import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, logAdminEvent } from "@/lib/auth";

export async function POST(req: NextRequest) {
  await logAdminEvent({
    event: "admin_logout",
    outcome: "success",
    ip: req.headers.get("x-forwarded-for") ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
