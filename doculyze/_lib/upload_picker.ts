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
