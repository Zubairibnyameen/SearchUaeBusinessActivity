import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { resolveAppOrigin } from "@/lib/app-origin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Never `new URL()` the raw env var: a malformed NEXT_PUBLIC_APP_URL would
  // throw here and fail the whole production build.
  metadataBase: new URL(resolveAppOrigin(process.env.NEXT_PUBLIC_APP_URL)),
  title: {
    default: "UAE Activity Intelligence | Business Activity & Jurisdiction Platform",
    template: "%s | UAE Activity Intelligence",
  },
  description:
    "Search UAE business activities, discover matching mainland and free-zone jurisdictions, licences, approvals and verified government fees.",
  keywords: [
    "UAE business activity",
    "UAE jurisdiction",
    "free zone",
    "mainland",
    "business licence",
    "Dubai",
    "Abu Dhabi",
    "DMCC",
    "IFZA",
    "company formation",
  ],
  openGraph: {
    type: "website",
    locale: "en_AE",
    siteName: "UAE Activity Intelligence",
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-neutral-900">
        {children}
      </body>
    </html>
  );
}
