"use client";

import { useActionState, useState } from "react";
import { uploadDocument } from "../../actions/document/upload_document";

export default function UploadForm() {
    const [formState, formAction] = useActionState(uploadDocument, {
        message: '',
        fileName: null,
        fileSize: null,
        fileType: null
    });
    const [loading, setIsLoading] = useState(false);
    // const [file, setFile] = useState<File | null>(null);
    return (
        <form action={formAction}>
            <input type="text" name="title" placeholder="Enter title here"/>
            <input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md,.js,.ts,.py,.html,.css,.json,.xml"/>
            { formState.message === 'success' && (
                <div className="mb-4 text-sm">
                    <p>File name: {formState.fileName}</p>
                    <p>File size: {formState.fileSize} bytes</p>
                    <p>File type: {formState.fileType}</p>
                </div>
            )} : (
                <div>{formState.message}</div>
            )
            
            <button type="submit">Upload</button>
        </form>
    );
}// Null when unauthenticated — for read paths that branch or redirect.
