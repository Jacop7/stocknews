import {adminJson} from '../../../../lib/admin-request.mjs';
import {adminCookie,assertAdminRequest} from '../../../../lib/admin-profile.mjs';
import {NextRequest,NextResponse} from 'next/server';
import {AdminError,assertWrite,editorRpc,session} from '../../../../lib/runtime.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const integer=(v:string|null,fallback:number,max:number)=>{if(v===null)return fallback;if(!/^\d{1,6}$/.test(v)||Number(v)>max)throw new AdminError('INVALID_PARAMETER');return Number(v);};
const allowed=(p:URLSearchParams,keys:string[])=>{const actual=[...p.keys()];if(actual.some(k=>!keys.includes(k))||new Set(actual).size!==actual.length)throw new AdminError('INVALID_PARAMETER');};
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
 try{assertAdminRequest(request.headers,'catalog');
  const s=await session(request.cookies.get(adminCookie())?.value),name=(await params).action.join('/'),p=request.nextUrl.searchParams;
  if(request.url.length>8192)throw new AdminError('REQUEST_TOO_LARGE',413);
  if(name==='summary'){allowed(p,['offset','limit']);return reply(await editorRpc('catalog_editor_index',{p_offset:integer(p.get('offset'),0,100000),p_limit:integer(p.get('limit'),100,200)},s));}
  if(name==='tree'){allowed(p,[]);return reply(await editorRpc('catalog_editor_tree',{},s));}
  if(name==='sector'){allowed(p,['id','version','offset']);return reply(await editorRpc('catalog_editor_sector',{p_sector:p.get('id'),p_expected:p.get('version'),p_offset:integer(p.get('offset'),0,100000),p_limit:25},s));}
  if(name==='companies'){allowed(p,['q','offset']);return reply(await editorRpc('catalog_editor_companies',{p_query:p.get('q')??'',p_offset:integer(p.get('offset'),0,100000),p_limit:50},s));}
  if(name==='company'){allowed(p,['id','version']);return reply(await editorRpc('catalog_editor_company',{p_company:p.get('id'),p_expected:p.get('version')},s));}
  if(name==='group'){allowed(p,['id','version']);return reply(await editorRpc('catalog_editor_group',{p_group:p.get('id'),p_expected:p.get('version')},s));}
  if(name==='membership'){allowed(p,['id','version']);return reply(await editorRpc('catalog_editor_membership',{p_membership:p.get('id'),p_expected:p.get('version')},s));}
  throw new AdminError('ROUTE_NOT_FOUND',404);
 }catch(e){return reply({error:e instanceof AdminError?e.message:'REQUEST_FAILED'},e instanceof AdminError?e.status:500);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
 try{assertAdminRequest(request.headers,'catalog');
  assertWrite(request.headers,undefined,undefined);
  if(Number(request.headers.get('content-length')??0)>131072)throw new AdminError('REQUEST_TOO_LARGE',413);
  const s=await session(request.cookies.get(adminCookie())?.value);assertWrite(request.headers,s.csrf,request.headers.get('x-csrf-token'));
  const data=await adminJson(request);
  const name=(await params).action.join('/');
  if(!data||Array.isArray(data)||typeof data!=='object')throw new AdminError('INVALID_CATALOG_REQUEST');
  if(name==='impact'){
   if(Object.keys(data).some(k=>!['p_sector','p_expected'].includes(k)))throw new AdminError('INVALID_CATALOG_REQUEST');
   return reply(await editorRpc('catalog_editor_impact',data,s));
  }
  if(name!=='mutate'&&name!=='operation')throw new AdminError('ROUTE_NOT_FOUND',404);
  if(Object.keys(data).sort().join(',')!=='p_entity,p_expected,p_kind,p_operation_key,p_payload')throw new AdminError('INVALID_CATALOG_REQUEST');
  // A POST lookup keeps a potentially 128KB pending intent out of URL/history.
  const result=await editorRpc(name==='mutate'?'catalog_apply':'catalog_operation_status',data,s);
  return reply(result,result.status==='REJECTED'?409:200);
 }catch(e){
  // Only an actual matching durable REJECTED journal above proves not-applied.
  return reply({error:e instanceof AdminError?e.message:'REQUEST_FAILED',not_applied:false},e instanceof AdminError?e.status:500);
 }
}
