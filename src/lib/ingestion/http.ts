/**
 * Polite HTTP fetching for official sources.
 * GET only, browser-like UA, hard timeout, no auth bypass / rate-limit evasion.
 */

import type { DiscoveredSource, FetchedPayload } from "./types";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 UAEActivityResearch/1.0 (+data-collection; contact via platform)";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function fetchOfficial(
  discovery: DiscoveredSource,
  opts: FetchOptions = {}
): Promise<FetchedPayload> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(discovery.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        ...(opts.headers ?? {}),
      },
    });

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      discovery,
      body: buf,
      contentType: res.headers.get("content-type") ?? undefined,
      filename: filenameFromUrl(res.url || discovery.url),
      fetchedAt: new Date(),
      httpStatus: res.status,
      finalUrl: res.url || discovery.url,
    };
  } finally {
    clearTimeout(timer);
  }
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
    return undefined;
  } catch {
    return undefined;
  }
}
