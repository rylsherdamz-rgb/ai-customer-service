"use client";

import { useRef, useState, useEffect } from "react";
import { ConvoSession, type TranscriptEvent } from "@/lib/client/convoSession";

type ConnectState = "idle" | "connecting" | "connected" | "error";

export default function Home() {
  const sessionRef = useRef<ConvoSession | null>(null);
  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";

  const pushStatus = (line: string) => {
    setStatusLines((prev) => [...prev.slice(-20), `${new Date().toLocaleTimeString([], { hour12: false })} - ${line}`]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, statusLines]);

  const handleStart = async () => {
    if (!appId) {
      setError("Agora App ID missing in env.");
      return;
    }

    setState("connecting");
    setError(null);
    setTranscript([]);
    setStatusLines([]);

    const newChannel = `live-${Math.random().toString(36).substring(7)}`;
    const newUid = Math.floor(Math.random() * 10000) + 2000;

    try {
      pushStatus("Initializing tokens...");
      const tokenRes = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: newChannel, uid: newUid }),
      });
      const tokenJson = await tokenRes.json();
      
      pushStatus("Starting Gemini + MiniMax Agent...");
      const startRes = await fetch("/api/start-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: newChannel, uid: newUid }),
      });
      const startJson = await startRes.json();
      if (!startRes.ok) throw new Error(startJson.reason || "Agent failed");

      pushStatus("Waiting for stabilization...");
      await new Promise((r) => setTimeout(r, 2000));

      const session = new ConvoSession();
      sessionRef.current = session;

      await session.connect(
        { appId, channelName: newChannel, token: tokenJson.token, uid: newUid },
        {
          onTranscript: (evt) => setTranscript((prev) => [...prev, evt]),
          onStatus: (s) => pushStatus(s),
        }
      );

      setState("connected");
      pushStatus("Session Live.");
    } catch (e: any) {
      setError(e.message);
      setState("error");
      pushStatus(`Error: ${e.message}`);
    }
  };

  const handleStop = async () => {
    setState("idle");
    pushStatus("Disconnecting...");
    await sessionRef.current?.disconnect();
    sessionRef.current = null;
  };

  return (
    <main className="flex h-screen w-full bg-white text-black overflow-hidden font-sans">
      <section className="flex flex-1 flex-col items-center justify-between p-12 border-r border-gray-100 relative">
        <div className="w-full max-w-md text-center">
          <h1 className="text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">Gemini Live</h1>
          <p className="text-[10px] text-gray-300 mt-1 uppercase tracking-widest font-medium italic">MiniMax Voice Enabled</p>
        </div>

        <div className="relative flex items-center justify-center">
          <div className={`absolute w-72 h-72 rounded-full transition-all duration-1000 ${
            state === "connected" ? "bg-black/[0.03] scale-125 blur-3xl animate-pulse" : "bg-transparent"
          }`} />
          
          <div className={`w-40 h-40 rounded-full border flex items-center justify-center transition-all duration-700 ${
            state === "connected" ? "border-black scale-110 shadow-2xl bg-white" : "border-gray-100"
          }`}>
            <div className={`w-3 h-3 rounded-full ${
              state === "connected" ? "bg-black animate-ping" : "bg-gray-200"
            }`} />
          </div>
        </div>

        <div className="w-full max-w-sm space-y-4">
          {state !== "connected" ? (
            <button
              onClick={handleStart}
              disabled={state === "connecting"}
              className="w-full py-4 rounded-2xl bg-black text-white font-semibold hover:bg-zinc-800 transition-all active:scale-95 disabled:bg-gray-100"
            >
              {state === "connecting" ? "Establishing..." : "Start Conversation"}
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setMuted(!muted)}
                className="flex-1 py-4 rounded-2xl border border-gray-200 font-medium hover:bg-gray-50 transition-colors"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={handleStop}
                className="flex-1 py-4 rounded-2xl bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition-colors"
              >
                End
              </button>
            </div>
          )}
          {error && <p className="text-center text-[11px] text-red-500 animate-shake">{error}</p>}
        </div>
      </section>

      <section className="w-[400px] bg-gray-50/50 flex flex-col h-full border-l border-gray-100">
        <div className="p-6 border-b border-gray-100 bg-white">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Debug Console</h2>
        </div>
        
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth no-scrollbar">
          <div className="space-y-2">
            <h3 className="text-[9px] font-bold text-gray-300 uppercase">System Logs</h3>
            <div className="font-mono text-[10px] space-y-1 text-gray-500 opacity-80">
              {statusLines.map((l, i) => <div key={i} className="border-l-2 border-gray-200 pl-2">{l}</div>)}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[9px] font-bold text-gray-300 uppercase">Live Transcript</h3>
            <div className="space-y-3">
              {transcript.length === 0 && <p className="text-[11px] text-gray-400 italic font-mono">Waiting for stream...</p>}
              {transcript.map((t, i) => (
                <div key={i} className={`p-3 rounded-xl text-[12px] leading-relaxed transition-all animate-in fade-in slide-in-from-bottom-2 ${
                  t.publisher === 'Agent' ? 'bg-black text-white self-start' : 'bg-white border border-gray-100 self-end text-gray-700'
                }`}>
                  <span className="block text-[8px] font-bold mb-1 opacity-50 uppercase tracking-tighter">
                    {t.publisher}
                  </span>
                  {t.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}