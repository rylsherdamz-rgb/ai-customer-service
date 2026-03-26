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

export class ConvoSession {
  private rtcClient: IAgoraRTCClient | null = null;
  private localAudioTrack: ILocalAudioTrack | null = null;
  private rtm: any = null;
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
      await this.rtcClient.subscribe(user, mediaType);
      
      if (mediaType === "audio") {
        opts?.onStatus?.("Agent audio track subscribed.");
        user.audioTrack?.play();
      }
    });

    this.rtcClient.on("connection-state-change", (cur, prev, reason) => {
      opts?.onStatus?.(`RTC: ${prev} -> ${cur} ${reason || ""}`);
    });

    await this.rtcClient.join(appId, channelName, token, uid);

    try {
      this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "speech_standard",
      });
      await this.rtcClient.publish([this.localAudioTrack]);
      opts?.onStatus?.("Microphone published.");
    } catch (err: any) {
      opts?.onStatus?.(`Mic Error: ${err.message}`);
    }

    try {
      const AgoraRTM = (await import("agora-rtm-sdk")).default;
      this.rtm = new AgoraRTM.RTM(appId, String(uid));

      this.rtm.addEventListener("message", (event: any) => {
        const msgContent = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);
        opts?.onTranscript?.({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ts: Date.now(),
          publisher: event.publisher || "Agent",
          message: msgContent,
        });
      });

      this.rtm.addEventListener("status", (event: any) => {
        opts?.onStatus?.(`RTM Status: ${event.state}`);
      });

      await this.rtm.login({ token: token }); 
      await this.rtm.subscribe(channelName);
      this.subscribedChannel = channelName;
      opts?.onStatus?.("Messaging system active.");
    } catch (err: any) {
      opts?.onStatus?.(`RTM Init Failed: ${err.message}`);
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