import { NextRequest,NextResponse } from 'next/server';
import { AdminError,assertWrite,editorRpc,login,logout,session } from '../../../../lib/runtime.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const cookieName='judoju_admin_session';
function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
  try{
    const {action}=await params;const name=action.join('/');
    if(Number(request.headers.get('content-length')??0)>131072)throw new AdminError('REQUEST_TOO_LARGE',413);
    // Origin and content type are checked before reading credentials or accepting a write.
    assertWrite(request.headers,undefined,undefined);
    const raw=await request.text();if(Buffer.byteLength(raw)>131072)throw new AdminError('REQUEST_TOO_LARGE',413);
    let data;try{data=JSON.parse(raw);}catch{throw new AdminError('INVALID_JSON');}
    if(name==='login'){
      const r=await login(data.email,data.password);const response=reply({csrf:r.csrf,expires:r.expires});
      response.cookies.set(cookieName,r.capability,{httpOnly:true,sameSite:'strict',secure:false,path:'/',expires:new Date(r.expires)});return response;
    }
    const capability=request.cookies.get(cookieName)?.value;const s=await session(capability);
    assertWrite(request.headers,s.csrf,request.headers.get('x-csrf-token'));
    if(name==='logout'){
      await logout(capability,s);const response=reply({loggedOut:true});response.cookies.set(cookieName,'',{httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:0});return response;
    }
    const routes:Record<string,string>={create:'m1_create_draft',save:'m1_save_draft','save-catalog':'catalog_save_draft',preview:'m1_preview_draft',publish:'m1_publish_draft',state:'m1_set_state'};
    if(!routes[name])throw new AdminError('ROUTE_NOT_FOUND',404);
    return reply(await editorRpc(routes[name],data,s));
  }catch(e){return reply({error:e instanceof AdminError?e.message:'REQUEST_FAILED',not_applied:e instanceof AdminError&&e.notApplied===true},e instanceof AdminError?e.status:500);}
}
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
  try{const name=(await params).action.join('/'),s=await session(request.cookies.get(cookieName)?.value);
    if(name==='session')return reply({admin:true,csrf:s.csrf});
    if(name==='catalog')return reply((await editorRpc('catalog_editor_sectors',{},s)).sectors);
    if(name==='catalog-current')return reply(await editorRpc('catalog_editor_sectors',{},s));
    if(name==='articles')return reply(await editorRpc('m1_editor_articles',{},s));
    if(name==='draft')return reply(await editorRpc('m1_get_draft',{p_issue:request.nextUrl.searchParams.get('id')},s));
    if(name==='operation')return reply(await editorRpc('m1_operation_status',{p_issue:request.nextUrl.searchParams.get('id'),p_effect_key:request.nextUrl.searchParams.get('key')},s));
    throw new AdminError('ROUTE_NOT_FOUND',404);
  }catch(e){return reply({error:e instanceof AdminError?e.message:'REQUEST_FAILED'},e instanceof AdminError?e.status:500);}
}
