import { instant } from './policy.mjs';
export function quoteAssessment(q,context,now){
  if(!q)return {quality:'MISSING',percentChange:null};
  const reasons=[];
  if(!Number.isFinite(context.maxAgeMs)||context.maxAgeMs<0)reasons.push('FRESHNESS_UNCONFIGURED');
  for(const field of ['instrumentId','venue','currency','sessionId','priceType','adjustment'])if(q[field]!==context[field])reasons.push('MISMATCH_'+field);
  if(q.sampleKind!=='PERMITTED_REAL'||q.permissionVerified!==true)reasons.push('NOT_REAL_APPROVED_QUOTE');
  if(!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.referencePrice)||q.referencePrice<=0)reasons.push('INVALID_PRICE');
  const t=instant(now),asOf=instant(q.asOf),received=instant(q.receivedAt);
  if(asOf>received||received>t||t-asOf>context.maxAgeMs)reasons.push('STALE_OR_FUTURE');
  return reasons.length?{quality:'UNAVAILABLE',percentChange:null,reasons}:{quality:'VERIFIED',percentChange:(q.price/q.referencePrice-1)*100};
}
export function coverageAssessment(quotes){const valid=quotes.filter(x=>x.quality==='VERIFIED');return {valid:valid.length,total:quotes.length,usable:quotes.length>0&&valid.length/quotes.length>=.7&&valid.length>=Math.min(3,quotes.length)};}
export function calendarForDay(bundle,market,date,now,{allowSynthetic=false}={}){
  if(!bundle||bundle.market!==market||bundle.timezone!==(market==='KRX'?'Asia/Seoul':'America/New_York')||!bundle.version||!bundle.evidenceId||instant(bundle.validUntil)<=instant(now)||bundle.permissionVerified!==true||bundle.sampleKind!=='PERMITTED_REAL'&&!allowSynthetic||date<bundle.coverageStart||date>bundle.coverageEnd)return 'UNKNOWN';
  const record=bundle.days.find(x=>x.date===date);if(!record)return 'UNKNOWN';
  if(record.closed===true)return null;
  if(!record.session||instant(record.session.opensAt)>=instant(record.session.closesAt)||record.session.tradingDayId!==date)return 'UNKNOWN';
  return record.session;
}
export function supplyBaseline(records,{sampleKind,unitPrice=null,currency=null}={}){
  const attempts=records.filter(x=>x.requests>0),successful=attempts.filter(x=>x.fieldsVerified===true&&x.status==='VERIFIED_SUPPLY');
  const latencies=attempts.filter(x=>Number.isFinite(x.latencyMs)).map(x=>x.latencyMs).sort((a,b)=>a-b);
  const percentile=p=>latencies.length?latencies[Math.ceil(p*latencies.length)-1]:null;
  const requests=attempts.reduce((n,x)=>n+x.requests,0),knownCost=unitPrice!==null&&Number.isFinite(unitPrice)&&unitPrice>=0&&currency;
  return {sampleKind,status:attempts.length?'OBSERVED':'NOT_MEASURED',attempted:attempts.length,requests,blocked:records.filter(x=>x.requests===0&&x.status==='BLOCKED').length,successful:successful.length,partial:attempts.filter(x=>x.status==='PARTIAL').length,successRate:attempts.length?successful.length/attempts.length:null,latency:{samples:latencies.length,p50:percentile(.5),p95:percentile(.95),max:latencies.at(-1)??null},cost:{status:attempts.length&&knownCost?'OBSERVED':'NOT_MEASURED',currency:knownCost?currency:null,unitPrice:knownCost?unitPrice:null,total:attempts.length&&knownCost?requests*unitPrice:null,perDiscovered:null,perPublished:null,reason:'ARTICLE_PIPELINE_NOT_MEASURED_STAGE_3'}};
}
