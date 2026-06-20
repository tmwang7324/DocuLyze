
import verifyUser from "../actions/auth/verify_user";
import { redirect } from "next/navigation";

export default async function Dashboard() {
    
    if(!await verifyUser()) {
        // Redirect to login page
        redirect("/login");
    }
    return (
        <div>
            <h1>Dashboard</h1>
        </div>
    )
}

                