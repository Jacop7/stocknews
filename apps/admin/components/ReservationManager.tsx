'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {Draft} from '../lib/editor-types';
import {kstReservationInput,parseReservationIntent} from '../lib/reservation-state.mjs';
type Intent={action:'create'|'cancel';args:Record<string,unknown>;owner:string};
type Item={id:string;issue_id:string;status:string;revision:number;title:string;due_at:string;expires_at:string;outcome_code:string|null;current_draft_revision:number;reserved_draft_revision:number};
type Operation={kind:string;registered:boolean;active:boolean;state:string;schedule:string;last_started_at:string|null;last_finished_at:string|null;last_error_code:string|null};
type Maintenance={jobs:Operation[];backlog:Record<string,string|number|null>;runs:Array<{kind:string;started_at:string;result:Record<string,unknown>}>};
const storage='judoju.reservation.pending.v1';
const display=(value:string|null)=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value)):'—';
const labels:Record<string,string>={PENDING:'예약 대기',PUBLISHED:'게시 완료',CANCELLED:'취소',HELD:'보류',EXPIRED:'기한 만료'};
async function api<T>(route:string,data?:unknown,csrf?:string):Promise<T>{
 const r=await fetch('/api/reservations/'+route,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
 const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error??'RESERVATION_UNAVAILABLE'),{notApplied:value.not_applied===true});return value;
}
export default function ReservationManager({csrf,draft,previewReady=false,onCreated}:{csrf:string;draft?:Draft;previewReady?:boolean;onCreated?:()=>void}){
 const [items,setItems]=useState<Item[]>([]),[owner,setOwner]=useState(''),[maintenance,setMaintenance]=useState<Maintenance|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Intent|null>(null),[storageFailed,setStorageFailed]=useState(false);
 const pendingRef=useRef<Intent|null>(null),dueInput=useRef<HTMLInputElement>(null);
 async function refresh(){const list=await api<{items:Item[];request_owner:string}>('list'+(draft?'?issue='+draft.issue_id:''));setItems(list.items);setOwner(list.request_owner);if(!draft)setMaintenance(await api<Maintenance>('maintenance'));return list.request_owner;}
 function keep(value:Intent|null){if(value)sessionStorage.setItem(storage,JSON.stringify(value));else sessionStorage.removeItem(storage);pendingRef.current=value;setPending(value);}
 useEffect(()=>{try{const p=parseReservationIntent(sessionStorage.getItem(storage)??'null') as Intent|null;pendingRef.current=p;setPending(p);}catch{setStorageFailed(true);setError('저장된 예약 요청을 확인할 수 없습니다. 다른 쓰기를 보내지 않았습니다.');}refresh().catch(e=>setError(e.message));},[csrf,draft?.issue_id,draft?.draft_revision,draft?.issue_revision]);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message+' · 상태를 새로 확인하고 재시도해 주세요.');}finally{setBusy(false);}}
 async function send(intent:Intent){
  const currentOwner=await refresh();if(intent.owner!==currentOwner)throw Error('다른 관리자 세션의 요청입니다. 원래 관리자 계정으로 확인해 주세요.');
  if(!pendingRef.current)keep(intent);else intent=pendingRef.current;
  try{await api(intent.action,intent.args,csrf);keep(null);setNotice('요청 처리 완료');await refresh();onCreated?.();}
  catch(e){const known=await api<{result:unknown}|null>('request?id='+String(intent.args.p_request)).catch(()=>null);
   if(known){keep(null);setNotice('이전 요청의 처리 결과를 확인했습니다.');await refresh();onCreated?.();return;}
   if((e as Error&{notApplied?:boolean}).notApplied){await refresh();keep(null);}throw e;
  }
 }
 const blocked=busy||storageFailed||!!pending||!owner,hasPending=items.some(x=>x.status==='PENDING');
 return <section className='panel reservation-panel'><h2>{draft?'예약 게시':'예약·유지관리'}</h2><p>한국시각(KST) · LOCAL 합성 기사 · 실제 푸시 발송 0</p>
 <p>카탈로그·정책 게시 또는 초안 변경 시 기존 예약이 보류됩니다. 최신 미리보기 후 다시 예약해 주세요.</p>
 {error&&<p role='alert' className='error'>{error}</p>}{notice&&<p role='status'>{notice}</p>}
 {pending&&<div role='status'><p>결과 확인 중인 예약 요청이 있습니다. 같은 요청 키를 유지합니다.</p><button disabled={busy||!owner||pending.owner!==owner} onClick={()=>run(()=>send(pending))}>동일 요청 재확인</button>{pending.owner!==owner&&<p>원래 관리자 계정으로 로그인해 확인해 주세요.</p>}</div>}
 {draft&&<div className='toolbar'><label>예약 게시일 · 한국시각<input key={draft.issue_id} ref={dueInput} type='datetime-local' disabled={blocked}/></label><button className='primary' disabled={blocked||!previewReady||draft.state!=='DRAFT'||hasPending} onClick={()=>run(async()=>{await send({action:'create',owner,args:{p_issue:draft.issue_id,p_draft_revision:draft.draft_revision,p_issue_revision:draft.issue_revision,p_policy:draft.policy_version,p_catalog:draft.catalog_version,p_due_at:kstReservationInput(dueInput.current?.value),p_request:crypto.randomUUID()}});})}>예약 게시</button><p>저장·미리보기 후 예약 가능 · 1분 이후~90일 이내 · 15분 초과 지연 시 만료</p></div>}
 <button disabled={busy} onClick={()=>run(async()=>{await refresh();})}>상태 새로고침</button>
 {items.length===0?<p>예약 내역이 없습니다.</p>:<><p>최근 최대 100개 예약{draft?' · 현재 기사':''}</p>{items.map(x=><article className='edit-group' key={x.id}><strong>{x.title||'제목 없는 초안'}</strong><p>{labels[x.status]??x.status} · 예약 {display(x.due_at)} · 기한 {display(x.expires_at)}</p><p>초안 {x.reserved_draft_revision} → 현재 {x.current_draft_revision}{x.outcome_code?' · '+x.outcome_code:''}</p>{x.status==='PENDING'&&<button disabled={blocked} onClick={()=>run(()=>send({action:'cancel',owner,args:{p_schedule:x.id,p_revision:x.revision,p_request:crypto.randomUUID()}}))}>예약 취소</button>}</article>)}</>}
 {!draft&&maintenance&&<><h3>전용 주기 작업</h3><p>실제 cron 실행 기록과 commit된 작업 통계를 구분합니다. 브라우저 실행이나 기사 수집 봇 운영 완료를 뜻하지 않습니다.</p>{maintenance.jobs.length===0?<p>등록된 작업 없음</p>:maintenance.jobs.map(j=><div className='edit-group' key={j.kind}><strong>{j.kind} · {j.state}</strong><p>{j.schedule} · 시작 {display(j.last_started_at)} · 종료 {display(j.last_finished_at)}</p>{j.last_error_code&&<p>{j.last_error_code}</p>}</div>)}<div className='toolbar'><button disabled={blocked} onClick={()=>run(async()=>{await api('configure',{p_enabled:false},csrf);await refresh();})}>주기 작업 일시정지</button><button disabled={blocked} onClick={()=>run(async()=>{await api('configure',{p_enabled:true},csrf);await refresh();})}>검증된 주기 작업 재개</button></div><h3>처리 대기</h3><dl>{Object.entries(maintenance.backlog).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl><h3>최근 commit된 실행</h3>{maintenance.runs.map((r,n)=><p key={n}>{r.kind} · {display(r.started_at)} · {JSON.stringify(r.result)}</p>)}<Link href='/articles'>기사 관리</Link></>}
 </section>;
}
