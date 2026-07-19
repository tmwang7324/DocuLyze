# Clear-file-after-upload — the `key` remount approach (archived, not used)

**Status:** Reverted 2026-07-12. We decided NOT to clear the file/preview after a
successful upload, because the preview is needed to display a LangChain-generated
summary of the just-uploaded document. Keeping this note in case we want an
explicit "Upload another" reset later.

## The problem it solved

`FileDropzone` keeps the visible filename in its OWN internal state
(`fileName`/`error` via `useState`). So resetting the parent's `fileObj` alone
does NOT clear what the dropzone shows — the parent cannot reach into the child's
state. To fully reset the dropzone you must remount it.

## The approach

1. Remount the dropzone by keying it on the per-upload `id`:

   ```tsx
   <FileDropzone key={fileObj.id}
       onFileAccepted={(f) => setFileObj(prev => ({ ...prev, file: f, url: URL.createObjectURL(f) }))}
       onFileCleared={/* ... */}
   />
   ```

2. On upload success, mint a NEW `id` (so the `key` changes → child remounts
   clean) and clear the rest of the state, revoking the object URL to avoid a
   blob leak:

   ```tsx
   setFileObj(prev => {
       if (prev.url) URL.revokeObjectURL(prev.url);
       return { id: crypto.randomUUID(), file: null, progress: 0, uploading: false, url: "", title: null };
   });
   form.reset(); // clears the uncontrolled title <input>
   ```

The new `id` → new `key` → `FileDropzone` remounts fresh (blank filename, cleared
error); `file: null` / `url: ""` drops the `<img>` preview; `form.reset()` clears
the title input.

## Alternatives considered

- **Key the whole `<form>`** (`<form key={fileObj.id}>`) — remounts title input
  and dropzone together, no separate `form.reset()` needed. Simpler, blunter.
- **Imperative `clear()` on `FileDropzone`** via `useImperativeHandle` + `ref` —
  cleanest API but more code in the component.

Chosen at the time: `key` on the dropzone only. Now reverted entirely.
