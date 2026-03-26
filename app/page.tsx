
"use client";

import { useMemo, useRef, useState } from "react";
import { ConvoSession, type TranscriptEvent } from "@/lib/client/convoSession";

type ConnectState = "idle" | "connecting" | "connected" | "error";

type TokenResponse = {
  token: string;
  appId: string;
  botUid: number;
  uid: number;
  channelName: string;
  expiresInSeconds: number;
  error?: string;
};

type StartAgentResponse = {
  agentId: string;
  channelName: string;
  uid: number;
  botUid: number;
  error?: string;
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Home() {
  const sessionRef = useRef<ConvoSession | null>(null);
  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const [channelName, setChannelName] = useState<string>("");
  const [uid, setUid] = useState<number | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);

  const appId = useMemo(() => process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "", []);

  const pushStatus = (line: string) => {
    setStatusLines((prev) => [...prev.slice(-30), `${formatTime(Date.now())} ${line}`]);
  };

  const handleStart = async () => {
    if (!appId) {
      setError("Missing NEXT_PUBLIC_AGORA_APP_ID");
      setState("error");
      return;
    }

    setError(null);
    setTranscript([]);
    setStatusLines([]);
    setMuted(false);
    setState("connecting");

    const newChannel = `support-${crypto.randomUUID()}`;
    const newUid = Math.floor(Math.random() * 1_000_000_000) + 1;
    setChannelName(newChannel);
    setUid(newUid);

    try {
      pushStatus("requesting token…");
      const tokenRes = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: newChannel, uid: newUid }),
      });
      const tokenJson = (await tokenRes.json()) as TokenResponse;
      if (!tokenRes.ok) throw new Error(tokenJson.error ?? "token request failed");
      if (!tokenJson.token) throw new Error("token response missing token");

      pushStatus("starting agent…");
      const startRes = await fetch("/api/start-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: newChannel, uid: newUid }),
      });
      const startJson = (await startRes.json()) as StartAgentResponse;
      if (!startRes.ok) throw new Error(startJson.error ?? "start-agent failed");
      if (!startJson.agentId) throw new Error("start-agent response missing agentId");
      setAgentId(startJson.agentId);

      pushStatus("joining RTC + RTM…");
      const session = new ConvoSession();
      sessionRef.current = session;

      await session.connect(
        { appId, channelName: newChannel, token: tokenJson.token, uid: newUid },
        {
          onTranscript: (evt) => setTranscript((prev) => [...prev, evt]),
          onStatus: (s) => pushStatus(s),
        }
      );

      pushStatus("connected");
      setState("connected");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
      pushStatus(`error: ${msg}`);
      await sessionRef.current?.disconnect().catch(() => {});
      sessionRef.current = null;
    }
  };

  const handleStop = async () => {
    setState("idle");
    setMuted(false);
    pushStatus("disconnecting…");

    await sessionRef.current?.disconnect().catch(() => {});
    sessionRef.current = null;

    if (agentId) {
      await fetch("/api/leave-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      }).catch(() => {});
    }

    setAgentId(null);
    pushStatus("disconnected");
  };

  const handleToggleMute = async () => {
    const next = !muted;
    setMuted(next);
    await sessionRef.current?.setMuted(next).catch(() => {});
  };

  return (
    <main className="flex-1 px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">AI Customer Support (Voice)</h1>
          <p className="text-sm opacity-80">
            Starts an Agora Conversational AI agent and connects your microphone for real-time support.
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          {state !== "connected" ? (
            <button
              onClick={handleStart}
              disabled={state === "connecting"}
              className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {state === "connecting" ? "Connecting…" : "Start session"}
            </button>
          ) : (
            <>
              <button onClick={handleStop} className="rounded-md bg-black px-4 py-2 text-white">
                End session
              </button>
              <button onClick={handleToggleMute} className="rounded-md border px-4 py-2">
                {muted ? "Unmute mic" : "Mute mic"}
              </button>
            </>
          )}
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
            <div className="font-medium">Error</div>
            <div className="mt-1 opacity-90">{error}</div>
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Session</h2>
              <span className="text-xs opacity-70">{state}</span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <dt className="opacity-70">Channel</dt>
              <dd className="col-span-2 font-mono">{channelName || "—"}</dd>
              <dt className="opacity-70">UID</dt>
              <dd className="col-span-2 font-mono">{uid ?? "—"}</dd>
              <dt className="opacity-70">Agent</dt>
              <dd className="col-span-2 font-mono">{agentId ?? "—"}</dd>
            </dl>
            <div className="mt-4">
              <h3 className="text-xs font-medium opacity-80">Status</h3>
              <div className="mt-2 max-h-56 overflow-auto rounded bg-black/5 p-2 font-mono text-[11px] leading-relaxed">
                {statusLines.length ? statusLines.map((l, i) => <div key={i}>{l}</div>) : <div>—</div>}
              </div>
            </div>
          </section>

          <section className="rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Transcript (RTM)</h2>
              <span className="text-xs opacity-70">{transcript.length}</span>
            </div>
            <div className="mt-3 max-h-[22rem] overflow-auto space-y-2 text-sm">
              {transcript.length ? (
                transcript.map((t) => (
                  <div key={t.id} className="rounded bg-black/5 p-2">
                    <div className="text-[11px] opacity-70">
                      {formatTime(t.ts)} · {t.publisher}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">{t.message}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm opacity-70">No messages yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
