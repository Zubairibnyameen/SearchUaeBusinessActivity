import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  regulatoryResearchQueue,
  jurisdictions,
  activities,
  activityApprovalSignals,
  approvals,
  approvalAuthorities,
  sources,
  verificationHistory,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  saveResearchNotes,
  startResearch,
  resolveVerified,
  resolveNotRequired,
  markConflicting,
  flagManualReview,
} from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  researching: "Researching",
  verified: "Verified",
  not_required: "Not required",
  conflicting_sources: "Conflicting sources",
  needs_manual_review: "Needs manual review",
};

interface ResearchDetailPageProps {
  params: Promise<{ id: string }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-neutral-200 rounded-lg bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">{title}</h2>
      {children}
    </section>
  );
}

const inputCls =
  "w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "block text-xs font-medium text-neutral-500 mb-1";

export default async function ResearchDetailPage({ params }: ResearchDetailPageProps) {
  const { id } = await params;

  const [item] = await db
    .select({
      r: regulatoryResearchQueue,
      a: activities,
      j: jurisdictions,
    })
    .from(regulatoryResearchQueue)
    .innerJoin(activities, eq(activities.id, regulatoryResearchQueue.activityId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, regulatoryResearchQueue.jurisdictionId))
    .where(eq(regulatoryResearchQueue.id, id))
    .limit(1);

  if (!item) notFound();
  const { r: q, a: act, j } = item;

  const [signalRows, resolvedApproval] = await Promise.all([
    db
      .select({
        signalType: activityApprovalSignals.signalType,
        authorityName: activityApprovalSignals.authorityName,
        notes: activityApprovalSignals.notes,
        lastVerified: activityApprovalSignals.lastVerified,
      })
      .from(activityApprovalSignals)
      .where(eq(activityApprovalSignals.activityId, act.id)),
    q.resolutionApprovalId
      ? db
          .select({
            approval: approvals,
            authority: approvalAuthorities,
            source: sources,
          })
          .from(approvals)
          .leftJoin(approvalAuthorities, eq(approvalAuthorities.id, approvals.approvalAuthorityId))
          .leftJoin(sources, eq(sources.id, approvals.sourceId))
          .where(eq(approvals.id, q.resolutionApprovalId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const history = q.resolutionApprovalId
    ? await db
        .select()
        .from(verificationHistory)
        .where(eq(verificationHistory.entityId, q.resolutionApprovalId))
        .orderBy(desc(verificationHistory.verifiedAt))
    : [];

  const priorityReasons = Array.isArray(q.priorityReasons)
    ? (q.priorityReasons as { factor: string; points: number }[])
    : [];
  const approval = resolvedApproval[0];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/research" className="text-sm text-neutral-500 hover:text-neutral-700">
            ← Back to research queue
          </Link>
          <h1 className="text-2xl font-bold mt-2">{act.officialName}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {act.activityCode ?? "no code"} · <span className="uppercase">{j.slug}</span> ({j.name}) ·{" "}
            Status: <strong>{STATUS_LABELS[q.researchStatus]}</strong> · Priority {q.priorityScore}
          </p>
        </div>
        <Link
          href={`/activities/${act.id}`}
          target="_blank"
          className="shrink-0 text-sm px-3 py-2 rounded-md border border-neutral-300 hover:bg-neutral-50"
        >
          Open activity ↗
        </Link>
      </div>

      <Section title="Signal context (from official free-zone source)">
        <p className="text-sm text-neutral-700 mb-3">
          Approval signal on activity record: <strong>{act.approvalSignal}</strong>
        </p>
        {signalRows.length > 0 ? (
          <ul className="text-sm space-y-2 list-disc list-inside text-neutral-700">
            {signalRows.map((s, i) => (
              <li key={i}>
                {s.signalType}
                {s.authorityName ? ` — ${s.authorityName}` : ""}
                {s.notes ? ` (${s.notes})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">No structured signal rows.</p>
        )}
        {priorityReasons.length > 0 && (
          <p className="text-xs text-neutral-400 mt-3">
            Priority factors:{" "}
            {priorityReasons.map((p) => `${p.factor} (+${p.points})`).join("; ")}
          </p>
        )}
        {q.possibleAuthority && (
          <p className="text-xs text-neutral-500 mt-2">
            Lead authority (unverified hint): {q.possibleAuthority}
          </p>
        )}
      </Section>

      {approval && (
        <Section title="Resolution record">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt>Approval</dt>
              <dd className="font-medium">{approval.approval.name}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{approval.approval.approvalType}</dd>
            </div>
            <div>
              <dt>Requirement status</dt>
              <dd>{approval.approval.status}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{approval.approval.verificationStatus}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{approval.authority?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{approval.approval.lastVerified ?? "—"}</dd>
            </div>
          </dl>
          {approval.source && (
            <p className="text-sm mt-4">
              Official source:{" "}
              <a
                className="text-blue-600 hover:underline break-all"
                href={approval.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {approval.source.title}
              </a>{" "}
              <span className="text-xs text-neutral-400">
                (retrieved {approval.source.retrievedDate ?? "?"}
                {approval.source.contentHash ? " · content hash recorded" : ""})
              </span>
            </p>
          )}
          {history.length > 0 && (
            <div className="mt-4">
              <p className={labelCls}>Verification history</p>
              <ul className="text-xs text-neutral-500 space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    {new Date(h.verifiedAt).toISOString().slice(0, 16).replace("T", " ")} · {h.verificationStatus} · by{" "}
                    {h.verifiedBy ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section title="Working notes & candidate lead (lead only — never final evidence)">
        <form action={saveResearchNotes} className="space-y-3">
          <input type="hidden" name="id" value={q.id} />
          <div>
            <label className={labelCls} htmlFor="candidateSourceUrl">
              Candidate source URL (may be third-party for discovery)
            </label>
            <input
              id="candidateSourceUrl"
              name="candidateSourceUrl"
              type="url"
              defaultValue={q.candidateSourceUrl ?? ""}
              placeholder="https://…"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="notes">
              Research notes
            </label>
            <textarea id="notes" name="notes" rows={3} defaultValue={q.notes ?? ""} className={inputCls} />
          </div>
          <button type="submit" className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700">
            Save notes
          </button>
        </form>
      </Section>

      <Section title="Workflow">
        {q.researchStatus === "pending_review" && (
          <form action={startResearch}>
            <input type="hidden" name="id" value={q.id} />
            <button className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-500">
              Start research
            </button>
          </form>
        )}

        <div className="space-y-8 mt-4">
          <div>
            <h3 className="text-sm font-semibold text-emerald-700 mb-2">Mark VERIFIED (requires official source)</h3>
            <form action={resolveVerified} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="id" value={q.id} />
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="verifiedSourceUrl">Official source URL (*.gov.ae / authority / free-zone official)</label>
                <input id="verifiedSourceUrl" name="verifiedSourceUrl" type="url" required placeholder="https://www.mohap.gov.ae/…" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="verifiedSourceTitle">Source title</label>
                <input id="verifiedSourceTitle" name="verifiedSourceTitle" required placeholder="e.g. MOHAP facility licensing requirements" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="authorityName">Authority name</label>
                <input id="authorityName" name="authorityName" defaultValue={q.possibleAuthority ?? ""} placeholder="Ministry of Health and Prevention" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="approvalType">Approval type</label>
                <select id="approvalType" name="approvalType" defaultValue="regulatory_permit" className={inputCls}>
                  <option value="regulatory_permit">regulatory_permit</option>
                  <option value="professional_license">professional_license</option>
                  <option value="sector_approval">sector_approval</option>
                  <option value="noc">noc</option>
                  <option value="inspection">inspection</option>
                  <option value="certification">certification</option>
                  <option value="registration">registration</option>
                  <option value="other">other</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="approvalName">Approval name</label>
                <input id="approvalName" name="approvalName" placeholder="Healthcare facility licence" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="requirementText">What exactly does the source require? (quote-level accuracy)</label>
                <textarea id="requirementText" name="requirementText" rows={2} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="applicationProcess">Application process (as described by the source)</label>
                <textarea id="applicationProcess" name="applicationProcess" rows={2} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="conditions">Conditions (one per line)</label>
                <textarea id="conditions" name="conditions" rows={3} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="requiredDocuments">Required documents (one per line)</label>
                <textarea id="requiredDocuments" name="requiredDocuments" rows={3} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <button className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500">
                  Resolve as verified
                </button>
              </div>
            </form>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Mark NOT REQUIRED (requires official basis)</h3>
            <form action={resolveNotRequired} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="id" value={q.id} />
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="notRequiredSourceUrl">Official source supporting this conclusion</label>
                <input id="notRequiredSourceUrl" name="notRequiredSourceUrl" type="url" required className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="rationale">Rationale</label>
                <textarea id="rationale" name="rationale" rows={2} className={inputCls} />
              </div>
              <button className="justify-self-start px-4 py-2 rounded-md border border-neutral-300 text-sm font-medium hover:bg-neutral-50">
                Resolve as not required
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-red-700 mb-2">Mark CONFLICTING SOURCES</h3>
              <form action={markConflicting} className="space-y-2">
                <input type="hidden" name="id" value={q.id} />
                <textarea name="conflictNotes" rows={2} placeholder="Which sources disagree?" className={inputCls} />
                <button className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-500">
                  Mark conflicting
                </button>
              </form>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-700 mb-2">Escalate to MANUAL REVIEW</h3>
              <form action={flagManualReview} className="space-y-2">
                <input type="hidden" name="id" value={q.id} />
                <textarea name="reviewNotes" rows={2} placeholder="Why does this need human review?" className={inputCls} />
                <button className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-500">
                  Flag manual review
                </button>
              </form>
            </div>
          </div>
        </div>
      </Section>

      <p className="text-xs text-neutral-400">
        Data rules: signals are never promoted without an authoritative source; every workflow change is
        audit-logged; unresolved records are never deleted.
      </p>
    </div>
  );
}
