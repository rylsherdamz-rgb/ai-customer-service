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
  uid: number;
};

type RtmMessageEvent = {
  publisher?: string;
  message?: unknown;
};

type RtmStatusEvent = {
  state?: string;
  reason?: string;
};

type RtmClient = {
  addEventListener: (event: "message" | "status", handler: (event: unknown) => void) => void;
  login: (params: { token: string }) => Promise<unknown>;
  subscribe: (channelName: string) => Promise<unknown>;
  unsubscribe?: (channelName: string) => Promise<unknown>;
  logout?: () => Promise<unknown>;
};

type RtmCtor = new (appId: string, userId: string) => RtmClient;

export class ConvoSession {
  private rtcClient: IAgoraRTCClient | null = null;
  private localAudioTrack: ILocalAudioTrack | null = null;
  private rtm: RtmClient | null = null;
  private subscribedChannel: string | null = null;

  async connect(
    params: ConvoConnectParams,
    opts?: {
      onTranscript?: (event: TranscriptEvent) => void;
      onStatus?: (status: string) => void;
    }
  ) {
    const { appId, channelName, token, uid } = params;

    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
    this.rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    this.rtcClient.on("user-published", async (user, mediaType) => {
      if (!this.rtcClient) return;
      if (mediaType !== "audio") return;
      await this.rtcClient.subscribe(user, mediaType);
      user.audioTrack?.play();
    });

    this.rtcClient.on("connection-state-change", (cur, prev, reason) => {
      opts?.onStatus?.(`rtc:${prev}->${cur} (${String(reason)})`);
    });

    await this.rtcClient.join(appId, channelName, token, uid);

    this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: "speech_standard",
    });
    await this.rtcClient.publish([this.localAudioTrack]);

    const AgoraRTM = (await import("agora-rtm-sdk")).default;
    const { RTM } = AgoraRTM as unknown as { RTM: RtmCtor };
    this.rtm = new RTM(appId, String(uid));

    this.rtm.addEventListener("message", (raw: unknown) => {
      const event = (raw ?? {}) as RtmMessageEvent;
      const message =
        typeof event.message === "string" ? event.message : JSON.stringify(event.message ?? "");
      opts?.onTranscript?.({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ts: Date.now(),
        publisher: String(event.publisher ?? "unknown"),
        message,
      });
    });

    this.rtm.addEventListener("status", (raw: unknown) => {
      const event = (raw ?? {}) as RtmStatusEvent;
      opts?.onStatus?.(`rtm:${String(event.state ?? "unknown")} (${String(event.reason ?? "")})`);
    });

    await this.rtm.login({ token });
    await this.rtm.subscribe(channelName);
    this.subscribedChannel = channelName;
  }

  async setMuted(muted: boolean) {
    if (!this.localAudioTrack) return;
    await this.localAudioTrack.setEnabled(!muted);
  }

  async disconnect() {
    const rtm = this.rtm;
    const rtcClient = this.rtcClient;
    const localAudioTrack = this.localAudioTrack;
    const channelName = this.subscribedChannel;

    this.rtm = null;
    this.rtcClient = null;
    this.localAudioTrack = null;
    this.subscribedChannel = null;

    try {
      if (rtm && channelName && typeof rtm.unsubscribe === "function") {
        await rtm.unsubscribe(channelName);
      }
    } catch {
      // ignore
    }
    try {
      if (rtm && typeof rtm.logout === "function") {
        await rtm.logout();
      }
    } catch {
      // ignore
    }

    try {
      if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
      }
    } catch {
      // ignore
    }

    try {
      if (rtcClient) {
        await rtcClient.leave();
      }
    } catch {
      // ignore
    }
  }
}
