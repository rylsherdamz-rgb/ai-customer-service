import { NextRequest, NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { getConvoAiAgentConfig, getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { channelName, uid } = body;
  const restCfg = getConvoAiRestConfig();
  const agentCfg = getConvoAiAgentConfig();
  const botUid = restCfg.botUid;

  const botToken = RtcTokenBuilder.buildTokenWithRtm2(
    restCfg.appId,
    restCfg.appCertificate,
    channelName,
    botUid,
    RtcRole.PUBLISHER,
    restCfg.tokenTtlSeconds,
    restCfg.tokenTtlSeconds,
    restCfg.tokenTtlSeconds,
    restCfg.tokenTtlSeconds,
    restCfg.tokenTtlSeconds,
    String(botUid),
    restCfg.tokenTtlSeconds
  );

  const requestBody = {
    name: `agent-${channelName}`,
    properties: {
      channel: channelName,
      token: botToken,
      agent_rtc_uid: String(botUid),
      remote_rtc_uids: ["*"],
      idle_timeout: 300,
      asr: { language: "en-US" },
      llm: {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${agentCfg.llm.apiKey}`,
        style: "gemini",
        system_messages: [
          {
            role: "user",
            parts: [{ text: "You are a helpful and concise AI assistant." }]
          }
        ],
        greeting_message: "Hello! How can I help you?",
        max_history: 10,
        params: {
          model: "gemini-2.0-flash",
          temperature: 0.7,
        }
      },
      tts: {
        vendor: "elevenlabs",
        params: {
          key: agentCfg.tts.key,
          voice_id: agentCfg.tts.voiceId,
          model_id: "eleven_flash_v2_5"
        }
      },
      turn_detection: {
        mode: "adaptive",
        config: {
          end_of_speech: { mode: "vad" }
        }
      }
    }
  };

  try {
    const response = await fetch(`${restCfg.convoAiBaseUrl}/${restCfg.appId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(restCfg.customerId, restCfg.customerSecret),
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("--- AGORA JOIN ERROR ---", data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json({
      agentId: data.agent_id,
      agent_id: data.agent_id,
      channelName,
      botUid
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Fetch failed", message: err.message }, { status: 500 });
  }
}