import { verifyUser } from '../auth/verify_user';
import { requireUid } from '@/_lib/data';

async function RenderDocs(): Promise<JSX.Element> {
    requireUid
    }