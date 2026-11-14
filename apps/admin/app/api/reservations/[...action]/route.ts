import {NextRequest,NextResponse} from 'next/server';
import {AdminError,assertWrite,editorRpc,serverRpc,session} from '../../../../lib/runtime.mjs';
import {reservationInput} from '../../../../lib/reservation-state.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function reply(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function host(request:NextRequest){if(request.headers.get('host')!=='127.0.0.1:3100')throw new AdminError('HOST_REJECTED',403,true);}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
 try{
  host(request);assertWrite(request.headers,undefined,undefined);
  const action=(await params).action.join('/');if(request.nextUrl.search)throw new AdminError('ROUTE_NOT_FOUND',404,true);
  if(Number(request.headers.get('content-length')??0)>4096)throw new AdminError('REQUEST_TOO_LARGE',413,true);
  const raw=await request.text();if(Buffer.byteLength(raw)>4096)throw new AdminError('REQUEST_TOO_LARGE',413,true);
  let body;try{body=JSON.parse(raw);}catch{throw new AdminError('INVALID_JSON',400,true);}
  if(!reservationInput(action,body))throw new AdminError('INVALID_RESERVATION_INPUT',400,true);
  const auth=await session(request.cookies.get('judoju_admin_session')?.value);assertWrite(request.headers,auth.csrf,request.headers.get('x-csrf-token'));
  if(action==='configure')return reply(await serverRpc('maintenance_configure_for_admin',{p_enabled:body.p_enabled,p_actor:auth.userId,p_auth_session:auth.sessionId}));
  const rpc=action==='create'?'reservation_create':'reservation_cancel';return reply(await editorRpc(rpc,body,auth));
 }catch(e){return reply({error:e instanceof AdminError?e.message:'RESERVATION_UNAVAILABLE',not_applied:e instanceof AdminError&&e.notApplied===true},e instanceof AdminError?e.status:500);}
}
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
 try{
  host(request);const action=(await params).action.join('/'),auth=await session(request.cookies.get('judoju_admin_session')?.value);
  if(action==='list'&&(!request.nextUrl.search||request.nextUrl.searchParams.size===1&&/^[0-9a-f-]{36}$/.test(request.nextUrl.searchParams.get('issue')??'')))return reply(await editorRpc('reservation_list',{p_issue:request.nextUrl.searchParams.get('issue')},auth));
  if(action==='maintenance'&&!request.nextUrl.search)return reply(await editorRpc('maintenance_admin_status',{},auth));
  if(action==='request'&&request.nextUrl.searchParams.size===1&&/^[0-9a-f-]{36}$/.test(request.nextUrl.searchParams.get('id')??''))return reply(await editorRpc('reservation_request_status',{p_request:request.nextUrl.searchParams.get('id')},auth));
  throw new AdminError('ROUTE_NOT_FOUND',404);
 }catch(e){return reply({error:e instanceof AdminError?e.message:'RESERVATION_UNAVAILABLE'},e instanceof AdminError?e.status:500);}
}
export function OPTIONS(){return reply({error:'METHOD_REJECTED'},405);}
