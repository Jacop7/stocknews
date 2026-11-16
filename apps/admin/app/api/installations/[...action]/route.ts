import {assertAdminRequest} from '../../../../lib/admin-profile.mjs';
import {AdminError} from '../../../../lib/runtime.mjs';
import {NextRequest,NextResponse} from 'next/server';
import {createInstallationHandler} from '../../../../lib/installation-runtime.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handle=createInstallationHandler();
async function guarded(request:NextRequest){
 try{assertAdminRequest(request.headers,'installations');return await handle(request);}
 catch(e){return NextResponse.json({error:e instanceof AdminError?e.message:'REQUEST_FAILED'},{status:e instanceof AdminError?e.status:500,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
}
export const GET=guarded;
export const POST=guarded;
export const OPTIONS=guarded;
