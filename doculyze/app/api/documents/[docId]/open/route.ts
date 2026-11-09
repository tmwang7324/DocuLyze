import { NextResponse } from "next/server";
import { getReadPresignedURL } from "@/app/actions/document/delete_document";

export async function GET(request: Request, { params }: { params: Promise<{ docId: string }> }) {
    try {
        const { docId } = await params;
        const download = new URL(request.url).searchParams.get("download") === "1";
        const url = await getReadPresignedURL(docId, download);
        return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
    } catch {
        return new NextResponse("The document could not be opened.", {
            status: 404,
            headers: { "Cache-Control": "private, no-store" },
        });
    }
}
