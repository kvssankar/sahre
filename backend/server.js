import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ path: path.resolve("backend/.env") });

const salesText = fs.readFileSync(path.resolve("../assets/salesmini.txt"), "utf-8");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

  const speakerMap = {};
  let speakerCount = 1;
  let conversationHistory = [];
  let conversationSummary = "The conversation has just started.";
  let lastFinalSpeaker = null;
  let lastFinalTranscript = null;
  let inquirerSpeaker = null;
  let responderSpeaker = null;

  try {
    const response = await transcribeClient.send(command);
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript?.Results;
          if (results && results.length > 0) {
            const result = results[0];
            const transcript = result.Alternatives?.[0]?.Transcript;
            const awsSpeaker = result.SpeakerLabel || null;
            let speakerDisplay = null;
            if (awsSpeaker) {
              if (!speakerMap[awsSpeaker]) {
                speakerMap[awsSpeaker] = `Speaker ${speakerCount++}`;
              }
              speakerDisplay = speakerMap[awsSpeaker];
            }

            if (transcript && transcript.length > 0) {
              ws.send(JSON.stringify({ transcript, isFinal: !result.IsPartial, speaker: speakerDisplay }));

              if (!result.IsPartial) {
                conversationHistory.push(`${speakerDisplay}: ${transcript}`);

                // --- Update conversation summary using LLM ---
                try {
                  const summaryPrompt = `
Conversation summary so far:
${conversationSummary}

New utterance:
${speakerDisplay}: ${transcript}

Update the summary to include the new information. Return only the updated summary.
                  `;
                  const summaryResponse = await anthropic.messages.create({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1024,
                    temperature: 0.5,
                    system: "You are a helpful assistant that summarizes conversations between two people. Always return only the updated summary.",
                    messages: [
                      {
                        role: "user",
                        content: [
                          {
                            type: "text",
                            text: summaryPrompt
                          }
                        ]
                      }
                    ]
                  });
                  conversationSummary = summaryResponse.content[0].text.trim();
                  ws.send(JSON.stringify({ type: "summary", summary: conversationSummary }));
                } catch (e) {
                  console.warn("Failed to update summary:", e.message);
                }

                // Identify inquirer and responder on first two speakers
                if (!inquirerSpeaker) {
                  inquirerSpeaker = speakerDisplay;
                } else if (!responderSpeaker && speakerDisplay !== inquirerSpeaker) {
                  responderSpeaker = speakerDisplay;
                }

                // If the last final was from the inquirer and this one is from the responder, trigger LLM
                if (
                  lastFinalSpeaker === inquirerSpeaker &&
                  speakerDisplay === responderSpeaker &&
                  lastFinalTranscript
                ) {
                  try {
                    const llmInput = `
Conversation summary so far:
${conversationSummary}

Recent utterances:
${conversationHistory.slice(-6).join('\n')}
                    `;
                    const llmResponse = await anthropic.messages.create({
                      model: "claude-3-haiku-20240307",
                      max_tokens: 4096,
                      temperature: 1,
                      system: `You are monitoring a live conversation between two people:
- The inquirer (usually a customer or end user) is asking questions, raising objections, or sharing frustrations.
- The responder (usually a sales or support agent) is replying or listening.

The conversation is being transcribed in real-time. This means it may be mid-sentence or not yet complete. Your job is to:
1. Carefully read the full conversation transcript provided.
2. Check whether the inquirer has said something complete, clear, and meaningful — such as:
   - Asking a question
   - Raising a concern or objection
   - Expressing confusion, frustration, or doubt
3. If so, determine if the responder needs a Suggestion Card to help handle this moment effectively.
4. If not (e.g. mid-sentence, nothing clear, or the responder is currently speaking), return "ready_for_suggestions": "no".

When ready, return the following output in JSON format only:

\`\`\`json
{
  "ready_for_suggestions": "yes" or "no",
  "user_context": "[A short summary of what the inquirer is asking, complaining about, or confused by — to be used in a Suggestion Card]"
}
\`\`\``,
                      messages: [
                        {
                          role: "user",
                          content: [
                            {
                              type: "text",
                              text: llmInput
                            }
                          ]
                        }
                      ]
                    });

                    let llmJson = null;
                    try {
                      const match = llmResponse.content[0].text.match(/\{[\s\S]*\}/);
                      llmJson = match ? JSON.parse(match[0]) : null;
                    } catch (e) {
                      llmJson = { ready_for_suggestions: "no", user_context: "Could not parse LLM response." };
                    }

                    ws.send(JSON.stringify({ type: "llm_eval", llm: { ...llmJson, speaker: inquirerSpeaker, transcript: lastFinalTranscript, summary: conversationSummary } }));

                    if (llmJson && llmJson.ready_for_suggestions === "yes") {
                      const suggestion = getSuggestionFromSalesText(lastFinalTranscript);
                      ws.send(JSON.stringify({ type: "suggestions", suggestions: [suggestion] }));
                    }
                  } catch (e) {
                    ws.send(JSON.stringify({ type: "llm_eval", llm: { ready_for_suggestions: "no", user_context: "LLM error: " + e.message, speaker: inquirerSpeaker, transcript: lastFinalTranscript, summary: conversationSummary } }));
                  }
                }

                lastFinalSpeaker = speakerDisplay;
                lastFinalTranscript = transcript;
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