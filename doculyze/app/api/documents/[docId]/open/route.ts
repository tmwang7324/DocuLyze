import { NextResponse } from "next/server";
import { getReadPresignedURL } from "@/app/actions/document/delete_document";

export async function GET(_request: Request, { params }: { params: Promise<{ docId: string }> }) {
    try {
        const { docId } = await params;
        const url = await getReadPresignedURL(docId);
        return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
    } catch {
        return new NextResponse("The document could not be opened.", {
            status: 404,
            headers: { "Cache-Control": "private, no-store" },
        });
    }
}
