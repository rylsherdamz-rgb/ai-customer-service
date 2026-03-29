"use client";

import type { IAgoraRTCClient, ILocalAudioTrack } from "agora-rtc-sdk-ng";

export type TranscriptEvent = {
  id: string;
  ts: number;
  publisher: string;
  message: string;
};

export type ConvoConnectParams = {
  appId: string;
  channelName: string;
  token: string;
  rtmToken?: string;
  uid: number;
};

type StatusHandler = (status: string) => void;

type TranscriptHandler = (event: TranscriptEvent) => void;

type RtmStatusEvent = {
  state?: string;
  reason?: string;
};

type RtmMessageEvent = {
  message?: unknown;
  publisher?: string;
  channelName?: string;
  customType?: string;
};

type StreamMessageEvent = {
  uid?: string | number;
  data?: string | Uint8Array | ArrayBuffer;
};

type TranscriptPayload = {
  object?: string;
  text?: string;
  turn_id?: number | string;
  turn_status?: number;
  final?: boolean;
  user_id?: string | number;
};

type TranscriptProtocolChunk = {
  messageId: string;
  partIndex: number;
  partCount: number;
  base64Payload: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

function pushDebugStatus(onStatus: StatusHandler | undefined, status: string) {
  console.log(`[ConvoSession] ${status}`);
  onStatus?.(status);
}

export class ConvoSession {
  private rtcClient: IAgoraRTCClient | null = null;
  private localAudioTrack: ILocalAudioTrack | null = null;
  private rtm: {
    addEventListener: (event: "message" | "status", cb: (...args: unknown[]) => void) => void;
    login: (params: { token: string }) => Promise<unknown>;
    subscribe: (channelName: string) => Promise<unknown>;
    unsubscribe: (channelName: string) => Promise<unknown>;
    logout: () => Promise<unknown>;
  } | null = null;
  private subscribedChannel: string | null = null;
  private transcriptChunks = new Map<string, (string | undefined)[]>();

  private decodeTextPayload(payload: string | Uint8Array | ArrayBuffer | undefined): string | null {
    if (!payload) return null;
    if (typeof payload === "string") return payload;
    if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
    if (payload instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload));
    return null;
  }

  private parseTranscriptChunk(raw: string): TranscriptProtocolChunk | null {
    const parts = raw.split("|");
    if (parts.length !== 4) return null;

    const [messageId, partIndexRaw, partCountRaw, base64Payload] = parts;
    const partIndex = Number(partIndexRaw);
    const partCount = Number(partCountRaw);
    if (!messageId || !Number.isInteger(partIndex) || !Number.isInteger(partCount) || partCount <= 0) {
      return null;
    }

    return { messageId, partIndex, partCount, base64Payload };
  }

  private decodeBase64Utf8(base64Payload: string): string {
    const binary = globalThis.atob(base64Payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  private assembleTranscriptChunk(raw: string): string | null {
    const chunk = this.parseTranscriptChunk(raw);
    if (!chunk) return raw;

    const existing = this.transcriptChunks.get(chunk.messageId) ?? new Array(chunk.partCount);
    existing[chunk.partIndex] = chunk.base64Payload;
    this.transcriptChunks.set(chunk.messageId, existing);

    if (existing.some((part) => part === undefined)) {
      return null;
    }

    this.transcriptChunks.delete(chunk.messageId);
    return this.decodeBase64Utf8(existing.join(""));
  }

  private normalizeTranscriptPayload(raw: unknown): TranscriptPayload | null {
    if (!raw || typeof raw !== "object") return null;
    const payload = raw as TranscriptPayload;
    if (!payload.object || !payload.text) return null;
    return payload;
  }

  private getPublisherLabel(payload: TranscriptPayload, fallbackPublisher?: string): string {
    if (payload.object === "assistant.transcription") return "Agent";
    if (payload.object === "user.transcription") return fallbackPublisher || "You";
    return fallbackPublisher || "System";
  }

  private shouldEmitTranscript(payload: TranscriptPayload): boolean {
    if (payload.object === "assistant.transcription") {
      return payload.turn_status !== 0;
    }
    if (payload.object === "user.transcription") {
      return payload.final !== false;
    }
    return false;
  }

  private emitTranscript(
    rawMessage: unknown,
    opts?: {
      onTranscript?: TranscriptHandler;
      onStatus?: StatusHandler;
    },
    fallbackPublisher?: string
  ) {
    const decodedText = this.decodeTextPayload(
      typeof rawMessage === "string" || rawMessage instanceof Uint8Array || rawMessage instanceof ArrayBuffer
        ? rawMessage
        : undefined
    );

    const assembledText =
      typeof decodedText === "string" ? this.assembleTranscriptChunk(decodedText) : null;
    const candidateText = assembledText ?? decodedText;
    if (!candidateText) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidateText);
    } catch {
      pushDebugStatus(opts?.onStatus, `Transcript payload was not JSON: ${candidateText.slice(0, 120)}`);
      return;
    }

    const payload = this.normalizeTranscriptPayload(parsed);
    if (!payload) return;
    if (!this.shouldEmitTranscript(payload)) return;

    const turnId = payload.turn_id ?? `${payload.object}-${Date.now()}`;
    opts?.onTranscript?.({
      id: String(turnId),
      ts: Date.now(),
      publisher: this.getPublisherLabel(payload, fallbackPublisher),
      message: payload.text ?? "",
    });
  }

  async connect(
    params: ConvoConnectParams,
    opts?: {
      onTranscript?: TranscriptHandler;
      onStatus?: StatusHandler;
    }
  ) {
    const { appId, channelName, token, uid } = params;
    pushDebugStatus(opts?.onStatus, `Preparing session for channel=${channelName}, uid=${uid}`);

    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
    this.rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    pushDebugStatus(opts?.onStatus, "RTC client created.");

    this.rtcClient.enableAudioVolumeIndicator();

    this.rtcClient.on("user-published", async (user, mediaType) => {
      if (!this.rtcClient) return;
      pushDebugStatus(opts?.onStatus, `RTC remote published: uid=${String(user.uid)}, media=${mediaType}`);
      await this.rtcClient.subscribe(user, mediaType);
      
      if (mediaType === "audio") {
        pushDebugStatus(opts?.onStatus, `Agent audio track subscribed from uid=${String(user.uid)}.`);
        user.audioTrack?.play();
      }
    });

    this.rtcClient.on("user-joined", (user) => {
      pushDebugStatus(opts?.onStatus, `RTC remote joined: uid=${String(user.uid)}`);
    });

    this.rtcClient.on("user-left", (user, reason) => {
      pushDebugStatus(opts?.onStatus, `RTC remote left: uid=${String(user.uid)} reason=${reason ?? "unknown"}`);
    });

    this.rtcClient.on("user-unpublished", (user, mediaType) => {
      pushDebugStatus(opts?.onStatus, `RTC remote unpublished: uid=${String(user.uid)}, media=${mediaType}`);
    });

    this.rtcClient.on("stream-message", (uid, data) => {
      const event = { uid, data } as StreamMessageEvent;
      pushDebugStatus(opts?.onStatus, `RTC stream message received from uid=${String(event.uid ?? "unknown")}`);
      this.emitTranscript(event.data, opts, String(event.uid ?? "Agent"));
    });

    this.rtcClient.on("volume-indicator", (volumes) => {
      const localEntry = volumes.find((entry) => String(entry.uid) === String(uid));
      if (localEntry) {
        pushDebugStatus(opts?.onStatus, `Mic level=${localEntry.level}`);
      }
    });

    this.rtcClient.on("connection-state-change", (cur, prev, reason) => {
      pushDebugStatus(opts?.onStatus, `RTC: ${prev} -> ${cur} ${reason || ""}`.trim());
    });

    pushDebugStatus(opts?.onStatus, "Joining RTC...");
    await this.rtcClient.join(appId, channelName, token, uid);
    pushDebugStatus(opts?.onStatus, "RTC join successful.");

    try {
      this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "speech_standard",
      });
      await this.rtcClient.publish([this.localAudioTrack]);
      pushDebugStatus(opts?.onStatus, "Microphone published.");
    } catch (err: unknown) {
      pushDebugStatus(opts?.onStatus, `Mic Error: ${getErrorMessage(err)}`);
    }

    try {
      const AgoraRTM = (await import("agora-rtm-sdk")).default;
      const rtm = new AgoraRTM.RTM(appId, String(uid));
      this.rtm = rtm;
      pushDebugStatus(opts?.onStatus, "RTM client created.");

      rtm.addEventListener("message", (...args: unknown[]) => {
        const event = (args[0] ?? {}) as RtmMessageEvent;
        pushDebugStatus(
          opts?.onStatus,
          `RTM message received from ${event.publisher ?? "unknown"} on ${event.channelName ?? channelName}`
        );
        this.emitTranscript(event.message, opts, event.publisher || "Agent");
      });

      rtm.addEventListener("status", (...args: unknown[]) => {
        const event = (args[0] ?? {}) as RtmStatusEvent;
        pushDebugStatus(
          opts?.onStatus,
          `RTM Status: ${event.state ?? "unknown"}${event.reason ? ` (${event.reason})` : ""}`
        );
      });

      pushDebugStatus(opts?.onStatus, "Logging into RTM...");
      await rtm.login({ token });
      pushDebugStatus(opts?.onStatus, "RTM login successful.");
      pushDebugStatus(opts?.onStatus, `Subscribing to RTM channel=${channelName}...`);
      await rtm.subscribe(channelName);
      this.subscribedChannel = channelName;
      pushDebugStatus(opts?.onStatus, "Messaging system active.");
    } catch (err: unknown) {
      pushDebugStatus(opts?.onStatus, `RTM Init Failed: ${getErrorMessage(err)}`);
    }
  }

  async setMuted(muted: boolean) {
    if (this.localAudioTrack) {
      await this.localAudioTrack.setEnabled(!muted);
    }
  }

  async disconnect() {
    try {
      if (this.rtm && this.subscribedChannel) {
        await this.rtm.unsubscribe(this.subscribedChannel);
        await this.rtm.logout();
      }
      if (this.localAudioTrack) {
        this.localAudioTrack.stop();
        this.localAudioTrack.close();
      }
      if (this.rtcClient) {
        await this.rtcClient.leave();
      }
    } catch (e) {
      console.error("Cleanup error", e);
    } finally {
      this.transcriptChunks.clear();
      this.rtm = null;
      this.rtcClient = null;
      this.localAudioTrack = null;
      this.subscribedChannel = null;
    }
  }
}
