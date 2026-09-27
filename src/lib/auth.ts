/**
 * Admin authentication — server-only module.
 *
 * Single-admin model: possession of ADMIN_PASSWORD grants the admin role.
 * Sessions are stateless HMAC-signed tokens stored in an HttpOnly cookie.
 * ADMIN_SESSION_SECRET and ADMIN_PASSWORD must never reach client code.
 */
import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { adminAuditLogs } from "@/lib/db/schema";
import { getRateLimiter } from "@/lib/rate-limit";

export const ADMIN_COOKIE = "uaai_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// ---------- rate limiting ----------
/**
 * Rate limiting is delegated to the rate-limiter abstraction (see
 * src/lib/rate-limit/*). The default implementation is in-process and
 * SINGLE-INSTANCE / DEVELOPMENT-GRADE only:
 *   - state resets on server restart
 *   - it does NOT protect multi-instance / serverless deployments
 *     (each instance keeps its own counter)
 *   - it is keyed by client IP and can be bypassed behind proxies that do
 *     not forward X-Forwarded-For faithfully
 * Production hardening would swap in a shared-storage adapter (e.g. Redis /
 * Upstash) via getRateLimiter() — no caller changes.
 *
 * NOTE: login/route.ts checks the rate limit BEFORE parsing the request body.
 */
const RATE_KEY_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;

function rateKey(key: string): string {
  // Guard against unbounded map growth from attacker-controlled keys.
  if (!RATE_KEY_RE.test(key)) return "unknown";
  return key;
}

export function checkRateLimit(key: string): boolean {
  return getRateLimiter().check(rateKey(key)).allowed;
}

export function clearRateLimit(key: string): void {
  getRateLimiter().clear(rateKey(key));
}

// ---------- password verification (timing-safe) ----------
export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected || typeof password !== "string" || password.length === 0) {
    return false;
  }
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Burn equivalent time before rejecting to reduce length oracle
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ---------- session tokens ----------
function sign(payload: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(): { token: string; maxAge: number } {
  const payload = JSON.stringify({
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const body = Buffer.from(payload).toString("base64url");
  return { token: `${body}.${sign(body)}`, maxAge: SESSION_TTL_SECONDS };
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig: string;
  try {
    expectedSig = sign(body);
  } catch {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return (
      payload?.role === "admin" &&
      typeof payload.exp === "number" &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

/** For server components / layouts guarding admin pages. */
export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}

// ---------- audit logging ----------
export async function logAdminEvent(input: {
  event: string;
  outcome?: "success" | "failure";
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(adminAuditLogs).values({
      event: input.event,
      outcome: input.outcome ?? "success",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      details: input.details ?? null,
    });
  } catch (err) {
    // Audit failures must not crash auth flows, but must be visible
    console.error("[audit] failed to record admin event:", err);
  }
}
