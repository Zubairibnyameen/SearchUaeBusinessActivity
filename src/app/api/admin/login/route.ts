import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  checkRateLimit,
  createSessionToken,
  logAdminEvent,
  verifyAdminPassword,
} from "@/lib/auth";

const BodySchema = z.object({
  password: z.string().min(1).max(500),
});

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1|fc|fd|fe80)/i;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp && !PRIVATE_IP_RE.test(firstIp)) {
      return firstIp;
    }
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && !PRIVATE_IP_RE.test(realIp)) {
    return realIp;
  }
  return "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  if (!checkRateLimit(ip)) {
    await logAdminEvent({
      event: "admin_login",
      outcome: "failure",
      ip,
      userAgent,
      details: { reason: "rate_limited" },
    });
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    await logAdminEvent({
      event: "admin_login",
      outcome: "failure",
      ip,
      userAgent,
      details: { reason: "invalid_password" },
    });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const { token, maxAge } = createSessionToken();
  await logAdminEvent({ event: "admin_login", outcome: "success", ip, userAgent });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}
