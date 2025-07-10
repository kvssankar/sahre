import { WS_MESSAGE_TYPES, CONVERSATION_DEFAULTS } from "../constants/index.js";
import ragService from "../services/ragService.js";
import aiService from "../services/aiService.js";
import transcriptionService from "../services/transcriptionService.js";

/**
 * WebSocket Connection Handler
 * Manages individual WebSocket connections and their conversation state
 */
class ConnectionHandler {
  constructor(ws) {
    this.ws = ws;
    this.audioBuffer = [];
    this.isClosed = false;
    this.ragSummary = "";

    // Conversation state
    this.speakerMap = {};
    this.speakerCount = 1;
    this.conversationHistory = [];
    this.conversationSummary = CONVERSATION_DEFAULTS.INITIAL_SUMMARY;
    this.lastFinalSpeaker = null;
    this.lastFinalTranscript = null;
    this.inquirerSpeaker = null;
    this.responderSpeaker = null;
  }

  /**
   * Initialize the connection and precompute RAG summary
   */
  async initialize() {
    try {
      console.log("Client connected - initializing...");

      // Precompute RAG summary once per connection
      await this.precomputeRAGSummary();

      // Set up event handlers
      this.setupEventHandlers();

      // Start transcription
      await this.startTranscription();
    } catch (error) {
      console.error("Failed to initialize connection:", error.message);
      this.sendError(error.message);
    }
  }

  /**
   * Precompute RAG summary for this connection
   */
  async precomputeRAGSummary() {
    try {
      const topChunks = await ragService.getOverviewChunks();
      this.ragSummary = await aiService.generateRAGSummary(topChunks);
      console.log("Precomputed RAG summary:", this.ragSummary);
    } catch (error) {
      console.warn("RAG summary error (on connect):", error.message);
      this.ragSummary = "";
    }
  }

  /**
   * Set up WebSocket event handlers
   */
  setupEventHandlers() {
    this.ws.on("message", (data) => {
      this.audioBuffer.push(Buffer.from(data));
    });

    this.ws.on("close", () => {
      this.isClosed = true;
      console.log("Client disconnected");
    });
  }

  /**
   * Start the transcription process
   */
  async startTranscription() {
    try {
      const transcriptStream = await transcriptionService.startTranscription(
        this.audioBuffer,
        () => this.isClosed
      );

      if (transcriptStream) {
        await this.processTranscriptionStream(transcriptStream);
      }
    } catch (error) {
      const errorInfo = transcriptionService.handleTranscriptionError(error);

      if (errorInfo.type === "warning") {
        console.warn(errorInfo.message);
      } else {
        this.sendError(errorInfo.message);
      }
    }
  }

  /**
   * Process the transcription stream events
   */
  async processTranscriptionStream(transcriptStream) {
    for await (const event of transcriptStream) {
      const transcriptionData =
        transcriptionService.processTranscriptionEvent(event);

      if (transcriptionData) {
        await this.handleTranscriptionData(transcriptionData);
      }
    }
  }

  /**
   * Handle processed transcription data
   */
  async handleTranscriptionData(data) {
    const { transcript, isFinal, awsSpeaker } = data;

    // Manage speaker mapping
    const speakerDisplay = this.getSpeakerDisplay(awsSpeaker);

    // Send transcript to client
    this.sendTranscript(transcript, isFinal, speakerDisplay);

    // Process final transcripts for AI analysis
    if (isFinal) {
      await this.processFinalTranscript(transcript, speakerDisplay);
    }
  }

  /**
   * Get or create speaker display name
   */
  getSpeakerDisplay(awsSpeaker) {
    if (!awsSpeaker) return null;

    if (!this.speakerMap[awsSpeaker]) {
      this.speakerMap[awsSpeaker] = `Speaker ${this.speakerCount++}`;
    }

    return this.speakerMap[awsSpeaker];
  }

  /**
   * Process final transcript for AI analysis
   */
  async processFinalTranscript(transcript, speakerDisplay) {
    // Add to conversation history
    this.conversationHistory.push(`${speakerDisplay}: ${transcript}`);

    // Update conversation summary
    await this.updateConversationSummary(speakerDisplay, transcript);

    // Identify inquirer and responder
    this.identifySpeakerRoles(speakerDisplay);

    // Check if we should trigger LLM evaluation
    if (this.shouldTriggerEvaluation(speakerDisplay)) {
      await this.performLLMEvaluation();
    }

    // Update state for next iteration
    this.lastFinalSpeaker = speakerDisplay;
    this.lastFinalTranscript = transcript;
  }

  /**
   * Update conversation summary using AI
   */
  async updateConversationSummary(speakerDisplay, transcript) {
    try {
      this.conversationSummary = await aiService.updateConversationSummary(
        this.conversationSummary,
        speakerDisplay,
        transcript
      );

      this.sendMessage(WS_MESSAGE_TYPES.SUMMARY, {
        summary: this.conversationSummary,
      });
    } catch (error) {
      console.warn("Failed to update summary:", error.message);
    }
  }

  /**
   * Identify speaker roles (inquirer/responder)
   */
  identifySpeakerRoles(speakerDisplay) {
    if (!this.inquirerSpeaker) {
      this.inquirerSpeaker = speakerDisplay;
    } else if (
      !this.responderSpeaker &&
      speakerDisplay !== this.inquirerSpeaker
    ) {
      this.responderSpeaker = speakerDisplay;
    }
  }

  /**
   * Check if LLM evaluation should be triggered
   */
  shouldTriggerEvaluation(speakerDisplay) {
    return (
      this.lastFinalSpeaker === this.inquirerSpeaker &&
      speakerDisplay === this.responderSpeaker &&
      this.lastFinalTranscript
    );
  }

  /**
   * Perform LLM evaluation and potentially generate suggestions
   */
  async performLLMEvaluation() {
    try {
      // Step 1: Evaluate if suggestions are needed
      const evalResult = await aiService.evaluateForSuggestions({
        ragSummary: this.ragSummary,
        conversationSummary: this.conversationSummary,
        conversationHistory: this.conversationHistory,
        lastFinalTranscript: this.lastFinalTranscript,
      });

      // Send evaluation result
      this.sendMessage(WS_MESSAGE_TYPES.LLM_EVAL, {
        llm: {
          ...evalResult,
          trigger: this.lastFinalTranscript,
          summary: this.conversationSummary,
          history: this.conversationHistory
            .slice(-CONVERSATION_DEFAULTS.MAX_HISTORY_ITEMS)
            .join("\n"),
        },
      });

      // Step 2: Generate suggestions if needed
      if (evalResult.ready_for_suggestions === "yes") {
        await this.generateSuggestions(evalResult);
      }
    } catch (error) {
      console.error("Error in LLM evaluation:", error.message);
      this.sendMessage(WS_MESSAGE_TYPES.LLM_EVAL, {
        llm: {
          ready_for_suggestions: "no",
          user_context: `LLM error: ${error.message}`,
          trigger: this.lastFinalTranscript,
          summary: this.conversationSummary,
          history: this.conversationHistory
            .slice(-CONVERSATION_DEFAULTS.MAX_HISTORY_ITEMS)
            .join("\n"),
        },
      });
    }
  }

  /**
   * Generate suggestion cards
   */
  async generateSuggestions(evalResult) {
    try {
      let ragContext = "";

      // Get RAG context if required
      if (evalResult.is_rag_required === "yes") {
        const topChunks = await ragService.getTopKRelevantChunks(
          this.lastFinalTranscript
        );
        ragContext = topChunks.join("\n---\n");
      }

      // Generate suggestions
      const suggestionCard = await aiService.generateSuggestions({
        ragSummary: this.ragSummary,
        conversationSummary: this.conversationSummary,
        conversationHistory: this.conversationHistory,
        lastFinalTranscript: this.lastFinalTranscript,
        ragContext,
        isRagRequired: evalResult.is_rag_required === "yes",
      });

      // Send suggestions
      this.sendMessage(WS_MESSAGE_TYPES.SUGGESTIONS, {
        suggestions: [suggestionCard],
      });
    } catch (error) {
      console.error("Error generating suggestions:", error.message);
    }
  }

  /**
   * Send transcript message to client
   */
  sendTranscript(transcript, isFinal, speaker) {
    this.sendMessage(WS_MESSAGE_TYPES.TRANSCRIPT, {
      transcript,
      isFinal,
      speaker,
    });
  }

  /**
   * Send generic message to client
   */
  sendMessage(type, data) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  /**
   * Send error message to client
   */
  sendError(message) {
    this.sendMessage(WS_MESSAGE_TYPES.ERROR, { error: message });
  }
}

export default ConnectionHandler;
