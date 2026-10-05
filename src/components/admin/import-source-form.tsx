"use client";

/**
 * Admin import form.
 *
 * The jurisdiction select, the file input and the "what happens to this data"
 * notice are all rendered from props supplied by the server page, so the list of
 * importable sources has exactly one definition (the ingestion registry).
 *
 * All decisions happen server-side. `slug` and `file` are re-validated by the
 * action against the registry; nothing here is trusted because it is displayed.
 */

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { runImportAction, type ImportActionState } from "@/app/admin/import/actions";

const INITIAL: ImportActionState = { ok: false, message: "" };

function SubmitButton({ dryRun }: { dryRun: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending
        ? dryRun
          ? "Checking…"
          : "Importing…"
        : dryRun
          ? "Run dry check"
          : "Import source file"}
    </button>
  );
}

function Counter({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "positive" | "warn";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-neutral-900";
  return (
    /* `min-w-0`: a grid item is floored at min-content, so a 6+ figure count
       would otherwise widen the cell instead of fitting its track. */
    <div className="min-w-0 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className={`text-xl font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function ResultSummary({ state }: { state: ImportActionState }) {
  const s = state.summary;
  if (!state.ok || !s) return null;

  return (
    <div
      role="status"
      className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4"
    >
      <h3 className="text-sm font-semibold text-emerald-900">
        {s.dryRun ? "Dry run — nothing was written" : "Import complete"}
      </h3>
      <p className="mt-1 text-sm text-emerald-900">{state.message}</p>

      {/* Two columns at 320px leaves ~74px of content per cell after the nested
          `p-4`/`p-3` padding, which wraps every label over 4-5 lines. Below 380px
          the counters stack instead. */}
      <div className="mt-4 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-5">
        <Counter label="Rows discovered" value={s.rowsDiscovered} />
        <Counter label="Rows accepted" value={s.rowsAccepted} tone="positive" />
        <Counter label="Rows rejected" value={s.rowsRejected} tone="warn" />
        <Counter
          label="Duplicates skipped"
          value={s.rowsSkippedDuplicate}
        />
        <Counter label="Review items created" value={s.reviewItemsCreated} tone="warn" />
      </div>

      {s.artifact ? (
        <p className="mt-3 break-all text-xs text-emerald-800">
          Raw artifact preserved at{" "}
          <code className="font-mono">{s.artifact.relativePath}</code>{" "}
          (sha256 {s.artifact.sha256.slice(0, 16)}…, {s.artifact.bytes.toLocaleString()} bytes)
        </p>
      ) : null}

      {s.reviewNotes.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
            {s.reviewNotes.length} item(s) sent to the review queue
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-900">
            {s.reviewNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {s.errors.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-red-800">
            {s.errors.length} error(s)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">
            {s.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {s.warnings.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-amber-800">
            {s.warnings.length} warning(s)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
            {s.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ImportSourceForm({
  sources,
  maxUploadBytes,
}: {
  sources: Array<{ slug: string; label: string; authorityName: string; formats: readonly string[] }>;
  maxUploadBytes: number;
}) {
  const [state, formAction] = useActionState(runImportAction, INITIAL);
  // Mirrors the checkbox so the submit button can say which run is happening.
  const [dryRun, setDryRun] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="slug" className="mb-1 block text-sm font-medium text-neutral-700">
          Source
        </label>
        <select
          id="slug"
          name="slug"
          defaultValue={sources[0]?.slug ?? ""}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        >
          {sources.map(s => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>
        {state.fieldErrors?.slug ? (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {state.fieldErrors.slug}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-neutral-500">
          Only sources with a working adapter are listed. Adding a new jurisdiction
          requires an adapter in the ingestion registry.
        </p>
      </div>

      <div>
        <label htmlFor="file" className="mb-1 block text-sm font-medium text-neutral-700">
          Official source file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Must match the format the source publishes ({sources.map(s => s.formats.join("/")).filter(Boolean).join(", ")}).
          Max {Math.floor(maxUploadBytes / 1024 / 1024)} MB.
        </p>
        {state.fieldErrors?.file ? (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {state.fieldErrors.file}
          </p>
        ) : null}
      </div>

      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          name="dryRun"
          checked={dryRun}
          onChange={e => setDryRun(e.target.checked)}
          className="mt-0.5 rounded border-neutral-300"
        />
        <span>
          Dry run only
          <span className="block text-xs text-neutral-500">
            Parse and validate the file and report what would happen. Writes nothing.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton dryRun={dryRun} />
      </div>

      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
      <ResultSummary state={state} />
    </form>
  );
}