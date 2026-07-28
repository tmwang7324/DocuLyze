import type { Metadata } from "next";
import LandingPage from "./landing_page";

// The home route. It does NOT branch on auth: "/" is the landing page signed in
// or out, and only the nav above it changes (the archive stays at /dashboard —
// see the 2026-07-26 revision on #20/#22/#23). The (public) layout still reads the
// cookie, but only to tell the nav which face to wear.
export const metadata: Metadata = {
    title: "DocuLyze — find the signal in everything",
    description:
        "Upload PDFs, Word documents, Markdown, code, markup, or plain text. DocuLyze parses each one into structured text and files it in a single searchable archive.",
};

export default function Home() {
    return <LandingPage />;
}
