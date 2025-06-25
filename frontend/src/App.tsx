import React, { useRef, useState, useEffect } from "react";

interface Transcript {
  text: string;
  isFinal: boolean;
}

interface Suggestion {
  title: string;
  content: string;
}

function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Cleanup WebSocket on unmount or when audioFile changes
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [audioFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAudioFile(file);
    setAudioUrl(file ? URL.createObjectURL(file) : "");
    setTranscripts([]);
    setSuggestions([]);
    // Close previous WebSocket if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const handlePlay = () => {
    if (!audioFile) return;
    wsRef.current = new WebSocket("ws://localhost:8080");
    wsRef.current.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === "suggestions") {
        setSuggestions((prev) => [...prev, ...data.suggestions]);
      } else if (data.transcript !== undefined) {
        setTranscripts((prev) => [...prev, { text: data.transcript, isFinal: data.isFinal }]);
      }
    };

    wsRef.current.onopen = () => {
      // Read and send audio file in chunks as it plays
      const chunkSize = 32000; // ~0.5s at 64kbps
      const reader = new FileReader();
      let offset = 0;

      function sendChunk() {
        if (!audioFile || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (offset >= audioFile.size) return;
        const slice = audioFile.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
      }

      reader.onload = function (e) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && e.target?.result) {
          wsRef.current.send(e.target.result as ArrayBuffer);
          offset += chunkSize;
          setTimeout(sendChunk, 250); // send next chunk after 250ms
        }
      };

      sendChunk();
    };
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Left: Audio Player */}
      <div style={{ flex: 1, padding: 32 }}>
        <h2>Select and Play Audio</h2>
        <input type="file" accept="audio/mp3" onChange={handleFileChange} />
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            onPlay={handlePlay}
            style={{ width: "100%", marginTop: 16 }}
          />
        )}
        <div style={{ marginTop: 32 }}>
          <h3>Transcripts</h3>
          <ul>
            {transcripts.map((t, i) => (
              <li key={i} style={{ color: t.isFinal ? "black" : "gray" }}>
                {t.text} {t.isFinal ? "📝" : "…"}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* Right: Suggestion Cards */}
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