import { verifyUser } from "../actions/auth/verify_user";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

// The Geist loaders that used to sit here were dead: their variables were never
// applied to any element (this layout renders no <html>), but calling a next/font
// loader still emits and preloads the font, so protected routes were shipping two
// families nothing rendered in. The design's three families are declared once, in
// the root layout. (issue #21)

export const metadata: Metadata = {
  title: "DocuLyze",
};

export default async function ProtectedLayout({children}: Readonly<{children: React.ReactNode}>) {
    const userVerified = await verifyUser();
    console.log("protected layout called, user verified:", userVerified)
    if (!userVerified) {
        redirect("/login");
    }
    // This layout no longer supplies the nav. It used to pass "signed-in" as a
    // proof rather than a guess — the redirect above means this line is
    // unreachable unless the cookie verified — but the bar now renders from the
    // root layout and its islands re-derive that for themselves. They reach the
    // same answer here by reading the same cookie; the verification below is
    // still what actually gates the route.
    return <>{children}</>;
}