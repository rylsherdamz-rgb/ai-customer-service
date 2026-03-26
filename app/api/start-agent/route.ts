import { NextRequest, NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { getConvoAiAgentConfig, getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

type StartAgentRequest = {
  channelName: string;
  uid: number;
};

type AgoraJoinResponse = {
  agent_id: string;
};

function basicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function POST(req: NextRequest) {
  let body: StartAgentRequest;
  try {
    body = (await req.json()) as StartAgentRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelName = body.channelName?.trim();
  const uid = Number(body.uid);
  if (!channelName || !Number.isInteger(uid) || uid <= 0) {
    return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
  }

  const restCfg = getConvoAiRestConfig();
  const agentCfg = getConvoAiAgentConfig();
  const ttl = restCfg.tokenTtlSeconds;
  const botUid = restCfg.botUid;

  const botToken = RtcTokenBuilder.buildTokenWithRtm2(
    restCfg.appId,
    restCfg.appCertificate,
    channelName,
    botUid,
    RtcRole.PUBLISHER,
    ttl,
    ttl,
    ttl,
    ttl,
    ttl,
    String(botUid),
    ttl
  );

  const inputModalities = (process.env.NEXT_PUBLIC_INPUT_MODALITIES ?? "audio").split(",").map((s) => s.trim()).filter(Boolean);
  const outputModalities = (process.env.NEXT_PUBLIC_OUTPUT_MODALITIES ?? "audio,text").split(",").map((s) => s.trim()).filter(Boolean);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${agentCfg.llm.model}:streamGenerateContent?alt=sse&key=${agentCfg.llm.apiKey}`;

  const requestBody = {
    name: `agent-${channelName}-${Date.now()}`,
    properties: {
      channel: channelName,
      token: botToken,
      agent_rtc_uid: String(botUid),
      remote_rtc_uids: ["*"],
      advanced_features: {
        enable_aivad: true,
        enable_rtm: true,
      },
      asr: { language: "en-US" },
      llm: {
        url: geminiUrl,
        style: "gemini",
        system_messages: [
          {
            role: "user",
            parts: [{ text: "You are a friendly, concise support agent. Keep replies short." }]
          }
        ],
        greeting_message: "Hi! How can I help you today?",
        failure_message: "I encountered an error. Please try again.",
        max_history: 12,
        input_modalities: inputModalities,
        output_modalities: outputModalities,
        params: {
          model: agentCfg.llm.model,
          max_tokens: agentCfg.llm.maxTokens,
          temperature: agentCfg.llm.temperature,
          top_p: agentCfg.llm.topP,
        },
      },
      vad: {
        interrupt_duration_ms: 160,
        silence_duration_ms: 640,
        prefix_padding_ms: 240,
      },
      tts:
        agentCfg.tts.vendor === "microsoft"
          ? {
              vendor: "microsoft",
              params: {
                key: agentCfg.tts.key,
                region: agentCfg.tts.region,
                voice_name: agentCfg.tts.voiceName,
                rate: agentCfg.tts.rate,
                volume: agentCfg.tts.volume,
              },
              skip_patterns: [2],
            }
          : agentCfg.tts.vendor === "minimax"
          ? {
              vendor: "minimax",
              params: {
                ...(agentCfg.tts.groupId ? { group_id: agentCfg.tts.groupId } : {}),
                key: agentCfg.tts.key,
                model: agentCfg.tts.model,
                voice_setting: {
                  voice_id: agentCfg.tts.voiceId,
                  speed: agentCfg.tts.speed,
                  vol: agentCfg.tts.volume,
                  pitch: agentCfg.tts.pitch,
                  emotion: agentCfg.tts.emotion,
                  latex_render: false,
                  english_normalization: true,
                },
                audio_setting: { sample_rate: agentCfg.tts.sampleRate },
              },
              skip_patterns: [2],
            }
          : {
              vendor: "elevenlabs",
              params: {
                key: agentCfg.tts.apiKey,
                voice_id: agentCfg.tts.voiceId,
                model_id: agentCfg.tts.modelId,
              },
              skip_patterns: [2],
            },
    },
  };

  const response = await fetch(`${restCfg.convoAiBaseUrl}/${restCfg.appId}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthHeader(restCfg.customerId, restCfg.customerSecret),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: "Agora API error", details: text }, { status: 500 });
  }

  const data = (await response.json()) as AgoraJoinResponse;
  return NextResponse.json({
    agentId: data.agent_id,
    channelName,
    uid,
    botUid,
  });
}