import Anthropic from "@anthropic-ai/sdk";
import environment from "../config/environment.js";
import {
  SUGGESTION_SYSTEM_PROMPT,
  AI_MODELS,
  CONVERSATION_DEFAULTS,
} from "../constants/index.js";
import {
  extractJsonFromResponse,
  hasCurlyBracesWithText,
  extractTextWithinCurlyBraces,
  safeJsonParse,
} from "../utils/index.js";

/**
 * AI Service for handling Claude interactions
 * Manages conversation summaries, evaluations, and suggestions
 */
class AIService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: environment.anthropic.apiKey,
    });
  }

  /**
   * Generate a summary of knowledge base context
   * @param {string[]} topChunks - Array of relevant text chunks
   * @returns {Promise<string>} Summary text
   */
  async generateRAGSummary(topChunks) {
    if (!topChunks || topChunks.length === 0) {
      return "";
    }

    try {
      const summaryPrompt = `Summarize the following knowledge base context in 2-3 sentences for a sales/support agent:\n\n${topChunks.join(
        "\n---\n"
      )}`;

      const response = await this.anthropic.messages.create({
        model: AI_MODELS.SUMMARY,
        max_tokens: 256,
        temperature: 0.2,
        system:
          "You are a helpful assistant that summarizes knowledge base context for sales/support agents.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: summaryPrompt }],
          },
        ],
      });

      return response.content[0].text.trim();
    } catch (error) {
      console.error("Error generating RAG summary:", error.message);
      return "";
    }
  }

  /**
   * Update conversation summary with new utterance
   * @param {string} currentSummary - Current conversation summary
   * @param {string} speakerDisplay - Speaker identifier
   * @param {string} transcript - New transcript text
   * @returns {Promise<string>} Updated summary
   */
  async updateConversationSummary(currentSummary, speakerDisplay, transcript) {
    try {
      const summaryPrompt = `
Conversation summary so far:
${currentSummary}

New utterance:
${speakerDisplay}: ${transcript}

Instructions:
- Infer which speaker is the customer and which is the agent, based on their utterances.
- Assign and use the roles "Customer" and "Agent" (instead of "Speaker 1"/"Speaker 2") in the summary and conversation history.
- If you are not sure, make your best guess based on context.
- Return only the updated summary, using "Customer:" and "Agent:" for each turn.
`;

      const response = await this.anthropic.messages.create({
        model: AI_MODELS.SUMMARY,
        max_tokens: 1024,
        temperature: 0.5,
        system:
          "You are a helpful assistant that summarizes conversations between two people. Always return only the updated summary.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: summaryPrompt }],
          },
        ],
      });

      return response.content[0].text.trim();
    } catch (error) {
      console.error("Failed to update conversation summary:", error.message);
      return currentSummary; // Return current summary if update fails
    }
  }

  /**
   * Evaluate if suggestions are needed for a customer message
   * @param {object} context - Evaluation context
   * @returns {Promise<object>} Evaluation result
   */
  async evaluateForSuggestions(context) {
    const {
      ragSummary,
      conversationSummary,
      conversationHistory,
      lastFinalTranscript,
    } = context;

    try {
      const evalPrompt = `
You are an AI assistant monitoring a live conversation between a customer and an agent.

Product and Sales Context (from knowledge base):
${ragSummary}

Conversation Summary:
${conversationSummary}

Recent Conversation History:
${conversationHistory
  .slice(-CONVERSATION_DEFAULTS.MAX_HISTORY_ITEMS)
  .join("\n")}

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

      const response = await this.anthropic.messages.create({
        model: AI_MODELS.EVALUATION,
        max_tokens: 512,
        temperature: 0.2,
        system: "",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: evalPrompt }],
          },
        ],
      });

      const evalJson = extractJsonFromResponse(response.content[0].text);

      return (
        evalJson || {
          ready_for_suggestions: "no",
          is_rag_required: "no",
          user_context: "Could not parse LLM response.",
        }
      );
    } catch (error) {
      console.error("Error in suggestion evaluation:", error.message);
      return {
        ready_for_suggestions: "no",
        is_rag_required: "no",
        user_context: `LLM error: ${error.message}`,
      };
    }
  }

  /**
   * Generate suggestion cards for agent assistance
   * @param {object} context - Suggestion context
   * @returns {Promise<object>} Suggestion card
   */
  async generateSuggestions(context) {
    const {
      ragSummary,
      conversationSummary,
      conversationHistory,
      lastFinalTranscript,
      ragContext = "",
      isRagRequired = false,
    } = context;

    try {
      const suggestionPrompt = `
${SUGGESTION_SYSTEM_PROMPT}

Product and Sales Context (from knowledge base):
${ragSummary}

${isRagRequired ? `Relevant Knowledge Base (RAG):\n${ragContext}\n` : ""}

Conversation Summary:
${conversationSummary}

Recent Conversation History:
${conversationHistory
  .slice(-CONVERSATION_DEFAULTS.MAX_HISTORY_ITEMS)
  .join("\n")}

User Question (Trigger Phrase):
${lastFinalTranscript}
`;

      const response = await this.anthropic.messages.create({
        model: AI_MODELS.SUGGESTIONS,
        max_tokens: 2000,
        temperature: 1,
        system: "",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: suggestionPrompt }],
          },
        ],
      });

      const suggestionText = response.content[0].text.trim();
      return this.parseSuggestionResponse(suggestionText, lastFinalTranscript);
    } catch (error) {
      console.error("Error generating suggestions:", error.message);
      return this.createFallbackSuggestion(
        lastFinalTranscript,
        `LLM error: ${error.message}`
      );
    }
  }

  /**
   * Parse the suggestion response from Claude
   * @param {string} suggestionText - Raw response text
   * @param {string} fallbackTrigger - Fallback trigger text
   * @returns {object} Parsed suggestion card
   */
  parseSuggestionResponse(suggestionText, fallbackTrigger) {
    try {
      if (hasCurlyBracesWithText(suggestionText)) {
        const jsonString = extractTextWithinCurlyBraces(suggestionText);
        if (jsonString) {
          const parsedJson = safeJsonParse(jsonString);
          if (parsedJson) {
            return {
              trigger: parsedJson.trigger || fallbackTrigger,
              title: parsedJson.title || "Suggestion Card",
              points: parsedJson.points || ["No points available"],
            };
          }
        }
      }
    } catch (parseError) {
      console.warn("Failed to parse suggestion JSON:", parseError.message);
    }

    return this.createFallbackSuggestion(
      fallbackTrigger,
      "Could not parse LLM response"
    );
  }

  /**
   * Create a fallback suggestion card
   * @param {string} trigger - Trigger phrase
   * @param {string} reason - Reason for fallback
   * @returns {object} Fallback suggestion card
   */
  createFallbackSuggestion(trigger, reason) {
    return {
      trigger: trigger,
      title: "Suggestion Card",
      points: [reason],
    };
  }
}

export default new AIService();
