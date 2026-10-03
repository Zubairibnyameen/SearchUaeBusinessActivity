/**
 * Result shape shared by every email-auth server action.
 *
 * WHY THIS LIVES IN ITS OWN MODULE
 *   A file with a top-level `"use server"` directive may only export async
 *   functions — Next rejects any other runtime export at build time, which is
 *   how an exported `const INITIAL_AUTH_STATE` turns into a build failure rather
 *   than a type error. The interface and the initial value are therefore defined
 *   here, where the client components can import them freely, and `actions.ts`
 *   exports nothing but async functions.
 *
 * DELIBERATELY NOT `server-only`
 *   The forms import `INITIAL_AUTH_STATE` to seed `useActionState`, so this
 *   module has to be reachable from a client bundle. It therefore holds no
 *   credentials and no server-only logic — `AuthFailureCode` is imported with
 *   `import type`, which is erased at compile time and so does not pull in the
 *   `server-only` guard on `auth-failures.ts`.
 *
 * NOTE WHAT IS ABSENT
 *   No password field. No provider error. No token. No identity object. Every
 *   field of this state is rendered, so anything a person should not see simply
 *   has nowhere to live.
 */

import type { AuthFailureCode } from "@/lib/auth/auth-failures";

export interface AuthActionState {
  ok: boolean;
  message: string;
  code: AuthFailureCode | "ok" | "confirmation_required" | "reset_sent";
  /** Present only to steer the UI; never an origin the client did not supply. */
  nextPath?: string;
  /** Signup: prefill so the person does not retype the address. */
  email?: string;
}

export const INITIAL_AUTH_STATE: AuthActionState = {
  ok: false,
  message: "",
  code: "unknown",
};