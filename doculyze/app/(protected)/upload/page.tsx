import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { verifyUser } from "@/app/actions/auth/verify_user";
import { listDocuments } from "@/_lib/database";
import { projectArchive, selectRecent, type ArchiveInput } from "@/_lib/archive_projection";
import SiteFooter from "@/components/site_footer";
import UploadForm from "./upload_form";
import RecentDocuments from "./recent_documents";

export const metadata: Metadata = {
    title: "Upload — DocuLyze",
};

// The design's two-column upload screen (issue #25). Left: the dropzone, which
// hands off to the pipeline view once an upload starts. Right: the user's most
// recent documents, so an upload can be seen joining the archive without leaving
// the screen.
//
// Deliberately NOT ported from the prototype: its multi-file session list with
// per-row progress bars (timer-driven fakes, and this codebase uploads one
// document at a time) and its search panel (the query path is a separate
// ticket). The single-document model is unchanged.
//
// Server Component — it reads the DAL directly, the way the archive does. The
// upload mechanics are untouched: presign, direct byte PUT, finalize and the
// per-document event stream all still live in the client form below.
export default async function UploadPage() {
    await verifyUser();
    // The same read the archive performs, narrowed at the same boundary: at read
    // time uploadedAt is a Firestore Timestamp, and it is briefly absent between
    // the write and the server resolving it. Converting here is what keeps
    // firebase-admin out of the projection module.
    const documents = await listDocuments();
    const records: ArchiveInput[] = documents.map((doc) => ({
        docId: doc.docId,
        title: doc.title,
        file_name: doc.file_name,
        size: doc.size,
        status: doc.status,
        uploadedAt: doc.uploadedAt instanceof Timestamp ? doc.uploadedAt.toMillis() : null,
    }));

    // The archive's projection, then a selection from it — never a second mapping
    // of statuses or formats. See selectRecent in _lib/archive_projection.ts.
    const recent = selectRecent(projectArchive(records).rows);

    return (
        <div className="flex flex-col min-h-full">
            <main className="flex-1">
                <div className="max-w-6xl mx-auto px-6 py-14">
                    <header className="mb-10">
                        <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-3">
                            Upload
                        </div>
                        <h1
                            className="font-display font-black text-dark uppercase leading-none"
                            style={{ fontSize: "clamp(40px, 6vw, 64px)", letterSpacing: "-0.025em" }}
                        >
                            Add a document
                        </h1>
                        <p className="text-muted text-sm mt-4 max-w-xl">
                            One document at a time. DocuLyze parses it into structured text as soon as
                            the bytes land — you can watch it move through the pipeline as it goes.
                        </p>
                    </header>

                    {/* One column on a phone, with the form first: the recent list
                        is supporting material, and stacking it above the dropzone
                        would push the screen's purpose off the fold. */}
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
                        <UploadForm />
                        <RecentDocuments rows={recent} />
                    </div>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
