import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  PartialResultsStability,
} from "@aws-sdk/client-transcribe-streaming";
import environment from "../config/environment.js";
import { delay } from "../utils/index.js";

/**
 * AWS Transcription Service
 * Handles real-time audio transcription using AWS Transcribe Streaming
 */
class TranscriptionService {
  constructor() {
    this.client = new TranscribeStreamingClient({
      region: environment.aws.region,
      credentials: {
        accessKeyId: environment.aws.accessKeyId,
        secretAccessKey: environment.aws.secretAccessKey,
      },
    });
  }

  /**
   * Create audio stream generator for AWS Transcribe
   * @param {Buffer[]} audioBuffer - Array of audio buffers
   * @param {Function} isClosedFn - Function to check if connection is closed
   * @returns {AsyncGenerator} Audio stream generator
   */
  async *createAudioStreamGenerator(audioBuffer, isClosedFn) {
    let lastIndex = 0;

    while (!isClosedFn() || lastIndex < audioBuffer.length) {
      if (lastIndex < audioBuffer.length) {
        yield { AudioEvent: { AudioChunk: audioBuffer[lastIndex++] } };
        await delay(20);
      } else {
        await delay(10);
      }
    }

    // Send empty chunk to signal end of stream
    yield { AudioEvent: { AudioChunk: Buffer.alloc(0) } };
  }

  /**
   * Create transcription command with configuration
   * @param {Buffer[]} audioBuffer - Audio buffer array
   * @param {Function} isClosedFn - Function to check connection status
   * @returns {StartStreamTranscriptionCommand} Configured transcription command
   */
  createTranscriptionCommand(audioBuffer, isClosedFn) {
    const config = environment.transcription;

    return new StartStreamTranscriptionCommand({
      LanguageCode: config.languageCode,
      MediaEncoding: config.mediaEncoding,
      MediaSampleRateHertz: config.sampleRate,
      EnablePartialResultsStabilization: true,
      PartialResultsStability: PartialResultsStability.MEDIUM,
      AudioStream: this.createAudioStreamGenerator(audioBuffer, isClosedFn),
      ShowSpeakerLabel: true,
      MaxSpeakerLabels: config.maxSpeakers,
    });
  }

  /**
   * Start transcription stream
   * @param {Buffer[]} audioBuffer - Audio buffer array
   * @param {Function} isClosedFn - Function to check connection status
   * @returns {Promise<AsyncIterable>} Transcription result stream
   */
  async startTranscription(audioBuffer, isClosedFn) {
    try {
      const command = this.createTranscriptionCommand(audioBuffer, isClosedFn);
      const response = await this.client.send(command);
      return response.TranscriptResultStream;
    } catch (error) {
      console.error("Failed to start transcription:", error.message);
      throw error;
    }
  }

  /**
   * Process transcription event and extract relevant information
   * @param {object} event - Transcription event from AWS
   * @returns {object|null} Processed transcription data or null
   */
  processTranscriptionEvent(event) {
    if (!event.TranscriptEvent) {
      return null;
    }

    const results = event.TranscriptEvent.Transcript?.Results;
    if (!results || results.length === 0) {
      return null;
    }

    const result = results[0];
    const transcript = result.Alternatives?.[0]?.Transcript;
    const awsSpeaker = result.SpeakerLabel || null;
    const isFinal = !result.IsPartial;

    if (!transcript || transcript.length === 0) {
      return null;
    }

    return {
      transcript,
      isFinal,
      awsSpeaker,
    };
  }

  /**
   * Handle transcription errors
   * @param {Error} error - The error that occurred
   * @returns {object} Error information
   */
  handleTranscriptionError(error) {
    if (error.code === "ERR_STREAM_PREMATURE_CLOSE") {
      return {
        type: "warning",
        message:
          "AWS Transcribe stream closed early (likely short audio window).",
      };
    }

    return {
      type: "error",
      message: error.message,
    };
  }
}

export default new TranscriptionService();
