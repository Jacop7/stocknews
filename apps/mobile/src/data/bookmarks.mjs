// The persisted envelope deliberately has no article content or installation ID.
export const bookmarkNamespace='judoju-news:local:bookmarks:v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const emptyBookmarks=()=>({schemaVersion:1,productId:'judoju-news',environment:'local',entries:[]});
const order=(a,b)=>b.saved_at.localeCompare(a.saved_at)||a.issue_id.localeCompare(b.issue_id);
export function parseBookmarks(raw){
 if(raw===null)return emptyBookmarks();
 let value;try{value=JSON.parse(raw);}catch{throw new Error('저장 데이터를 읽을 수 없습니다. 기존 데이터는 유지됩니다.');}
 if(!value||Object.keys(value).sort().join(',')!=='entries,environment,productId,schemaVersion'||value.schemaVersion!==1||value.productId!=='judoju-news'||value.environment!=='local'||!Array.isArray(value.entries)||value.entries.length>500)throw new Error('저장 데이터 형식이 올바르지 않습니다.');
 const byId=new Map();
 for(const e of value.entries){
  if(!e||Object.keys(e).sort().join(',')!=='issue_id,saved_at'||!uuid.test(e.issue_id)||typeof e.saved_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.saved_at)||!Number.isFinite(Date.parse(e.saved_at)))throw new Error('저장 데이터를 확인해 주세요. 기존 데이터는 유지됩니다.');
  const old=byId.get(e.issue_id);if(!old||old.saved_at>e.saved_at)byId.set(e.issue_id,{...e});
 }
 return {...emptyBookmarks(),entries:[...byId.values()].sort(order)};
}
export function changeBookmark(value,id,save,now=new Date().toISOString()){
 if(!uuid.test(id))throw new Error('기사 ID가 올바르지 않습니다.');
 const entries=value.entries.filter(x=>x.issue_id!==id);
 if(save){const old=value.entries.find(x=>x.issue_id===id);if(entries.length>=500)throw new Error('최대 500개까지 저장할 수 있습니다. 기존 글을 지운 뒤 다시 저장해 주세요.');entries.push(old??{issue_id:id,saved_at:now});}
 return parseBookmarks(JSON.stringify({...emptyBookmarks(),entries}));
}
export function resolveBookmarkAliases(value,aliases){
 // Transform the latest persisted list inside the same lock as removal. Never
 // merge an old in-memory list back into storage, which could resurrect a delete.
 return parseBookmarks(JSON.stringify({...emptyBookmarks(),entries:value.entries.map(e=>{const target=aliases[e.issue_id];return uuid.test(target??'')?{...e,issue_id:target}:e;})}));
}
export class BookmarkChanged extends Error{constructor(current){super('다른 화면에서 저장 ID가 변경됐습니다. 최신 목록에서 다시 해제해 주세요.');this.current=current;}}
export function applyBookmarkIntent(current,id,save,canonical=id,known={}){
 if(!uuid.test(id)||!uuid.test(canonical))throw new Error('기사 ID가 올바르지 않습니다.');
 const links={...known,...(canonical!==id?{[id]:canonical}:{})};
 const resolve=start=>{let x=start;const seen=new Set();while(links[x]){if(seen.has(x)||seen.size>=16)throw new Error('저장 ID를 다시 확인해 주세요.');seen.add(x);x=links[x];}return x;};
 const target=resolve(canonical),matched=current.entries.filter(e=>e.issue_id===id||resolve(e.issue_id)===target);
 if(!save){
  // An absent old ID may have been rewritten by another tab. Without a proved
  // canonical identity, do not announce a successful no-op or guess by date.
  if(!matched.length)throw new BookmarkChanged(current);
  return {...current,entries:current.entries.filter(e=>!matched.includes(e))};
 }
 const rewritten=resolveBookmarkAliases(current,Object.fromEntries(matched.map(e=>[e.issue_id,target])));
 return changeBookmark(rewritten,target,true);
}
export function createBookmarkStore(adapter){
 let snapshot={hydrated:false,entries:[],error:''},tail=Promise.resolve();const listeners=new Set(),known=new Map();
 const remember=map=>{for(const [from,to]of Object.entries(map))if(uuid.test(from)&&uuid.test(to)&&from!==to)known.set(from,to);while(known.size>4096)known.delete(known.keys().next().value);};
 const emit=(value,error='')=>{snapshot={hydrated:true,entries:value.entries,error};for(const fn of listeners)fn();};
 const failed=e=>{snapshot={...snapshot,error:e instanceof Error?e.message:'저장에 실패했습니다.'};for(const fn of listeners)fn();};
 const schedule=fn=>{const p=tail.then(fn);tail=p.catch(()=>{});return p;};
 const read=()=>schedule(async()=>{try{emit(parseBookmarks(await adapter.read()));}catch(e){failed(e);throw e;}});
 const initial=read();initial.catch(()=>{});
 const mutate=(transform,after=()=>{})=>schedule(async()=>{
  try{if(!snapshot.hydrated)throw new Error('저장 목록을 먼저 다시 읽어 주세요.');const value=await adapter.update(transform);after();emit(value);return value;}catch(e){if(e instanceof BookmarkChanged)emit(e.current,e.message);else failed(e);throw e;}
 });
 return {getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},reload:read,
  set:(id,save,canonical=id)=>mutate(current=>applyBookmarkIntent(current,id,save,canonical,Object.fromEntries(known)),()=>remember({[id]:canonical})),
  aliases:map=>mutate(current=>resolveBookmarkAliases(current,map),()=>remember(map))};
}
