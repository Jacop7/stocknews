import type {CalendarSupply,VerifiedQuote} from '@judoju/contracts';

export type Venue='KRX'|'NYSE'|'NASDAQ';
export interface Instrument {instrumentId:string;venue:Venue;currency:'KRW'|'USD';code:string;}
export interface Member {companyId:string;instrumentId:string|null;}
export interface QuotePair extends VerifiedQuote {
 referenceSessionId:string;referenceAsOf:string;referenceAdjustment:VerifiedQuote['adjustment'];
 adjustmentVersion:string;referenceAdjustmentVersion:string;
 corporateActionStatus:'NONE_OR_REFLECTED'|'UNKNOWN';corporateActionVersion:string;
}
export interface MetricsInput {
 mode:'LOCAL_SYNTHETIC';sampleKind:'SYNTHETIC';asOf:string;period:string;groupMarket:'KR'|'FOREIGN_US';
 masterVersion:string;compositionVersion:string;instruments:readonly Instrument[];members:readonly Member[];
 calendars:readonly CalendarSupply[];quotes:readonly QuotePair[];
 policy:{version:string;lastMaxAgeMs:number};
}
interface Session {tradingDayId:string;opensAt:string;closesAt:string;}
interface Selection {current:Session;reference:Session;priceType:'LAST'|'CLOSE';calendarVersion:string;}
export interface MemberResult {
 instrumentId:string|null;companyIds:string[];status:string;returnPct:number|null;
 tradingDay?:string;referenceDay?:string;priceType?:'LAST'|'CLOSE';priceAsOf?:string;
 calendarVersion?:string;adjustment?:string;adjustmentVersion?:string;corporateActionVersion?:string;
}
export interface MetricsResult {
 status:string;sampleKind:'SYNTHETIC';asOf:string;period:string;returnPct:number|null;
 memberCount:number;validCount:number;coverage:number;representativeCompanyBasis:boolean;
 masterVersion:string;compositionVersion:string;policyVersion:string;members:MemberResult[];
}
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=160;
function dateOk(d:string):boolean {
 return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
}
function instant(s:unknown):number {
 if(typeof s!=='string')return NaN;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(s);
 if(!m||!dateOk(m[1])||Number(m[2])>23||Number(m[3])>59||Number(m[4])>59)return NaN;
 if(m[5]!=='Z'&&(Number(m[5].slice(1,3))>14||Number(m[5].slice(4))>59||Number(m[5].slice(1,3))===14&&m[5].slice(4)!=='00'))return NaN;
 return Date.parse(s);
}
function localDate(ms:number,zone:string):string {
 const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 return ['year','month','day'].map(k=>p.find(x=>x.type===k)!.value).join('-');
}
const previousDate=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
export const regularSessionId=(venue:Venue,day:string)=>venue+':'+day+':REGULAR';

function selectSessions(venue:Venue,calendars:readonly CalendarSupply[],now:number):Selection|null {
 const matches=calendars.filter(c=>c.market===venue);if(matches.length!==1)return null;
 const c=matches[0],zone=venue==='KRX'?'Asia/Seoul':'America/New_York',today=localDate(now,zone);
 if(c.timezone!==zone||!text(c.version)||!text(c.evidenceId)||!dateOk(c.coverageStart)||!dateOk(c.coverageEnd)||c.coverageStart>c.coverageEnd||today<c.coverageStart||today>c.coverageEnd||!(instant(c.validUntil)>now))return null;
 const days=new Map<string,CalendarSupply['days'][number]>();
 for(const d of c.days){
  if(!dateOk(d.date)||d.date<c.coverageStart||d.date>c.coverageEnd||days.has(d.date)||typeof d.closed!=='boolean'||d.closed&&d.session!==null||!d.closed&&!d.session)return null;
  if(d.session){
   const s=d.session,o=instant(s.opensAt),e=instant(s.closesAt);
   if(s.tradingDayId!==d.date||!Number.isFinite(o)||!Number.isFinite(e)||o>=e||localDate(o,zone)!==d.date||localDate(e,zone)!==d.date)return null;
  }
  days.set(d.date,d);
 }
 const todayRow=days.get(today);if(!todayRow)return null;
 const current=todayRow.session;
 const intraday=current!==null&&instant(current.opensAt)<=now&&now<instant(current.closesAt);
 const completed:Session[]=[];
 for(let n=0;n<=14;n++){
  const day=previousDate(today,n);if(day<c.coverageStart)return null;
  const d=days.get(day);if(!d)return null;
  if(d.session&&instant(d.session.closesAt)<=now)completed.push(d.session);
  if(completed.length===(intraday?1:2))break;
 }
 if(intraday)return completed.length>=1?{current:current!,reference:completed[0],priceType:'LAST',calendarVersion:c.version}:null;
 return completed.length>=2?{current:completed[0],reference:completed[1],priceType:'CLOSE',calendarVersion:c.version}:null;
}

function metric(instrument:Instrument,companyIds:string[],input:MetricsInput,now:number):MemberResult {
 const fail=(status:string):MemberResult=>({instrumentId:instrument.instrumentId,companyIds,status,returnPct:null});
 if((input.groupMarket==='KR')!==(instrument.venue==='KRX'))return fail('WRONG_GROUP_MARKET');
 const s=selectSessions(instrument.venue,input.calendars,now);if(!s)return fail('CALENDAR_UNAVAILABLE');
 const candidates=input.quotes.filter(q=>q.instrumentId===instrument.instrumentId&&q.sessionId===regularSessionId(instrument.venue,s.current.tradingDayId));
 if(!candidates.length)return fail('QUOTE_UNAVAILABLE');
 if(candidates.some(q=>!Number.isFinite(instant(q.asOf))))return fail('INVALID_QUOTE_TIME');
 const latest=Math.max(...candidates.map(q=>instant(q.asOf))),records=candidates.filter(q=>instant(q.asOf)===latest);
 const canonical=(v:unknown)=>typeof v==='number'&&!Number.isFinite(v)?{nonFinite:String(v)}:v===undefined?{undefined:true}:v;
 const economic=(q:QuotePair)=>JSON.stringify([q.price,q.referencePrice,q.venue,q.currency,q.priceType,q.referenceSessionId,instant(q.referenceAsOf),q.adjustment,q.referenceAdjustment,q.adjustmentVersion,q.referenceAdjustmentVersion,q.corporateActionStatus,q.corporateActionVersion].map(canonical));
 if(new Set(records.map(economic)).size!==1)return fail('CONFLICT');
 if(records.some(q=>!Number.isFinite(instant(q.receivedAt))||instant(q.receivedAt)<instant(q.asOf)||instant(q.receivedAt)>now))return fail('INVALID_QUOTE_TIME');
 const q=[...records].sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt))[0],at=instant(q.asOf),received=instant(q.receivedAt);
 if(q.venue!==instrument.venue||q.currency!==instrument.currency||q.priceType!==s.priceType||q.referenceSessionId!==regularSessionId(instrument.venue,s.reference.tradingDayId))return fail('QUOTE_BASIS_MISMATCH');
 if(received<at||received>now||at>now||instant(q.referenceAsOf)!==instant(s.reference.closesAt))return fail('INVALID_QUOTE_TIME');
 if(s.priceType==='LAST'&&(at<instant(s.current.opensAt)||at>=instant(s.current.closesAt)||now-at>input.policy.lastMaxAgeMs))return fail('STALE_OR_OUTSIDE_SESSION');
 if(s.priceType==='CLOSE'&&at!==instant(s.current.closesAt))return fail('INVALID_CLOSE_TIME');
 if(!['RAW','SPLIT','TOTAL_RETURN'].includes(q.adjustment)||q.adjustment!==q.referenceAdjustment||!text(q.adjustmentVersion)||q.adjustmentVersion!==q.referenceAdjustmentVersion||q.corporateActionStatus!=='NONE_OR_REFLECTED'||!text(q.corporateActionVersion))return fail('ADJUSTMENT_UNAVAILABLE');
 if(typeof q.price!=='number'||!Number.isFinite(q.price)||q.price<=0||typeof q.referencePrice!=='number'||!Number.isFinite(q.referencePrice)||q.referencePrice<=0)return fail('INVALID_PRICE');
 const value=(q.price/q.referencePrice-1)*100;if(!Number.isFinite(value))return fail('INVALID_PRICE');
 return {instrumentId:instrument.instrumentId,companyIds,status:'AVAILABLE',returnPct:value,tradingDay:s.current.tradingDayId,referenceDay:s.reference.tradingDayId,priceType:s.priceType,priceAsOf:q.asOf,calendarVersion:s.calendarVersion,adjustment:q.adjustment,adjustmentVersion:q.adjustmentVersion,corporateActionVersion:q.corporateActionVersion};
}

/** Dormant, local SYNTHETIC calculator; no application/API/provider caller yet. */
export function calculateSectorMetrics(input:MetricsInput):MetricsResult {
 const result:MetricsResult={status:'INVALID_INPUT',sampleKind:'SYNTHETIC',asOf:input.asOf,period:input.period,returnPct:null,memberCount:0,validCount:0,coverage:0,representativeCompanyBasis:false,masterVersion:input.masterVersion,compositionVersion:input.compositionVersion,policyVersion:input.policy?.version,members:[]};
 if(input.mode!=='LOCAL_SYNTHETIC'||input.sampleKind!=='SYNTHETIC'||input.quotes.some(q=>q.sampleKind!=='SYNTHETIC')||input.calendars.some(c=>c.sampleKind!=='SYNTHETIC'))return {...result,status:'LIVE_SUPPLY_NOT_ENABLED'};
 if(input.period!=='TODAY')return {...result,status:'PERIOD_UNSUPPORTED'};
 const now=instant(input.asOf);
 if(!Number.isFinite(now)||!['KR','FOREIGN_US'].includes(input.groupMarket)||!text(input.masterVersion)||!text(input.compositionVersion)||!text(input.policy?.version)||!Number.isFinite(input.policy.lastMaxAgeMs)||input.policy.lastMaxAgeMs<=0||input.policy.lastMaxAgeMs>120000)return result;
 const master=new Map<string,Instrument>(),listings=new Map<string,string>();
 for(const i of input.instruments){
  if(!text(i.instrumentId)||!['KRX','NYSE','NASDAQ'].includes(i.venue)||i.currency!==(i.venue==='KRX'?'KRW':'USD')||typeof i.code!=='string'||!(i.venue==='KRX'?/^\d{6}$/:/^[A-Z0-9][A-Z0-9.-]{0,14}$/).test(i.code))return result;
  const prior=master.get(i.instrumentId);if(prior&&JSON.stringify([prior.venue,prior.currency,prior.code])!==JSON.stringify([i.venue,i.currency,i.code]))return result;
  const listing=i.venue+':'+i.code;if(listings.has(listing)&&listings.get(listing)!==i.instrumentId)return result;listings.set(listing,i.instrumentId);
  master.set(i.instrumentId,i);
 }
 const companies=new Map<string,string|null>(),groups=new Map<string,{instrumentId:string|null;companyIds:string[]}>();
 for(const m of input.members){
  if(!text(m.companyId)||m.instrumentId!==null&&!text(m.instrumentId)||companies.has(m.companyId)&&companies.get(m.companyId)!==m.instrumentId)return result;
  if(companies.has(m.companyId))continue;companies.set(m.companyId,m.instrumentId);
  const key=m.instrumentId&&master.has(m.instrumentId)?'instrument:'+m.instrumentId:'company:'+m.companyId;
  const group=groups.get(key)??{instrumentId:m.instrumentId,companyIds:[]};group.companyIds.push(m.companyId);groups.set(key,group);
 }
 result.members=[...groups.values()].map(g=>g.instrumentId&&master.has(g.instrumentId)?metric(master.get(g.instrumentId)!,g.companyIds,input,now):{...g,status:'INSTRUMENT_UNMAPPED',returnPct:null});
 result.memberCount=result.members.length;const valid=result.members.filter(m=>m.status==='AVAILABLE');result.validCount=valid.length;
 result.coverage=result.memberCount?result.validCount/result.memberCount:0;result.representativeCompanyBasis=result.memberCount>0&&result.memberCount<3;
 if(result.memberCount===0)return {...result,status:'NO_MEMBERS'};
 if(valid.length<Math.ceil(result.memberCount*.7)||valid.length<Math.min(3,result.memberCount))return {...result,status:'INSUFFICIENT_COVERAGE'};
 if(new Set(valid.map(v=>JSON.stringify([v.tradingDay,v.referenceDay,v.priceType,v.adjustment,v.adjustmentVersion,v.corporateActionVersion]))).size!==1)return {...result,status:'MIXED_COMPARISON_BASIS'};
 const mean=valid.reduce((sum,v)=>sum+v.returnPct!/valid.length,0);
 return Number.isFinite(mean)?{...result,status:'AVAILABLE',returnPct:mean}:{...result,status:'INVALID_AGGREGATE'};
}
