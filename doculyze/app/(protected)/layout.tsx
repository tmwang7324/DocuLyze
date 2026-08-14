import { verifyUser } from "../actions/auth/verify_user";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUid } from "@/_lib/data";

export const metadata: Metadata = {
  title: "DocuLyze",
};

export default async function ProtectedLayout({children}: Readonly<{children: React.ReactNode}>) {
    const userVerified = await getCurrentUid();
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