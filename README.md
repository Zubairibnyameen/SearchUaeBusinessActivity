# UAE Activity Intelligence

An intelligent search and comparison engine for UAE business activities across licensed
jurisdictions (mainland + free zones). It ingests official activity registers from licensing
authorities, exposes an admin workflow for review/audit, and provides a public search,
jurisdiction-profile and cost-comparison experience.

## What it does

- **Official-source ingestion** — adapters pull activity registers straight from each
  jurisdiction's authority (RAKEZ, SPC Free Zone, Ajman Free Zone / AFZ, DMCC, IFZA), each
  with documented, verifiable sourcing provenance.
- **Normalized canonical model** — heterogeneous source fields (activity names, codes,
  fees, approval/TPA flags, sub-zones) are normalized into a single PostgreSQL schema with
  a search-friendly index.
- **Intelligent search** — intent-aware query parsing, jurisdiction recognition
  ("restaurant in RAKEZ"), synonym matching, cost and approval-ranking enrichment, and a
  multi-jurisdiction **comparison engine**.
- **Admin + audit workflow** — import, review/approval queues, research tracking, fee and
  approval management, and administrative audit logging.

> **Coverage note:** Currently indexed jurisdictions are **RAKEZ, SPC Free Zone, Ajman Free
> Zone (AFZ), DMCC, and IFZA**. This is not yet a claim of full UAE coverage — additional
> mainland and free-zone jurisdictions can be added through the ingestion framework later.

## Tech stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Styling**: Tailwind CSS v4, Base UI React, shadcn/ui-style components
- **Database**: PostgreSQL via `postgres.js`, **Drizzle ORM**, **pgvector** embeddings
- **Search**: pg_trgm + full-text indexes with a custom intent/relevance engine
- **Testing**: Vitest (unit + API), Playwright (E2E, opt-in for sandbox DB)
- **Data**: XLSX / CSV / JSON parsing (`exceljs`, `csv-parse`)

## Project structure

```
src/
  app/
    (public)/          Public storefront: home, search, jurisdictions, compare, activities
    admin/             Admin panel: sources, import, review, research, fees, approvals, audit
    login/             Admin authentication
    api/               Route handlers (search, compare, intelligence, jurisdictions, categories,
                       activities, admin auth, health, ready)
  lib/
    db/                Drizzle schema, migrations, connection, pure db-safety guard (guard.ts)
    search/            Query parsing, intent, enrichment, jurisdiction intelligence, comparison
    ingestion/         Source adapters + normalization/validation pipeline
    rate-limit/        Rate limiter abstraction (in-memory default; pluggable)
    env.ts             Runtime environment validation + secret redaction
    server-logger.ts   Server-side error logging + sanitization (Sentry-ready stub)
  scripts/             CLI tools (db-guard, verify, imports, search test harness)
e2e/                   Playwright specs (smoke + db-backed) + README
tests/                 Vitest unit + API specs
```

See [docs/migration-strategy.md](docs/migration-strategy.md) for the database migration
workflow and the E2E notes in [e2e/README.md](e2e/README.md).

## Getting started

### Prerequisites

- Node.js 20+ (developed against Node 22)
- A PostgreSQL database (local or Neon), ideally with `pg_trgm` and `vector` extensions
  available

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in real values. The app **requires** the following
variables — it will refuse to start meaningful DB-backed flows without them:

| Variable                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string (postgres://… or postgresql://…)  |

Optional: `NEXT_PUBLIC_APP_URL` for canonical links.

Placeholder values (e.g. `change-this-to-a-secure-password`) are detected by the
environment validator and treated as unconfigured.

### Admin access

There is **no admin password**. `/admin` is authorized by Supabase (Google) login:

1. The visitor signs in with Google via `/signin`.
2. On sign-in their e-mail is looked up in the `ADMIN_EMAILS` allowlist and
   promoted to `role = 'admin'` in `app_users`.
3. Every admin page, route handler and server action calls `requireAdmin()`,
   which requires a verified session with `role = 'admin'` and an `active`
   status.

An empty `ADMIN_EMAILS` grants no admin access at all, so the admin area is
unreachable until you fill it in. Set `ADMIN_EMAILS` to your own address.

### 3. Run the database migrations

Migrations are **forward-only SQL files** under `src/lib/db/migrations/`. They are applied
manually, never automatically at server startup (see
[docs/migration-strategy.md](docs/migration-strategy.md) for the reasoning and the
do/don't table).

For a **local** database:

```bash
npm run db:migrate:local
```

> The `db:push`, `db:seed`, and `db:migrate` scripts pass through a safety guard
> (`src/scripts/db-guard.ts`) that **blocks** them from running against a
> non-local / production-like database (e.g. Neon) unless you explicitly set
> `ALLOW_PROD_DB=1` or pass `--allow`. There is no auto-migration over production.

### 4. Run the dev server

```bash
npm run dev
# open http://localhost:3000
```

To verify the app is healthy once deployed:

- `GET /api/health` — always `200 { "status": "ok" }` (liveness; no DB touch)
- `GET /api/ready` — `200 { "status": "ok" }` when required env + DB are reachable, else
  `503 { "status": "unavailable" }`. Never leaks host, credentials, SQL, or stack traces.

## Scripts

| Script                     | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `npm run dev`              | Start the Next.js dev server                                      |
| `npm run build`            | Production build                                                  |
| `npm run start`            | Start the production server                                       |
| `npm run lint`             | ESLint                                                            |
| `npm run typecheck`        | `tsc --noEmit` type check                                         |
| `npm test`                 | Run the Vitest suite (unit + API)                                 |
| `npm run test:coverage`    | Run tests with coverage                                           |
| `npm run test:e2e`         | Run Playwright E2E (sandbox DB only — see e2e/README.md)          |
| `npm run verify`           | Read-only production sanity check (env, build files, DB, schema)  |
| `npm run ci`               | Full CI gate chain: lint → typecheck → test → build               |
| `npm run db:migrate:local` | Guarded migration for local DB only                               |

The CI pipeline (`.github/workflows/ci.yml`) runs `npm run ci` on PRs and pushes to `main`
with zero database, deploy, or secrets requirement (tests mock the DB layer).

## Testing

- **Unit + API (Vitest)**: specs under `tests/`, environment mocked in `tests/setup.ts`
  (no real database needed). The admin/API spec coverage includes authentication,
  rate-limiting, search, comparison, env validation, error sanitization, db-safety guard,
  and health/readiness.
- **E2E (Playwright)**: opt-in, **must not run against a remote/Neon database**. The config
  refuses to run unless `DATABASE_URL` targets a local/sandbox host (or you explicitly set
  `E2E_ALLOW_REMOTE=1` + `E2E_BASE_URL`). See [e2e/README.md](e2e/README.md).

## Security & reliability

- Runtime env validation with **secret redaction** in logs and health/ready responses
  (`src/lib/env.ts`, `src/lib/server-logger.ts`).
- **Rate limiting** on the admin login route via a pluggable limiter
  (`src/lib/rate-limit`); the default is an in-memory implementation, with a documented
  upgrade path to Redis/Upstash for multi-instance deployments.
- DB-destructive CLI commands are **guarded** against production databases.
- Security headers + `poweredByHeader: false` baked into `next.config.ts`.
- `.env*` is git-ignored; only `.env.example` is committed.

## Roadmap (non-exhaustive)

- Add more mainland + free-zone jurisdictions through the ingestion framework.
- Automatic migration journaling / baselining for a healthy forward-only flow.
- Pluggable error-monitoring provider (Sentry) hook — emplacement already stubbed.
- Multi-instance rate limiting via a shared store.

## Credits

Built and maintained by **MOHD ZUBAIR** · [LinkedIn](https://linkedin.com/in/ziydev)