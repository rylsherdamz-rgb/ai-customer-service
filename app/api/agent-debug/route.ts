import { NextRequest, NextResponse } from "next/server";
import { getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

function basicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

function summarizeRecord(data: unknown) {
  if (!data || typeof data !== "object") {
    return { type: typeof data };
  }

  const record = data as Record<string, unknown>;
  const contents = Array.isArray(record.contents) ? record.contents : undefined;
  const assistantContents =
    contents?.filter(
      (entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).role === "assistant"
    ) ?? [];
  const userContents =
    contents?.filter(
      (entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).role === "user"
    ) ?? [];
  const latestContent = contents && contents.length > 0 ? contents[contents.length - 1] : undefined;

  return {
    keys: Object.keys(record),
    status: record.status,
    message: record.message,
    detail: record.detail,
    traceId: record.trace_id,
    historyCount: contents?.length,
    userTurnCount: userContents.length,
    assistantTurnCount: assistantContents.length,
    firstContent:
      contents && contents.length > 0 && typeof contents[0] === "object"
        ? contents[0]
        : undefined,
    latestContent:
      latestContent && typeof latestContent === "object"
        ? latestContent
        : undefined,
  };
}

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId")?.trim();
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const cfg = getConvoAiRestConfig();
  const headers = {
    "Content-Type": "application/json",
    Authorization: basicAuthHeader(cfg.customerId, cfg.customerSecret),
  };

  const statusUrl = `${cfg.convoAiBaseUrl}/${cfg.appId}/agents/${agentId}`;
  const historyUrl = `${cfg.convoAiBaseUrl}/${cfg.appId}/agents/${agentId}/history`;

  try {
    const [statusRes, historyRes] = await Promise.all([
      fetch(statusUrl, { headers, cache: "no-store" }),
      fetch(historyUrl, { headers, cache: "no-store" }),
    ]);

    const statusData = await statusRes.json().catch(() => null);
    const historyData = await historyRes.json().catch(() => null);

    console.log("[agent-debug]", {
      agentId,
      statusHttp: statusRes.status,
      historyHttp: historyRes.status,
      statusSummary: summarizeRecord(statusData),
      historySummary: summarizeRecord(historyData),
    });

    return NextResponse.json({
      agentId,
      statusHttp: statusRes.status,
      historyHttp: historyRes.status,
      statusOk: statusRes.ok,
      historyOk: historyRes.ok,
      status: statusData,
      history: historyData,
      statusSummary: summarizeRecord(statusData),
      historySummary: summarizeRecord(historyData),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "agent-debug fetch failed", message }, { status: 500 });
  }
}
