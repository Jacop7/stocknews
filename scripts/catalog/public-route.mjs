import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const periods=['TODAY','YESTERDAY','THIS_WEEK','LAST_WEEK','THIS_MONTH','LAST_MONTH'];
export class CatalogReadError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(x='INVALID_PARAMETER',status=400)=>{throw new CatalogReadError(x,status);};
const date=x=>typeof x==='string'&&timestamp.test(x)&&Number.isFinite(Date.parse(x));
export function catalogRoute(u){
 const p=u.searchParams,keys=[...p.keys()];
 const allow=names=>{if(!keys.every(k=>names.includes(k)))fail();};
 const version=()=>{const value=p.get('version');if(value!==null&&!/^[1-9]\d{0,14}$/.test(value))fail();return value;};
 const integer=(key,fallback,max)=>{const v=p.get(key)??String(fallback);if(!/^\d{1,6}$/.test(v)||Number(v)>max)fail();return Number(v);};
 if(u.pathname==='/v2/catalog'){allow(['version']);return {name:'catalog_public_tree',args:{p_expected:version()}};}
 const sector=u.pathname.match(/^\/v2\/sectors\/([0-9a-f-]+)$/);
 if(sector&&uuid.test(sector[1])){allow(['version','offset','limit']);const limit=integer('limit',50,50);if(limit<1)fail();return {name:'catalog_public_sector_page',args:{p_sector:sector[1],p_expected:version(),p_offset:integer('offset',0,100000),p_limit:limit}};}
 if(u.pathname!=='/v2/articles')fail('ROUTE_NOT_FOUND',404);
 allow(['version','sectors','period','limit','cursor']);
 const head=version();if(head===null)fail();
 const sectors=p.get('sectors')?.split(',')??[];if(sectors.length>200||sectors.some(x=>!uuid.test(x))||new Set(sectors).size!==sectors.length)fail();sectors.sort();
 const period=p.get('period')??'TODAY',limit=integer('limit',20,50);if(!periods.includes(period)||limit<1)fail();
 const context=createHash('sha256').update(JSON.stringify({version:head,sectors,period,limit})).digest('hex');
 let cursor=null;
 if(p.has('cursor')){
  const encoded=p.get('cursor');if(!/^[A-Za-z0-9_-]{1,1400}$/.test(encoded))fail('INVALID_CURSOR_CONTEXT',409);
  try{cursor=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{fail('INVALID_CURSOR_CONTEXT',409);}
  if(!cursor||Array.isArray(cursor)||Object.keys(cursor).sort().join(',')!=='as_of,catalog_version,filter_hash,last_id,last_time,version'||cursor.version!==2||cursor.catalog_version!==head||cursor.filter_hash!==context||!date(cursor.as_of)||!date(cursor.last_time)||!uuid.test(cursor.last_id)||Date.parse(cursor.last_time)>Date.parse(cursor.as_of))fail('INVALID_CURSOR_CONTEXT',409);
 }
 return {name:'catalog_public_articles',args:{p_expected:head,p_sectors:sectors,p_period:period,p_limit:limit,p_as_of:cursor?.as_of??null,p_last_time:cursor?.last_time??null,p_last_id:cursor?.last_id??null},context};
}
export function catalogResponse(route,value){
 if(route.name!=='catalog_public_articles')return value;
 if(!value||!Array.isArray(value.items)||value.items.length>50||value.items.some(x=>x.sample_kind!=='SYNTHETIC')||!date(value.as_of)||String(value.catalog_version)!==route.args.p_expected)fail('SYNTHETIC_DTO_REQUIRED',502);
 const next_cursor=value.next?Buffer.from(JSON.stringify({version:2,catalog_version:value.catalog_version,as_of:value.as_of,last_time:value.next.last_time,last_id:value.next.last_id,filter_hash:route.context})).toString('base64url'):null;
 const {next,...rest}=value;return {...rest,next_cursor};
}
