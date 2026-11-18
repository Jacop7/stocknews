// C2 pure contracts. No file/network I/O and no activation by importing this module.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {previewProject,uuid,previewOwnerIdentity} from './preview-admin-config.mjs';

export const actualOwner=previewOwnerIdentity();
export const actualOrganization='qfzgicohgpuogehdyzfx';
export const actualHost='http://127.0.0.2:62333';
export const actualLimits=Object.freeze({hostMs:1800000,proofMs:86400000,responseBytes:262144,loginEntries:128,setupMs:300000,sqlFloorMs:1800000,setupMarginMs:5000,initialSetupHeadroomMs:2105000});
const hex=/^[0-9a-f]{64}$/;
const keyId=/^[A-Za-z0-9_-]{1,128}$/;
const fail=code=>{throw new Error('ADMIN_ACTUAL_HOLD:'+code);};
export const actualHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function copyActualData(value,seen=new Set(),depth=0){
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'&&value.length<=262144)return value;
  if(typeof value==='number'&&Number.isSafeInteger(value))return value;
  if(!value||typeof value!=='object'||types.isProxy(value)||seen.has(value)||depth>12)fail('DATA');
  const arr=Array.isArray(value),p=Object.getPrototypeOf(value);
  if(arr?p!==Array.prototype||value.length>512:p!==Object.prototype&&p!==null)fail('DATA');
  const keys=Reflect.ownKeys(value);
  if(keys.length>(arr?513:257)||keys.some(k=>typeof k!=='string'))fail('DATA');
  if(arr&&keys.length!==value.length+1)fail('DATA');
  seen.add(value);const out=arr?[]:{};
  for(const k of arr?Array.from({length:value.length},(_,i)=>String(i)):keys){
    const d=Object.getOwnPropertyDescriptor(value,k);
    if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('DATA');
    Object.defineProperty(out,k,{value:copyActualData(d.value,seen,depth+1),enumerable:true,writable:true,configurable:true});
  }
  seen.delete(value);return out;
}
export function actualCanonical(value){
  const data=copyActualData(value);
  const text=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(text).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+text(x[k])).join(',')+'}';
  return text(data);
}
function exact(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==[...keys].sort().join('|'))fail('SHAPE');}
export function actualTime(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail('TIME');
  const t=Date.parse(value);if(!Number.isSafeInteger(t)||new Date(t).toISOString()!==value)fail('TIME');return t;
}
export function validateActualOwner(raw){
  const u=copyActualData(raw);
  exact(u,['id','created_at','confirmed_at','anonymous','sso','deleted','banned','email_sha256','metadata_email_only','identity_count','email_identity_count']);
  if(u.id!==actualOwner.id||u.email_sha256!==actualOwner.emailSha256||u.created_at!==actualOwner.createdAt
    ||!u.confirmed_at||!Number.isFinite(Date.parse(u.confirmed_at))||Date.parse(u.confirmed_at)<Date.parse(u.created_at)
    ||u.anonymous!==false||u.sso!==false||u.deleted!==false||u.banned!==false
    ||u.metadata_email_only!==true||u.identity_count!==1||u.email_identity_count!==1)fail('OWNER');
  return Object.freeze(u);
}
export function makeActualDecision(template,raw,render){
  const p=copyActualData(raw);
  exact(p,['effectKey','expiresAt','implementationManifestSha256','publishableKeyId','secretKeyId','prestateSha256','observedAt']);
  if(!uuid.test(p.effectKey??'')||![p.implementationManifestSha256,p.prestateSha256].every(x=>typeof x==='string'&&hex.test(x))
    ||!keyId.test(p.publishableKeyId??'')||!keyId.test(p.secretKeyId??'')||p.publishableKeyId===p.secretKeyId||typeof template!=='string'||typeof render!=='function')fail('DECISION');
  const observed=actualTime(p.observedAt),end=actualTime(p.expiresAt);
  if(end<=observed+1800000||end-observed>actualLimits.proofMs)fail('WINDOW');
  const args={ownerUserId:actualOwner.id,ownerEmailSha256:actualOwner.emailSha256,effectKey:p.effectKey,expiresAt:p.expiresAt,implementationManifestSha256:p.implementationManifestSha256};
  const pre=render(template,{...args,decisionSha256:'0'.repeat(64)});
  const decision=Object.freeze({schemaVersion:1,productId:'judoju-news',projectRef:previewProject,organizationRef:actualOrganization,
    ownerUserId:actualOwner.id,ownerEmailSha256:actualOwner.emailSha256,...p,launchEffect:p.effectKey,
    templateSha256:actualHash(template),sqlPreimageSha256:actualHash(pre.sql)});
  const decisionSha256=actualHash(actualCanonical(decision));
  const final=render(template,{...args,decisionSha256});
  return Object.freeze({decision,decisionSha256,sql:final.sql,sqlSha256:actualHash(final.sql)});
}
export function checkActualApproval(raw,binding){
  const a=copyActualData(raw);
  exact(a,['schemaVersion','decisionSha256','sqlSha256','implementationManifestSha256','ownerUserId','confirmationReference','confirmedAt']);
  if(a.schemaVersion!==1||a.decisionSha256!==binding.decisionSha256||a.sqlSha256!==binding.sqlSha256
    ||a.implementationManifestSha256!==binding.decision.implementationManifestSha256||a.ownerUserId!==actualOwner.id
    ||typeof a.confirmationReference!=='string'||!/^[A-Za-z0-9:._/-]{8,240}$/.test(a.confirmationReference))fail('APPROVAL');
  const t=actualTime(a.confirmedAt);
  if(t<actualTime(binding.decision.observedAt)||t>=actualTime(binding.decision.expiresAt))fail('APPROVAL_TIME');
  return Object.freeze(a); // Audit assertion, not a cryptographic human signature or OS sandbox.
}
// One in-memory setup budget anchored before the fresh DB observation request.
export function createActualSetupBudget(binding,approval,serverObservedAt,requestTicks,receivedTicks){
  checkActualApproval(approval,binding);
  if(![requestTicks,receivedTicks].every(Number.isSafeInteger)||requestTicks<0||receivedTicks<requestTicks)fail('SETUP_MONOTONIC');
  const observed=actualTime(serverObservedAt),confirmed=actualTime(approval.confirmedAt),end=actualTime(binding.decision.expiresAt);
  if(observed<confirmed||observed<actualTime(binding.decision.observedAt))fail('APPROVAL_FUTURE');
  const authoritativeNow=observed+receivedTicks-requestTicks;
  if(end-authoritativeNow<=actualLimits.initialSetupHeadroomMs)fail('SETUP_HEADROOM');
  const budget=Object.freeze({requestTicks,receivedTicks,authoritativeNow,proofEnd:end});
  actualSetupAllowance(budget,receivedTicks);return budget;
}
export function actualSetupAllowance(raw,currentTicks,kind='HTTP'){
  const b=copyActualData(raw);exact(b,['requestTicks','receivedTicks','authoritativeNow','proofEnd']);
  if(![b.requestTicks,b.receivedTicks,b.authoritativeNow,b.proofEnd,currentTicks].every(Number.isSafeInteger)
    ||b.requestTicks<0||b.receivedTicks<b.requestTicks||currentTicks<b.receivedTicks||!['HTTP','NATIVE'].includes(kind))fail('SETUP_MONOTONIC');
  const remainingSetupMs=b.requestTicks+actualLimits.setupMs-currentTicks;
  const remainingProofMs=b.proofEnd-b.authoritativeNow-(currentTicks-b.receivedTicks);
  if(remainingSetupMs<=actualLimits.setupMarginMs||remainingSetupMs>actualLimits.setupMs
    ||remainingProofMs<=actualLimits.sqlFloorMs+remainingSetupMs+actualLimits.setupMarginMs)fail('SETUP_EXHAUSTED');
  const timeoutMs=Math.min(kind==='HTTP'?25000:20000,remainingSetupMs-actualLimits.setupMarginMs);
  return Object.freeze({timeoutMs,remainingSetupMs,remainingProofMs});
}
export function launchStatement(binding){
  const d=binding.decision;
  if(d.ownerUserId!==actualOwner.id||d.projectRef!==previewProject||d.launchEffect!==d.effectKey)fail('LAUNCH_BINDING');
  return Object.freeze({query:`with t as materialized(select clock_timestamp() as ts), used as (
    update private.admin_preview_control c set launched_at=t.ts,host_lease_expires_at=least(c.expires_at,t.ts+interval '30 minutes') from t
    where pg_catalog.current_setting('transaction_isolation')='read committed' and c.singleton and c.enabled and c.owner_user_id=$1::uuid and c.decision_sha256=$2
      and c.implementation_manifest_sha256=$3 and c.template_sha256=$4 and c.effect_key=$5::uuid
      and c.launch_effect=$5::uuid and c.launched_at is null and c.host_lease_expires_at is null
      and c.expires_at=$6::timestamptz and c.expires_at>t.ts and c.activated_at<=t.ts
      and exists(select 1 from auth.users u where u.id=c.owner_user_id and u.email_confirmed_at is not null
        and u.is_anonymous=false and u.is_sso_user=false and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=t.ts)
        and encode(extensions.digest(convert_to(lower(btrim(u.email)),'UTF8'),'sha256'),'hex')=c.owner_email_sha256
        and u.raw_app_meta_data->>'app_role'='admin' and u.raw_app_meta_data->>'product_id'='judoju-news'
        and u.raw_app_meta_data->>'provider'='email' and u.raw_app_meta_data->'providers'='["email"]'::jsonb
        and (select count(*) from auth.identities i where i.user_id=u.id)=1
        and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='email'))
      and exists(select 1 from private.admin_memberships m where m.user_id=c.owner_user_id and m.active)
    returning c.*)
    select jsonb_build_object('launchEffect',launch_effect,'ownerUserId',owner_user_id,'decisionSha256',decision_sha256,
      'serverTime',to_char(launched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt',to_char(host_lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as receipt from used`,
    parameters:[actualOwner.id,binding.decisionSha256,d.implementationManifestSha256,d.templateSha256,d.effectKey,d.expiresAt]});
}
export function validateLaunchAck(raw,binding,requestTicks,receivedTicks){
  const a=copyActualData(raw);exact(a,['launchEffect','ownerUserId','decisionSha256','serverTime','expiresAt']);
  if(a.launchEffect!==binding.decision.launchEffect||a.ownerUserId!==actualOwner.id||a.decisionSha256!==binding.decisionSha256
    ||!Number.isSafeInteger(requestTicks)||!Number.isSafeInteger(receivedTicks)||requestTicks<0||receivedTicks<requestTicks)fail('LAUNCH_ACK');
  const start=actualTime(a.serverTime),end=actualTime(a.expiresAt),proofEnd=actualTime(binding.decision.expiresAt);
  const rtt=receivedTicks-requestTicks,remainingMs=end-start-rtt;
  if(start<actualTime(binding.decision.observedAt)||end>proofEnd||end-start>actualLimits.hostMs||remainingMs<=0)fail('LAUNCH_EXPIRED');
  return Object.freeze({...a,requestTicks,receivedTicks,remainingMs,authoritativeNow:start+rtt});
}
export function checkLiveLease(lease,currentTicks){
  const p=copyActualData(lease);
  exact(p,['launchEffect','ownerUserId','decisionSha256','serverTime','expiresAt','requestTicks','receivedTicks','remainingMs','authoritativeNow']);
  if(!uuid.test(p.launchEffect??'')||p.ownerUserId!==actualOwner.id||!hex.test(p.decisionSha256??'')
    ||![p.requestTicks,p.receivedTicks,p.remainingMs,p.authoritativeNow,currentTicks].every(Number.isSafeInteger)
    ||p.requestTicks<0||p.receivedTicks<p.requestTicks||currentTicks<p.receivedTicks||p.remainingMs<=0
    ||p.remainingMs>actualLimits.hostMs||p.authoritativeNow+p.remainingMs!==actualTime(p.expiresAt)
    ||actualTime(p.serverTime)+p.receivedTicks-p.requestTicks!==p.authoritativeNow)fail('MONOTONIC');
  const elapsed=currentTicks-p.receivedTicks;
  if(elapsed>=p.remainingMs)fail('LEASE_EXPIRED');
  return p.authoritativeNow+elapsed;
}
export function makeLoginJournalEntry(raw){
  const x=copyActualData(raw);
  exact(x,['generation','phase','ownerUserId','authSessionId','capabilityHash']);
  if(!Number.isSafeInteger(x.generation)||x.generation<1||x.generation>actualLimits.loginEntries
    ||!['BEFORE_AUTH','BEFORE_OPEN','COMPLETE','RESIDUAL','CLOSED'].includes(x.phase)||x.ownerUserId!==actualOwner.id
    ||x.authSessionId!==null&&!uuid.test(x.authSessionId)||x.capabilityHash!==null&&!hex.test(x.capabilityHash)
    ||x.phase==='BEFORE_AUTH'&&(x.authSessionId!==null||x.capabilityHash!==null)
    ||['BEFORE_OPEN','COMPLETE','CLOSED'].includes(x.phase)&&(!x.authSessionId||!x.capabilityHash))fail('LOGIN_JOURNAL');
  return Object.freeze(x);
}
function appendCheckedJournal(old,next){
  const same=old.filter(x=>x.generation===next.generation),last=same.at(-1),latest=old.reduce((n,x)=>Math.max(n,x.generation),0);
  if(same.some(x=>x.phase===next.phase)){
    if(same.some(x=>x.phase===next.phase&&actualCanonical(x)===actualCanonical(next)))return old;
    fail('JOURNAL_EFFECT_CONFLICT');
  }
  if(next.phase==='BEFORE_AUTH'){
    const current=old.filter(x=>x.generation===latest).at(-1);
    if(next.generation!==latest+1||current&&!['COMPLETE','RESIDUAL','CLOSED'].includes(current.phase))fail('JOURNAL_SEQUENCE');
  }else if(!last||next.generation!==latest&&next.phase!=='CLOSED'
    ||next.phase==='BEFORE_OPEN'&&last.phase!=='BEFORE_AUTH'
    ||next.phase==='COMPLETE'&&last.phase!=='BEFORE_OPEN'
    ||next.phase==='CLOSED'&&!['COMPLETE','RESIDUAL'].includes(last.phase)
    ||next.phase==='RESIDUAL'&&!['BEFORE_AUTH','BEFORE_OPEN'].includes(last.phase))fail('JOURNAL_SEQUENCE');
  for(const field of ['authSessionId','capabilityHash']){
    const known=same.find(x=>x[field]!==null);
    if(next.phase==='CLOSED'&&!known||known&&next[field]!==known[field])fail('JOURNAL_BINDING_CONFLICT');
  }
  return [...old,next];
}
export function validateLoginJournal(previous){
  const data=copyActualData(previous);if(!Array.isArray(data)||data.length>actualLimits.loginEntries*4)fail('JOURNAL_CAPACITY');
  let verified=[];
  for(const raw of data){const next=appendCheckedJournal(verified,makeLoginJournalEntry(raw));if(next.length!==verified.length+1)fail('JOURNAL_DUPLICATE_FRAME');verified=next;}
  return Object.freeze(verified);
}
export function appendLoginJournal(previous,entry){
  const old=validateLoginJournal(previous),next=makeLoginJournalEntry(entry);
  if(old.length>=actualLimits.loginEntries*4)fail('JOURNAL_CAPACITY');
  return Object.freeze(appendCheckedJournal(old,next));
}
