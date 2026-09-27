# Database Migration Strategy

Status: **Adopted for all future schema changes** (Phase C, Step 8).

## Background / known issue

The project was developed using `db:push` plus a set of **manually maintained
SQL migrations** under `src/lib/db/migrations/` (`0001_*.sql` … `0008_*.sql`).
The Drizzle migration **journal** (`meta/_journal.json` + snapshot) was **never
established**. As a result:

- `drizzle-kit migrate` / `drizzle-kit generate` do not have a reliable journal
  to replay against.
- The existing production database (Neon) already holds ~46,055 records and a
  schema that was built up through those hand-written SQL files.

Converting the historical, already-applied migrations into a fresh Drizzle
journal automatically would risk divergence from the **actual** production
schema (hand-written DDL vs. generated DDL are not guaranteed to match), which
could corrupt or misapply future migrations against live data.

**Decision:** We do **not** attempt to auto-baseline the existing production
schema into a Drizzle journal in this step. Instead we establish a **safe,
forward-only** strategy for **all future** schema changes and add guards so
dev/destructive commands are hard to run against production by accident.

## Principles

1. **Never run destructive automatic migrations on app startup.**
   The application does not and must not run DDL on boot. Migrations are
   explicit, operator-run commands.
2. **Forward-only SQL migrations.** Every schema change is a new, numbered
   `.sql` file. Never edit an already-applied migration. New changes go in the
   next number (`0009_*`, `0010_*`, …).
3. **Manual, reviewed SQL.** Because there is no reliable journal, SQL is
   written by hand, reviewed, and applied explicitly in an order that matches
   the real database. Drizzle can still generate SQL for the schema, but the
   applied source of truth is the reviewed SQL files.
4. **No accidental `db:push` against production.** `db:push` is a dev tool. A
   guard script (`src/scripts/db-guard.ts`) blocks it (and other dev DDL) from
   running against any non-local host unless explicitly allowed.
5. **Sandbox/staging first.** Apply a new migration to a local or staging
   PostgreSQL that mirrors production before touching production.
6. **Backup before migrating production.** Snapshot/recover the production
   schema and data before applying any DDL to it.

## Workflows

### Development (local PostgreSQL)

```
# 1. Write a new numbered migration
src/lib/db/migrations/0009_<name>.sql

# 2. Apply it to your local DB (host is localhost → allowed by the guard)
npm run db:migrate         # (or psql -f src/lib/db/migrations/0009_<name>.sql)

# 3. Optionally review the generated SQL against the drizzle schema
npm run db:generate        # dev-time generation, verified by hand
```

### Production (Neon / hosted PostgreSQL)

```
# Migration is applied explicitly and deliberately:
ALLOW_PROD_DB=1 npm run db:migrate    # after backup + sandbox verification
```

`db:push` and `db:seed` are **never** intended for production. They will be
blocked by `db-guard` unless `ALLOW_PROD_DB=1` is set.

## Guard script

`src/scripts/db-guard.ts` is wired into the destructive/dev package scripts.
It:

- Reads `DATABASE_URL` without printing it.
- Allows local hosts by default.
- Blocks remote/production-like hosts (e.g. `*.neon.tech`) for
  destructive/dev commands unless `ALLOW_PROD_DB=1` (or `--allow`) is set.
- Exits non-zero with a clear, **secret-free** message when blocked.

## Do / Don't

| Do                                                              | Don't                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| Add a new numbered forward-only SQL migration                    | Edit an already-applied migration                           |
| Test on local/sandbox before production                          | Run `db:push` / `db:seed` against production                |
| Backup production before applying DDL                            | Rely on auto-migration during app startup                   |
| Keep `DATABASE_URL` out of logs and out of git                   | Auto-baseline a Drizzle journal over live prod data blindly |

## Table inventory (current schema)

The schema is defined in `src/lib/db/schema/*.ts` and the applied DDL is the
hand-written `src/lib/db/migrations/*.sql`. Key tables include:

- `jurisdictions`, `activities`, `activity_synonyms`, `activity_relationships`
- `approvals`, `approval_authorities`, `approval_fees`, `third_party_costs`
- `sources`, `verification_history`, `historical_versions`
- `activity_approval_signals`, `activity_source_prices`
- `licence_types`, `licensing_authorities`
- `import_review_queue`, `regulatory_research_queue`, `admin_audit_logs`

> This documentation does not alter any existing schema or data. Existing
> 46,055 production records are untouched by Step 8.
