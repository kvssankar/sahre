import { WebSocketServer } from "ws";
import environment from "../config/environment.js";
import ConnectionHandler from "./connectionHandler.js";

/**
 * WebSocket Server Manager
 * Handles WebSocket server creation and connection management
 */
class WebSocketManager {
  constructor() {
    this.server = null;
    this.connections = new Set();
  }

  /**
   * Start the WebSocket server
   */
  start() {
    const { port, host } = environment.server;

    this.server = new WebSocketServer({ port });

    this.server.on("connection", (ws) => {
      this.handleNewConnection(ws);
    });

    this.server.on("error", (error) => {
      console.error("WebSocket server error:", error.message);
    });

    console.log(`WebSocket server started on ws://${host}:${port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  async handleNewConnection(ws) {
    const connectionHandler = new ConnectionHandler(ws);
    this.connections.add(connectionHandler);

    // Initialize the connection
    await connectionHandler.initialize();

    // Clean up when connection closes
    ws.on("close", () => {
      this.connections.delete(connectionHandler);
      console.log(
        `Connection closed. Active connections: ${this.connections.size}`
      );
    });

    console.log(
      `New connection established. Active connections: ${this.connections.size}`
    );
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      isRunning: !!this.server,
      activeConnections: this.connections.size,
      port: environment.server.port,
    };
  }

  /**
   * Gracefully shutdown the server
   */
  async shutdown() {
    if (this.server) {
      console.log("Shutting down WebSocket server...");

      // Close all active connections
      for (const connection of this.connections) {
        if (connection.ws.readyState === connection.ws.OPEN) {
          connection.ws.close();
        }
      }

      // Close the server
      await new Promise((resolve) => {
        this.server.close(resolve);
      });

      this.connections.clear();
      console.log("WebSocket server shutdown complete");
    }
  }
}

export default new WebSocketManager();
