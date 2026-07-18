import { verifyUser } from '../auth/verify_user';
import { requireUid } from '@/_lib/data';


export async function uploadDocument( formData: FormData) {
    const userId = await verifyUser();
    
    // client SDK firestore code
    // const uploadedDoc = doc(firestore, 'documents', formData.get("title") as string);
    // const docData = {
    //     description: "A delicious vanilla latte",
    //     price: 4.5,
    //     milk: 'whole',
    //     vegan: false
    // };
    // setDoc(uploadedDoc, docData, {merge: true});
    // console.log("Document uploaded:", docData);
}
