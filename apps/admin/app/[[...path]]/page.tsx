import AdminConsole from '../../components/AdminConsole';
import {adminProfile} from '../../lib/admin-profile.mjs';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){const {path}=await params;return <AdminConsole initialPath={path?.join('/')??''} deploymentProfile={adminProfile()}/>;}
