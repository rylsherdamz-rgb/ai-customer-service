import { NextRequest, NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { getConvoAiAgentConfig, getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

function getAuthHeader(id: string, secret: string): string {
  const credentials = `${id}:${secret}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { channelName } = body;
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
        url: `https://generativelanguage.googleapis.com/v1beta/models/${agentCfg.llm.model}:streamGenerateContent?alt=sse&key=${agentCfg.llm.apiKey}`,
        style: "gemini",
        system_messages: [
          {
            role: "user",
            parts: [{ text: "You are a helpful, witty AI assistant. Keep your responses brief and natural." }]
          }
        ],
        greeting_message: "Connected. I'm ready to talk!",
        max_history: 10,
        params: {
          model: agentCfg.llm.model,
          temperature: 0.7,
        }
      },
      tts: {
        vendor: "minimax",
        params: {
          key: process.env.MINIMAX_API_KEY,
          group_id: process.env.MINIMAX_GROUP_ID,
          model: "speech-01-turbo",
          voice_setting: {
            voice_id: "male-qn-qingse",
            speed: 1.0,
            vol: 1.0,
            pitch: 0
          }
        }
      },
      turn_detection: {
        mode: "server_vad",
        config: {
          end_of_speech: {
            mode: "vad",
            vad_config: {
              threshold: 40,
              silence_duration_ms: 800,
              prefix_padding_ms: 200
            }
          }
        }
      }
    }
  };

  try {
    const authHeader = getAuthHeader(restCfg.customerId, restCfg.customerSecret);
    const apiUrl = `${restCfg.convoAiBaseUrl}/${restCfg.appId}/join`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("401 Check - CustomerID:", restCfg.customerId);
      console.error("401 Check - API URL:", apiUrl);
      console.error("Agora Response:", data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json({
      agentId: data.agent_id,
      channelName,
      botUid
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Fetch Error", message: err.message }, { status: 500 });
  }
}