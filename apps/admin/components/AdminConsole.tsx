'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PublicSector,PublicScenario } from '@judoju/contracts';
import type { Draft,EditorContent,EditorImpact,Preview } from '../lib/editor-types';
import { ArticlePreview } from './ArticlePreview';
import CatalogManager from './CatalogManager';
import NewsAnalytics from './NewsAnalytics';
import ReservationManager from './ReservationManager';
import AiOriginPanel from './AiOriginPanel';
import CompanyScope from './CompanyScope';
import { alignedScenarios,currentPublicationBinding,EditorApiError,matchesSavedDraft,observePendingEditorOperation,parsePendingIntent,publicationBinding,saveFailureNeedsDraftReload,stateRecoveryDraft } from '../lib/editor-state.mjs';
type CurrentCatalog={catalog_version:string;sectors:PublicSector[]};
type PendingIntent={action:'create'|'publish'|'state';args:Record<string,unknown>};
type BoundPreview={article:Preview;binding:ReturnType<typeof publicationBinding>};
const pendingStorage='judoju.editor.pending.v1';
import './editor.css';
const menus=[['articles','기사 관리'],['sectors','섹터 관리'],['keywords','키워드 설정'],['analytics','뉴스 조회 통계'],['reservations','예약·유지관리'],['ranking','홈 순위 관리'],['sources','수집 상태'],['settings','설정']];
const lines=(x:string)=>x.split('\n');
const clean=(x:string[])=>x.map(s=>s.trim()).filter(Boolean);
// Supabase returns the TOTP QR as an unencoded SVG data URI with the media type "img/svg+xml"; browsers need
// "image/svg+xml" and an encoded body (characters such as # break it).
function qrImageSrc(value:string):string{const m=/^data:(?:image|img)\/svg\+xml;(?:utf-8|charset=utf-8),\s*(<(?:\?xml|svg)[\s\S]*)$/i.exec(value);return m?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(m[1]):value;}
async function api<T>(action:string,data?:unknown,csrf?:string):Promise<T>{
 const r=await fetch('/api/editor/'+action,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw new EditorApiError(value.error??'REQUEST_FAILED',r.status,value.not_applied);return value as T;
}
export default function AdminConsole({initialPath,deploymentProfile='local'}:{initialPath:string;deploymentProfile?:'local'|'preview'|'online'}){
 const previewMode=deploymentProfile!=='local',onlineMode=deploymentProfile==='online';
 // Online: password, then a TOTP code (first sign-in enrols the authenticator from a QR code).
 const [mfa,setMfa]=useState<''|'challenge'|'enroll'>(''),[qr,setQr]=useState<{qrCode:string;secret:string}|null>(null),[code,setCode]=useState('');
 const router=useRouter(),[ready,setReady]=useState(false),[csrf,setCsrf]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [articles,setArticles]=useState<Array<{id:string;title:string;publication_state:string;draft_revision:number;sample_kind?:string;ai_origin?:{state:string;ai_version:number;facts:number|null}|null}>>([]),[sectors,setSectors]=useState<PublicSector[]>([]),[draft,setDraft]=useState<Draft|null>(null),[preview,setPreview]=useState<BoundPreview|null>(null);
 const running=useRef(false);
 const pendingRef=useRef<PendingIntent|null>(null),[pending,setPending]=useState<PendingIntent|null>(null),[recoveryDraft,setRecoveryDraft]=useState<string|null>(null);
 function keepIntent(value:PendingIntent|null){
  // Persist only request identifiers, never credentials or editorial content. Fail before sending if storage is unavailable.
  if(value)sessionStorage.setItem(pendingStorage,JSON.stringify(value));else sessionStorage.removeItem(pendingStorage);
  pendingRef.current=value;setPending(value);
 }
 useEffect(()=>{let active=true;let restored:PendingIntent|null=null;
  try{restored=parsePendingIntent(sessionStorage.getItem(pendingStorage)??'null') as PendingIntent|null;pendingRef.current=restored;setPending(restored);}catch{setError('요청 상태 저장소를 확인할 수 없습니다.');}
  api<{csrf:string}>('session').then(async s=>{if(!active)return;setCsrf(s.csrf);const [a,c]=await Promise.all([api<typeof articles>('articles'),api<PublicSector[]>('catalog')]);if(active){setArticles(a);setSectors(c);if(restored?.action!=='create'&&restored?.args.p_issue){await load(String(restored.args.p_issue));router.replace('/articles');}}}).catch(e=>{if(active&&e.message!=='LOGIN_REQUIRED')setError(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 async function run(fn:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'REQUEST_FAILED');}finally{running.current=false;setBusy(false);}}
 const patch=(value:Partial<EditorContent>)=>{if(!draft||running.current||pendingRef.current||recoveryDraft)return;const next={...draft.content,...value};if(value.impacts)next.scenarios=alignedScenarios(next.scenarios,next.impacts);setDraft({...draft,content:next});setPreview(null);};
 const patchImpact=(n:number,value:Partial<EditorImpact>)=>{if(draft)patch({impacts:draft.content.impacts.map((x,i)=>i===n?{...x,...value}:x)});};
 async function readDraft(id:string){const [d,c]=await Promise.all([api<Draft>('draft?id='+encodeURIComponent(id)),api<CurrentCatalog>('catalog-current')]);if(String(d.catalog_version)!==c.catalog_version)throw new Error('STALE_CATALOG');setSectors(c.sectors);return d;}
 async function load(id:string){const d=await readDraft(id);setDraft({...d,content:{...d.content,scenarios:alignedScenarios(d.content.scenarios,d.content.impacts)}});setPreview(null);setRecoveryDraft(null);}
 async function recoverIntent(intent:PendingIntent,error?:unknown){
  if(intent.action==='create'){setNotice('새 글 요청 결과 확인이 필요합니다. 동일 요청으로 다시 확인해 주세요.');return;}
  const id=String(intent.args.p_issue);
  const {resolution,latest}=await observePendingEditorOperation(
   ()=>api<{state:string}>('operation?id='+encodeURIComponent(id)+'&key='+encodeURIComponent(String(intent.args.p_effect_key))),
   ()=>readDraft(id),error);
  if(resolution==='APPLIED'){
   const restored=intent.action==='state'?stateRecoveryDraft(draft,latest):{draft:{...latest,content:{...latest.content,scenarios:alignedScenarios(latest.content.scenarios,latest.content.impacts)}},needsReload:false};
   keepIntent(null);setDraft(restored.draft);setPreview(null);setRecoveryDraft(restored.needsReload?id:null);
   const confirmed=restored.needsReload?'상태 변경은 반영됐지만 다른 편집본이 저장되어 있습니다. 현재 입력과 기준 버전은 유지됩니다. 최신 초안을 불러온 뒤 편집해 주세요.':'처리가 반영된 최신 상태를 확인했습니다.';
   try{await refresh();setNotice(confirmed);}catch{setNotice(confirmed+' 기사 목록은 새로고침해 주세요.');}
  }else if(resolution==='REJECTED'||resolution==='CONFLICT'){
   keepIntent(null);setPreview(null);setRecoveryDraft(id);setNotice('요청이 반영되지 않은 것을 확인했습니다. 입력 내용은 유지됩니다. 최신 초안을 불러온 뒤 다시 편집해 주세요.');
  }else setNotice('처리 결과가 아직 확정되지 않았습니다. 같은 요청 키를 유지합니다.');
  return resolution;
 }
 async function mutate(intent:PendingIntent){
  if(pendingRef.current)intent=pendingRef.current;else keepIntent(intent);
  let result:{issue_id?:string};
  try{result=await api(intent.action,intent.args,csrf);}
  catch(e){
   // An explicit SQL rollback is different from an unknown transport outcome. Both require a fresh state read.
   try{if(await recoverIntent(intent,e)==='APPLIED')return;}
   catch{setNotice('최신 상태 확인에 실패했습니다. 동일 요청을 유지합니다.');}
   throw e;
  }
  if(intent.action==='create'){await load(String(result.issue_id));keepIntent(null);await refresh();setNotice('새 초안 생성 완료');}
  else await recoverIntent(intent);
 }
 async function save(){
  if(!draft)throw new Error('DRAFT_REQUIRED');
  const before=draft,c=before.content;
  const normalized={...c,key_issues:clean(c.key_issues),risks:clean(c.risks),impacts:c.impacts.map(x=>({...x,conditions:clean(x.conditions)})),scenarios:c.scenarios.map(x=>({...x,checks:clean(x.checks)}))};
  setPreview(null);
  let receipt:unknown;
  try{
   receipt=await api('save-catalog',{p_issue:before.issue_id,p_expected_revision:before.draft_revision,p_content:normalized,p_catalog:before.catalog_version},csrf);
  }catch(e){
   if(saveFailureNeedsDraftReload(e))setRecoveryDraft(before.issue_id);
   throw e;
  }
  try{
   const latest=await readDraft(before.issue_id);
   if(!matchesSavedDraft(before,receipt,latest))throw new Error('저장한 초안의 판본을 확인할 수 없습니다.');
   setDraft(latest);
   return latest;
  }catch(e){setRecoveryDraft(before.issue_id);throw e;}
 }
 async function previewDraft(){
  const saved=await save(),binding=publicationBinding(saved);
  const article=await api<Preview>('preview',{p_issue:binding.p_issue,p_expected_revision:binding.p_expected_revision,
   p_policy:binding.p_policy,p_catalog:binding.p_catalog},csrf);
  setPreview({article,binding});
 }
 async function refresh(){setArticles(await api<typeof articles>('articles'));}
 async function reloadCatalog(){if(!draft)return;const c=await api<CurrentCatalog>('catalog-current');setSectors(c.sectors);setDraft({...draft,catalog_version:Number(c.catalog_version)});setPreview(null);setNotice('최신 섹터 목록을 불러왔습니다. 기사 입력과 초안 버전은 유지됩니다.');}
 const content=draft?.content;
 // Publish 1A: real drafts are reviewed and previewed only; publishing and scheduling stay closed (the DB refuses them too).
 const realDraft=draft?.sample_kind==='PERMITTED_REAL';
 const previewBinding=currentPublicationBinding(draft,preview?.binding);
 const previousSector=(id:string)=>draft?.sector_labels?.find(s=>s.id===id)?.name??id;
 const missingSector=(id:string|null)=>!!id&&!sectors.some(s=>s.id===id);
 const needsSectorChoice=!!content&&(missingSector(content.primary_sector_id)||content.impacts.some(x=>missingSector(x.sector_id)));
 const positive=content?.impacts.filter(x=>x.direction==='BENEFIT'||x.conditional_direction==='POSITIVE')??[],negative=content?.impacts.filter(x=>x.direction==='DAMAGE'||x.conditional_direction==='NEGATIVE')??[];
 function scenario(direction:'POSITIVE'|'NEGATIVE',value:Partial<PublicScenario>){if(!content)return;const paths=direction==='POSITIVE'?positive:negative;const prior=content.scenarios.find(x=>x.direction===direction)??{direction,title:'',expected_result:'',checks:[],path_ids:paths.map(x=>x.path_id)};patch({scenarios:[...content.scenarios.filter(x=>x.direction!==direction),{...prior,...value,path_ids:paths.map(x=>x.path_id)}]});}
 return <div className='shell'><aside><strong>주도주 뉴스</strong><p>관리자</p><nav>{menus.filter(([key])=>!previewMode||['articles','sectors','keywords'].includes(key)).map(([key,label])=><Link href={'/'+key} key={key}>{label}</Link>)}</nav>{csrf&&<button disabled={busy} onClick={()=>run(async()=>{await api('logout',{},csrf);setCsrf('');setDraft(null);router.replace('/login');})}>로그아웃</button>}</aside><main>
 <span className='tag'>{onlineMode?'온라인 · 개발 DB · 합성 검증 · 2단계 인증':previewMode?'개발 DB · 합성 검증 · 실제 뉴스 미연결':'LOCAL · 합성 기사 · 실제 뉴스/운영 게시 미연결'}</span><h1>{!csrf?'관리자 로그인':draft&&(!initialPath||['articles','login'].includes(initialPath))?'기사 작성·편집':menus.find(([k])=>k===initialPath)?.[1]??'기사 관리'}</h1>
 {error&&<p role='alert' className='error'>{error} · 최신 상태를 확인한 후 다시 시도해 주세요.</p>}{notice&&<p role='status'>{notice}</p>}
 {csrf&&pending&&<div className='panel' role='status'><p>확인 중인 {pending.action==='create'?'새 글':pending.action==='publish'?'게시':'상태 변경'} 요청이 있습니다. 다른 쓰기는 잠시 잠깁니다.</p><button disabled={busy} onClick={()=>run(()=>mutate(pending))}>동일 요청 재확인</button>{pending.action!=='create'&&<button disabled={busy} onClick={()=>run(async()=>{await recoverIntent(pending);})}>처리 상태 확인</button>}</div>}
 {csrf&&recoveryDraft&&<div className='panel'><p>현재 입력을 자동으로 덮어쓰지 않았습니다. 최신 초안을 불러오면 현재 입력이 교체됩니다.</p><button disabled={busy} onClick={()=>run(()=>load(recoveryDraft))}>최신 초안 불러오기</button></div>}
 {!ready?<p>인증 상태 확인 중…</p>:!csrf&&mfa?<form className='panel login' onSubmit={e=>{e.preventDefault();run(async()=>{const s=await api<{csrf:string}>('mfa/verify',{code});setCode('');setMfa('');setQr(null);setCsrf(s.csrf);setArticles(await api<typeof articles>('articles'));setSectors(await api<PublicSector[]>('catalog'));router.replace('/articles');});}}>{mfa==='enroll'&&!qr&&<button type='button' disabled={busy} onClick={()=>run(async()=>{setQr(await api<{qrCode:string;secret:string}>('mfa/enroll',{}));})}>인증 앱 등록 QR 만들기</button>}{qr&&<div><p>인증 앱(Google Authenticator 등)으로 QR을 찍어 등록하세요.</p><img src={qrImageSrc(qr.qrCode)} alt='TOTP 등록 QR' width={200} height={200}/><p>직접 입력 키: <code>{qr.secret}</code></p></div>}<label>인증 앱 6자리 코드<input inputMode='numeric' pattern='[0-9]{6}' maxLength={6} required autoComplete='one-time-code' value={code} onChange={e=>setCode(e.target.value)}/></label><button className='primary' disabled={busy||(mfa==='enroll'&&!qr)}>확인</button><p>5분 안에 입력해야 합니다. 5번 틀리면 다시 로그인해야 합니다.</p></form>
 :!csrf?<form className='panel login' onSubmit={e=>{e.preventDefault();run(async()=>{const s=await api<{csrf?:string;mfa?:'challenge'|'enroll'}>('login',{email,password});setPassword('');if(s.mfa){setMfa(s.mfa);return;}setCsrf(s.csrf??'');setArticles(await api<typeof articles>('articles'));setSectors(await api<PublicSector[]>('catalog'));if(pendingRef.current?.action!=='create'&&pendingRef.current?.args.p_issue)await load(String(pendingRef.current.args.p_issue));router.replace('/articles');});}}><label>이메일<input type='email' required autoComplete='username' value={email} onChange={e=>setEmail(e.target.value)}/></label><label>비밀번호<input type='password' required autoComplete='current-password' value={password} onChange={e=>setPassword(e.target.value)}/></label><button className='primary' disabled={busy}>로그인</button><p>소비자 앱에는 로그인이 없습니다.</p></form>
 :['sectors','keywords'].includes(initialPath)?<CatalogManager csrf={csrf}/>
 :previewMode&&initialPath&&!['articles','login','sectors','keywords'].includes(initialPath)?<section className='panel'><p>이 메뉴는 개발 DB에 아직 연결하지 않았습니다.</p></section>
 :initialPath==='analytics'?<NewsAnalytics csrf={csrf} articles={articles}/>
 :initialPath==='reservations'?<ReservationManager csrf={csrf}/>
 :initialPath&&!['articles','login'].includes(initialPath)?<section className='panel'><p>이 메뉴의 편집 기능은 후속 단계에서 연결합니다.</p></section>
 :!draft?<section className='panel'><div className='toolbar'><button className='primary' disabled={busy||!!pending||!!recoveryDraft} onClick={()=>run(async()=>{await mutate({action:'create',args:{p_request:crypto.randomUUID()}});})}>새 글 작성</button><button disabled={busy} onClick={()=>run(refresh)}>새로고침</button></div>{articles.length===0?<p>작성한 글이 없습니다.</p>:articles.map(x=><button className='article-row' key={x.id} disabled={busy||!!pending||!!recoveryDraft} onClick={()=>run(()=>load(x.id))}><strong>{x.title||'제목 없는 초안'}</strong>{x.sample_kind==='PERMITTED_REAL'&&<span className='tag'>{x.ai_origin?'AI 초안 · ':''}실데이터{x.ai_origin?.state==='HOLD_EDITOR'?' · 새 근거 대기':''}</span>}<span>{x.publication_state} · 초안 {x.draft_revision}</span></button>)}</section>
 :content&&<><div className='toolbar'><button disabled={busy||!!pending||!!recoveryDraft} onClick={()=>{setDraft(null);setPreview(null);run(refresh);}}>‹ 목록</button><span>{draft.state} · 초안 {draft.draft_revision}</span></div>{realDraft&&<p role='status' className='panel'>실데이터 초안입니다(내부 검토용). 1A 단계에서는 미리보기까지만 되고, 게시와 예약은 1B에서 열립니다.</p>}{realDraft&&draft.ai_origin&&<AiOriginPanel origin={draft.ai_origin}/>}{!previewMode&&!realDraft&&<ReservationManager csrf={csrf} draft={draft} previewReady={!!previewBinding&&!busy&&!pending&&!recoveryDraft&&!needsSectorChoice} onCreated={()=>setPreview(null)}/>}<div className='editor-grid'><form className='panel' onSubmit={e=>e.preventDefault()}><fieldset disabled={busy||!!pending||!!recoveryDraft}>
 <button type='button' onClick={()=>run(reloadCatalog)}>최신 섹터 목록 불러오기</button>{needsSectorChoice&&<p role='status'>이전/비활성 분류가 남아 있습니다. 현재 섹터를 직접 선택해야 미리보기와 게시가 가능합니다.</p>}<label>뉴스 제목 핵심 축약<input maxLength={200} value={content.title} onChange={e=>patch({title:e.target.value})}/></label><label>기사 핵심 설명<textarea value={content.summary} onChange={e=>patch({summary:e.target.value})}/></label>
 <div className='form-grid'><label>기사 구분<select value={content.article_kind} onChange={e=>patch({article_kind:e.target.value as 'SECTOR'|'MACRO'|'COMPANY',...(e.target.value==='COMPANY'?{}:{primary_company_ref:null})})}><option value='SECTOR'>섹터 이슈</option><option value='MACRO'>매크로 이슈</option><option value='COMPANY'>종목 이슈</option></select></label><label>대표 섹터<select value={content.primary_sector_id??''} onChange={e=>patch({primary_sector_id:e.target.value||null})}><option value=''>선택 없음</option>{missingSector(content.primary_sector_id)&&<option disabled value={content.primary_sector_id??''}>이전/비활성 분류 · {previousSector(content.primary_sector_id??'')}</option>}{sectors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
 <div className='form-grid'><label>원문 시장<select value={content.source_market} onChange={e=>patch({source_market:e.target.value})}>{(realDraft?['KR','US','GLOBAL']:['KR','US','GLOBAL','SYNTHETIC']).map(x=><option key={x}>{x}</option>)}</select></label><label>선정 시장 기준<select value={content.selection_market_basis} onChange={e=>patch({selection_market_basis:e.target.value as 'KR'|'FOREIGN_US'})}><option value='KR'>한국 주가 기반</option><option value='FOREIGN_US'>해외 주가 기반</option></select></label></div>
 <label>핵심 이슈 · 한 줄에 하나<textarea value={content.key_issues.join('\n')} onChange={e=>patch({key_issues:lines(e.target.value)})}/></label><label>이슈 분석<textarea rows={7} value={content.issue_analysis} onChange={e=>patch({issue_analysis:e.target.value})}/></label><p>영향 분석 관점: 한국 주식</p>
 <CompanyScope kind={content.article_kind} primary={content.primary_company_ref??null} refs={content.company_refs??[]} labels={draft.company_labels??[]} impacts={content.impacts} sectorName={id=>sectors.find(s=>s.id===id)?.name??previousSector(id)} disabled={busy||!!pending||!!recoveryDraft} onChange={v=>patch(v)}/><h2>섹터 영향과 근거</h2>{content.impacts.map((x,n)=><div className='edit-group' key={x.path_id}><label>섹터<select value={x.sector_id} onChange={e=>patchImpact(n,{sector_id:e.target.value})}>{missingSector(x.sector_id)&&<option disabled value={x.sector_id}>이전/비활성 분류 · {previousSector(x.sector_id)}</option>}{sectors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className='form-grid'><label>영향<select value={x.direction} onChange={e=>patchImpact(n,{direction:e.target.value as EditorImpact['direction'],conditional_direction:'NONE'})}><option value='BENEFIT'>수혜</option><option value='DAMAGE'>피해</option><option value='RELATED'>연관</option></select></label>{x.direction==='RELATED'&&<label>조건부 방향<select value={x.conditional_direction} onChange={e=>patchImpact(n,{conditional_direction:e.target.value as EditorImpact['conditional_direction']})}><option value='NONE'>확정 방향 없음</option><option value='POSITIVE'>조건부 긍정</option><option value='NEGATIVE'>조건부 부정</option></select></label>}</div><label>영향 설명<textarea value={x.description} onChange={e=>patchImpact(n,{description:e.target.value})}/></label><label>조건 · 한 줄에 하나<textarea value={x.conditions.join('\n')} onChange={e=>patchImpact(n,{conditions:lines(e.target.value)})}/></label><button type='button' onClick={()=>patch({impacts:content.impacts.filter((_,i)=>i!==n)})}>영향 항목 삭제</button></div>)}<button type='button' disabled={!sectors.length} onClick={()=>patch({impacts:[...content.impacts,{sector_id:sectors[0].id,path_id:crypto.randomUUID(),direction:'RELATED',conditional_direction:'NONE',description:'',conditions:[],evidence_ids:[draft.claim_id]}]})}>섹터 영향 추가</button>
 <h2>예상 시나리오</h2>{positive.length===0?<p>긍정 근거가 없는 글은 시나리오를 표시하지 않습니다.<button type='button' onClick={()=>patch({scenarios:[]})}>시나리오 비우기</button></p>:['POSITIVE',...(negative.length?['NEGATIVE']:[])].map(v=>{const direction=v as 'POSITIVE'|'NEGATIVE',s=content.scenarios.find(x=>x.direction===direction);return <div className='edit-group' key={v}><h3>{v==='POSITIVE'?'긍정':'부정'}</h3><label>조건 제목<input value={s?.title??''} onChange={e=>scenario(direction,{title:e.target.value})}/></label><label>예상결과<textarea value={s?.expected_result??''} onChange={e=>scenario(direction,{expected_result:e.target.value})}/></label><label>체크사항 · 한 줄에 하나<textarea value={s?.checks.join('\n')??''} onChange={e=>scenario(direction,{checks:lines(e.target.value)})}/></label></div>;})}
 <label>리스크 체크리스트 · 한 줄에 하나<textarea value={content.risks.join('\n')} onChange={e=>patch({risks:lines(e.target.value)})}/></label>
 <h2>주요 일정</h2>{content.schedule.map((x,n)=><div className='edit-group' key={n}><label>일정 제목<input value={x.title} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,title:e.target.value}:y)})}/></label><div className='form-grid'><label>상태<select value={x.status} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,status:e.target.value as typeof x.status}:y)})}>{['VERIFIED','CANCELLED','UNVERIFIED','SUPERSEDED'].map(v=><option key={v}>{v}</option>)}</select></label><label>시간대<input value={x.timezone} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,timezone:e.target.value}:y)})}/></label></div>{x.kind==='EXACT'?<label>확정 시각 · 시간대 포함 ISO 형식<input value={x.event_at??''} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,event_at:e.target.value}:y)})}/></label>:<><label>공식 예정 기간 표기<input value={x.period_label??''} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,period_label:e.target.value}:y)})}/></label><div className='form-grid'>{(['period_start','period_end'] as const).map(k=><label key={k}>{k==='period_start'?'기간 시작':'기간 종료 · 미포함'}<input value={x[k]??''} onChange={e=>patch({schedule:content.schedule.map((y,i)=>i===n?{...y,[k]:e.target.value}:y)})}/></label>)}</div></>}<button type='button' onClick={()=>patch({schedule:content.schedule.filter((_,i)=>i!==n)})}>일정 삭제</button></div>)}<div className='toolbar'>{(['EXACT','PERIOD'] as const).map(kind=><button type='button' key={kind} onClick={()=>patch({schedule:[...content.schedule,{kind,title:'',status:'UNVERIFIED',timezone:'Asia/Seoul',evidence_ids:[draft.claim_id],evidence_as_of:new Date().toISOString(),...(kind==='EXACT'?{event_at:''}:{period_label:'',period_start:'',period_end:'',precision:'PERIOD'})}]})}>{kind==='EXACT'?'확정 시각 추가':'예정 기간 추가'}</button>)}</div>
 <h2>뉴스 출처</h2>{realDraft?<ul>{content.sources.map(s=><li key={s.url}><a href={s.url} target='_blank' rel='noreferrer noopener'>{s.name}</a></li>)}</ul>:<p>SYNTHETIC 검증 근거 · 실제 원문 수집 미연결</p>}</fieldset>
 <div className='toolbar'><button disabled={busy||!!pending||!!recoveryDraft} onClick={()=>run(async()=>{await save();setNotice('초안 저장 완료');})}>초안 저장</button><button disabled={busy||!!pending||!!recoveryDraft||needsSectorChoice} onClick={()=>run(previewDraft)}>미리보기</button>{!realDraft&&<button className='primary' disabled={busy||!!pending||!!recoveryDraft||needsSectorChoice||!previewBinding} onClick={()=>{if(previewBinding)void run(()=>mutate({action:'publish',args:{...previewBinding,p_effect_key:crypto.randomUUID()}}));}}>게시</button>}<button disabled={busy||!!pending||!!recoveryDraft||draft.state!=='PUBLISHED'} onClick={()=>run(()=>mutate({action:'state',args:{p_issue:draft.issue_id,p_expected_revision:draft.issue_revision,p_state:'HIDDEN',p_effect_key:crypto.randomUUID()}}))}>숨김</button></div></form><section className='panel preview-panel'>{preview&&previewBinding?<ArticlePreview {...preview.article}/>:<p>미리보기를 누르면 서버가 판정한 공개 화면이 표시됩니다.</p>}</section></div></>}
 </main></div>;
}
