import {NextRequest,NextResponse} from 'next/server';
import {AdminError,assertWrite,config,editorRpc,session} from '../../../../lib/runtime.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string[]}>}){
 try{
  if(request.headers.get('host')!=='127.0.0.1:3100')throw new AdminError('HOST_REJECTED',403);
  assertWrite(request.headers,undefined,undefined);
  if((await params).action.join('/')!=='stats'||request.nextUrl.search)throw new AdminError('ROUTE_NOT_FOUND',404);
  if(Number(request.headers.get('content-length')??0)>4096)throw new AdminError('REQUEST_TOO_LARGE',413);
  const raw=await request.text();if(Buffer.byteLength(raw)>4096)throw new AdminError('REQUEST_TOO_LARGE',413);
  let body;try{body=JSON.parse(raw);}catch{throw new AdminError('INVALID_JSON');}
  if(!body||Object.keys(body).sort().join(',')!=='p_end,p_issue,p_sector,p_start'||typeof body.p_start!=='string'||typeof body.p_end!=='string'
   ||body.p_start.length>40||body.p_end.length>40||!Number.isFinite(Date.parse(body.p_start))||!Number.isFinite(Date.parse(body.p_end))
   ||![body.p_issue,body.p_sector].every(x=>x===null||typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)))throw new AdminError('INVALID_STATS_FILTER');
  const s=await session(request.cookies.get('judoju_admin_session')?.value);assertWrite(request.headers,s.csrf,request.headers.get('x-csrf-token'));
  return reply(await editorRpc('installation_admin_stats',body,s));
 }catch(e){return reply({error:e instanceof AdminError?e.message:'STATS_UNAVAILABLE'},e instanceof AdminError?e.status:500);}
}
export function OPTIONS(){return reply({error:'METHOD_REJECTED'},405);}
