import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  checkRateLimit,
  clearRateLimit,
  createSessionToken,
  logAdminEvent,
  verifyAdminPassword,
} from "@/lib/auth";

const BodySchema = z.object({
  password: z.string().min(1).max(500),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
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
    // Uniform response — do not reveal whether the account exists
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  clearRateLimit(ip);
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
