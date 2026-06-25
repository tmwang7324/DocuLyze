import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getCurrentUid } from "@/_lib/data";
import { listDocuments } from "@/_lib/database";

// GET /dashboard/api
// Returns the *current* user's documents (newest first) for the dashboard.
// uid is never taken from the request — it's derived server-side from the
// verified `refresh` session cookie inside the DAL, so a caller cannot read
// another user's documents.
export async function GET() {
    // Clean 401 branch. getCurrentUid() and listDocuments() both go through the
    // same cache()-wrapped getSession(), so this does not cost an extra verify.
    const uid = await getCurrentUid();
    if (!uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const records = await listDocuments();
        // Firestore Timestamps don't serialize to a clean JSON shape — convert
        // to epoch millis so the client can `new Date(uploadedAt)` directly.
        const documents = records.map(({ uploadedAt, ...rest }) => ({
            ...rest,
            uploadedAt: uploadedAt instanceof Timestamp ? uploadedAt.toMillis() : null,
        }));
        return NextResponse.json({ documents });
    } catch (error) {
        console.error("Failed to list documents:", error);
        return NextResponse.json(
            { error: "Failed to load documents" },
            { status: 500 }
        );
    }
}
