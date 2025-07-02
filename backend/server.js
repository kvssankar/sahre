import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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

  let audioBuffer = [];
  let isClosed = false;

  ws.on("message", (data) => {
    audioBuffer.push(Buffer.from(data));
  });

  ws.on("close", () => {
    isClosed = true;
    console.log("Client disconnected");
  });

  // Start streaming to AWS Transcribe as soon as connection is established
  streamTranscribe(ws, audioBuffer, () => isClosed);
});

async function* audioStreamGenerator(audioBuffer, isClosedFn) {
  let lastIndex = 0;
  while (!isClosedFn() || lastIndex < audioBuffer.length) {
    if (lastIndex < audioBuffer.length) {
      yield { AudioEvent: { AudioChunk: audioBuffer[lastIndex++] } };
      await new Promise((r) => setTimeout(r, 20));
    } else {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  // Graceful end
  yield { AudioEvent: { AudioChunk: Buffer.alloc(0) } };
}

async function streamTranscribe(ws, audioBuffer, isClosedFn) {
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 8000,
    EnablePartialResultsStabilization: true,
    PartialResultsStability: PartialResultsStability.MEDIUM,
    AudioStream: audioStreamGenerator(audioBuffer, isClosedFn),
    ShowSpeakerLabel: true,
    MaxSpeakerLabels: 2,
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
  }
}

function getSuggestionFromSalesText(transcript) {
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