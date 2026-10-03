/**
 * Rate-limit key derivation — server-only.
 *
 * WHY A HASH AND NOT THE RAW EMAIL
 *   Rate limiter keys live in a `Map` for the lifetime of the process, and the
 *   whole limiter is in-memory. Keying on a plaintext address would put every
 *   email a person has ever tried to sign in with into long-lived heap memory,
 *   readable from any heap dump or error report that happens to serialise it.
 *   A truncated SHA-256 is stable, collision-free for this purpose and reveals
 *   nothing without knowing the input.
 *
 * WHY NOT `node:crypto` DIRECTLY IN THE CALLER
 *   Centralised so every caller salts with the same prefix convention and the
 *   truncation length cannot differ between two call sites — a mismatch there
 *   would silently give an address two independent allowances.
 */
import "server-only";

import { createHash } from "node:crypto";

/**
 * 128 bits of SHA-256. Long enough that two real addresses colliding is not a
 * concern, short enough to keep a Map key small.
 */
const KEY_BITS = 32;

export function hashRateKey(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, KEY_BITS);
}