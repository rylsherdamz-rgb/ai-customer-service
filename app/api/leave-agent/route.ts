import { NextRequest, NextResponse } from "next/server";
import { getConvoAiRestConfig } from "@/lib/server/config";

export const runtime = "nodejs";

type LeaveAgentRequest = {
  agentId: string;
};

function basicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function POST(req: NextRequest) {
  let body: LeaveAgentRequest;
  try {
    body = (await req.json()) as LeaveAgentRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = body.agentId?.trim();
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  const cfg = getConvoAiRestConfig();

  const response = await fetch(
    `${cfg.convoAiBaseUrl}/${cfg.appId}/agents/${agentId}/leave`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(cfg.customerId, cfg.customerSecret),
      },
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to leave agent", status: response.status, details: text.slice(0, 2000) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
