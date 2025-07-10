import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve("backend/.env") });

/**
 * Environment configuration with validation
 */
class Environment {
  constructor() {
    this.validateRequiredEnvVars();
  }

  get aws() {
    return {
      region: process.env.AWS_REGION || "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  get anthropic() {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  get server() {
    return {
      port: parseInt(process.env.PORT) || 8080,
      host: process.env.HOST || "localhost",
    };
  }

  get transcription() {
    return {
      languageCode: process.env.LANGUAGE_CODE || "en-IN",
      mediaEncoding: process.env.MEDIA_ENCODING || "pcm",
      sampleRate: parseInt(process.env.SAMPLE_RATE) || 8000,
      maxSpeakers: parseInt(process.env.MAX_SPEAKERS) || 2,
    };
  }

  get embedding() {
    return {
      model: process.env.EMBEDDING_MODEL || "amazon.titan-embed-text-v1",
      vectorFile: process.env.VECTOR_FILE || "heythere_vectors.json",
    };
  }

  validateRequiredEnvVars() {
    const required = [
      "ANTHROPIC_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }
}

export default new Environment();
