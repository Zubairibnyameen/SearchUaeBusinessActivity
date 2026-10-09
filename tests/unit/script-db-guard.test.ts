import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyHost, decideGuard } from "@/lib/db/guard";
import { loadEnvFile } from "@/lib/db/env";
import { assertDatabaseWritable, isProdOptIn } from "@/scripts/db-safety";

const LOCAL_URL = "postgres://localhost:5432/app";
const REMOTE_URL =
  "postgresql://user:pw@ep-cool-name.eu-central-1.aws.neon.tech/app";

/** Write a throwaway `.env` file and return its path. */
function writeTempEnv(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-guard-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, contents, "utf-8");
  return file;
}

// ─── A. Pure decision logic ───────────────────────────────────────────────

describe("database host classification", () => {
  it.each([
    [LOCAL_URL, "local"],
    ["postgres://127.0.0.1:5432/app", "local"],
    ["postgres://[::1]:5432/app", "local"],
    ["postgres://0.0.0.0:5432/app", "local"],
    [REMOTE_URL, "remote"],
    ["postgres://db.internal.example.com/app", "remote"],
    ["", "unset"],
    ["   ", "unset"],
    [undefined, "unset"],
  ])("classifyHost(%j) === %s", (url, expected) => {
    expect(classifyHost(url)).toBe(expected);
  });

  it("allows local, blocks remote unless opted in, blocks unset", () => {
    expect(decideGuard(LOCAL_URL, false).allowed).toBe(true);
    expect(decideGuard(REMOTE_URL, false).allowed).toBe(false);
    expect(decideGuard(REMOTE_URL, true).allowed).toBe(true);
    expect(decideGuard(undefined, true).allowed).toBe(false);
  });
});

// ─── B. Runtime gate behavior ─────────────────────────────────────────────

describe("assertDatabaseWritable", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalOptIn = process.env.ALLOW_PROD_DB;

  let exitSpy: MockInstance;
  let logSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.ALLOW_PROD_DB;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalOptIn === undefined) delete process.env.ALLOW_PROD_DB;
    else process.env.ALLOW_PROD_DB = originalOptIn;
  });

  it("allows a local database without opt-in", () => {
    process.env.DATABASE_URL = LOCAL_URL;
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("blocks a production-like database without opt-in", () => {
    process.env.DATABASE_URL = REMOTE_URL;
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("allows a production-like database when ALLOW_PROD_DB=1", () => {
    process.env.DATABASE_URL = REMOTE_URL;
    process.env.ALLOW_PROD_DB = "1";
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("allows a production-like database when --allow is passed", () => {
    process.env.DATABASE_URL = REMOTE_URL;
    assertDatabaseWritable("test-command", ["--allow"]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT authorize a remote write from a .env ALLOW_PROD_DB", () => {
    // Simulates the loader path: a `.env` on disk tries to opt in, but the
    // loader strips the key, so the gate still blocks a remote host.
    delete process.env.ALLOW_PROD_DB;
    loadEnvFile(writeTempEnv("ALLOW_PROD_DB=1\n"));
    process.env.DATABASE_URL = REMOTE_URL;
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("authorizes a remote write when ALLOW_PROD_DB is exported at invocation", () => {
    process.env.ALLOW_PROD_DB = "1";
    process.env.DATABASE_URL = REMOTE_URL;
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("blocks when DATABASE_URL is unset", () => {
    assertDatabaseWritable("test-command", []);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("never prints the DATABASE_URL", () => {
    process.env.DATABASE_URL = REMOTE_URL;
    assertDatabaseWritable("test-command", []);
    const printed = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]
      .flat()
      .join(" ");
    expect(printed).not.toContain("ep-cool-name");
    expect(printed).not.toContain("user:pw");
  });
});

describe("isProdOptIn", () => {
  const original = process.env.ALLOW_PROD_DB;

  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_PROD_DB;
    else process.env.ALLOW_PROD_DB = original;
  });

  it("is true for ALLOW_PROD_DB=1", () => {
    process.env.ALLOW_PROD_DB = "1";
    expect(isProdOptIn([])).toBe(true);
  });

  it("is true for --allow", () => {
    delete process.env.ALLOW_PROD_DB;
    expect(isProdOptIn(["--allow"])).toBe(true);
  });

  it("is false by default", () => {
    delete process.env.ALLOW_PROD_DB;
    expect(isProdOptIn([])).toBe(false);
  });
});

// ─── B2. loadEnvFile never sources ALLOW_PROD_DB from a file ───────────────

describe("loadEnvFile — FILE values vs the invoking shell", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalOptIn = process.env.ALLOW_PROD_DB;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalOptIn === undefined) delete process.env.ALLOW_PROD_DB;
    else process.env.ALLOW_PROD_DB = originalOptIn;
  });

  it("skips ALLOW_PROD_DB but still loads other keys", () => {
    delete process.env.ALLOW_PROD_DB;
    delete process.env.DATABASE_URL;
    loadEnvFile(
      writeTempEnv('ALLOW_PROD_DB=1\nDATABASE_URL="postgres://localhost:5432/app"\n')
    );
    expect(process.env.ALLOW_PROD_DB).toBeUndefined();
    expect(process.env.DATABASE_URL).toBe("postgres://localhost:5432/app");
  });

  it("does not clear an ALLOW_PROD_DB already set in the shell", () => {
    process.env.ALLOW_PROD_DB = "1";
    loadEnvFile(writeTempEnv("ALLOW_PROD_DB=1\n"));
    expect(process.env.ALLOW_PROD_DB).toBe("1");
  });

  it("never overrides an existing environment value", () => {
    process.env.DATABASE_URL = LOCAL_URL;
    loadEnvFile(writeTempEnv('DATABASE_URL="postgres://remote.example.com/app"\n'));
    expect(process.env.DATABASE_URL).toBe(LOCAL_URL);
  });
});

// ─── B3. package.json scripts route mutating commands through the gate ──────

describe("package.json database scripts", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")
  ) as { scripts: Record<string, string> };

  it.each(["db:migrate", "db:migrate:local", "db:push", "db:seed"])(
    "%s is gated by db-guard",
    (name) => {
      expect(pkg.scripts[name]).toContain("db-guard.ts");
    }
  );

  // Verified non-mutating against the database: `db:generate` only reads the
  // schema to emit SQL files, and `db:studio` is an interactive browser that
  // performs no write on launch. They are intentionally NOT gated so read-only
  // inspection workflows keep working; pin that so a future change is
  // deliberate.
  it.each(["db:generate", "db:studio"])("%s is intentionally not gated", (name) => {
    expect(pkg.scripts[name]).not.toContain("db-guard.ts");
  });
});

// ─── B4. Direct seed execution is gated ────────────────────────────────────

describe("src/lib/db/seed.ts direct execution", () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, "../../src/lib/db/seed.ts"),
    "utf-8"
  );

  it("calls assertDatabaseWritable before opening a connection", () => {
    const guardIdx = content.indexOf("assertDatabaseWritable(");
    const connectIdx = content.indexOf("postgres(");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(connectIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(connectIdx);
  });

  it("loads .env through the safe loader", () => {
    expect(content).toContain("loadEnvFile(");
  });
});

// ─── C. Static coverage: no mutating script escapes the gate ───────────────

describe("every mutating script invokes the DB-write gate", () => {
  const scriptsDir = path.resolve(__dirname, "../../src/scripts");

  // A script mutates if it issues INSERT/UPDATE/DELETE or opens a transaction.
  const MUTATION_RE = /\.(?:insert|update|delete)\s*\(|\.transaction\s*\(/;

  // Mutating scripts whose write verb is not directly visible:
  //  - apply-migrations: raw DDL via client.unsafe()
  //  - import-jurisdiction: delegates writes to the guarded runImport()
  const KNOWN_MUTATING = new Set([
    "apply-migrations.ts",
    "import-jurisdiction.ts",
  ]);

  // The guard implementation itself and the wrapper must not be scanned.
  const EXCLUDED = new Set(["db-guard.ts", "db-safety.ts"]);

  function scriptFiles(): string[] {
    return fs
      .readdirSync(scriptsDir)
      .filter((f) => f.endsWith(".ts") && !EXCLUDED.has(f));
  }

  function read(file: string): string {
    return fs.readFileSync(path.join(scriptsDir, file), "utf-8");
  }

  it("detects the direct-mutation scripts at all (guards the guardrail)", () => {
    const detected = scriptFiles().filter((f) => MUTATION_RE.test(read(f)));
    // If this number collapses, the detector has rotted and the coverage test
    // below would silently stop protecting anything.
    expect(detected.length).toBeGreaterThanOrEqual(9);
    expect(detected).toContain("import-dmcc.ts");
    expect(detected).toContain("seed-afz.ts");
  });

  it("leaves no mutating script without assertDatabaseWritable()", () => {
    const unguarded = scriptFiles().filter((f) => {
      const content = read(f);
      const mutating = MUTATION_RE.test(content) || KNOWN_MUTATING.has(f);
      return mutating && !content.includes("assertDatabaseWritable(");
    });
    expect(unguarded).toEqual([]);
  });

  it("does not gate read-only diagnostic scripts (verify must keep working)", () => {
    // verify.ts is a READ-ONLY production connectivity check; gating it would
    // defeat its purpose. This pins that no one adds the gate there.
    expect(read("verify.ts")).not.toContain("assertDatabaseWritable(");
    expect(read("audit-regulatory.ts")).not.toContain("assertDatabaseWritable(");
    expect(read("benchmark-search.ts")).not.toContain("assertDatabaseWritable(");
  });
});
