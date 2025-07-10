/**
 * Simple test runner to verify the modular structure
 */

import environment from "./config/environment.js";
import ragService from "./services/ragService.js";
import aiService from "./services/aiService.js";
import transcriptionService from "./services/transcriptionService.js";
import { cosineSimilarity, hasCurlyBracesWithText } from "./utils/index.js";
import { SUGGESTION_SYSTEM_PROMPT, AI_MODELS } from "./constants/index.js";

/**
 * Test suite for modular backend
 */
class ModuleTests {
  async runTests() {
    console.log("🧪 Running Module Tests...\n");

    await this.testEnvironment();
    await this.testUtils();
    await this.testConstants();
    await this.testRAGService();
    await this.testAIService();
    await this.testTranscriptionService();

    console.log("\n✅ All module tests completed!");
  }

  async testEnvironment() {
    console.log("📋 Testing Environment Configuration...");

    try {
      const aws = environment.aws;
      const server = environment.server;

      console.log(`   ✓ AWS Region: ${aws.region}`);
      console.log(`   ✓ Server Port: ${server.port}`);
      console.log(`   ✓ Environment loaded successfully`);
    } catch (error) {
      console.log(`   ❌ Environment test failed: ${error.message}`);
    }
  }

  async testUtils() {
    console.log("\n🔧 Testing Utilities...");

    try {
      // Test JSON utilities
      const testJson = '{"test": "value"}';
      const hasJson = hasCurlyBracesWithText(testJson);
      console.log(`   ✓ JSON detection: ${hasJson}`);

      // Test cosine similarity
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      console.log(`   ✓ Cosine similarity calculated: ${similarity}`);
    } catch (error) {
      console.log(`   ❌ Utils test failed: ${error.message}`);
    }
  }

  async testConstants() {
    console.log("\n📝 Testing Constants...");

    try {
      console.log(
        `   ✓ Suggestion prompt loaded (${SUGGESTION_SYSTEM_PROMPT.length} chars)`
      );
      console.log(`   ✓ AI Models: ${Object.keys(AI_MODELS).join(", ")}`);
    } catch (error) {
      console.log(`   ❌ Constants test failed: ${error.message}`);
    }
  }

  async testRAGService() {
    console.log("\n🔍 Testing RAG Service...");

    try {
      await ragService.initialize();
      const stats = ragService.getVectorStats();
      console.log(`   ✓ RAG Service initialized`);
      console.log(`   ✓ Vectors loaded: ${stats.count}`);
      console.log(`   ✓ Has embedder: ${stats.hasEmbedder}`);
    } catch (error) {
      console.log(`   ❌ RAG Service test failed: ${error.message}`);
    }
  }

  async testAIService() {
    console.log("\n🤖 Testing AI Service...");

    try {
      // Test fallback suggestion creation
      const fallback = aiService.createFallbackSuggestion(
        "test trigger",
        "test reason"
      );
      console.log(`   ✓ Fallback suggestion created: ${fallback.title}`);

      // Test JSON parsing
      const testResponse =
        '{"trigger": "test", "title": "Test Title", "points": ["point1"]}';
      const parsed = aiService.parseSuggestionResponse(
        testResponse,
        "fallback"
      );
      console.log(`   ✓ Response parsing: ${parsed.title}`);
    } catch (error) {
      console.log(`   ❌ AI Service test failed: ${error.message}`);
    }
  }

  async testTranscriptionService() {
    console.log("\n🎤 Testing Transcription Service...");

    try {
      // Test transcription event processing
      const mockEvent = {
        TranscriptEvent: {
          Transcript: {
            Results: [
              {
                Alternatives: [{ Transcript: "test transcript" }],
                IsPartial: false,
                SpeakerLabel: "spk_0",
              },
            ],
          },
        },
      };

      const processed =
        transcriptionService.processTranscriptionEvent(mockEvent);
      console.log(`   ✓ Event processing: ${processed.transcript}`);
      console.log(`   ✓ Speaker detection: ${processed.awsSpeaker}`);
      console.log(`   ✓ Final status: ${processed.isFinal}`);
    } catch (error) {
      console.log(`   ❌ Transcription Service test failed: ${error.message}`);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tests = new ModuleTests();
  tests.runTests().catch(console.error);
}

export default ModuleTests;
