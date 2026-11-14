import {createHash} from 'node:crypto';
import {CatalogReadError} from './public-route.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const date=x=>typeof x==='string'&&timestamp.test(x)&&Number.isFinite(Date.parse(x));
const fail=(message='INVALID_SEARCH_PARAMETER',status=400)=>{throw new CatalogReadError(message,status);};
export function normalizeSearch(value){
 if(typeof value!=='string'||[...value].length<1||[...value].length>80)fail();
 const q=value.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
 if(!q||q.split(' ').length>6||/[\u0000-\u001f\u007f]/u.test(q))fail();return q;
}
export function searchRoute(u){
 const p=u.searchParams,keys=[...p.keys()];
 const only=allowed=>{if(!keys.every(x=>allowed.includes(x)))fail();};
 const head=p.get('version');if(!head||!(/^[1-9]\d{0,14}$/).test(head))fail();
 const integer=(name,initial,max)=>{const x=p.get(name)??String(initial);if(!/^\d{1,4}$/.test(x)||Number(x)>max)fail();return Number(x);};
 if(u.pathname==='/v2/saved'){
  only(['version','ids']);const ids=p.get('ids')?.split(',')??[];
  if(ids.length<1||ids.length>20||ids.some(x=>!uuid.test(x))||new Set(ids).size!==ids.length)fail();
  return {name:'catalog_public_saved',args:{p_expected:head,p_issues:ids},search:true};
 }
 const related=u.pathname.match(/^\/v2\/companies\/([0-9a-f-]+)\/sectors$/);
 if(related&&uuid.test(related[1])){
  only(['version','offset','limit']);const limit=integer('limit',20,20);if(!limit)fail();
  return {name:'catalog_public_company_sectors',args:{p_expected:head,p_company:related[1],p_offset:integer('offset',0,3000),p_limit:limit},search:true};
 }
 if(!['/v2/search/news','/v2/search/companies'].includes(u.pathname))return null;
 only(['version','q','limit','cursor']);const query=normalizeSearch(p.get('q')),limit=integer('limit',20,20);if(!limit)fail();
 const type=u.pathname.endsWith('/news')?'news':'companies';
 const context=createHash('sha256').update(JSON.stringify({version:head,query,type,limit})).digest('hex');
 let c=null;
 if(p.has('cursor')){
  const encoded=p.get('cursor');if(!/^[A-Za-z0-9_-]{1,1800}$/.test(encoded))fail('INVALID_CURSOR_CONTEXT',409);
  try{c=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{fail('INVALID_CURSOR_CONTEXT',409);}
  const fields=type==='news'?'as_of,context,last_id,last_time,version':'context,last_id,last_name,last_rank,version';
  if(!c||Array.isArray(c)||Object.keys(c).sort().join(',')!==fields||c.version!==1||c.context!==context||!uuid.test(c.last_id))fail('INVALID_CURSOR_CONTEXT',409);
  if(type==='news'?(!date(c.as_of)||!date(c.last_time)||Date.parse(c.last_time)>Date.parse(c.as_of)):
   (!Number.isInteger(c.last_rank)||c.last_rank<0||c.last_rank>3||typeof c.last_name!=='string'||[...c.last_name].length<1||[...c.last_name].length>200))fail('INVALID_CURSOR_CONTEXT',409);
 }
 return {name:'catalog_public_search_'+type,search:true,context,args:{p_expected:head,p_query:query,p_limit:limit,...(type==='news'?{p_as_of:c?.as_of??null,p_last_time:c?.last_time??null,p_last_id:c?.last_id??null}:{p_last_rank:c?.last_rank??null,p_last_name:c?.last_name??null,p_last_id:c?.last_id??null})}};
}
const card=x=>x&&uuid.test(x.issue_id)&&x.sample_kind==='SYNTHETIC'&&typeof x.title==='string'&&typeof x.summary==='string'&&date(x.first_published_at);
export function searchResponse(route,value){
 if(!route.search)return value;
 if(!value||String(value.catalog_version)!==route.args.p_expected||!Array.isArray(value.items))fail('INVALID_SEARCH_DTO',502);
 if(route.name==='catalog_public_saved'){
  if(value.items.length!==route.args.p_issues.length||value.items.some((x,i)=>x.requested_issue_id!==route.args.p_issues[i]||!['PUBLISHED','NOT_FOUND','HIDDEN','WITHDRAWN','CORRECTION_PENDING'].includes(x.state)||
   (x.state==='PUBLISHED'?(!card(x.card)||x.card.issue_id!==x.canonical_issue_id):('card'in x||'body'in x||'title'in x||'summary'in x))))fail('INVALID_SEARCH_DTO',502);
  return value;
 }
 if(value.items.length>(route.args.p_limit??20))fail('INVALID_SEARCH_DTO',502);
 if(route.name==='catalog_public_company_sectors')return value;
 const news=route.name.endsWith('_news');
 if(news?(!date(value.as_of)||value.items.some(x=>!card(x))):value.items.some(x=>!uuid.test(x.source_company_ref)||typeof x.name!=='string'||typeof x.search_description!=='string'||x.metadata_kind!=='USER_REFERENCE_UNVERIFIED'||x.stock_identity_state!=='UNRESOLVED'||['stock_code','price','change_percent','stock_url'].some(k=>x[k]!==null)))fail('INVALID_SEARCH_DTO',502);
 const next_cursor=value.next?Buffer.from(JSON.stringify({version:1,context:route.context,...value.next,...(news?{as_of:value.as_of}:{})})).toString('base64url'):null;
 const {next,...rest}=value;return {...rest,next_cursor};
}
