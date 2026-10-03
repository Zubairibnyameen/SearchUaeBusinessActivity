import { vi } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";

/*
 * ADMIN_PASSWORD and ADMIN_SESSION_SECRET are deliberately NOT set here. The
 * ADMIN_PASSWORD admin session has been removed, and no test should depend on
 * those variables existing — if any test starts passing because one of them is
 * defined, that is a sign the legacy path is being resurrected.
 *
 * A leftover value in a developer's real .env must not change test behaviour
 * either, so they are explicitly cleared.
 */
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_SESSION_SECRET;

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }),
}));
