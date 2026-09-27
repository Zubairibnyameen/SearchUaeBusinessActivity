import { NextResponse } from "next/server";

/**
 * Health endpoint — confirms the application process is running.
 * Does NOT touch the database and reveals no internals, credentials, paths
 * or stack traces.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
