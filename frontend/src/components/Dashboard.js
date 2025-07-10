import React, { useRef, useState } from "react";
import "./Dashboard.css";

const Dashboard = () => {
  const [recording, setRecording] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [llmEvals, setLlmEvals] = useState([]);
  const [summary, setSummary] = useState("The conversation has just started.");
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const startRecording = async () => {
    setTranscripts([]);
    setSuggestions([]);
    setLlmEvals([]);
    setSummary("The conversation has just started.");

    try {
      console.log("🔗 Connecting to WebSocket...");
      wsRef.current = new WebSocket("ws://localhost:8080");

      wsRef.current.onopen = () => {
        console.log("✅ WebSocket connected successfully");
      };

      wsRef.current.onclose = (event) => {
        console.log("🔴 WebSocket closed:", event.code, event.reason);
      };

      wsRef.current.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
      };

      wsRef.current.onmessage = (event) => {
        console.log("📨 Received message:", event.data);
        try {
          const data = JSON.parse(event.data);
          console.log("📦 Parsed data:", data);

          if (data.type === "suggestions") {
            console.log("💡 Adding suggestions:", data.suggestions);
            setSuggestions((prev) => [...data.suggestions, ...prev]);
          } else if (data.type === "llm_eval") {
            console.log("🧠 Adding LLM eval:", data.llm);
            setLlmEvals((prev) => [...prev, data.llm]);
          } else if (data.type === "summary") {
            console.log("📋 Updating summary:", data.summary);
            setSummary(data.summary);
          } else if (data.transcript !== undefined) {
            console.log("📝 Adding transcript:", {
              text: data.transcript,
              isFinal: data.isFinal,
              speaker: data.speaker,
            });
            setTranscripts((prev) => [
              ...prev,
              {
                text: data.transcript,
                isFinal: data.isFinal,
                speaker: data.speaker,
              },
            ]);
          } else {
            console.log("❓ Unknown message type:", data);
          }
        } catch (parseError) {
          console.error(
            "❌ Error parsing message:",
            parseError,
            "Raw data:",
            event.data
          );
        }
      };

      console.log("🎤 Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("✅ Microphone access granted");

      console.log("🔊 Setting up audio context...");
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)({ sampleRate: 8000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(
        4096,
        1,
        1
      );

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          console.log(
            "⚠️ WebSocket not ready, state:",
            wsRef.current?.readyState
          );
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          let s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        try {
          wsRef.current.send(pcm.buffer);
          // Log every 100th audio packet to avoid spam
          if (Math.random() < 0.01) {
            console.log("🎵 Sending audio data, buffer size:", pcm.length);
          }
        } catch (sendError) {
          console.error("❌ Error sending audio:", sendError);
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      processorRef.current = processor;
      console.log("✅ Audio processing started");

      setRecording(true);
    } catch (error) {
      console.error("❌ Error starting recording:", error);
      setRecording(false);
    }
  };

  const stopRecording = () => {
    setRecording(false);
    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current)
      streamRef.current.getTracks().forEach((t) => t.stop());
    if (wsRef.current) wsRef.current.close();
  };

  return (
    <div className="dashboard-container">
      {/* Left Column - 40% */}
      <div className="left-column">
        <div className="recording-section">
          <h2 className="section-title">Live Call Transcription</h2>

          {/* Microphone Button */}
          <div className="mic-container">
            <button
              className={`mic-button ${recording ? "recording" : ""}`}
              onClick={recording ? stopRecording : startRecording}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
                  fill="currentColor"
                />
                <path
                  d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <p className="mic-status">
              {recording ? "Recording..." : "Click to start recording"}
            </p>
          </div>

          {/* Summary Section */}
          <div className="summary-section">
            <h3>Conversation Summary</h3>
            <div className="summary-content">{summary}</div>
          </div>

          {/* LLM Evaluation Section */}
          <div className="llm-section">
            <h3>LLM Evaluation</h3>
            <div className="llm-content">
              {llmEvals.length === 0
                ? "LLM not called yet."
                : llmEvals.map((evalObj, idx) => (
                    <pre key={idx} className="llm-eval">
                      {evalObj.speaker ? <b>{evalObj.speaker}: </b> : null}
                      {JSON.stringify(evalObj, null, 2)}
                    </pre>
                  ))}
            </div>
          </div>
        </div>
      </div>

      {/* Middle Column - 30% */}
      <div className="middle-column">
        <h2 className="section-title">Suggestions</h2>
        <div className="suggestions-container">
          {suggestions.length === 0 ? (
            <div className="empty-state">Nothing yet</div>
          ) : (
            suggestions.map((suggestion, index) => (
              <div
                key={index}
                className={`custom-card suggestion-card ${
                  index === 0 ? "new-card" : "old-card"
                }`}
              >
                {suggestion.trigger && (
                  <div className="suggestion-trigger">
                    Suggestion for:{" "}
                    <span className="trigger-text">{suggestion.trigger}</span>
                  </div>
                )}
                <h4 className="suggestion-title">{suggestion.title}</h4>
                <div className="suggestion-content">
                  {suggestion.points &&
                    suggestion.points.map((point, i) => (
                      <div key={i} className="suggestion-point">
                        <span className="bullet">•</span>
                        <span>{point}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Column - 30% */}
      <div className="right-column">
        <h2 className="section-title">Transcripts</h2>
        <div className="transcripts-container">
          {transcripts.length === 0 ? (
            <div className="empty-state">
              Click and start and wait for transcription
            </div>
          ) : (
            transcripts.map((transcript, index) =>
              transcript.isFinal ? (
                <div
                  key={index}
                  className={`transcript-item ${
                    transcript.isFinal ? "final" : "interim"
                  }`}
                >
                  {transcript.speaker && (
                    <span className="speaker-name">{transcript.speaker}: </span>
                  )}
                  <span className="transcript-text">{transcript.text}</span>
                  <span className="transcript-status">
                    {transcript.isFinal ? "📝" : "…"}
                  </span>
                </div>
              ) : (
                <></>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
