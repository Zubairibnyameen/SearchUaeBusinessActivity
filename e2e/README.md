# E2E testing — Playwright

This project uses [Playwright](https://playwright.dev/) for end-to-end testing.

## Safety — read this first

- **Never run the E2E suite against the production Neon database.**
- The `playwright.config.ts` **refuses to start** when `DATABASE_URL` points to
  a remote / production-like host. It will only run when the app is served
  against a **local or sandbox PostgreSQL**.
- If you are certain you want to override this (not recommended), you can set
  `E2E_ALLOW_REMOTE=1` alongside an explicit `E2E_BASE_URL` — but you must be
  sure the target is a throwaway sandbox, not production.

## Suite layout

- `e2e/smoke/*.spec.ts` — **DB-independent** structural smoke tests
  (homepage renders, hero search, search submit, search results page,
  jurisdictions page, compare page, login page, invalid route → 404). These
  assert rendering behaviour that holds regardless of data volume.
- `e2e/db-backed/*.spec.ts` — assertions that depend on data being present.
  These are **skipped** unless `E2E_DB=1` is set.

## Running safely (local / sandbox)

1. Provision a **local PostgreSQL** (or a disposable sandbox / staging DB that
   mirrors the dataset — NOT production).
2. Point the app at it and start it against a localhost URL:

   ```bash
   # terminal 1 — run the app against the sandbox DB
   DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/uae_activity_sandbox" \
     npm run build
   DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/uae_activity_sandbox" \
     npm run start
   ```

   The DB host **must be localhost / 127.0.0.1 / ::1** for the guard to allow
   E2E to start.

3. In a second terminal, run the smoke suite:

   ```bash
   E2E_BASE_URL="http://127.0.0.1:3000" npm run test:e2e -- --project=smoke
   ```

4. Optional: run DB-backed tests against the sandbox that has data:

   ```bash
   E2E_DB=1 E2E_BASE_URL="http://127.0.0.1:3000" npm run test:e2e -- --project=db-backed
   ```

## Install browsers

```bash
npm run test:e2e:install
```

## CI note

E2E is **not** part of the default CI pipeline. CI runs only DB-free unit/API
tests. E2E is a separate, opt-in, locally-run suite that requires an
environment with a safe sandbox database.
