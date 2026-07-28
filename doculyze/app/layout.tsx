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



// Deliberately synchronous and cookie-free. This layout is the shared segment
// above EVERY route, so a single cookies() call here opts the entire app out of
// static rendering — that is what kept /login and /register dynamic. The nav and
// its auth state live in the route-group layouts instead; see
// components/nav_shell.tsx for why each group supplies its own value.
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
        {children}
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
