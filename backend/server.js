import { TranscribeStreamingClient, StartStreamTranscriptionCommand, PartialResultsStability } from "@aws-sdk/client-transcribe-streaming";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ path: path.resolve("backend/.env") });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PRODUCT_CONTEXT = `
Product Overview:
Our CRM platform helps businesses streamline their sales process, manage leads efficiently, and automate follow-ups. It integrates seamlessly with popular tools like Salesforce, HubSpot, Slack, Gmail, and more. With features like real-time analytics, intelligent lead scoring, and customizable workflows, our product supports both small teams and large enterprises. Pricing starts at $49 per user per month, with tiered plans for larger teams.

Typical Customer Challenges:
Many of our users switch to us because they’re struggling with leads slipping through the cracks due to scattered tools and manual processes. Some find it hard to customize workflows without developer support. Others are frustrated with outdated reports or time-consuming integrations. Our CRM solves these issues with end-to-end visibility, easy automation, and live dashboards that update in real time.

Objection Handling:
When prospects say we’re too expensive, we explain how our customers typically see 3–5x ROI in just a few months by recovering lost leads and saving time. If someone mentions they already use Salesforce, we highlight that we enhance Salesforce’s capabilities by eliminating tedious admin work. For those worried about setup time, we share that most customers are onboarded within a week, and we offer white-glove onboarding support to make it seamless.

Industry Templates:
We offer ready-made templates based on industry. For example, in real estate, we support workflows from lead capture through to document collection and deal closure. In healthcare, we support appointment scheduling, reminders, and patient feedback. EdTech clients use us to manage demo bookings, free trial activations, and student follow-ups with automated messaging.

Success Stories:
ABC Corp improved their lead conversion rate by 37% in just two months using our automated follow-ups. A financial services client reduced manual CRM tasks by 40% by integrating our platform with their internal tools. These success stories help reinforce trust and demonstrate real-world impact.

Trigger-Based Guidance:
During calls, if a prospect mentions they currently manage sales in Excel, the assistant should surface a prompt explaining the benefits of switching to a dedicated CRM—like fewer errors, better tracking, and time saved. If they ask about setup time, a quick success story and average onboarding timeline should be shown. If the user talks about managing a large team, the assistant can highlight our features for collaboration, permissions, and team performance tracking. If data privacy comes up, cards about SOC 2 compliance and role-based access should appear instantly.
`;

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
                    // Prompt 1: LLM evaluation for suggestion card trigger
                    const evalPrompt = `
You are an AI assistant monitoring a live conversation between a customer and an agent.

Product and Sales Context:
${PRODUCT_CONTEXT}

Conversation Summary:
${conversationSummary}

Recent Conversation History:
${conversationHistory.slice(-6).join('\n')}

Customer's Latest Message:
${lastFinalTranscript}

Instructions:
- Decide if the customer's latest message is a clear, relevant question, objection, or concern about the product, sales process, or support, and is related to the product context above.
- If it is relevant and actionable, return "ready_for_suggestions": "yes".
- If it is not relevant to the product context, or is off-topic, return "ready_for_suggestions": "no".
- Also return a short summary of the customer's intent as "user_context".

Respond ONLY in this JSON format:
{
  "ready_for_suggestions": "yes" or "no",
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
                      const suggestionPrompt = `
${SUGGESTION_SYSTEM_PROMPT}

Product and Sales Context:
${PRODUCT_CONTEXT}

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