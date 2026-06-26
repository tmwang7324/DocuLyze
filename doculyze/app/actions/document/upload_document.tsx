"use server";
import { db } from '@/_lib/admin';
import { doc, setDoc } from 'firebase/firestore';
import { verifyUser } from '../auth/verify_user';
import { createDocumentRecord } from '@/_lib/database';

type DocFormState = {
    message: string;
    fileName: string | null;
    fileSize: number | null;
    fileType: string | null;
}
// File size is already limited by server actions config
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function uploadDocument(prevState: DocFormState, formData: FormData): Promise<DocFormState> {
    //createDocumentRecord()
    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;
    console.log(file);
    if (!file) {
        return {
            message: 'Error: No file uploaded.',
            fileName: null,
            fileSize: null,
            fileType: null
        };
    }
    if (file.size > MAX_FILE_SIZE) {
        return {
            message: `Error: File size exceeds the maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
            fileName: null,
            fileSize: null,
            fileType: null
        };
    }
    if (!title) {
        return {
            message: 'Error: No title provided.',
            fileName: null,
            fileSize: null,
            fileType: null
        };
    }
    
    // add functionality to ask user if they want to replace 
    const docId = await createDocumentRecord({ file_name: file.name, title, contentType: file.type, size: file.size});
    console.log(`successfully created ${docId}`)
    return {
        message: 'success',
        fileName: file?.name ?? null,
        fileSize: file?.size ?? null,
        fileType: file?.type ?? null,
    };
}
