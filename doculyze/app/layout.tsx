import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./providers";
import { Toaster } from "sonner";
import Header from "@/app/navbar/header";

// The design's three families. Loaded through next/font rather than the
// stylesheet @import the Figma Make export used: an @import blocks render and
// bypasses the optimizer's self-hosting and fallback metrics. Each exposes a CSS
// variable that globals.css maps onto the --font-* theme tokens.
//
// Barlow Condensed is not a variable font, so its weights are enumerated. The
// design's hierarchy runs the full 400-900 range (the export's numeric
// `font-500` / `font-700` / `font-900` classes are inert in Tailwind v4, so the
// weights only ever showed up where an inline style happened to accompany them —
// real utilities need the real files). Italic is the wordmark's.
const displayFont = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

const bodyFont = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const labelFont = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DocuLyze",
  description: "Upload documents, and DocuLyze turns them into a searchable, structured archive.",
};



// Still synchronous and cookie-free itself, which is what lets the nav live here
// at all. This layout is the shared segment above EVERY route, so a cookies()
// call *in this function* would opt the whole app out of static rendering. The
// read happens one level down instead, inside the navbar islands, so the shell
// this renders is plain markup.
//
// Being honest about what that buys and what it doesn't: the islands are awaited
// with no Suspense boundary between them and the document, so every route still
// renders dynamically — the win is that the nav is resolved server-side and
// correct in the first byte, not that anything prerenders. See
// app/navbar/header.tsx for the trade and the way back.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${labelFont.variable} h-full antialiased`}
    >
    <AuthProvider>
      
      <body className="min-h-full flex flex-col">
        <Header></Header>
        {/* The nav is fixed at h-16; everything below it clears that. This moved
            up from NavShell, which used to supply the clearance per route group. */}
        <div className="flex-1 pt-16">{children}</div>
        <Toaster
          richColors
          position="top-right"
          toastOptions={{ style: { borderRadius: "12px" } }}
        />
        </body>
    </AuthProvider>
    </html>

  );
}
