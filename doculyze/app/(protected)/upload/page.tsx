import { verifyUser } from "@/app/actions/auth/verify_user";
import { redirect } from 'next/navigation'
import UploadForm from "./upload_form";

export default async function UploadPage() {
    if(!await verifyUser()) {
        redirect('/login');
    }
    return (
        <div>
            <h1>Upload Page</h1>
            <UploadForm></UploadForm>
        </div>
    );
}