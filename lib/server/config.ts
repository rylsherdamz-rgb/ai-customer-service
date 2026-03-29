import { envNumber, optionalEnv, requireEnv } from "@/lib/server/env";

export type TtsVendor = "microsoft" | "elevenlabs" | "minimax";

export type AgoraTokenConfig = {
  appId: string;
  appCertificate: string;
  botUid: number;
  tokenTtlSeconds: number;
};

export type ConvoAiRestConfig = AgoraTokenConfig & {
  customerId: string;
  customerSecret: string;
  convoAiBaseUrl: string;
};

export type LlmConfig = {
  apiKey: string;
  model: string;
  url: string;
  maxTokens: number;
  temperature: number;
  topP: number;
};

export type TtsConfig = {
      vendor: "minimax";
      key: string;
      model: string;
      url: string;
      voiceId: string;
      speed: number;
      volume: number;
      pitch: number;
      emotion: string;
      sampleRate: number;
      groupId?: string;
    };

export type ConvoAiAgentConfig = {
  llm: LlmConfig;
  tts: TtsConfig;
};

export function getAgoraTokenConfig(): AgoraTokenConfig {
  const appId = requireEnv("NEXT_PUBLIC_AGORA_APP_ID");
  const appCertificate = requireEnv("AGORA_APP_CERTIFICATE");

  return {
    appId,
    appCertificate,
    botUid: envNumber("NEXT_PUBLIC_AGORA_BOT_UID", 1001),
    tokenTtlSeconds: envNumber("AGORA_TOKEN_TTL_SECONDS", 3600),
  };
}

export function getConvoAiRestConfig(): ConvoAiRestConfig {
  const base = getAgoraTokenConfig();
  return {
    ...base,
    customerId: requireEnv("AGORA_CUSTOMER_ID"),
    customerSecret: requireEnv("AGORA_CUSTOMER_SECRET"),
    convoAiBaseUrl:
      optionalEnv("AGORA_CONVO_AI_BASE_URL") ??
      "https://api.agora.io/api/conversational-ai-agent/v2/projects",
  };
}

export function getConvoAiAgentConfig(): ConvoAiAgentConfig {
  const llmApiKey =
    optionalEnv("GEMINI_API_KEY")?.trim() ??
    optionalEnv("LLM_API_KEY")?.trim() ??
    requireEnv("GOOGLE_API_KEY").trim();
  const llmModel = (optionalEnv("GEMINI_MODEL") ?? optionalEnv("LLM_MODEL") ?? "gemini-2.0-flash").trim();
  const defaultLlmUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:streamGenerateContent?alt=sse&key=${llmApiKey}`;
  const rawLlmUrl = optionalEnv("LLM_URL")?.trim();
  const llmUrl =
    rawLlmUrl && !rawLlmUrl.includes("${")
      ? rawLlmUrl.replace(":generateContent?alt=sse", ":streamGenerateContent?alt=sse")
      : defaultLlmUrl;

  const llm: LlmConfig = {
    apiKey: llmApiKey,
    model: llmModel,
    url: llmUrl,
    maxTokens: envNumber("LLM_MAX_TOKENS", 1000),
    temperature: envNumber("LLM_TEMPERATURE", 0.7),
    topP: envNumber("LLM_TOP_P", 0.9),
  };

  const tts: TtsConfig = 
      {
          vendor: "minimax",
          key: requireEnv("MINIMAX_TTS_KEY").trim(),
          model: (optionalEnv("MINIMAX_TTS_MODEL") ?? "speech-02-turbo").trim(),
          url: (optionalEnv("MINIMAX_TTS_URL") ?? "wss://api-uw.minimax.io/ws/v1/t2a_v2").trim(),
          voiceId: requireEnv("MINIMAX_TTS_VOICE_ID").trim(),
          speed: envNumber("MINIMAX_TTS_SPEED", 1.0),
          volume: envNumber("MINIMAX_TTS_VOLUME", 1.0),
          pitch: envNumber("MINIMAX_TTS_PITCH", 0),
          emotion: (optionalEnv("MINIMAX_TTS_EMOTION") ?? "neutral").trim(),
          sampleRate: envNumber("MINIMAX_TTS_SAMPLE_RATE", 48000),
          groupId: optionalEnv("MINIMAX_TTS_GROUP_ID")?.trim() ?? optionalEnv("MINIMAX_GROUP_ID")?.trim(),
        }

  return { llm, tts };
}
