"use client";

import FileDropzone from "@/components/file_dropzone";
import { useRouter } from "next/navigation";
import { IconUpload } from "@/components/brand_icons";
import { useActionState, useState } from "react";
import { getPresignedUrl, finalizeUpload } from "../../actions/document/upload_document";
import { MAX_FILE_SIZE } from "@/_lib/fileupload_schema";
import { MIN_FILE_SIZE } from "@/_lib/fileupload_schema";
import { toast } from 'sonner';
import PipelineProgress from "../../../components/pipeline_progress";
import type { FinalizeResult } from "@/_lib/ingest_contract";
//import { uploadDocument } from "../../actions/document/upload_document";

type fileObject = {
    id: string;
    file: File | null;
    progress: number;
    uploading: boolean;
    url: string;
    title: string | null;
};

// Pipeline view state (issue #10): set when a PUT starts (docId known, finalize
// pending), completed when finalize returns its enqueue classification.
type PipelineState = {
    docId: string;
    result: FinalizeResult | null;
};

export default function UploadForm() {
    /**  const [formState, formAction] = useActionState(uploadDocument, {
    /**  const [formState, formAction] = useActionState(uploadDocument, {
        message: '',
        fileName: null,
        fileSize: null,
        fileType: null
    });
    const [loading, setIsLoading] = useState(false);
    */
    const [fileObj, setFileObj] = useState<fileObject>({
        id: crypto.randomUUID(),
        file: null,
        progress: 0,
        uploading: false,
        url: "",
        title: null
    });
    // const uploadedDocs: React.MutableRefObject<F[]> = useRef([])
    const [pipeline, setPipeline] = useState<PipelineState | null>(null);
    // Only use: re-running the page's Server Component so the recent-documents
    // column beside this form picks up the record finalize just wrote (#25). It
    // touches no upload mechanic — the presign, PUT and finalize below are
    // unchanged, and client state survives a refresh().
    const router = useRouter();

//     useEffect(() => {
// )

    // files with no extension are not accepted
    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const title = formData.get('title') as string | null;

        setPipeline(null); // a new upload tears down the previous progress view (and its stream)
        if(!fileObj.file) {
            toast.error("No file selected");
            setFileObj(prev => ({ ...prev, uploading: false }));
            return;
        }
        const file = fileObj.file;
        setFileObj(prev => ({ ...prev, title }));
        const { url, docId, contentType, error } = await getPresignedUrl(file.name, title ?? "", file.size);
        // The server refused for a reason worth showing (duplicate document) —
        // report that instead of the generic presign failure below.
        if (error) {
            toast.error(error);
            setFileObj(prev => ({ ...prev, uploading: false }));
            return;
        }
        if (!url || !docId || !contentType) {
            toast.error("Failed to get presigned URL");
            setFileObj(prev => ({ ...prev, uploading: false }));
            return;
        }
     
        // const response = await fetch(url, {
        //     method: 'PUT',
        //     headers: {
        //         'Content-Type': fileObj.file.type,
        //         "x-goog-content-length-range": `${MIN_FILE_SIZE},${MAX_FILE_SIZE}`
        //     },
        //     body: fileObj.file
        // });
        // if (!response.ok) {
        //     console.error(`Upload failed with status: ${response.status}`);
        //     return;
        // }
        // if (response.ok) {
        //     console.log("Upload successful");
            
        // }
        // return;
        try {
        setFileObj(prev => ({ ...prev, uploading: true, progress: 0 }));
        setPipeline({ docId, result: null }); // step view opens at "Uploading"
        await new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (event) => {
                if(event.lengthComputable) {
                    const percentageCompleted = (event.loaded / event.total) * 100;
                    setFileObj(prev => ({ ...prev, progress: Math.round(percentageCompleted) }));
                }
            }
            xhr.onload = async () => {
                if(xhr.status >= 200 && xhr.status < 300) {
                    // Bytes landed — now write the Firestore record (record-after-upload).
                    // finalize returns the enqueue classification (issue #10); the
                    // pipeline view branches on it (stream / retry-later / warn+watch).
                    try {
                        const result = await finalizeUpload(docId, file.name, file.size, contentType, title ?? "");
                        setPipeline({ docId, result });
                        router.refresh(); // the record now exists — show it in the recent column (#25)
                    } catch (err) {
                        setFileObj(prev => ({ ...prev, uploading: false }));
                        setPipeline(null);
                        toast.error(`Upload saved but finalize failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                        reject(err);
                        return;
                    }
                    setFileObj(prev => ({ ...prev, uploading: false }));
                    form.reset();
                    resolve("success");
                } else {
                    setFileObj(prev => ({ ...prev, progress: 0, uploading: false }));
                    setPipeline(null);
                    toast.error(`Upload failed with status: ${xhr.status}`);
                    reject(new Error(`Upload failed with status: ${xhr.status}`));
                }
            }
            xhr.onerror = () => {
                toast.error(`Upload failed due to a network error`);
                reject(new Error(`Upload failed due to a network error`));
            }
            xhr.open('PUT', url);
            // Echo the SERVER-resolved content-type (Policy B), not file.type — it must match
            // the value pinned into the signed URL or GCS 403s the PUT.
            xhr.setRequestHeader('Content-Type', contentType);
            xhr.setRequestHeader('x-goog-content-length-range', `${MIN_FILE_SIZE},${MAX_FILE_SIZE}`);
            xhr.send(file);
        })
        } catch (error) {
            setFileObj(prev => ({ ...prev, progress: 0, uploading: false }));
            setPipeline(null);
            toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
           //  return "success"
    
    }
    return (
        <div className="flex flex-col gap-8">
            {/* The dropzone stays on screen while the pipeline view runs below it
                (issue #25's composition), rather than being swapped out — so the
                next upload doesn't need a page reload. Submitting again still
                tears down the previous view; that is handleSubmit's first line. */}
            <div className="border border-hairline bg-white p-6 sm:p-8">
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <label
                            htmlFor="title"
                            className="font-mono-label text-[10px] tracking-widest uppercase text-muted"
                        >
                            Title <span className="text-placeholder">(optional)</span>
                        </label>
                        <input
                            id="title"
                            type="text"
                            name="title"
                            placeholder="Untitled document"
                            className="w-full border-2 border-dark bg-white px-4 py-3 text-sm text-dark placeholder:text-placeholder focus:border-orange-primary focus:outline-none rounded-[0.625rem]"
                        />
                    </div>

                    <FileDropzone onFileAccepted={(f) => setFileObj(prev => ({ ...prev, file: f, url: URL.createObjectURL(f)}))}
                        onFileCleared={() => {
                            setFileObj(prev => {
                                if(prev.url) {
                                    URL.revokeObjectURL(prev.url);
                                }
                                return { ...prev, file: null, url: "" };
                            })}
                        }
                    />

                    <button
                        type="submit"
                        disabled={!fileObj.file}
                        className="self-start inline-flex items-center gap-2 bg-orange-primary text-white px-7 py-4 font-semibold text-sm uppercase tracking-wider hover:bg-orange-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-primary cursor-pointer"
                    >
                        <IconUpload /> Upload document
                    </button>
                </form>

                <div>
                    {fileObj.file && (() => {
                        const t = fileObj.file.type;
                        if (t === "application/pdf" || t.startsWith("text/") || t === "application/json") {
                            return (
                                <iframe
                                    src={fileObj.url}
                                    title={fileObj.file.name}
                                    className="mt-6 h-96 w-full border border-hairline bg-off-white"
                                />
                            );
                        }
                        // .doc/.docx and other non-previewable types — no browser renderer exists
                        return (
                            <div className="mt-6 border border-hairline bg-off-white px-4 py-3 text-sm text-muted">
                                No inline preview for{" "}
                                <span className="font-mono-label text-dark text-xs">{fileObj.file.name}</span>{" "}
                                — the browser has no renderer for this format.
                            </div>
                        );
                    })()}
                </div>
            </div>

            {pipeline && (
                <PipelineProgress
                    docId={pipeline.docId}
                    progress={fileObj.progress}
                    enqueue={pipeline.result?.enqueue ?? null}
                    // The recent column is server-rendered, so a terminal status
                    // is when it has something new to say. (issue #25)
                    onSettled={() => router.refresh()}
                />
            )}
        </div>

        // <form onSubmit={handleSubmit}>
        //     <input type="text" name="title" placeholder="Enter title here"/>
        //     <input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md,.js,.ts,.py,.html,.css,.json,.xml" onChange={handleFileChange}/>
        //     <button type="submit">Upload</button>
        // </form>
    );
}// Null when unauthenticated — for read paths that branch or redirect.
