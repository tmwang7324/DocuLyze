"use client";

import FileDropzone from "@/components/file_dropzone";
import { useActionState, useState } from "react";
import { getPresignedUrl, finalizeUpload } from "../../actions/document/upload_document";
import { MAX_FILE_SIZE } from "@/_lib/fileupload_schema";
import { MIN_FILE_SIZE } from "@/_lib/fileupload_schema";
import { toast } from 'sonner';
//import { uploadDocument } from "../../actions/document/upload_document";

type fileObject = {
    id: string;
    file: File | null;
    progress: number;
    uploading: boolean;
    url: string;
    title: string | null;
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
    
    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const title = formData.get('title') as string | null;

        if(!fileObj.file) {
            toast.error("No file selected");
            setFileObj(prev => ({ ...prev, uploading: false }));
            return;
        }
        const file = fileObj.file;
        setFileObj(prev => ({ ...prev, title }));
        const { url, docId, contentType } = await getPresignedUrl(file.name, title ?? "", file.size);
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
        setFileObj(prev => ({ ...prev, uploading: true }));
        await new Promise((resolve, reject) => {
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
                    try {
                        await finalizeUpload(docId, file.name, file.size, title ?? "");
                    } catch (err) {
                        setFileObj(prev => ({ ...prev, uploading: false }));
                        
                        toast.error(`Upload saved but finalize failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                        reject(err);
                        return;
                    }
                    toast.success("Upload successful!");
                    form.reset();
                    resolve("success");
                } else {
                    setFileObj(prev => ({ ...prev, progress: 0, uploading: false })); 
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
            toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
           //  return "success"
    
    }
    return (
        <div> 
            Upload Your Document
            <form onSubmit={handleSubmit}>
                <input type="text" name="title" placeholder="Enter title here" />
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
                <button type="submit" disabled={!fileObj.file}>Upload</button>
            </form>
            <div>
                {fileObj.file && (() => {
                    const t = fileObj.file.type;
                    if (t === "application/pdf" || t.startsWith("text/") || t === "application/json") {
                        return (
                            <iframe
                                src={fileObj.url}
                                title={fileObj.file.name}
                                className="h-96 w-full rounded-lg border"
                            />
                        );
                    }
                    // .doc/.docx and other non-previewable types — no browser renderer exists
                    return (
                        <div className="rounded-lg border p-4 text-sm">
                            📄 {fileObj.file.name} — no inline preview available
                        </div>
                    );
                })()}
                <div>Upload Progress: {fileObj.progress.toFixed(2)}%</div>
            </div>
        </div>
    
        // <form onSubmit={handleSubmit}>
        //     <input type="text" name="title" placeholder="Enter title here"/>
        //     <input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md,.js,.ts,.py,.html,.css,.json,.xml" onChange={handleFileChange}/>
        //     <button type="submit">Upload</button>
        // </form>
    );
}// Null when unauthenticated — for read paths that branch or redirect.
