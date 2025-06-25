import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import sessionManager from "./SessionManager.js";
import { SessionDataProperty } from "../utils/index.js";
import WebSocket from "ws";
import alawmulaw from "alawmulaw";
const { mulaw } = alawmulaw;

const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const activeVoiceResponses = new Map();

async function convertTextToSpeechStream(sessionId, text) {
  console.log(`Converting text to speech for session ${sessionId}: ${text}`);

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: "pcm",
      VoiceId: "Joanna",
      Engine: "neural",
      SampleRate: "8000", // 8kHz for Twilio
      TextType: "text",
    });

    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream received from Polly");
    }

    const audioBuffer = await streamToBuffer(response.AudioStream);

    // Convert PCM (Int16LE) to μ-law using alawmulaw
    const pcmSamples = new Int16Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.length / 2
    );
    const muLawSamples = mulaw.encode(pcmSamples);
    const mulawBuffer = Buffer.from(muLawSamples.buffer);

    const audioOutput = mulawBuffer.toString("base64");

    const ws = sessionManager.getProperty(sessionId, SessionDataProperty.ws);
    const streamSid = sessionManager.getProperty(
      sessionId,
      SessionDataProperty.streamSid
    );

    if (!ws || !streamSid) {
      console.error("WebSocket or StreamSid not found for session:", sessionId);
      return "";
    }

    const mediaMessage = {
      event: "media",
      streamSid: streamSid,
      media: {
        payload: audioOutput,
      },
    };

    console.log(
      `WebSocket ready state: ${ws.readyState}, OPEN: ${WebSocket.OPEN}`
    );

    if (ws.readyState === WebSocket.OPEN) {
      activeVoiceResponses.set(sessionId, {
        timestamp: Date.now(),
        text: text,
      });

      ws.send(JSON.stringify(mediaMessage));
      console.log(`Voice response sent for session ${sessionId}`);

      setTimeout(() => {
        activeVoiceResponses.delete(sessionId);
      }, estimateAudioDuration(text) * 1000 + 1000);
    } else {
      console.error(
        `WebSocket not ready for session ${sessionId}. ReadyState: ${ws.readyState}`
      );
    }

    return JSON.stringify(mediaMessage);
  } catch (error) {
    console.error("Error in text to speech conversion:", error);
    return "";
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];

  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// Estimate audio duration based on text length
function estimateAudioDuration(text) {
  const wordsPerMinute = 150;
  const avgWordLength = 5;
  const estimatedWords = text.length / avgWordLength;
  const durationMinutes = estimatedWords / wordsPerMinute;
  return durationMinutes * 60;
}

// Stop/interrupt current voice response
function stopVoiceResponse(sessionId) {
  console.log(`Stopping voice response for session ${sessionId}`);

  const ws = sessionManager.getProperty(sessionId, SessionDataProperty.ws);
  const streamSid = sessionManager.getProperty(
    sessionId,
    SessionDataProperty.streamSid
  );

  if (ws && ws.readyState === WebSocket.OPEN && streamSid) {
    const clearMessage = {
      event: "clear",
      streamSid: streamSid,
    };

    ws.send(JSON.stringify(clearMessage));
    console.log(`Clear message sent for session ${sessionId}`);
  }

  activeVoiceResponses.delete(sessionId);
}

// Check if there's an active voice response
function hasActiveVoiceResponse(sessionId) {
  return activeVoiceResponses.has(sessionId);
}

// Get available Polly voices
async function getAvailableVoices() {
  try {
    const { ListVoicesCommand } = await import("@aws-sdk/client-polly");
    const command = new ListVoicesCommand({
      LanguageCode: "en-US",
      Engine: "neural",
    });

    const response = await pollyClient.send(command);
    return response.Voices || [];
  } catch (error) {
    console.error("Error fetching available voices:", error);
    return [];
  }
}

// Wrapper function to retry with fallback engine
async function convertTextToSpeechWithVoice(
  sessionId,
  text,
  voiceId = "Joanna",
  engine = "neural"
) {
  try {
    return await convertTextToSpeechStream(sessionId, text);
  } catch (error) {
    console.error(`Error with voice ${voiceId}:`, error);

    if (engine === "neural") {
      console.log("Falling back to standard engine...");
      return await convertTextToSpeechWithVoice(
        sessionId,
        text,
        voiceId,
        "standard"
      );
    }

    throw error;
  }
}

export {
  convertTextToSpeechStream,
  stopVoiceResponse,
  hasActiveVoiceResponse,
  getAvailableVoices,
  convertTextToSpeechWithVoice,
};

----------------


import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  PartialResultsStability,
} from "@aws-sdk/client-transcribe-streaming";
import { RunType, SessionDataProperty } from "../utils/index.js";
import sessionManager from "./SessionManager.js";
import { stopVoiceResponse } from "./Synthesizer.js";
import alawmulaw from "alawmulaw";
const { mulaw } = alawmulaw;

export default class AmazonTranscriber {
  keepAlive = true;
  callSid = "";
  isConnected = false;
  isStreaming = false; // Add this separate flag
  transcriber = null;
  options = null;
  streamController = null;
  audioBuffer = [];

  constructor() {
    this.options = {
      LanguageCode: "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 8000,
      EnablePartialResultsStabilization: true,
      PartialResultsStability: PartialResultsStability.MEDIUM,
    };

    this.streamController = new AbortController();
    this.transcriber = new TranscribeStreamingClient();
  }

  connect(callSid) {
    this.callSid = callSid;
    this.startTranscription();
  }

  async startTranscription() {
    try {
      this.isStreaming = true; // Set streaming flag first

      this.command = new StartStreamTranscriptionCommand({
        ...this.options,
        AudioStream: this.getAudioStream(),
      });

      console.log("Sending transcription command...");
      const response = await this.transcriber.send(this.command);
      this.isConnected = true;
      console.log("Amazon Transcribe: connected and streaming started");

      this.processTranscriptionResults(response);
    } catch (error) {
      console.error("Amazon Transcribe: connection error", error);
      this.isConnected = false;
      this.isStreaming = false;
    }
  }

  async *getAudioStream() {
    console.log("Audio stream generator started, waiting for audio...");

    while (this.isStreaming && !this.streamController.signal.aborted) {
      if (this.audioBuffer.length > 0) {
        const chunk = this.audioBuffer.shift();
        if (chunk && chunk.length > 0) {
          const pcmChunk = this.convertMulawToPCM(chunk);
          //   console.log(`Yielding audio chunk: ${pcmChunk.length} bytes`);

          yield {
            AudioEvent: {
              AudioChunk: pcmChunk,
            },
          };
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    console.log("Audio stream generator ended");
  }

  convertMulawToPCM(mulawBuffer) {
    const muLawSamples = new Uint8Array(
      mulawBuffer.buffer,
      mulawBuffer.byteOffset,
      mulawBuffer.length
    );
    const pcmSamples = mulaw.decode(muLawSamples);
    return Buffer.from(pcmSamples.buffer);
  }

  async processTranscriptionResults(response) {
    try {
      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (event.TranscriptEvent) {
            const results = event.TranscriptEvent.Transcript?.Results;
            if (results && results.length > 0) {
              const result = results[0];
              const transcript = result.Alternatives?.[0]?.Transcript;

              if (transcript && transcript.length > 0) {
                console.log(
                  `Amazon Transcribe: ${
                    result.IsPartial ? "Partial" : "Final"
                  } - ${transcript}`
                );

                if (result.IsPartial) {
                  // Handle partial transcripts - stop current voice response
                  if (
                    sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.apiProcessing
                    ) ||
                    sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.outputBlockProcessing
                    ) ||
                    sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.agentLoopProcessing
                    )
                  ) {
                    console.log(
                      "Amazon Transcribe Partial ignored script:",
                      transcript
                    );
                  } else {
                    // sessionManager.setProperty(
                    //   this.callSid,
                    //   SessionDataProperty.humanSpeaking,
                    //   true
                    // );
                    console.log(
                      "Amazon Transcribe Partial script:",
                      transcript
                    );
                    stopVoiceResponse(this.callSid);
                  }
                } else {
                  // Handle final transcripts
                  console.log("Amazon Transcribe Final script:", transcript);
                  const status = await processData(transcript, this.callSid);
                  if (status === "transferred") {
                    logger.info({
                      type: "transfer",
                      session_id: this.callSid,
                      message:
                        "Amazon Transcribe closed as the call got transferred",
                    });
                    this.close();
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Amazon Transcribe: error processing results", error);
    }
  }

  processVoice(twilioData) {
    if (this.isConnected && twilioData) {
      try {
        const audioBuffer = Buffer.from(twilioData, "base64");
        this.audioBuffer.push(audioBuffer);
        // console.log(
        //   `Audio buffered: ${audioBuffer.length} bytes, total buffer: ${this.audioBuffer.length} chunks`
        // );
      } catch (error) {
        console.error("Error processing voice data:", error);
      }
    } else {
      console.log("Not connected or no audio data");
    }
  }

  close() {
    console.log("Amazon Transcribe: disconnecting");
    this.isConnected = false;
    this.isStreaming = false; // Stop streaming
    this.audioBuffer = [];
    this.streamController.abort();
  }
}

async function processData(transcript, callSid) {
  if (
    !sessionManager.getProperty(callSid, SessionDataProperty.apiProcessing) &&
    !sessionManager.getProperty(
      callSid,
      SessionDataProperty.outputBlockProcessing
    ) &&
    !sessionManager.getProperty(
      callSid,
      SessionDataProperty.agentLoopProcessing
    )
  ) {
    try {
      const session = sessionManager.sessions[callSid];
      const userId = session?.userId || "684d43c3234f6819aae4d80e";

      await sessionManager.run({
        session_id: callSid,
        text: transcript,
        type: RunType.AI,
        isChat: false,
        userId: userId,
      });
    } catch (error) {
      console.error("Error processing data:", error);
    }
  }
}


--------------

  async processMessage(userMessage) {
    // Add to history
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    });

    // Check if we're waiting for intent confirmation
    if (this.pendingIntent) {
      return await this.handleIntentConfirmation(userMessage);
    }

    const tools = [
      {
        name: "search_knowledge_base",
        description: "Search for information to answer user questions",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for the knowledge base",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "identify_intent",
        description:
          "Identify user's specific intent when they describe a need or problem",
        input_schema: {
          type: "object",
          properties: {
            user_message: {
              type: "string",
              description: "The user's message to analyze for intent",
            },
          },
          required: ["user_message"],
        },
      },
    ];

    const systemPrompt = `You are a friendly, conversational assistant. Your goal is to:

1. Have natural, engaging conversations with users
2. When users ask questions, ALWAYS use the search_knowledge_base tool to find answers
3. Only provide information that comes from the knowledge base search results
4. If the search returns no results, politely say you don't have that information and ask for more details
5. When users describe problems or needs, use the identify_intent tool
6. If no intent is identified, ask clarifying questions to better understand their needs
7. Keep responses conversational and warm, but stay focused on helping

Important rules:
- Never answer factual questions without using search_knowledge_base first
- If search returns nothing, don't make up answers - ask for clarification
- Be genuinely interested in understanding what the user needs
- Guide conversations naturally toward identifying how you can help
- When an intent is identified, you'll receive confirmation instructions`;

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MEDIUM_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      tools,
      messages: [
        ...this.getFormattedHistory(),
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    await convertTextToSpeechStream(
      this.session?.sessionId,
      cleanText(getAIText(response))
    );

    // Process tool calls
    let finalResponse = response;
    let intentFound = false;
    let finalResponseChanged = false;

    console.log("Claude response:", response);

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const toolResult = await this.executeTool(block.name, block.input);

        console.log(`Tool result for ${block.name}:`, toolResult);

        // Check if intent was found
        if (block.name === "identify_intent" && toolResult.intent) {
          intentFound = true;
          this.pendingIntent = toolResult.intent;
        }
        finalResponseChanged = true;
        // Send tool result back to Claude for final response
        finalResponse = await client.messages.create({
          model: process.env.ANTHROPIC_MEDIUM_MODEL,
          max_tokens: 500,
          system: systemPrompt,
          tools,
          messages: [
            ...this.getFormattedHistory(),
            {
              role: "user",
              content: userMessage,
            },
            {
              role: "assistant",
              content: response.content,
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify(toolResult),
                },
              ],
            },
          ],
        });
      }
    }

    const responseText = this.extractText(finalResponse);

    if (finalResponseChanged) {
      await convertTextToSpeechStream(
        this.session?.sessionId,
        cleanText(responseText)
      );
    }

    // Add to history
    this.conversationHistory.push({
      role: "assistant",
      content: responseText,
      timestamp: new Date(),
    });

    // If intent was found, ask for confirmation
    if (intentFound && this.pendingIntent) {
      const confirmationText = `I understand you need help with "${this.pendingIntent.intent}". Is that correct?`;

      await convertTextToSpeechStream(
        this.session?.sessionId,
        cleanText(confirmationText)
      );

      this.conversationHistory.push({
        role: "assistant",
        content: confirmationText,
        timestamp: new Date(),
      });

      return {
        text: responseText + "\n\n" + confirmationText,
        pendingIntent: this.pendingIntent,
        awaitingConfirmation: true,
      };
    }

    return {
      text: responseText,
      pendingIntent: null,
      awaitingConfirmation: false,
    };
  }


    async executeTool(toolName, input) {
    switch (toolName) {
      case "search_knowledge_base":
        try {
          const results = await performRAGSearch(input.query, this.userId);
          return {
            success: true,
            results: results || [],
            query: input.query,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }

      case "identify_intent":
        try {
          if (!this.session.intents) {
            this.session.intents = await getIntents(this.userId);
          }
          // Get intents from session if available
          const identifiedIntent = await intentFinder(
            this.session.intents,
            input.user_message
          );

          return {
            success: true,
            intent: identifiedIntent,
            found: !!identifiedIntent,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }

      default:
        return { success: false, error: "Unknown tool" };
    }
  }