/**
 * Authorization failure types — server-side only.
 *
 * Authentication ("who are you") and authorization ("what may you do") are
 * kept as separate failure modes so route handlers can return the correct
 * HTTP status:
 *   - no valid provider session  -> 401 Unauthorized
 *   - valid session, insufficient role -> 403 Forbidden
 */
import "server-only";

export class AuthRequiredError extends Error {
  readonly status = 401 as const;
  readonly code = "AUTH_REQUIRED" as const;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = "FORBIDDEN" as const;

  constructor(message = "You do not have access to this resource") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Map a thrown authorization error to a JSON response. Generic, non-leaking
 * messages only — never echo stack traces, SQL, or provider internals.
 */
export function authErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthRequiredError) {
    return Response.json(
      { error: "Authentication required", code: error.code },
      { status: 401 }
    );
  }
  if (error instanceof ForbiddenError) {
    return Response.json(
      { error: "Forbidden", code: error.code },
      { status: 403 }
    );
  }
  return null;
}
