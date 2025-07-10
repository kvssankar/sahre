/**
 * AI Live Call Insights Solution - Main Server
 *
 * A modular, real-time transcription and AI-powered suggestion system
 * for live customer support and sales conversations.
 *
 * Features:
 * - Real-time audio transcription via AWS Transcribe
 * - AI-powered conversation analysis with Claude
 * - RAG-based knowledge retrieval
 * - Live suggestion cards for agents
 * - Speaker identification and role detection
 */

import environment from "./config/environment.js";
import ragService from "./services/ragService.js";
import webSocketManager from "./websocket/webSocketManager.js";

/**
 * Application class for managing the server lifecycle
 */
class Application {
  constructor() {
    this.isInitialized = false;
  }

  /**
   * Initialize all services and start the server
   */
  async start() {
    try {
      console.log("🚀 Starting AI Live Call Insights Server...");

      // Display configuration
      this.logConfiguration();

      // Initialize services
      await this.initializeServices();

      // Start WebSocket server
      this.startWebSocketServer();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      this.isInitialized = true;
      console.log("✅ Server started successfully!");
      console.log(
        `📡 WebSocket server listening on ws://localhost:${environment.server.port}`
      );
    } catch (error) {
      console.error("❌ Failed to start server:", error.message);
      process.exit(1);
    }
  }

  /**
   * Log current configuration
   */
  logConfiguration() {
    console.log("📋 Configuration:");
    console.log(`   • Port: ${environment.server.port}`);
    console.log(`   • AWS Region: ${environment.aws.region}`);
    console.log(`   • Language: ${environment.transcription.languageCode}`);
    console.log(`   • Vector File: ${environment.embedding.vectorFile}`);
  }

  /**
   * Initialize all required services
   */
  async initializeServices() {
    console.log("🔧 Initializing services...");

    // Initialize RAG service (loads vectors and sets up embeddings)
    await ragService.initialize();

    // Log RAG statistics
    const ragStats = ragService.getVectorStats();
    console.log(`   • RAG Service: ${ragStats.count} vectors loaded`);

    console.log("✅ All services initialized");
  }

  /**
   * Start the WebSocket server
   */
  startWebSocketServer() {
    webSocketManager.start();
  }

  /**
   * Set up graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      console.log(`\n📡 Received ${signal}, shutting down gracefully...`);

      try {
        await webSocketManager.shutdown();
        console.log("✅ Graceful shutdown complete");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error.message);
        process.exit(1);
      }
    };

    // Handle different termination signals
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      console.error("❌ Uncaught Exception:", error);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
      process.exit(1);
    });
  }

  /**
   * Get application status and statistics
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      websocket: webSocketManager.getStats(),
      rag: ragService.getVectorStats(),
      environment: {
        port: environment.server.port,
        region: environment.aws.region,
      },
    };
  }
}

// Create and start the application
const app = new Application();
app.start().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});

// Export for testing purposes
export default app;
