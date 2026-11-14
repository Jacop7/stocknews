import AdminConsole from '../../components/AdminConsole';
export default async function Page({params}:{params:Promise<{path?:string[]}>}){const {path}=await params;return <AdminConsole initialPath={path?.join('/')??''}/>;}
