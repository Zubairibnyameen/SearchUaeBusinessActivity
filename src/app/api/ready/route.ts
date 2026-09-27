import { NextResponse } from "next/server";
import { getEnvSummary } from "@/lib/env";
import { logServerError } from "@/lib/server-logger";

/**
 * Readiness endpoint — verifies that critical dependencies (database
 * connectivity) are available using a minimal, safe query.
 *
 * Responses never reveal: database host, credentials, SQL, internal paths or
 * stack traces.
 */
export async function GET() {
  const env = getEnvSummary();
  if (!env.requiredConfigured) {
    // Required configuration missing → not ready, but say nothing sensitive.
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503 }
    );
  }

  let dbOk = false;
  try {
    // Dynamic import keeps builds without a DATABASE_URL from failing, and
    // runs the connectivity check only at request time.
    const { migrationClient } = await import("@/lib/db");
    const res = await migrationClient`select 1 as ok`;
    dbOk = Array.isArray(res) && res.length === 1;
  } catch (err) {
    logServerError("readiness", err, { check: "db_connectivity" });
    dbOk = false;
  }

  if (!dbOk) {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ status: "ok" });
}
