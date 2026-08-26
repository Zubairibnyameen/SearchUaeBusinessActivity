import { vi } from "vitest";

process.env.ADMIN_PASSWORD = "test-password-123";
process.env.ADMIN_SESSION_SECRET = "test-session-secret-key-for-testing-only";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }),
}));
