// What the upload screen offers the user, derived from what the server accepts.
// (issue #25)
//
// Neutral module — no "use client" / "server-only" — for the same reason
// _lib/fileupload_schema.ts is: it sits between a client component and the rules
// a server action enforces, and the whole point is that the two can't drift.
//
// It is presentation, never a gate. Nothing here decides what may be uploaded;
// that is fileSchema / uploadClaimSchema. The picker filter is a convenience for
// the OS file dialog, and a wrong one is invisible — the user just sees their
// file greyed out and concludes the format is unsupported. Which is what
// happened: the dropzone hard-coded ".pdf,.docx" plus two MIME types while the
// allowlist accepted eleven extensions. Pinned by tests/upload/picker.test.ts.

import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE, formatBytes } from "@/_lib/fileupload_schema";

/**
 * The `accept` attribute for the dropzone's <input type="file">. Extensions
 * only: the old filter listed MIME types alongside them, which is how half of it
 * went stale unnoticed — one vocabulary, and it's the allowlist's.
 */
export const PICKER_ACCEPT: string = ACCEPTED_EXTENSIONS.join(",");

/**
 * The one line of copy under the dropzone. It states the enforced ceiling and
 * nothing else: the format claim belongs to the six chips above it, which come
 * from FORMAT_FAMILIES. A second hand-typed format list here is precisely the
 * thing that drifted.
 */
export const SIZE_HINT = `Any supported format, up to ${formatBytes(MAX_FILE_SIZE)}`;
