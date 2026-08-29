import Link from "next/link";

const NAV_ITEMS = [
  { href: "/search", label: "Search Activities" },
  { href: "/jurisdictions", label: "Jurisdictions" },
  { href: "/compare", label: "Compare" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight text-neutral-900"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M10 2.5 16.5 5v4.2c0 3.9-2.8 7.1-6.5 8.3-3.7-1.2-6.5-4.4-6.5-8.3V5L10 2.5z"
                stroke="white"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="8.6" r="1.6" fill="white" />
            </svg>
          </span>
          <span className="text-[15px]">
            UAE Activity Intelligence
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 sm:px-3"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
