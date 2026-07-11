"use server";
import { db, storage } from '@/_lib/admin';
import { doc, setDoc } from 'firebase/firestore';
import { verifyUser } from '../auth/verify_user';
import { createDocumentRecord } from '@/_lib/database';
import { getCurrentUid } from '@/_lib/data';


// File size is already limited by server actions config
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function getPresignedUrl(filePath: string, contentType: string): Promise<string> {
    const uid = await getCurrentUid();
    if (!uid) {
        throw new Error("User is not authenticated");
    }
    const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
    const file = bucket.file(`users/${uid}/${filePath}`);

    const [url] = await file.getSignedUrl({
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
        contentType: contentType
    });
    
    return url;
}

// Cannot use a server action to upload the file directly because the file is too large to be sent in the request body. 
// Instead, we generate a presigned URL and return it to the client, which can then use it to upload the file directly to Firebase Storage.
// PUT request to the presigned URL with the file as the body and the content type set to the file.type.
// export async function uploadDocument(prevState: DocFormState, formData: FormData): Promise<DocFormState> {
//     //createDocumentRecord()
//     const file = formData.get('file') as File | null;
//     const title = formData.get('title') as string | null;
//     console.log(file);
//     if (!file) {
//         return {
//             message: 'Error: No file uploaded.',
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
//     if (file.size > MAX_FILE_SIZE) {
//         return {
//             message: `Error: File size exceeds the maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
//     if (!title) {
//         return {
//             message: 'Error: No title provided.',
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
    
//     // add functionality to ask user if they want to replace 
//     const docId = await createDocumentRecord({ file_name: file.name, title, contentType: file.type, size: file.size});
//     console.log(`successfully created ${docId}`)
//     return {
//         message: 'success',
//         fileName: file?.name ?? null,
//         fileSize: file?.size ?? null,
//         fileType: file?.type ?? null,
//     };
// }

