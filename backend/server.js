import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { RetrievalQAChain } from "langchain/chains";
import { ChatAnthropic, AnthropicEmbeddings } from "@langchain/anthropic";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";

dotenv.config({ path: path.resolve("backend/.env") });

// --- RAG SETUP (ChromaDB + LangChain + Anthropic) ---
const vectorStore = await Chroma.fromExistingCollection(
  new AnthropicEmbeddings({ apiKey: process.env.ANTHROPIC_API_KEY }),
  { collectionName: "reference_docs" }
);
const llm = new ChatAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ragChain = RetrievalQAChain.fromLLM(llm, vectorStore.asRetriever());

// --- AWS Transcribe Client ---
const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ port: 8080 });
console.log("WebSocket server started on ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("Client connected");

  let isTranscribing = false;
  let transcribeAbort = null;
  let tempWebm = path.join(os.tmpdir(), `audio-${Date.now()}.webm`);
  let tempPcm = path.join(os.tmpdir(), `audio-${Date.now()}.pcm`);
  let writeStream = fs.createWriteStream(tempWebm);

  ws.on("message", async (data) => {
    // Receive audio chunk from frontend (webm)
    writeStream.write(data);

    // Start transcription on first chunk
    if (!isTranscribing) {
      isTranscribing = true;
      transcribeAbort = new AbortController();
      streamTranscribe(ws, tempWebm, tempPcm, transcribeAbort.signal);
    }
  });

  ws.on("close", () => {
    if (transcribeAbort) transcribeAbort.abort();
    writeStream.end();
    console.log("Client disconnected");
  });
});

// --- Transcription Streaming ---
async function streamTranscribe(ws, tempWebm, tempPcm, abortSignal) {
  // Convert webm to PCM using ffmpeg (after enough data is written)
  await new Promise((resolve, reject) => {
    const ffmpeg = require("child_process").spawn(
      "ffmpeg",
      [
        "-y",
        "-i", tempWebm,
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
  }

  // Start AWS Transcribe streaming
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 8000,
    EnablePartialResultsStabilization: true,
    PartialResultsStability: PartialResultsStability.MEDIUM,
    AudioStream: pcmFileStream(),
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
            if (transcript && transcript.length > 0) {
              if (result.IsPartial) {
                ws.send(JSON.stringify({ transcript, isFinal: false }));
              } else {
                ws.send(JSON.stringify({ transcript, isFinal: true }));
                // RAG: Get suggestions and send as cards
                const suggestions = await getSuggestions(transcript);
                ws.send(JSON.stringify({ type: "suggestions", suggestions }));
              }
            }
          }
        }
      }
    }
  } catch (err) {
    ws.send(JSON.stringify({ error: err.message }));
  } finally {
    fs.unlinkSync(tempWebm);
    fs.unlinkSync(tempPcm);
  }
}

// --- RAG Suggestion Pipeline ---
async function getSuggestions(transcript) {
  const ragResult = await ragChain.call({ query: transcript });
  return [
    {
      title: "Suggested Next Question",
      content: ragResult.text,
    },
  ];
}