"use client";

import { useActionState, useState } from "react";
//import { uploadDocument } from "../../actions/document/upload_document";

export default function UploadForm() {
    /**  const [formState, formAction] = useActionState(uploadDocument, {
        message: '',
        fileName: null,
        fileSize: null,
        fileType: null
    });
    const [loading, setIsLoading] = useState(false);
    */
    // const [file, setFile] = useState<File | null>(null);
    // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    //     const selectedFile = event.target.files?.[0] || null;
    //     setFile(selectedFile);
    // }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        const file = formData.get('file') as File | null;
        if(!file) {
            console.error("No file selected");
            return;
        }
;
        
        console.log(file);
        //getPresignedUrl()
        return 
    }
    return (
        <form onSubmit={handleSubmit}>
            <input type="text" name="title" placeholder="Enter title here"/>
            <input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md,.js,.ts,.py,.html,.css,.json,.xml"/>
            
            
            <button type="submit">Upload</button>
        </form>
    );
}// Null when unauthenticated — for read paths that branch or redirect.
