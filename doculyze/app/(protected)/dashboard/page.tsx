import { Timestamp } from "firebase-admin/firestore";
import { listDocuments } from "@/_lib/database";

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Server Component: reads from the data layer directly. listDocuments() derives
// the uid from the verified session cookie (server-only), so there's no fetch,
// no /dashboard/api round-trip, and nothing to serialize. Access control is
// handled by app/(protected)/layout.tsx.
export default async function Dashboard() {
    const documents = await listDocuments();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-semibold mb-4">Dashboard</h1>

            {documents.length === 0 ? (
                <p className="text-gray-500">No documents uploaded yet.</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {documents.map((doc) => {
                        // At read time uploadedAt is a Firestore Timestamp; the
                        // DAL types it as FieldValue, so narrow before using it.
                        const uploadedAt =
                            doc.uploadedAt instanceof Timestamp
                                ? doc.uploadedAt.toDate()
                                : null;
                        return (
                            <li key={doc.docId} className="rounded border px-4 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">{doc.title}</span>
                                    <span className="text-xs uppercase text-gray-500">
                                        {doc.status}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-600">
                                    {doc.file_name} · {formatBytes(doc.size)}
                                    {uploadedAt && <> · {uploadedAt.toLocaleString()}</>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
