import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database access.
 *
 * The clients are built LAZILY. `postgres()` parses its argument at call time,
 * so constructing the client at module scope meant that a missing or
 * placeholder `DATABASE_URL` threw `TypeError: Invalid URL` the instant
 * anything imported this module — including `next build`, which imports routes
 * merely to collect their configuration. A build-time env placeholder is not a
 * reason to be unable to compile the app.
 *
 * This also matches the invariant documented in `lib/env.ts`: validation never
 * throws at import time.
 *
 * When `DATABASE_URL` is genuinely required, the error is raised on first use
 * with a message that names the variable and never echoes its value.
 */

const CONNECTION_OPTIONS = {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

function readConnectionString(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set. The database is required for this operation."
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    // Almost always an unfilled placeholder from .env.example. Say so, because
    // the raw `Invalid URL` from postgres-js gives no clue what to fix.
    throw new Error(
      "DATABASE_URL is set but is not a postgres:// connection string. " +
        "Fill in the value in your environment file."
    );
  }
  return raw;
}

type Client = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle<typeof schema>>;

let client: Client | null = null;
let database: Database | null = null;

function getClient(): Client {
  if (!client) {
    client = postgres(readConnectionString(), CONNECTION_OPTIONS);
  }
  return client;
}

function getDatabase(): Database {
  if (!database) {
    database = drizzle(getClient(), { schema });
  }
  return database;
}

/**
 * The pooled Drizzle client.
 *
 * Proxied so construction stays deferred: property access resolves the real
 * client on demand, and methods are bound to it so Drizzle's internal `this`
 * usage is unaffected.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = getDatabase();
    const value = Reflect.get(instance as object, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

let migration: Client | null = null;

function getMigrationClient(): Client {
  if (!migration) {
    migration = postgres(readConnectionString(), { max: 1 });
  }
  return migration;
}

/**
 * Direct client for migrations and scripts (no pooling).
 *
 * Exported as a proxy rather than a value so it keeps working as both a tagged
 * template (``migrationClient`select 1` ``) and an object with `.unsafe()` and
 * `.end()`, while still deferring client construction until first use.
 */
export const migrationClient: Client = new Proxy(
  (() => {
    throw new Error(
      "migrationClient is a tagged template — call it as migrationClient`...`"
    );
  }) as unknown as Client,
  {
    get(_target, prop) {
      const instance = getMigrationClient();
      const value = Reflect.get(instance as object, prop);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    apply(_target, _thisArg, argArray) {
      return Reflect.apply(
        getMigrationClient() as unknown as (...a: unknown[]) => unknown,
        undefined,
        argArray
      );
    },
  }
);
