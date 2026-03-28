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
    addEventListener: (event: string, cb: (...args: unknown[]) => void) => void;
    login: (params: { token: string }) => Promise<void>;
    subscribe: (channelName: string) => Promise<void>;
    unsubscribe: (channelName: string) => Promise<void>;
    logout: () => Promise<void>;
  } | null = null;
  private subscribedChannel: string | null = null;

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
      this.rtm = new AgoraRTM.RTM(appId, String(uid));
      pushDebugStatus(opts?.onStatus, "RTM client created.");

      this.rtm.addEventListener("message", (...args: unknown[]) => {
        const event = (args[0] ?? {}) as RtmMessageEvent;
        const msgContent =
          typeof event.message === "string" ? event.message : JSON.stringify(event.message);
        pushDebugStatus(
          opts?.onStatus,
          `RTM message received from ${event.publisher ?? "unknown"} on ${event.channelName ?? channelName}`
        );
        opts?.onTranscript?.({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ts: Date.now(),
          publisher: event.publisher || "Agent",
          message: msgContent,
        });
      });

      this.rtm.addEventListener("status", (...args: unknown[]) => {
        const event = (args[0] ?? {}) as RtmStatusEvent;
        pushDebugStatus(
          opts?.onStatus,
          `RTM Status: ${event.state ?? "unknown"}${event.reason ? ` (${event.reason})` : ""}`
        );
      });

      pushDebugStatus(opts?.onStatus, "Logging into RTM...");
      await this.rtm.login({ token });
      pushDebugStatus(opts?.onStatus, "RTM login successful.");
      pushDebugStatus(opts?.onStatus, `Subscribing to RTM channel=${channelName}...`);
      await this.rtm.subscribe(channelName);
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
      this.rtm = null;
      this.rtcClient = null;
      this.localAudioTrack = null;
      this.subscribedChannel = null;
    }
  }
}
