import fs from "fs";
import path from "path";
import { BedrockEmbeddings } from "@langchain/aws";
import environment from "../config/environment.js";
import { cosineSimilarity } from "../utils/index.js";
import { ERROR_MESSAGES, CONVERSATION_DEFAULTS } from "../constants/index.js";

/**
 * RAG (Retrieval Augmented Generation) Service
 * Handles vector search and knowledge base operations
 */
class RAGService {
  constructor() {
    this.salesVectors = [];
    this.embedder = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the RAG service by loading vectors and setting up embedder
   */
  async initialize() {
    try {
      await this.loadVectors();
      this.setupEmbedder();
      this.isInitialized = true;
      console.log("RAG Service initialized successfully");
    } catch (error) {
      console.error("Failed to initialize RAG service:", error.message);
      throw error;
    }
  }

  /**
   * Load vector data from file
   */
  loadVectors() {
    const vectorsPath = path.resolve(environment.embedding.vectorFile);

    if (fs.existsSync(vectorsPath)) {
      this.salesVectors = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));
      console.log(
        `Loaded ${this.salesVectors.length} vectors from ${vectorsPath}`
      );
    } else {
      console.warn(ERROR_MESSAGES.VECTORS_NOT_FOUND);
      this.salesVectors = [];
    }
  }

  /**
   * Set up the Bedrock embeddings client
   */
  setupEmbedder() {
    this.embedder = new BedrockEmbeddings({
      region: environment.aws.region,
      model: environment.embedding.model,
    });
  }

  /**
   * Get top K relevant chunks for a query
   * @param {string} query - The search query
   * @param {number} k - Number of top results to return
   * @returns {Promise<string[]>} Array of relevant text chunks
   */
  async getTopKRelevantChunks(
    query,
    k = CONVERSATION_DEFAULTS.RAG_CHUNKS_COUNT
  ) {
    if (!this.isInitialized) {
      throw new Error("RAG service not initialized. Call initialize() first.");
    }

    if (this.salesVectors.length === 0) {
      console.warn("No vectors available for search");
      return [];
    }

    try {
      const [queryVec] = await this.embedder.embedDocuments([query]);

      const scored = this.salesVectors.map((obj) => ({
        chunk: obj.chunk,
        score: cosineSimilarity(queryVec, obj.vector),
      }));

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((s) => s.chunk);
    } catch (error) {
      console.error("Error in RAG search:", error.message);
      return [];
    }
  }

  /**
   * Get a general overview of the knowledge base
   * @returns {Promise<string[]>} Array of representative chunks
   */
  async getOverviewChunks(k = CONVERSATION_DEFAULTS.RAG_CHUNKS_COUNT) {
    return this.getTopKRelevantChunks("overview", k);
  }

  /**
   * Check if the RAG service has vectors loaded
   * @returns {boolean} True if vectors are available
   */
  hasVectors() {
    return this.salesVectors.length > 0;
  }

  /**
   * Get statistics about loaded vectors
   * @returns {object} Vector statistics
   */
  getVectorStats() {
    return {
      count: this.salesVectors.length,
      isInitialized: this.isInitialized,
      hasEmbedder: !!this.embedder,
    };
  }
}

export default new RAGService();
