// The four status tones the archive projection can return, as design tokens.
// (issue #25)
//
// Lifted out of app/(protected)/dashboard/archive_view.tsx when the upload
// screen's recent column started rendering the same rows: the column reuses the
// projection so a document can't be *labelled* one way in the archive and
// another beside the dropzone, and this is the same argument one layer down —
// "Parsing" must not be orange in one place and grey in the other.
//
// Neutral module: class names only, no hooks, no imports beyond the tone type,
// so a Server Component and a Client Component can both read it.

import type { StatusTone } from "@/_lib/archive_projection";

export const TONE_CLASS: Record<StatusTone, string> = {
    ok: "text-ok",
    busy: "text-orange-primary",
    muted: "text-muted",
    error: "text-error",
};
