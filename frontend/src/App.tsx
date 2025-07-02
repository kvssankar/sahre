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
    wsRef.current = new WebSocket("ws://localhost:8080");
    wsRef.current.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === "suggestions") {
        setSuggestions((prev) => [...prev, ...data.suggestions]);
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
          <ul>
            {transcripts.map((t, i) => (
              <li key={i} style={{ color: t.isFinal ? "black" : "gray" }}>
                {t.speaker ? <b>{t.speaker}: </b> : null}
                {t.text} {t.isFinal ? "📝" : "…"}
              </li>
            ))}
          </ul>
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