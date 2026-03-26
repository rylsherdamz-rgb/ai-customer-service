import { NextRequest, NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { getAgoraTokenConfig } from "@/lib/server/config";

export const runtime = "nodejs";

type TokenRequest = {
  channelName: string;
  uid: number;
};

export async function POST(req: NextRequest) {
  let body: TokenRequest;
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelName = body.channelName?.trim();
  const uid = Number(body.uid);
  if (!channelName) return NextResponse.json({ error: "channelName is required" }, { status: 400 });
  if (!Number.isInteger(uid) || uid <= 0)
    return NextResponse.json({ error: "uid must be a positive integer" }, { status: 400 });

  const cfg = getAgoraTokenConfig();
  const ttl = cfg.tokenTtlSeconds;

  const token = RtcTokenBuilder.buildTokenWithRtm2(
    cfg.appId,
    cfg.appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    ttl,
    ttl,
    ttl,
    ttl,
    ttl,
    String(uid),
    ttl
  );

  return NextResponse.json({
    token,
    appId: cfg.appId,
    botUid: cfg.botUid,
    uid,
    channelName,
    expiresInSeconds: ttl,
  });
}
