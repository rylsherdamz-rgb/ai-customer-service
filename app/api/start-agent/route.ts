import { NextRequest, NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { getConvoAiAgentConfig, getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

function getAuthHeader(id: string, secret: string): string {
  const credentials = `${id}:${secret}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

function summarizeAgentResponse(data: unknown) {
  if (!data || typeof data !== "object") {
    return { type: typeof data };
  }

  const record = data as Record<string, unknown>;
  return {
    keys: Object.keys(record),
    agentId: record.agent_id,
    status: record.status,
    message: record.message,
    detail: record.detail,
    traceId: record.trace_id,
  };
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const channelName = typeof body?.channelName === "string" ? body.channelName.trim() : "";
  const userUid = Number(body?.uid);
  if (!channelName) {
    return NextResponse.json({ error: "channelName is required" }, { status: 400 });
  }
  if (!Number.isInteger(userUid) || userUid <= 0) {
    return NextResponse.json({ error: "uid must be a positive integer" }, { status: 400 });
  }

  const restCfg = getConvoAiRestConfig();
  const agentCfg = getConvoAiAgentConfig();
  const botUid = restCfg.botUid;
  const agentRtmUid = `${botUid}-${channelName}`;

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
      agent_rtm_uid: agentRtmUid,
      remote_rtc_uids: ["*"],
      advanced_features: {
        enable_rtm: true,
      },
      enable_string_uid: false,
      idle_timeout: 300,
      asr: {
        vendor: "ares",
        language: "en-US",
        task: "conversation",
      },
      llm: {
        url: agentCfg.llm.url,
        api_key: agentCfg.llm.apiKey,
        style: "gemini",
        system_messages: [
          {
            role: "system",
            content: "You are a helpful, witty AI assistant. Keep your responses brief and natural.",
          },
        ],
        greeting_message: "Connected. I'm ready to talk!",
        failure_message: "Hold on a second.",
        max_history: 32,
        ignore_empty: true,
        params: {
          model: agentCfg.llm.model,
          max_output_tokens: agentCfg.llm.maxTokens,
          temperature: agentCfg.llm.temperature,
          top_p: agentCfg.llm.topP,
        }
      },
      tts: {
        vendor: agentCfg.tts.vendor,
        params: {
          url: agentCfg.tts.url,
          key: agentCfg.tts.key,
          group_id: agentCfg.tts.groupId,
          model: agentCfg.tts.model,
          voice_setting: {
            voice_id: agentCfg.tts.voiceId.trim(),
            speed: agentCfg.tts.speed,
            vol: agentCfg.tts.volume,
            pitch: agentCfg.tts.pitch,
            emotion: agentCfg.tts.emotion,
          },
          sample_rate: agentCfg.tts.sampleRate,
        }
      },
      parameters: {
        transcript: {
          enable: true,
          protocol_version: "v2",
          enable_words: false,
        },
        enable_dump: true,
      },
      turn_detection: {
        config: {
          end_of_speech: {
            mode: "semantic",
          },
        },
      },
    },
  };

  try {
    const authHeader = getAuthHeader(restCfg.customerId, restCfg.customerSecret);
    const apiUrl = `${restCfg.convoAiBaseUrl}/${restCfg.appId}/join`;

    console.log("[start-agent] joining", {
      channelName,
      userUid,
      botUid,
      agentRtmUid,
      ttsVendor: agentCfg.tts.vendor,
      ttsModel: agentCfg.tts.model,
      ttsUrl: agentCfg.tts.url,
      ttsVoiceId: agentCfg.tts.voiceId.trim(),
      ttsGroupIdPresent: Boolean(agentCfg.tts.groupId),
      llmModel: agentCfg.llm.model,
      llmUrl: agentCfg.llm.url.replace(agentCfg.llm.apiKey, "<redacted>"),
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    const debug = summarizeAgentResponse(data);

    console.log("[start-agent] Agora join response", {
      httpStatus: response.status,
      ok: response.ok,
      debug,
    });

    if (!response.ok) {
      console.error("[start-agent] failure", {
        apiUrl,
        debug,
      });
      return NextResponse.json({ ...data, debug }, { status: response.status });
    }

    return NextResponse.json({
      agentId: data.agent_id,
      channelName,
      botUid,
      agentRtmUid,
      debug,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[start-agent] fetch error", { channelName, message });
    return NextResponse.json({ error: "Fetch Error", message }, { status: 500 });
  }
}
