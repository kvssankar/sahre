import React, { useRef, useState } from "react";

interface Transcript {
  text: string;
  isFinal: boolean;
  speaker?: string;
}

interface Suggestion {
  title: string;
  content: string;
}

function App() {
  const [llmEval, setLlmEval] = useState<any>(null);
  const [llmEvals, setLlmEvals] = useState<any[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    setTranscripts([]);
    setSuggestions([]);
    setLlmEval(null);
    wsRef.current = new WebSocket("ws://localhost:8080");
    wsRef.current.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === "suggestions") {
        setSuggestions((prev) => [...prev, ...data.suggestions]);
      } else if (data.type === "llm_eval") {
        setLlmEvals((prev) => [...prev, data.llm]); // <-- append to array!
      } else if (data.transcript !== undefined) {
        setTranscripts((prev) => [
          ...prev,
          { text: data.transcript, isFinal: data.isFinal, speaker: data.speaker }
        ]);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 8000 });
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      // Convert Float32 [-1,1] to Int16 PCM
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      wsRef.current.send(pcm.buffer);
    };

    source.connect(processor);
    processor.connect(audioContextRef.current.destination);
    processorRef.current = processor;
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (wsRef.current) wsRef.current.close();
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1, padding: 32 }}>
        <h2>Live Call Transcription</h2>
        {!recording ? (
          <button onClick={startRecording}>Start Recording</button>
        ) : (
          <button onClick={stopRecording}>Stop Recording</button>
        )}
        <div style={{ marginTop: 32 }}>
          <h3>Transcripts</h3>
          <div style={{
            height: "40vh",
            overflowY: "auto",
            border: "1px solid #eee",
            borderRadius: 6,
            background: "#fafafa",
            padding: 8,
            marginBottom: 16
          }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {transcripts.map((t, i) => (
                <li key={i} style={{ color: t.isFinal ? "black" : "gray", marginBottom: 4 }}>
                  {t.speaker ? <b>{t.speaker}: </b> : null}
                  {t.text} {t.isFinal ? "📝" : "…"}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ height: "40vh", marginTop: 0 }}>
          <h3>LLM Evaluation (after each final)</h3>
          <div style={{
            background: "#f0f0f0",
            padding: 12,
            borderRadius: 6,
            height: "calc(40vh - 48px)",
            width: 480,
            overflowY: "auto",
            overflowX: "auto"
          }}>
            {llmEvals.length === 0
              ? "LLM not called yet."
              : llmEvals.map((evalObj, idx) => (
                <pre key={idx} style={{ marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {evalObj.speaker ? <b>{evalObj.speaker}: </b> : null}
                  {JSON.stringify(evalObj, null, 2)}
                </pre>
              ))}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: 32, background: "#f7f7f7" }}>
        <h2>Suggestions</h2>
        {suggestions.map((s, i) => (
          <div key={i} style={{ background: "#fff", margin: 8, padding: 16, borderRadius: 8, boxShadow: "0 2px 8px #ddd" }}>
            <strong>{s.title}</strong>
            <div>{s.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;