import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { BedrockEmbeddings } from "@langchain/aws";

dotenv.config({ path: path.resolve("backend/.env") });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUGGESTION_SYSTEM_PROMPT = `You are an AI assistant embedded in a live conversation between two people:

- The “inquirer” is a customer, stakeholder, or user who may be frustrated, confused, or asking questions.
- The “responder” is a support or sales agent who relies on you to surface 1 quick, helpful Suggestion Card based on the message and supporting documents.

🎯 Your task:
- For every user message, return exactly 1 Suggestion Card.
- It should be short, actionable, and easy to read quickly during a live call.

✅ Guidelines:
- Format output as:
  [Trigger Phrase: "..."]
  Suggestion Card:  
  Title: [Short title]  
  Content:
  - [1-liner action tip]  
  - [1-liner tone tip]  
  - [1-liner fact or doc reference if helpful]

- Keep each bullet under 12 words.
- No paragraphs, no explanations.
- Use helpful verbs: “Acknowledge,” “Offer,” “Clarify,” “Mention,” “Share,” “Ask,” “Defer”

⚠️ Rules:
- Do NOT return more than one card per message
- Do NOT use long sentences
- Avoid generic tips like “be helpful” or “respond professionally”

🧾 Example:

[Trigger Phrase: “Your tool completely missed 2 SLAs last month. We lost a huge contract.”]  
Suggestion Card:  
Title: Calm SLA Escalation Response  
Content:  
- Acknowledge SLA breach, no deflection  
- Use steady tone: “I get how serious this is”  
- Offer SLA report review + escalation path

Now begin.
`;

const vectorsPath = path.resolve("heythere_vectors.json");
let salesVectors = [];
if (fs.existsSync(vectorsPath)) {
  salesVectors = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));
} else {
  console.warn("sales_txt_vectors.json not found. Please run the ingestion script first.");
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getTopKRelevantChunks(query, k = 3) {
  const embedder = new BedrockEmbeddings({
    region: process.env.AWS_REGION || "us-east-1",
    model: "amazon.titan-embed-text-v1",
  });
  const [queryVec] = await embedder.embedDocuments([query]);
  const scored = salesVectors.map(obj => ({
    chunk: obj.chunk,
    score: cosineSimilarity(queryVec, obj.vector)
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, k).map(s => s.chunk);
}

const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const wss = new WebSocketServer({ port: 8080 });
console.log("WebSocket server started on ws://localhost:8080");

wss.on("connection", async (ws) => {
  console.log("Client connected");

  let audioBuffer = [];
  let isClosed = false;

  // Precompute RAG summary ONCE per connection
  let ragSummary = "";
  try {
    // Use a generic query to get the most representative context (e.g., first chunk or a default question)
    const topChunks = await getTopKRelevantChunks("overview", 3);
    const summaryPrompt = `Summarize the following knowledge base context in 2-3 sentences for a sales/support agent:\n\n${topChunks.join("\n---\n")}`;
    const ragSummaryResponse = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 256,
      temperature: 0.2,
      system: "You are a helpful assistant that summarizes knowledge base context for sales/support agents.",
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
    ragSummary = ragSummaryResponse.content[0].text.trim();
    console.log("Precomputed RAG summary:", ragSummary);
  } catch (e) {
    ragSummary = "";
    console.warn("RAG summary error (on connect):", e.message);
  }

  ws.on("message", (data) => {
    audioBuffer.push(Buffer.from(data));
  });

  ws.on("close", () => {
    isClosed = true;
    console.log("Client disconnected");
  });

  streamTranscribe(ws, audioBuffer, () => isClosed, ragSummary);
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

async function streamTranscribe(ws, audioBuffer, isClosedFn, ragSummary) {
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-IN",
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

                // --- Update conversation summary using LLM (optional, can keep as before) ---
                try {
                  const summaryPrompt = `
Conversation summary so far:
${conversationSummary}

New utterance:
${speakerDisplay}: ${transcript}

Instructions:
- Infer which speaker is the customer and which is the agent, based on their utterances.
- Assign and use the roles "Customer" and "Agent" (instead of "Speaker 1"/"Speaker 2") in the summary and conversation history.
- If you are not sure, make your best guess based on context.
- Return only the updated summary, using "Customer:" and "Agent:" for each turn.
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

                // If the last final was from the inquirer and this one is from the responder, trigger LLM evaluation (Prompt 1)
                if (
                  lastFinalSpeaker === inquirerSpeaker &&
                  speakerDisplay === responderSpeaker &&
                  lastFinalTranscript
                ) {
                  try {

                    // Use precomputed RAG summary for this connection

                    // Prompt 1: LLM evaluation for suggestion card trigger, and if RAG is required
                    const evalPrompt = `
You are an AI assistant monitoring a live conversation between a customer and an agent.

Product and Sales Context (from knowledge base):
${ragSummary}

Conversation Summary:
${conversationSummary}

Recent Conversation History:
${conversationHistory.slice(-6).join('\n')}

Customer's Latest Message:
${lastFinalTranscript}

Instructions:
- Evaluate the customer's latest message and decide:
  1. Is a suggestion card needed? (yes/no)
  2. Is RAG (knowledge base context) required to answer/help? (yes/no)
  3. If suggestion card is needed, provide a short summary of the user's intent as "user_context".
- Suggestion cards can be needed for both RAG and non-RAG (generic sales/help/tone) cases.
- If the message is off-topic or not actionable, set both to "no".

Respond ONLY in this JSON format:
{
  "ready_for_suggestions": "yes" or "no",
  "is_rag_required": "yes" or "no",
  "user_context": "[short summary of the customer's question or concern]"
}
                    `;
                    const evalResponse = await anthropic.messages.create({
                      model: "claude-3-haiku-20240307",
                      max_tokens: 512,
                      temperature: 0.2,
                      system: "",
                      messages: [
                        {
                          role: "user",
                          content: [
                            {
                              type: "text",
                              text: evalPrompt
                            }
                          ]
                        }
                      ]
                    });

                    let evalJson = null;
                    try {
                      const match = evalResponse.content[0].text.match(/\{[\s\S]*\}/);
                      evalJson = match ? JSON.parse(match[0]) : null;
                    } catch (e) {
                      evalJson = { ready_for_suggestions: "no", user_context: "Could not parse LLM response." };
                    }

                    ws.send(JSON.stringify({
                      type: "llm_eval",
                      llm: {
                        ...evalJson,
                        trigger: lastFinalTranscript,
                        summary: conversationSummary,
                        history: conversationHistory.slice(-6).join('\n')
                      }
                    }));

                    // Only call Prompt 2 if ready_for_suggestions is "yes"
                    if (evalJson && evalJson.ready_for_suggestions === "yes") {
                      let ragContext = "";
                      if (evalJson.is_rag_required === "yes") {
                        // RAG required: Find relevant context from local vectors
                        try {
                          const topChunks = await getTopKRelevantChunks(lastFinalTranscript, 3);
                          ragContext = topChunks.join("\n---\n");
                        } catch (e) {
                          ragContext = "";
                          console.warn("Local RAG error:", e.message);
                        }
                      }

                      const suggestionPrompt = `
${SUGGESTION_SYSTEM_PROMPT}

Product and Sales Context (from knowledge base):
${ragSummary}

${evalJson.is_rag_required === "yes" ? `Relevant Knowledge Base (RAG):\n${ragContext}\n` : ""}
Conversation Summary:
${conversationSummary}

Recent Conversation History:
${conversationHistory.slice(-6).join('\n')}

User Question (Trigger Phrase):
${lastFinalTranscript}
                      `;
                      const suggestionResponse = await anthropic.messages.create({
                        model: "claude-sonnet-4-20250514",
                        max_tokens: 2000,
                        temperature: 1,
                        system: "",
                        messages: [
                          {
                            role: "user",
                            content: [
                              {
                                type: "text",
                                text: suggestionPrompt
                              }
                            ]
                          }
                        ]
                      });

                      let suggestionText = suggestionResponse.content[0].text.trim();
                      ws.send(JSON.stringify({
                        type: "suggestions",
                        suggestions: [{
                          title: "Suggestion Card",
                          content: suggestionText,
                          trigger: lastFinalTranscript
                        }]
                      }));
                    }
                  } catch (e) {
                    ws.send(JSON.stringify({
                      type: "llm_eval",
                      llm: {
                        ready_for_suggestions: "no",
                        user_context: "LLM error: " + e.message,
                        trigger: lastFinalTranscript,
                        summary: conversationSummary,
                        history: conversationHistory.slice(-6).join('\n')
                      }
                    }));
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