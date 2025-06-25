import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  PartialResultsStability,
} from "@aws-sdk/client-transcribe-streaming";
import alawmulaw from "alawmulaw";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const { mulaw } = alawmulaw;

// AWS Transcribe client
const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Utility: Convert MP3 to 8kHz mono PCM using ffmpeg
async function convertMp3ToPcmUlaw(mp3Path, outPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i", mp3Path,
        "-ar", "8000",
        "-ac", "1",
        "-f", "s16le",
        outPath,
      ],
      { stdio: "ignore" }
    );
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg failed"));
    });
  });
}

// Generator: Stream PCM file as μ-law chunks
// async function* pcmFileToUlawStream(pcmPath, chunkSize = 320) {
//   const fd = fs.openSync(pcmPath, "r");
//   const buffer = Buffer.alloc(chunkSize);
//   let bytesRead;
//   while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
//     // Convert PCM to μ-law
//     const pcmSamples = new Int16Array(buffer.buffer, buffer.byteOffset, bytesRead / 2);
//     const muLawSamples = mulaw.encode(pcmSamples);
//     yield {
//       AudioEvent: {
//         AudioChunk: Buffer.from(muLawSamples.buffer),
//       },
//     };
//     await new Promise((r) => setTimeout(r, 20)); // Simulate streaming
//   }
//   fs.closeSync(fd);
// }

async function* pcmFileStream(pcmPath, chunkSize = 320) {
  const fd = fs.openSync(pcmPath, "r");
  const buffer = Buffer.alloc(chunkSize);
  let bytesRead;
  while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
    yield {
      AudioEvent: {
        AudioChunk: Buffer.from(buffer.slice(0, bytesRead)),
      },
    };
    await new Promise((r) => setTimeout(r, 20));
  }
  fs.closeSync(fd);
}

// Main transcription function
async function transcribeMp3Streaming(mp3Path) {
  const tempPcmPath = path.join(path.dirname(mp3Path), "temp-audio.pcm");
  await convertMp3ToPcmUlaw(mp3Path, tempPcmPath);

  // const command = new StartStreamTranscriptionCommand({
  //   LanguageCode: "en-US",
  //   MediaEncoding: "pcm",
  //   MediaSampleRateHertz: 8000,
  //   EnablePartialResultsStabilization: true,
  //   PartialResultsStability: PartialResultsStability.MEDIUM,
  //   AudioStream: pcmFileToUlawStream(tempPcmPath),
  // });
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 8000,
    EnablePartialResultsStabilization: true,
    PartialResultsStability: PartialResultsStability.MEDIUM,
    AudioStream: pcmFileStream(tempPcmPath),
  });

  let lastTranscript = "";
  let allTranscripts = [];
  let lastLoggedTime = Date.now();

  console.log("Starting streaming transcription...");

  const response = await transcribeClient.send(command);

  if (response.TranscriptResultStream) {
    for await (const event of response.TranscriptResultStream) {
      if (event.TranscriptEvent) {
        const results = event.TranscriptEvent.Transcript?.Results;
        if (results && results.length > 0) {
          const result = results[0];
          const transcript = result.Alternatives?.[0]?.Transcript;
          if (transcript && transcript.length > 0) {
            if (result.IsPartial) {
              // Log partial if gap > 1s since last log
              if (Date.now() - lastLoggedTime > 1000 && transcript !== lastTranscript) {
                console.log(`🔄 Partial: "${transcript}"`);
                lastLoggedTime = Date.now();
                lastTranscript = transcript;
              }
            } else {
              // Log final transcript
              console.log(`📝 Final: "${transcript}"`);
              allTranscripts.push(transcript);
              lastLoggedTime = Date.now();
              lastTranscript = "";
            }
          }
        }
      }
    }
  }

  // Clean up temp file
  fs.unlinkSync(tempPcmPath);

  // Show summary
  const summary = allTranscripts.join(" ");
  console.log("\n=== SUMMARY ===");
  console.log(summary);
}

// Run transcription on E:\Hack\assets\testaudio.mp3
transcribeMp3Streaming("E:\\Hack\\assets\\testaudio.mp3").catch(console.error);