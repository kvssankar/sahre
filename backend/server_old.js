import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

dotenv.config({ path: path.resolve("backend/.env") });

const salesText = fs.readFileSync(path.resolve("../assets/salesmini.txt"), "utf-8");

const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const wss = new WebSocketServer({ port: 8080 });
console.log("WebSocket server started on ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("Client connected");

  let audioChunks = [];
  let isTranscribing = false;
  let transcribeAbort = null;
  let chunkOffset = 0; // Track how much we've already transcribed

  ws.on("message", async (data) => {
    audioChunks.push(data);

    // Only start transcription if enough chunks for a window
    const windowSize = 20;
    if (!isTranscribing && audioChunks.length >= windowSize) {
      isTranscribing = true;
      transcribeNextWindow().catch((err) => {
        if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
          console.warn("AWS Transcribe stream closed early (likely short audio window).");
        } else {
          console.error("Transcription error:", err);
          ws.send(JSON.stringify({ error: err.message }));
        }
        isTranscribing = false;
      });
    }
  });

  ws.on("close", () => {
    if (transcribeAbort) transcribeAbort.abort();
    console.log("Client disconnected");
  });

  async function transcribeNextWindow() {
    // Write the next window of audio to a temp file
    const tempMp3 = path.join(os.tmpdir(), `audio-${Date.now()}.mp3`);
    const tempPcm = path.join(os.tmpdir(), `audio-${Date.now()}.pcm`);
    const writeStream = fs.createWriteStream(tempMp3);

    // Take the next N chunks (e.g., 10 seconds worth)
    const windowSize = 40; // Tune this for your chunk size and desired window (e.g., 40 chunks ~10s)
    const windowChunks = audioChunks.slice(chunkOffset, chunkOffset + windowSize);
    chunkOffset += windowChunks.length;

    for (const chunk of windowChunks) {
      writeStream.write(chunk);
    }
    writeStream.end();

    // Wait for file to finish writing
    await new Promise((resolve) => writeStream.on("finish", resolve));

    // Transcribe this window
    transcribeAbort = new AbortController();
    try {
    await streamTranscribe(ws, tempMp3, tempPcm, transcribeAbort.signal);
  } catch (err) {
    if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
      console.warn("AWS Transcribe stream closed early (likely short audio window).");
    } else {
      console.error("Transcription error:", err);
      ws.send(JSON.stringify({ error: err.message }));
    }
  }

    // Clean up temp files
    fs.unlinkSync(tempMp3);
    fs.unlinkSync(tempPcm);

    // If more audio has arrived, start the next window
    if (chunkOffset < audioChunks.length) {
      setTimeout(transcribeNextWindow, 100); // Small delay to allow more chunks to arrive
    } else {
      isTranscribing = false;
    }
  }
});

async function streamTranscribe(ws, tempMp3, tempPcm, abortSignal) {
  // Convert MP3 to PCM using ffmpeg (after enough data is written)
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i", tempMp3,
        "-ar", "8000",
        "-ac", "1",
        "-f", "s16le",
        tempPcm,
      ]
    );
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg failed"))));
  });

  // Generator to stream PCM file
  async function* pcmFileStream(chunkSize = 320) {
    const fd = fs.openSync(tempPcm, "r");
    const buffer = Buffer.alloc(chunkSize);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      yield { AudioEvent: { AudioChunk: Buffer.from(buffer.slice(0, bytesRead)) } };
      await new Promise((r) => setTimeout(r, 20));
      if (abortSignal.aborted) break;
    }
    fs.closeSync(fd);
    // Gracefully end the stream
    yield { AudioEvent: { AudioChunk: Buffer.alloc(0) } };
  }

  // Start AWS Transcribe streaming
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 8000,
    EnablePartialResultsStabilization: true,
    PartialResultsStability: PartialResultsStability.MEDIUM,
    AudioStream: pcmFileStream(),
    ShowSpeakerLabel: true, // Enable speaker labels
    MaxSpeakerLabels: 2,    // Set to 2 for two speakers
  });

  try {
    const response = await transcribeClient.send(command);
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript?.Results;
          if (results && results.length > 0) {
            const result = results[0];
            const transcript = result.Alternatives?.[0]?.Transcript;
            const speaker = result.Alternatives?.[0]?.Items?.[0]?.Speaker || result.SpeakerLabel || null;
            if (transcript && transcript.length > 0) {
              ws.send(JSON.stringify({ transcript, isFinal: !result.IsPartial, speaker }));
              if (!result.IsPartial) {
                const suggestion = getSuggestionFromSalesText(transcript);
                ws.send(JSON.stringify({ type: "suggestions", suggestions: [suggestion] }));
              }
            }
          }
        }
      }
    }
  } catch (err) {
    if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
      console.warn("AWS Transcribe stream closed early (likely short audio window).");
    } else {
      ws.send(JSON.stringify({ error: err.message }));
    }
  } finally {
    // fs.unlinkSync(tempMp3);
    // fs.unlinkSync(tempPcm);
  }
}

function getSuggestionFromSalesText(transcript) {
  // For demo: always return the first scenario, or you can match transcript to scenario
  const match = salesText.match(/Customer says: “([^”]+)”\s*“([^”]+)”\s*“([^”]+)”/);
  if (match) {
    return {
      title: `Customer says: "${match[1]}"`,
      content: `${match[2]}\n${match[3]}`,
    };
  }
  return {
    title: "Sample Suggestion",
    content: salesText.slice(0, 200) + "...",
  };
}
// import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
// import { WebSocketServer } from "ws";
// import dotenv from "dotenv";
// import fs from "fs";
// import os from "os";
// import path from "path";

// dotenv.config({ path: path.resolve("backend/.env") });

// // --- Load sales.txt content once ---
// const salesText = fs.readFileSync(path.resolve("../assets/salesmini.txt"), "utf-8");

// // --- AWS Transcribe Client ---
// const transcribeClient = new TranscribeStreamingClient({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });

// // --- WebSocket Server ---
// const wss = new WebSocketServer({ port: 8080 });
// console.log("WebSocket server started on ws://localhost:8080");

// wss.on("connection", (ws) => {
//   console.log("Client connected");

//   let isTranscribing = false;
//   let transcribeAbort = null;
//   let tempWebm = path.join(os.tmpdir(), `audio-${Date.now()}.webm`);
//   let tempPcm = path.join(os.tmpdir(), `audio-${Date.now()}.pcm`);
//   let writeStream = fs.createWriteStream(tempWebm);

//   ws.on("message", async (data) => {
//     // Receive audio chunk from frontend (webm)
//     writeStream.write(data);

//     // Start transcription on first chunk
//     if (!isTranscribing) {
//       isTranscribing = true;
//       transcribeAbort = new AbortController();
//       streamTranscribe(ws, tempWebm, tempPcm, transcribeAbort.signal);
//     }
//   });

//   ws.on("close", () => {
//     if (transcribeAbort) transcribeAbort.abort();
//     writeStream.end();
//     console.log("Client disconnected");
//   });
// });

// // --- Transcription Streaming ---
// async function streamTranscribe(ws, tempWebm, tempPcm, abortSignal) {
//   // Convert webm to PCM using ffmpeg (after enough data is written)
//   await new Promise(async (resolve, reject) => {
//     const { spawn } = await import("child_process");
//     const ffmpeg = spawn(
//       "ffmpeg",
//       [
//         "-y",
//         "-i", tempWebm,
//         "-ar", "8000",
//         "-ac", "1",
//         "-f", "s16le",
//         tempPcm,
//       ]
//     );
//     ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg failed"))));
//   });

//   // Generator to stream PCM file
//   async function* pcmFileStream(chunkSize = 320) {
//     const fd = fs.openSync(tempPcm, "r");
//     const buffer = Buffer.alloc(chunkSize);
//     let bytesRead;
//     while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
//       yield { AudioEvent: { AudioChunk: Buffer.from(buffer.slice(0, bytesRead)) } };
//       await new Promise((r) => setTimeout(r, 20));
//       if (abortSignal.aborted) break;
//     }
//     fs.closeSync(fd);
//   }

//   // Start AWS Transcribe streaming
//   const command = new StartStreamTranscriptionCommand({
//     LanguageCode: "en-US",
//     MediaEncoding: "pcm",
//     MediaSampleRateHertz: 8000,
//     EnablePartialResultsStabilization: true,
//     PartialResultsStability: PartialResultsStability.MEDIUM,
//     AudioStream: pcmFileStream(),
//   });

//   try {
//     const response = await transcribeClient.send(command);
//     if (response.TranscriptResultStream) {
//       for await (const event of response.TranscriptResultStream) {
//         if (event.TranscriptEvent) {
//           const results = event.TranscriptEvent.Transcript?.Results;
//           if (results && results.length > 0) {
//             const result = results[0];
//             const transcript = result.Alternatives?.[0]?.Transcript;
//             if (transcript && transcript.length > 0) {
//               if (result.IsPartial) {
//                 ws.send(JSON.stringify({ transcript, isFinal: false }));
//               } else {
//                 ws.send(JSON.stringify({ transcript, isFinal: true }));
//                 // Respond with a suggestion from sales.txt (for demo, just send the first suggestion)
//                 const suggestion = getSuggestionFromSalesText(transcript);
//                 ws.send(JSON.stringify({ type: "suggestions", suggestions: [suggestion] }));
//               }
//             }
//           }
//         }
//       }
//     }
//   } catch (err) {
//     ws.send(JSON.stringify({ error: err.message }));
//   } finally {
//     fs.unlinkSync(tempWebm);
//     fs.unlinkSync(tempPcm);
//   }
// }

// // --- Suggestion logic: simple demo, always returns the first scenario ---
// function getSuggestionFromSalesText(transcript) {
//   // For demo: just return the first scenario from sales.txt
//   // You can improve this to match transcript to a scenario if needed
//   const match = salesText.match(/Customer says: “([^”]+)”\s*“([^”]+)”\s*“([^”]+)”/);
//   if (match) {
//     return {
//       title: `Customer says: "${match[1]}"`,
//       content: `${match[2]}\n${match[3]}`,
//     };
//   }
//   // fallback: return first 200 chars
//   return {
//     title: "Sample Suggestion",
//     content: salesText.slice(0, 200) + "...",
//   };
// }