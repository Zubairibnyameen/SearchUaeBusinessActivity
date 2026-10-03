import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";

// The header renders authentication state from the verified session, so every
// public route must be rendered per request. Without this, a build that runs
// before the Supabase environment variables are present would not see any
// cookie read, and the page could be prerendered with a stale logged-out header.
export const dynamic = "force-dynamic";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
