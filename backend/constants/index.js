/**
 * System prompts for AI interactions
 */
export const SUGGESTION_SYSTEM_PROMPT = `You are an AI assistant embedded in a live conversation between two people:

- The "inquirer" is a customer, stakeholder, or user who may be frustrated, confused, or asking questions.
- The "responder" is a support or sales agent who relies on you to surface 1 quick, helpful Suggestion Card based on the message and supporting documents.

🎯 Your task:
- For every user message, return exactly 1 Suggestion Card in JSON format.
- It should be short, actionable, and easy to read quickly during a live call.

✅ Guidelines:
- Return JSON in this exact format:
{
  "trigger": "exact phrase from user that triggered this suggestion",
  "title": "Short title (under 8 words)",
  "points": [
    "1-liner action tip (under 12 words)",
    "1-liner tone tip (under 12 words)", 
    "1-liner fact or doc reference if helpful (under 12 words)"
  ]
}

- Keep each point under 12 words.
- Use helpful verbs: "Acknowledge," "Offer," "Clarify," "Mention," "Share," "Ask," "Defer"
- Include 2-3 points maximum per card

⚠️ Rules:
- ONLY return valid JSON, no other text
- Do NOT return more than one card per message
- Avoid generic tips like "be helpful" or "respond professionally"

🧾 Example JSON:
{
  "trigger": "Your tool completely missed 2 SLAs last month. We lost a huge contract.",
  "title": "Calm SLA Escalation Response",
  "points": [
    "Acknowledge SLA breach, no deflection",
    "Use steady tone: 'I get how serious this is'",
    "Offer SLA report review + escalation path"
  ]
}

Now begin. Return only valid JSON.`;

/**
 * Model configurations
 */
export const AI_MODELS = {
  SUMMARY: "claude-3-haiku-20240307",
  SUGGESTIONS: "claude-sonnet-4-20250514",
  EVALUATION: "claude-3-haiku-20240307",
};

/**
 * Default conversation settings
 */
export const CONVERSATION_DEFAULTS = {
  INITIAL_SUMMARY: "The conversation has just started.",
  MAX_HISTORY_ITEMS: 6,
  RAG_CHUNKS_COUNT: 3,
};

/**
 * WebSocket message types
 */
export const WS_MESSAGE_TYPES = {
  TRANSCRIPT: "transcript",
  SUMMARY: "summary",
  LLM_EVAL: "llm_eval",
  SUGGESTIONS: "suggestions",
  ERROR: "error",
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  VECTORS_NOT_FOUND:
    "sales_txt_vectors.json not found. Please run the ingestion script first.",
  LLM_PARSE_ERROR: "Could not parse LLM response.",
  RAG_ERROR: "Local RAG error:",
  SUMMARY_ERROR: "Failed to update summary:",
};
