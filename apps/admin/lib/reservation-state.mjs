const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const shape=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(',');
export function reservationInput(action,a){
 if(action==='create')return shape(a,'p_issue,p_draft_revision,p_issue_revision,p_policy,p_catalog,p_due_at,p_request')&&uuid(a.p_issue)&&uuid(a.p_request)&&integer(a.p_draft_revision)&&integer(a.p_issue_revision)&&integer(a.p_policy)&&a.p_policy>0&&integer(a.p_catalog)&&a.p_catalog>0&&typeof a.p_due_at==='string'&&a.p_due_at.length<=50&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(a.p_due_at)&&Number.isFinite(Date.parse(a.p_due_at));
 if(action==='cancel')return shape(a,'p_schedule,p_revision,p_request')&&uuid(a.p_schedule)&&uuid(a.p_request)&&integer(a.p_revision)&&a.p_revision>0;
 return action==='configure'&&shape(a,'p_enabled')&&typeof a.p_enabled==='boolean';
}
export function parseReservationIntent(text){
 const v=JSON.parse(text);if(v===null)return null;
 if(!shape(v,'action,args,owner')||typeof v.owner!=='string'||!/^[0-9a-f]{64}$/.test(v.owner)||!['create','cancel'].includes(v.action)||!reservationInput(v.action,v.args))throw Error('INVALID_SAVED_RESERVATION_REQUEST');return v;
}
export function kstReservationInput(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))throw Error('한국시각 날짜와 시간을 입력해 주세요.');
 const iso=value+':00+09:00',at=new Date(iso);if(!Number.isFinite(at.getTime())||new Date(at.getTime()+9*3600000).toISOString().slice(0,16)!==value)throw Error('유효한 한국시각이 아닙니다.');return iso;
}
