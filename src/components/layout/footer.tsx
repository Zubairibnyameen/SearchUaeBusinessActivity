import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="text-sm text-neutral-500">
            UAE Activity Intelligence Platform
          </div>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/activities"
              className="text-neutral-500 hover:text-neutral-700"
            >
              Activities
            </Link>
            <Link
              href="/jurisdictions"
              className="text-neutral-500 hover:text-neutral-700"
            >
              Jurisdictions
            </Link>
            <Link
              href="/compare"
              className="text-neutral-500 hover:text-neutral-700"
            >
              Compare
            </Link>
          </nav>
        </div>
        <div className="mt-6 text-center text-sm">
          Built by{" "}
          <span className="font-semibold text-neutral-800">MOHD ZUBAIR</span>{" "}
          &middot;{" "}
          <a
            href="https://www.linkedin.com/in/ziydev/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            linkedin.com/in/ziydev
          </a>
        </div>
        <div className="mt-3 text-center text-xs text-neutral-400">
          Data sourced from official UAE government authorities. Approval signals
          are not verified approvals. Always verify regulatory requirements with
          the relevant authority.
        </div>
      </div>
    </footer>
  );
}
