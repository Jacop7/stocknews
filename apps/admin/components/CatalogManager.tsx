'use client';
import {useEffect,useRef,useState} from 'react';
import {catalogPending,catalogOutcome,catalogArchive,recoveryTarget,recoveryFieldPairs,rebaseCatalogOrder,sameRecoveryScope} from '../lib/catalog-state.mjs';
type Entity={id:string;name:string;parent_id:string|null;catalog_kind:'PARENT'|'LEAF';display_order:number;active:boolean};
type Member={id:string;subgroup_id:string|null;source_company_ref:string;role:string;display_order:number;active:boolean;name:string};
type Group={id:string;name:string;order:number;active:boolean};
type Detail={catalog_version:string;sector:Entity&{description:string};groups:Group[];memberships:Member[];total_memberships:number;offset:number;keyword_settings:Record<string,string[]>};
type Company={id:string;name:string;search_description:string;direct_terms:string[];industry_terms:string[];active:boolean};
type Intent={actor:string;targetName?:string;recoveryOf?:string;args:{p_expected:number;p_operation_key:string;p_kind:string;p_entity:string|null;p_payload:Record<string,unknown>}};
type Archive={intent:Intent;version:string;latest:Record<string,unknown>};
const storage='judoju.catalog.pending.v1';
const archiveStorage='judoju.catalog.recovery.v1';
const fieldLabels:Record<string,string>={name:'이름',description:'섹터 상세 설명',parent_id:'상위 분류',sector_id:'섹터',display_order:'표시 순서',catalog_kind:'분류 종류',search_description:'검색 시 설명글',direct_terms:'기업 직접 검색어',industry_terms:'기업 산업 검색어',subgroup_id:'하위 묶음',source_company_ref:'연결 기업',role:'기업 역할',keyword_kind:'키워드 종류',terms:'검색어',ids:'순서',scope:'순서 적용 범위'};
const list=(s:string)=>s.split('\n').filter(x=>x.trim()!=='');
const displayValue=(value:unknown)=>Array.isArray(value)?value.join('\n'):value===null?'없음':String(value??'');
const importableFields=(kind:string)=>kind.startsWith('COMPANY_')?['name','search_description','direct_terms','industry_terms']:kind==='SECTOR_KEYWORDS'?['terms']:kind.startsWith('SECTOR_')?['name','description','parent_id','display_order']:kind.startsWith('GROUP_')?['name','sector_id']:kind.startsWith('MEMBERSHIP_')?['role','subgroup_id','source_company_ref']:[];
async function api(action:string,data?:unknown,csrf?:string){
 const response=await fetch('/api/catalog/'+action,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000),headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();if(!response.ok&&result.status!=='REJECTED')throw new Error(result.error??'REQUEST_FAILED');return result;
}
export default function CatalogManager({csrf}:{csrf:string}){
 const [head,setHead]=useState(''),[actor,setActor]=useState(''),[index,setIndex]=useState<Entity[]>([]),[id,setId]=useState(''),[detail,setDetail]=useState<Detail|null>(null);
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[parent,setParent]=useState(''),[order,setOrder]=useState(0),[groupId,setGroupId]=useState(''),[groupName,setGroupName]=useState(''),[groupLeaf,setGroupLeaf]=useState('');
 const [member,setMember]=useState<Member|null>(null),[memberGroup,setMemberGroup]=useState(''),[memberCompanyId,setMemberCompanyId]=useState(''),[memberCompanyName,setMemberCompanyName]=useState(''),[memberCompanyVersion,setMemberCompanyVersion]=useState(''),[role,setRole]=useState(''),[companyId,setCompanyId]=useState(''),[companies,setCompanies]=useState<Array<{id:string;name:string;active:boolean}>>([]),[companyTotal,setCompanyTotal]=useState(0),[companyListVersion,setCompanyListVersion]=useState(''),[query,setQuery]=useState(''),[company,setCompany]=useState<Company|null>(null);
 const [companyName,setCompanyName]=useState(''),[companyDescription,setCompanyDescription]=useState(''),[direct,setDirect]=useState(''),[industry,setIndustry]=useState(''),[keywordKind,setKeywordKind]=useState('INDUSTRY'),[keywords,setKeywords]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Intent|null>(null),[outcome,setOutcome]=useState('UNCERTAIN'),[impact,setImpact]=useState<Record<string,unknown>|null>(null),[archive,setArchive]=useState<Archive|null>(null);
 const [sectorVersion,setSectorVersion]=useState(''),[companyVersion,setCompanyVersion]=useState(''),[groupVersion,setGroupVersion]=useState(''),[memberVersion,setMemberVersion]=useState(''),[keywordVersion,setKeywordVersion]=useState('');
 const lock=useRef(false),pendingRef=useRef<Intent|null>(null);
 const locked=busy||pending!==null||!head||Boolean(archive&&archive.intent.actor!==actor);
 async function run(fn:()=>Promise<unknown>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'REQUEST_FAILED');}finally{lock.current=false;setBusy(false);}}
 function keep(value:Intent|null){if(value)sessionStorage.setItem(storage,JSON.stringify(value));else sessionStorage.removeItem(storage);pendingRef.current=value;setPending(value);}
 function keepArchive(value:Archive|null){if(value){catalogArchive(JSON.stringify(value));sessionStorage.setItem(archiveStorage,JSON.stringify(value));}else sessionStorage.removeItem(archiveStorage);setArchive(value);}
 async function loadIndex(){
  let offset=0,all:Entity[]=[],version='',who='';
  do{const page=await api('summary?limit=200&offset='+offset);if(version&&version!==page.catalog_version)throw new Error('STALE_CATALOG');version=page.catalog_version;who=page.actor_id;all.push(...page.items);offset+=page.items.length;if(offset>=page.total)break;if(page.items.length===0)throw new Error('INVALID_CATALOG_PAGE');}while(offset<1000);
  setHead(version);setActor(who);setIndex(all);setImpact(null);return {version,actor:who,items:all};
 }
 async function selectSector(next:string,version=head){
  const d=next?await api('sector?id='+next+'&version='+version) as Detail:null;
  if(d&&d.sector.id!==next)throw new Error('CATALOG_TARGET_MISMATCH');
  setId(next);setDetail(d);setImpact(null);setMember(null);setGroupId('');setGroupName('');setMemberGroup('');setMemberCompanyId('');setMemberCompanyName('');setRole('');
  setSectorVersion(version);setGroupVersion(version);setMemberVersion(version);setKeywordVersion(version);setMemberCompanyVersion(version);
  setName(d?.sector.name??'');setDescription(d?.sector.description??'');setParent(d?.sector.parent_id??'');setOrder(d?.sector.display_order??0);setGroupLeaf(next);setKeywords((d?.keyword_settings[keywordKind]??[]).join('\n'));return d;
 }
 async function findCompanies(offset=0){const page=await api('companies?q='+encodeURIComponent(query)+'&offset='+offset);if(offset&&page.catalog_version!==companyListVersion)throw new Error('STALE_CATALOG');setCompanies(offset?[...companies,...page.items]:page.items);setCompanyTotal(page.total);setCompanyListVersion(page.catalog_version);}
 function applyCompany(c:Company|null,version:string){setCompanyId(c?.id??'');setCompany(c);setCompanyVersion(version);setCompanyName(c?.name??'');setCompanyDescription(c?.search_description??'');setDirect(c?.direct_terms.join('\n')??'');setIndustry(c?.industry_terms.join('\n')??'');}
 async function selectCompany(next:string,version=head){const d=next?await api('company?id='+next+'&version='+version):null;if(d&&d.company.id!==next)throw new Error('CATALOG_TARGET_MISMATCH');applyCompany(d?.company??null,version);return d?.company as Company|null;}
 function chooseMember(m:Member,version:string){setMember(m);setRole(m.role??'');setMemberGroup(m.subgroup_id??'');setMemberCompanyId(m.source_company_ref);setMemberCompanyName(m.name);setMemberVersion(version);setMemberCompanyVersion(version);}
 function requestVersion(kind:string,payload:Record<string,unknown>){
  if(kind.startsWith('COMPANY_'))return companyVersion||head;
  if(kind.startsWith('GROUP_'))return groupVersion||detail?.catalog_version||head;
  if(kind.startsWith('MEMBERSHIP_'))return String(Math.min(Number(memberVersion||detail?.catalog_version||head),Number(memberCompanyVersion||memberVersion||head)));
  if(kind==='SECTOR_KEYWORDS')return keywordVersion||head;
  if(kind==='REORDER')return ['GROUPS','MEMBERSHIPS'].includes(String(payload.scope))?detail?.catalog_version||head:head;
  return sectorVersion||head;
 }
 async function resolve(intent:Intent,result:unknown){
  const state=catalogOutcome(intent,result,actor);setOutcome(state);
  if(state==='APPLIED'){
   if(archive&&intent.recoveryOf===archive.intent.args.p_operation_key)keepArchive(null);
   keep(null);const fresh=await loadIndex(),kind=intent.args.p_kind;
   // Refresh the saved form only. Other form versions are retained until their
   // own explicit reload, preventing adoption of a head with stale field values.
   if(kind.startsWith('COMPANY_')){await findCompanies();if(companyId)await selectCompany(companyId,fresh.version);}
   else if(id){const d=await api('sector?id='+id+'&version='+fresh.version) as Detail;setDetail(d);
    if(kind.startsWith('SECTOR_')&&kind!=='SECTOR_KEYWORDS'){setSectorVersion(fresh.version);setName(d.sector.name);setDescription(d.sector.description);setParent(d.sector.parent_id??'');setOrder(d.sector.display_order);}
    if(kind==='SECTOR_KEYWORDS'){setKeywordVersion(fresh.version);setKeywords((d.keyword_settings[keywordKind]??[]).join('\n'));}
    if(kind.startsWith('GROUP_')){setGroupId('');setGroupName('');setGroupVersion(fresh.version);}
    if(kind.startsWith('MEMBERSHIP_')){setMember(null);setRole('');setMemberGroup('');setMemberCompanyId('');setMemberCompanyName('');setMemberVersion(fresh.version);}
   }
   setNotice('저장 완료 · 버전 '+fresh.version+' · 다른 편집 영역의 입력과 기준은 유지됩니다.');
  }
  else if(state==='DEFINITELY_REJECTED')setNotice('반영되지 않은 요청으로 확정됐습니다. 입력을 유지한 채 최신 기준을 불러온 뒤 다시 편집하세요.');
  else setNotice('처리 결과 미확정 · 동일 요청만 조회하거나 재시도할 수 있습니다.');
 }
 async function send(kind:string,entity:string|null,payload:Record<string,unknown>,version=requestVersion(kind,payload)){
  if(pendingRef.current)throw new Error('PENDING_CATALOG_OPERATION');
  if(archive&&!sameRecoveryScope(archive.intent,kind,entity,payload))throw new Error('보관 입력의 재편집을 마치거나 보관 입력을 직접 지운 뒤 다른 작업을 저장해 주세요.');
  const intent:Intent={actor,targetName:kind.startsWith('COMPANY_')?companyName:kind.startsWith('MEMBERSHIP_')?member?.name??memberCompanyName:kind.startsWith('GROUP_')?groupName:kind==='REORDER'?'표시 순서':name,...(archive&&sameRecoveryScope(archive.intent,kind,entity,payload)?{recoveryOf:archive.intent.args.p_operation_key}:{}),args:{p_expected:Number(version),p_operation_key:crypto.randomUUID(),p_kind:kind,p_entity:entity,p_payload:payload}};
  catalogPending(JSON.stringify(intent));keep(intent);setOutcome('UNCERTAIN');setNotice('');const result=await api('mutate',intent.args,csrf);await resolve(intent,result);
 }
 async function move(scope:string,ids:string[],entity:string,direction:number,parentId:string|null,subgroup:string|null=null){const from=ids.indexOf(entity),to=from+direction;if(from<0||to<0||to>=ids.length)return;const ordered=[...ids];[ordered[from],ordered[to]]=[ordered[to],ordered[from]];await send('REORDER',null,{scope,parent_id:parentId,subgroup_id:subgroup,ids:ordered});}
 async function moveMember(m:Member,direction:number){
  if(!detail)return;let rows:Member[]=[],offset=0;
  do{const page=await api('sector?id='+id+'&version='+detail.catalog_version+'&offset='+offset) as Detail;rows.push(...page.memberships);offset+=page.memberships.length;if(offset>=page.total_memberships)break;if(!page.memberships.length)throw new Error('INVALID_CATALOG_PAGE');}while(offset<2000);
  await move('MEMBERSHIPS',rows.filter(x=>x.active&&x.subgroup_id===m.subgroup_id).map(x=>x.id),m.id,direction,id,m.subgroup_id);
 }
 async function latestTarget(intent:Intent,version:string,items:Entity[]){
  const target=recoveryTarget(intent),payload=intent.args.p_payload;
  if(target.type==='COMPANY'){const c=await selectCompany(target.id??'',version);return c?{...c}:{name:'',search_description:'',direct_terms:[],industry_terms:[]};}
  if(target.type==='GROUP'){
   if(target.id){const r=await api('group?id='+target.id+'&version='+version);await selectSector(r.group.sector_id,version);setGroupId(r.group.id);setGroupName(r.group.name);setGroupLeaf(r.group.sector_id);return r.group;}
   if(target.owner)await selectSector(String(target.owner),version);setGroupId('');setGroupName('');return {name:'',sector_id:target.owner??null,display_order:0};
  }
  if(target.type==='MEMBERSHIP'){
   if(target.id){const r=await api('membership?id='+target.id+'&version='+version);await selectSector(r.membership.sector_id,version);chooseMember(r.membership,version);return r.membership;}
   if(target.owner)await selectSector(String(target.owner),version);setMember(null);setMemberCompanyId('');setMemberGroup('');setRole('');return {sector_id:target.owner??null,subgroup_id:null,source_company_ref:null,role:'',display_order:0};
  }
  if(target.type==='ORDER'){
   const scope=String(payload.scope),owner=String(payload.parent_id??'');let ids:string[]=[];
   if(scope==='PARENTS'||scope==='SECTORS')ids=items.filter(x=>x.active&&x.catalog_kind===(scope==='PARENTS'?'PARENT':'LEAF')&&(scope==='PARENTS'||x.parent_id===owner)).sort((a,b)=>a.display_order-b.display_order||a.id.localeCompare(b.id)).map(x=>x.id);
   else{const d=await selectSector(owner,version);if(!d)throw new Error('CATALOG_ENTITY_NOT_FOUND');if(scope==='GROUPS')ids=d.groups.filter(x=>x.active).map(x=>x.id);else{let offset=0;do{const page=await api('sector?id='+owner+'&version='+version+'&offset='+offset) as Detail;ids.push(...page.memberships.filter(x=>x.active&&x.subgroup_id===(payload.subgroup_id??null)).map(x=>x.id));offset+=page.memberships.length;if(offset>=page.total_memberships)break;if(!page.memberships.length)throw new Error('INVALID_CATALOG_PAGE');}while(offset<2000);}}
   return {...payload,ids};
  }
  const d=await selectSector(target.id??'',version);
  if(intent.args.p_kind==='SECTOR_KEYWORDS'&&d){const k=String(payload.keyword_kind);setKeywordKind(k);setKeywords((d.keyword_settings[k]??[]).join('\n'));return {keyword_kind:k,terms:d.keyword_settings[k]??[]};}
  return d?{...d.sector}:{name:'',description:'',catalog_kind:payload.catalog_kind,parent_id:null,display_order:0};
 }
 async function recoverLatest(intent:Intent){
  const fresh=await loadIndex();if(fresh.actor!==intent.actor)throw new Error('PENDING_CATALOG_ACTOR_MISMATCH');
  const values=await latestTarget(intent,fresh.version,fresh.items),saved:Archive={intent,version:fresh.version,latest:values};
  // Store the rejected input before ending its old operation. A refresh at any
  // point retains either the pending request or this separate recovery copy.
  keepArchive(saved);keep(null);setOutcome('UNCERTAIN');setNotice('대상의 최신 값을 불러왔습니다. 이전 입력은 보관했습니다. 필요한 항목만 가져와 다시 저장하세요.');
 }
 function canImport(a:Archive){const t=recoveryTarget(a.intent);if(t.type==='COMPANY')return companyId===(t.id??'')&&companyVersion===a.version;if(t.type==='GROUP')return groupId===(t.id??'')&&(!t.id?id===t.owner:true)&&groupVersion===a.version;if(t.type==='MEMBERSHIP')return (member?.id??'')===(t.id??'')&&(!t.id?id===t.owner:true)&&memberVersion===a.version;if(t.type==='SECTOR')return id===(t.id??'')&&(a.intent.args.p_kind!=='SECTOR_KEYWORDS'||keywordKind===a.intent.args.p_payload.keyword_kind)&&(a.intent.args.p_kind==='SECTOR_KEYWORDS'?keywordVersion:sectorVersion)===a.version;return false;}
 function importField(a:Archive,field:string,value:unknown){
  if(!canImport(a))throw new Error('보관한 대상의 최신 값을 먼저 불러와 주세요.');const kind=a.intent.args.p_kind;
  if(kind.startsWith('COMPANY_')){if(field==='name')setCompanyName(String(value));else if(field==='search_description')setCompanyDescription(String(value));else if(field==='direct_terms')setDirect((value as string[]).join('\n'));else if(field==='industry_terms')setIndustry((value as string[]).join('\n'));}
  else if(kind==='SECTOR_KEYWORDS'){if(field==='terms')setKeywords((value as string[]).join('\n'));}
  else if(kind.startsWith('SECTOR_')){if(field==='name')setName(String(value));else if(field==='description')setDescription(String(value));else if(field==='parent_id')setParent(String(value??''));else if(field==='display_order')setOrder(Number(value));}
  else if(kind.startsWith('GROUP_')){if(field==='name')setGroupName(String(value));else if(field==='sector_id')setGroupLeaf(String(value));}
  else if(kind.startsWith('MEMBERSHIP_')){if(field==='role')setRole(String(value));else if(field==='subgroup_id')setMemberGroup(String(value??''));else if(field==='source_company_ref'&&!member){const c=companies.find(c=>c.id===value&&c.active);if(!c)throw new Error('현재 기업 목록에서 연결할 기업을 다시 선택해 주세요.');setMemberCompanyId(c.id);setMemberCompanyName(c.name);setMemberCompanyVersion(companyListVersion);}}
 }
 useEffect(()=>{void run(async()=>{const restored=catalogPending(sessionStorage.getItem(storage)) as Intent|null,storedArchive=catalogArchive(sessionStorage.getItem(archiveStorage)) as Archive|null;pendingRef.current=restored;setPending(restored);setArchive(storedArchive);const fresh=await loadIndex();if((restored&&restored.actor!==fresh.actor)||(storedArchive&&storedArchive.intent.actor!==fresh.actor))throw new Error('PENDING_CATALOG_ACTOR_MISMATCH');await findCompanies();});},[]);
 const parents=index.filter(x=>x.catalog_kind==='PARENT'&&x.active),leaves=index.filter(x=>x.catalog_kind==='LEAF'&&x.active),selected=index.find(x=>x.id===id);
 return <section><p>시트 참조 메타데이터 · 카탈로그 {head||'확인 중'} · 종목코드/시세 확인 전</p>
 {error&&<p className='error' role='alert'>{error}</p>}{notice&&<p role='status'>{notice}</p>}
 {pending&&<div className='panel'><strong>저장 요청 {outcome==='DEFINITELY_REJECTED'?'확정 거절':'결과 확인 중'} · {pending.targetName??pending.args.p_entity??'새 항목'}</strong><p>새로고침 후에도 아래 입력과 요청 키를 유지합니다. 새 요청은 잠겨 있습니다.</p><details open><summary>보관 중인 미저장 입력</summary>{recoveryFieldPairs(pending,{}).map(row=><div className='edit-group' key={row.field}><strong>{fieldLabels[row.field]??row.field}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{displayValue(row.requested)}</pre></div>)}</details><button disabled={busy||pending.actor!==actor} onClick={()=>run(async()=>resolve(pending,await api('operation',pending.args,csrf)))}>처리 결과 조회</button> <button disabled={busy||pending.actor!==actor||outcome==='DEFINITELY_REJECTED'} onClick={()=>run(async()=>resolve(pending,await api('mutate',pending.args,csrf)))}>동일 요청 재시도</button>{outcome==='DEFINITELY_REJECTED'&&<button disabled={busy||pending.actor!==actor} onClick={()=>run(()=>recoverLatest(pending))}>대상 최신값 불러오기</button>}</div>}
 {archive&&!pending&&<div className='panel'><h2>보관한 입력과 대상 비교 · {archive.intent.targetName??archive.intent.args.p_entity??'새 항목'}</h2><p>마지막 확인 기준 {archive.version}. 편집 폼은 최신 값을 사용합니다. 필요한 이전 입력만 하나씩 가져오세요.</p><button disabled={busy||archive.intent.actor!==actor} onClick={()=>run(()=>recoverLatest(archive.intent))}>보관한 대상 최신값 불러오기</button>{recoveryFieldPairs(archive.intent,archive.latest).map(row=><div className='edit-group' key={row.field}><h3>{fieldLabels[row.field]??row.field}</h3><div className='form-grid'><div><strong>보관한 입력</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{displayValue(row.requested)}</pre></div><div><strong>확인한 현재 값</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{displayValue(row.current)}</pre></div></div>{importableFields(archive.intent.args.p_kind).includes(row.field)&&<button disabled={locked||!canImport(archive)} onClick={()=>run(async()=>importField(archive,row.field,row.requested))}>{fieldLabels[row.field]??row.field} 입력만 가져오기</button>}</div>)}{archive.intent.args.p_kind==='REORDER'&&<button disabled={locked} onClick={()=>run(()=>send('REORDER',null,{...archive.intent.args.p_payload,ids:rebaseCatalogOrder(archive.intent.args.p_payload.ids,archive.latest.ids)},archive.version))}>현재 항목을 유지하며 보관한 순서로 다시 요청</button>}<p>비활성화·복원은 최신 대상 상태와 삭제 영향을 확인한 뒤 아래에서 다시 선택하세요.</p><button disabled={busy} onClick={()=>{if(window.confirm('보관한 미저장 입력을 지울까요?'))keepArchive(null);}}>보관 입력 지우기</button></div>}
 <div className='editor-grid'><div className='panel'><h2>섹터 설정</h2><fieldset disabled={locked}>
 <label>상위 분류 / 섹터 선택<select value={id} onChange={e=>run(()=>selectSector(e.target.value))}><option value=''>새로 추가</option>{index.map(x=><option key={x.id} value={x.id}>{x.catalog_kind==='PARENT'?'[상위] ':''}{x.name}{x.active?'':' · 비활성'}</option>)}</select></label>
 <button disabled={locked} onClick={()=>run(async()=>{const fresh=await loadIndex();await selectSector(id,fresh.version);})}>섹터 최신값 불러오기</button><p>섹터 편집 기준 {sectorVersion||head}</p><label>이름<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><label>섹터 상세 설명 · C열<textarea value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)}/></label>
 <label>상위 분류<select value={parent} onChange={e=>setParent(e.target.value)}><option value=''>선택</option>{parents.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>표시 순서<input type='number' min={0} max={1000000} value={order} onChange={e=>setOrder(Number(e.target.value))}/></label>
 {selected?<><button onClick={()=>run(()=>send('SECTOR_UPDATE',id,{name,description,display_order:order,...(selected.catalog_kind==='LEAF'?{parent_id:parent}:{})}))}>섹터 저장</button> {selected.active?<button onClick={()=>run(async()=>{setImpact(await api('impact',{p_sector:id,p_expected:Number(sectorVersion)},csrf));})}>삭제 영향 확인</button>:<button onClick={()=>run(()=>send('SECTOR_RESTORE',id,{}))}>선택 항목 복원</button>}
 <div className='toolbar'>{[-1,1].map(d=><button key={d} onClick={()=>run(()=>move(selected.catalog_kind==='PARENT'?'PARENTS':'SECTORS',index.filter(x=>x.active&&x.catalog_kind===selected.catalog_kind&&x.parent_id===selected.parent_id).sort((a,b)=>a.display_order-b.display_order||a.id.localeCompare(b.id)).map(x=>x.id),id,d,selected.parent_id))}>{d<0?'위로':'아래로'}</button>)}</div></>:<><button onClick={()=>run(()=>send('SECTOR_CREATE',null,{name,description,display_order:order,catalog_kind:'PARENT'}))}>상위 분류 추가</button> <button onClick={()=>run(()=>send('SECTOR_CREATE',null,{name,description,display_order:order,catalog_kind:'LEAF',parent_id:parent}))}>섹터 추가</button></>}
 </fieldset>{impact&&<div className='edit-group'><h3>삭제 적용 전 영향</h3><p>섹터 {String(impact.sector_count)} · 하위 묶음 {String(impact.active_group_count)} · 기업 연결 {String(impact.active_membership_count)}</p><p>글 {String(impact.issue_count)} · 게시 중 {String(impact.published_count)} · 예약 {String(impact.scheduled_count)} · 관심 설정 {String(impact.interest_settings_count)}</p><p>게시글은 정정 대기로 전환되며 기존 본문 제공이 중지됩니다. 비활성 선택값은 필터와 관심 설정에서 제외됩니다.</p><button disabled={locked} onClick={()=>run(()=>send('SECTOR_DEACTIVATE',id,{impact_sha256:impact.impact_sha256}))}>영향 확인 후 비활성화</button></div>}
 </div><div className='panel'><h2>한국 기업 · 검색 설명</h2><fieldset disabled={locked}><label>기업 검색<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={()=>run(()=>findCompanies())}>검색</button><label>기업 선택<select value={companyId} onChange={e=>run(()=>selectCompany(e.target.value))}><option value=''>새 기업</option>{company&&!companies.some(c=>c.id===company.id)&&<option value={company.id}>{company.name}</option>}{companies.map(c=><option key={c.id} value={c.id}>{c.name}{c.active?'':' · 비활성'}</option>)}</select></label>{companies.length<companyTotal&&<button onClick={()=>run(()=>findCompanies(companies.length))}>기업 더 불러오기</button>}
 <button disabled={locked} onClick={()=>run(async()=>{const fresh=await loadIndex();await selectCompany(companyId,fresh.version);})}>기업 최신값 불러오기</button><p>기업 편집 기준 {companyVersion||head}</p><label>기업명<input maxLength={200} value={companyName} onChange={e=>setCompanyName(e.target.value)}/></label><label>검색 시 설명글 · E열<textarea maxLength={2000} value={companyDescription} onChange={e=>setCompanyDescription(e.target.value)}/></label><label>기업 직접 적용 검색어 · 한 줄에 하나<textarea value={direct} onChange={e=>setDirect(e.target.value)}/></label><label>기업 산업 검색어 · 한 줄에 하나<textarea value={industry} onChange={e=>setIndustry(e.target.value)}/></label>
 <button onClick={()=>run(()=>send(company?'COMPANY_UPDATE':'COMPANY_CREATE',company?.id??null,{name:companyName,search_description:companyDescription,direct_terms:list(direct),industry_terms:list(industry)}))}>{company?'기업 저장':'기업 추가'}</button> {company&&<button onClick={()=>run(()=>send(company.active?'COMPANY_DEACTIVATE':'COMPANY_RESTORE',company.id,{}))}>{company.active?'기업 비활성화':'기업 복원'}</button>}</fieldset></div></div>
 {selected?.catalog_kind==='LEAF'&&detail&&<div className='editor-grid'><div className='panel'><h2>하위 묶음 · 기업 역할</h2><fieldset disabled={locked||!selected.active}>
 <label>하위 묶음<select value={groupId} onChange={e=>{const g=detail.groups.find(x=>x.id===e.target.value);setGroupId(e.target.value);setGroupName(g?.name??'');setGroupLeaf(id);setGroupVersion(detail.catalog_version);}}><option value=''>새 하위 묶음</option>{detail.groups.map(g=><option value={g.id} key={g.id}>{g.name}{g.active?'':' · 비활성'}</option>)}</select></label><label>묶음 이름<input value={groupName} maxLength={200} onChange={e=>setGroupName(e.target.value)}/></label><label>이동 대상 섹터<select value={groupLeaf} onChange={e=>setGroupLeaf(e.target.value)}>{leaves.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 <button onClick={()=>run(()=>send(groupId?'GROUP_UPDATE':'GROUP_CREATE',groupId||null,{name:groupName,sector_id:groupLeaf}))}>{groupId?'묶음 저장·이동':'묶음 추가'}</button> {groupId&&<><button onClick={()=>run(()=>send(detail.groups.find(x=>x.id===groupId)?.active?'GROUP_DEACTIVATE':'GROUP_RESTORE',groupId,{}))}>묶음 비활성/복원</button>{[-1,1].map(d=><button key={d} onClick={()=>run(()=>move('GROUPS',detail.groups.filter(g=>g.active).map(g=>g.id),groupId,d,id))}>{d<0?'묶음 위로':'묶음 아래로'}</button>)}</>}
 <div className='edit-group'>{detail.memberships.map(m=><div className='article-row' key={m.id}><button onClick={()=>chooseMember(m,detail.catalog_version)}>{m.name} · {m.role}{m.active?'':' · 비활성'}</button><span>{[-1,1].map(d=><button key={d} onClick={()=>run(()=>moveMember(m,d))}>{d<0?'↑':'↓'}</button>)}</span></div>)}{detail.offset+detail.memberships.length<detail.total_memberships&&<button onClick={()=>run(async()=>{const next=await api('sector?id='+id+'&version='+detail.catalog_version+'&offset='+(detail.offset+detail.memberships.length));setDetail({...next,memberships:[...detail.memberships,...next.memberships],offset:0});})}>연결 기업 더 불러오기</button>}</div>
 <button onClick={()=>{setMember(null);setRole('');setMemberGroup('');setMemberVersion(detail.catalog_version);setMemberCompanyId(company?.id??'');setMemberCompanyName(company?.name??'');setMemberCompanyVersion(companyVersion||detail.catalog_version);}}>새 기업 연결</button><label>연결할 기업<select disabled={!!member} value={memberCompanyId} onChange={e=>{const c=companies.find(x=>x.id===e.target.value);setMemberCompanyId(c?.id??'');setMemberCompanyName(c?.name??'');setMemberCompanyVersion(companyListVersion);}}><option value=''>기업 선택</option>{memberCompanyId&&!companies.some(c=>c.id===memberCompanyId)&&<option value={memberCompanyId}>{memberCompanyName}</option>}{companies.filter(c=>c.active||c.id===memberCompanyId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p>기업 편집 대상과 연결 대상은 별도로 선택됩니다. 위 기업 검색으로 연결 후보를 불러올 수 있습니다.</p><label>묶음<select value={memberGroup} onChange={e=>setMemberGroup(e.target.value)}><option value=''>묶음 없음</option>{detail.groups.filter(g=>g.active).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>이 묶음에서의 기업 역할 · B열<textarea maxLength={600} value={role} onChange={e=>setRole(e.target.value)}/></label>
 <button onClick={()=>run(()=>send(member?'MEMBERSHIP_UPDATE':'MEMBERSHIP_CREATE',member?.id??null,{sector_id:id,subgroup_id:memberGroup||null,role,...(!member?{source_company_ref:memberCompanyId}:{})}))}>{member?'연결 역할 저장':'기업 연결 추가'}</button> {member&&<button onClick={()=>run(()=>send(member.active?'MEMBERSHIP_DEACTIVATE':'MEMBERSHIP_RESTORE',member.id,{}))}>{member.active?'연결 해제':'연결 복원'}</button>}
 </fieldset></div><div className='panel'><h2>섹터 수집 키워드</h2><fieldset disabled={locked||!selected.active}><label>종류<select value={keywordKind} onChange={e=>{setKeywordKind(e.target.value);setKeywordVersion(detail.catalog_version);setKeywords((detail.keyword_settings[e.target.value]??[]).join('\n'));}}><option value='INDUSTRY'>산업 키워드 · F열</option><option value='CORE'>핵심 키워드 · G열</option><option value='ADDITIONAL'>추가 키워드 · H~Q열</option></select></label><label>검색어 · 한 줄에 하나<textarea rows={12} value={keywords} onChange={e=>setKeywords(e.target.value)}/></label><button onClick={()=>run(()=>send('SECTOR_KEYWORDS',id,{keyword_kind:keywordKind,terms:list(keywords)}))}>선택한 종류의 키워드 저장</button><p>다른 종류·카테고리의 중복 검색어는 유지됩니다. 기업별 직접 검색어와 분리됩니다.</p></fieldset></div></div>}
 </section>;
}
