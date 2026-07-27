import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { listDocuments, reapStalePendingDocuments } from "@/_lib/database";
import { projectArchive, type ArchiveInput } from "@/_lib/archive_projection";
import SiteFooter from "@/components/site_footer";
import ArchiveView from "./archive_view";

export const metadata: Metadata = {
    title: "Archive — DocuLyze",
};

// Server Component: reads from the data layer directly. listDocuments() derives
// the uid from the verified session cookie (server-only), so there's no fetch,
// no /dashboard/api round-trip, and nothing to serialize. Access control is
// handled by app/(protected)/layout.tsx.
//
// Issue #23 restyled this screen into the design's archive. It stays at
// /dashboard and stays in the protected group: an earlier revision was going to
// move it to "/" and delete the route, which was reversed on 2026-07-26. The
// reap below therefore keeps the trigger it has always had.
export default async function Dashboard() {
    // Opportunistic reap (#3): there's no scheduler in this stack yet, so the
    // dashboard visit is the trigger — abandoned `pending` uploads older than
    // the threshold are cleaned up right before the list is read, so ghost
    // uploads never render. Usually a no-op (one indexed query, empty result).
    // Best-effort: a reap failure (e.g. index not yet deployed) must degrade to
    // ghosts-still-visible, never a broken dashboard.
    await reapStalePendingDocuments().catch((error) => {
        console.error("Stale-pending reap failed (dashboard renders anyway):", error);
    });
    const documents = await listDocuments();

    // Narrow at the boundary, not inside the projection. At read time uploadedAt
    // is a Firestore Timestamp; the DAL types it as FieldValue (its write type),
    // and it is briefly absent between a write and the server resolving it.
    // Converting here is what keeps firebase-admin out of the projection module
    // — and therefore out of its tests.
    const records: ArchiveInput[] = documents.map((doc) => ({
        docId: doc.docId,
        title: doc.title,
        file_name: doc.file_name,
        size: doc.size,
        status: doc.status,
        uploadedAt: doc.uploadedAt instanceof Timestamp ? doc.uploadedAt.toMillis() : null,
    }));

    const { rows, stats, isEmpty } = projectArchive(records);

    return (
        <div className="flex flex-col min-h-full">
            <main className="flex-1">
                <ArchiveView rows={rows} stats={stats} isEmpty={isEmpty} />
            </main>
            <SiteFooter />
        </div>
    );
}
