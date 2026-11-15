import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoveryPlan,listingResult,reportDecision,configChangeDecision,shadowEligible,recoveryDecision,intervalMinutes,systemicMacroDecision,normalizeArticleUrl } from '../scripts/providers/policy.mjs';
import { probe,publicAddress } from '../scripts/providers/probe.mjs';
import { createProbeBudget } from '../scripts/providers/budget.mjs';
import { calendarForDay,quoteAssessment,coverageAssessment,supplyBaseline } from '../scripts/providers/market.mjs';
const time='2026-11-14T00:00:00Z';
const endpoint={endpoint_id:'TEST',permission_profile_id:'PTEST',permission_profile_version:'1',status:'TECH_TEST',url:'https://news.example/article?id=1'};
const profile={id:'PTEST',version:'1',endpoint_id:'TEST',status:'VERIFIED',evidence:['SYNTHETIC_TEST_ONLY'],verified_at:'2026-11-13T00:00:00Z',expires_at:'2026-11-15T00:00:00Z',purposes:Object.fromEntries(['DISCOVERY','MACHINE_ACCESS','LINK_EXTRACTION','QUERY_TERMS'].map(x=>[x,'ALLOW'])),allowed_hosts:['news.example'],methods:['GET'],max_requests:3,max_bytes:1024,timeout_ms:1000};
const input={endpoint,profile,now:time};
const json=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
test('A34: report paths have explicit combined/company-only/bot scopes',()=>{
 const r=json('data/providers/routes.json').routes;
 assert.equal(r.find(x=>x.original_row===64).content_filter,'COMPANY_AND_INDUSTRY');
 assert.equal(reportDecision(r.find(x=>x.original_row===67),'INDUSTRY'),'PASS');
 assert.equal(reportDecision(r.find(x=>x.original_row===16),'COMPANY'),'BOT_ADAPTER_REQUIRED');
});
test('A35: wrong single-URL tab cannot overwrite checkpoint',()=>assert.deepEqual(listingResult({tabVerified:false,previousCheckpoint:'before',nextCheckpoint:'wrong'}),{status:'FAILED',checkpoint:'before',reason:'TAB_UNVERIFIED'}));
test('A36: truncated pages and partial failures preserve checkpoint and gap',()=>{
 for(const part of [{complete:false,atLimit:false},{complete:true,atLimit:true}])assert.deepEqual(listingResult({...part,tabVerified:true,previousCheckpoint:'before',nextCheckpoint:'after',missingRange:'range'}),{status:'PARTIAL',checkpoint:'before',missingRange:'range'});
});
test('A37: calendar coverage/expiry/closed/early sessions and synthetic separation',()=>{
 const b={market:'NYSE',timezone:'America/New_York',version:'synth1',evidenceId:'SYNTHETIC',permissionVerified:true,sampleKind:'SYNTHETIC',validUntil:'2027-01-01',coverageStart:'2026-01-01',coverageEnd:'2026-12-31',days:[{date:'2026-11-14',closed:true},{date:'2026-11-27',session:{tradingDayId:'2026-11-27',opensAt:'2026-11-27T14:30:00Z',closesAt:'2026-11-27T18:00:00Z'}}]};
 assert.equal(calendarForDay(b,'NYSE','2026-11-14',time),'UNKNOWN');assert.equal(calendarForDay(b,'NYSE','2026-11-14',time,{allowSynthetic:true}),null);
 assert.equal(calendarForDay(b,'NYSE','2026-11-27',time,{allowSynthetic:true}).closesAt,'2026-11-27T18:00:00Z');
 assert.equal(calendarForDay(b,'NYSE','2027-01-02',time,{allowSynthetic:true}),'UNKNOWN');
 assert.equal(calendarForDay(b,'NYSE','2026-11-14','2027-01-01',{allowSynthetic:true}),'UNKNOWN');
});
test('A38: public access with unknown purpose invokes zero transport requests',async()=>{
 let calls=0;const result=await probe({endpoint,profile:{...profile,purposes:{...profile.purposes,DISCOVERY:'UNKNOWN'}},execute:true,now:()=>time,transport:async()=>{calls++;throw new Error('MUST_NOT_CALL');}});assert.equal(calls,0);assert.equal(result.requests,0);assert.equal(result.status,'BLOCKED');
});
test('A43: new and quality paths cannot use availability resume shortcut',()=>{
 const base={state:'PAUSED_ERROR',pausedAt:'2026-11-13T23:40Z',resumeState:'ACTIVE',permissionValid:true,versionsUnchanged:true,fieldsValid:true,healthyChecks:['2026-11-13T23:50Z','2026-11-13T23:55Z']};
 assert.equal(recoveryDecision({...base,isNew:true},time).state,'TECH_TEST');assert.equal(recoveryDecision({...base,state:'SHADOW',techVerified:true,isNew:true},time).state,'SHADOW');assert.equal(recoveryDecision({...base,qualityIssue:true},time).state,'SHADOW');assert.equal(recoveryDecision({...base,versionsChanged:true},time).state,'TECH_TEST');
 assert.equal(recoveryDecision({...base,explicitAuthOrPayment:true},time).action,'NO_AUTO_PROBE');
 assert.equal(recoveryDecision({...base,retryAfter:'2026-11-15',healthyChecks:[],pausedAt:time,reprobeCount:0,fastRetryCount:0},time).action,'WAIT');
 assert.equal(shadowEligible({tradingDays:5,successfulLists:10,attemptedLists:11,permittedBodies:1,unresolvedCritical:0}),false);
 assert.equal(shadowEligible({tradingDays:5,successfulLists:20,attemptedLists:21,permittedBodies:1,unresolvedCritical:0}),true);
});
test('A48: original pagination URL is preserved and first page remains unverified',()=>{
 const r=json('data/providers/routes.json'),original=json('data/providers/approved-registry.json');
 for(const u of original.sources.find(x=>x.row===65).urls)assert.ok(r.endpoints.some(x=>x.url===u&&x.blocked_reasons.includes('ENDPOINT_UNVERIFIED')));
 assert.equal(r.routes.find(x=>x.original_row===16).effective_kind,'REPORT_BOT');
});
test('A52: unchanged ACTIVE resumes after two checks >=5min, low frequency stops at14days',()=>{
 const s={state:'PAUSED_ERROR',pausedAt:'2026-11-13T23:40Z',resumeState:'ACTIVE',permissionValid:true,versionsUnchanged:true,fieldsValid:true,healthyChecks:['2026-11-13T23:50Z','2026-11-13T23:55Z']};
 assert.deepEqual(recoveryDecision(s,time),{state:'ACTIVE',action:'RESUME'});
 for(const days of [20/1440,2])assert.equal(recoveryDecision({...s,pausedAt:new Date(Date.parse(time)-days*86400000).toISOString()},time).state,'ACTIVE');
 assert.equal(recoveryDecision({state:'PAUSED_ERROR',permissionValid:true,versionsUnchanged:true,lowFrequencySince:'2026-10-31',healthyChecks:[]},time).state,'DISABLED');
 assert.equal(recoveryDecision({...s,permissionValid:false},time).state,'RIGHTS_HOLD');
 assert.notEqual(recoveryDecision({...s,pausedAt:time,fastRetryCount:0},time).action,'RESUME');
});
test('A53: independent3 without authorityID can compare under MACRO_ALL lock',()=>{
 const x={independentOrigins:['a','b','c'].map(id=>({originGroupId:id,newsroomId:'newsroom-'+id,ownerGroupId:'owner-'+id,originVerified:true,newsroomVerified:true,ownerGroupVerified:true})),koreaPathVerified:true,current:true,storyLockAcquired:true};
 assert.equal(systemicMacroDecision(x),'COMPARE_EXISTING_ISSUE');assert.equal(systemicMacroDecision({...x,storyLockAcquired:false}),'REQUIRES_MACRO_ALL_LOCK');assert.equal(systemicMacroDecision({...x,independentOrigins:[x.independentOrigins[0],x.independentOrigins[0]]}),'HOLD');
});
test('Review C01: per-operation override cannot omit mandatory machine access',async()=>{
 let called=0;
 for(const purposes of [['DISCOVERY'],['ORIGINAL_ACCESS'],[],['MACHINE_ACCESS']]){
  const r=await probe({endpoint,profile:{...profile,purposes:{...profile.purposes,ORIGINAL_ACCESS:'ALLOW',MACHINE_ACCESS:'DENY'}},purposes,execute:true,now:()=>time,transport:async()=>{called++;throw new Error('must not call');}});
  assert.equal(r.status,'BLOCKED');assert.equal(r.requests,0);
 }
 assert.equal(called,0);
});
test('Review C02: repeated owner/newsroom/origin and unknown group facts never count as independent3',()=>{
 const origins=['a','b','c'].map(id=>({originGroupId:id,newsroomId:id,ownerGroupId:id,originVerified:true,newsroomVerified:true,ownerGroupVerified:true}));
 const decide=independentOrigins=>systemicMacroDecision({independentOrigins,koreaPathVerified:true,current:true,storyLockAcquired:true});
 for(const key of ['originGroupId','newsroomId','ownerGroupId'])assert.equal(decide(origins.map(x=>({...x,[key]:'same'}))),'HOLD');
 for(const key of ['originVerified','newsroomVerified','ownerGroupVerified'])assert.equal(decide(origins.map(x=>({...x,[key]:false}))),'HOLD');
 assert.equal(decide(origins.map(({ownerGroupId,...x})=>x)),'HOLD');assert.equal(decide(origins),'COMPARE_EXISTING_ISSUE');
});
test('Review C03/C04: low-frequency window begins at first allowed reprobe; disabled remains terminal',()=>{
 const s={state:'PAUSED_RATE_LIMIT',permissionValid:true,versionsUnchanged:true,pausedAt:time,lastProbeAt:time,reprobeCount:3,retryAfter:'2026-11-29T00:00:00Z'};
 const first=recoveryDecision(s,time);assert.equal(first.since,'2026-11-29T00:00:00.000Z');assert.equal(first.action,'ENTER_LOW_FREQUENCY');
 const low={...s,lowFrequencySince:first.since};assert.equal(recoveryDecision(low,'2026-11-28T00:00:00Z').action,'WAIT');assert.equal(recoveryDecision(low,'2026-11-29T00:00:00Z').action,'PROBE_ONCE');assert.equal(recoveryDecision(low,'2026-12-13T00:00:00Z').state,'DISABLED');
 for(const extra of [{},{resumeState:'ACTIVE',healthyChecks:['2026-11-13T23:50Z','2026-11-13T23:55Z'],fieldsValid:true},{isNew:true,versionsChanged:true}])assert.deepEqual(recoveryDecision({...s,...extra,state:'DISABLED'},time),{state:'DISABLED',action:'STOP'});
});
test('Review retry counters: fast retries and episode reprobes keep separate 1/5/15 and 1/6/24 phases',()=>{
 const base={state:'PAUSED_ERROR',permissionValid:true,versionsUnchanged:true,pausedAt:time,lastProbeAt:time};
 for(const [n,minutes] of [1,5,15].entries())assert.equal(Date.parse(recoveryDecision({...base,fastRetryCount:n},time).nextAt)-Date.parse(time),minutes*60000);
 for(const [n,hours] of [1,6,24].entries()){
  assert.equal(Date.parse(recoveryDecision({...base,fastRetryCount:3,reprobeCount:n},time).nextAt)-Date.parse(time),hours*3600000);
  assert.equal(Date.parse(recoveryDecision({...base,state:'PAUSED_ACCESS',reprobeCount:n},time).nextAt)-Date.parse(time),hours*3600000);
 }
 assert.equal(recoveryDecision({...base,versionsUnchanged:false},time).action,'NO_AUTO_PROBE');
 assert.equal(intervalMinutes('GLOBAL','2026-07-01T12:30Z',{usSession:{opensAt:'2026-07-01T13:30Z',closesAt:'2026-07-01T20:00Z'}}),5);
});
test('A54: schedules have half-open KR boundaries, weekend and US-session inputs',()=>{
 for(const [t,n] of [['2026-11-13T20:59:59Z',15],['2026-11-13T21:00Z',5],['2026-11-14T00:00Z',2],['2026-11-14T06:30Z',5],['2026-11-14T11:00Z',15]])assert.equal(intervalMinutes('N_STOCK',t,{koreanTradingDay:true}),n);
 assert.equal(intervalMinutes('N_STOCK',time,{koreanTradingDay:false}),15);assert.equal(intervalMinutes('N_DISCOVERY',time,{koreanTradingDay:false}),30);
 assert.equal(intervalMinutes('GLOBAL',time,{koreanTradingDay:true,usSession:'UNKNOWN'}),null);
 assert.equal(intervalMinutes('GLOBAL','2026-07-01T12:30Z',{koreanTradingDay:true,usSession:{opensAt:'2026-07-01T13:30Z',closesAt:'2026-07-01T20:00Z'}}),5);
});
test('U06: new paths cannot inherit ACTIVE keyword next-cycle change',()=>{
 assert.equal(configChangeDecision({status:'ACTIVE',newEndpoint:true}).nextState,'RIGHTS_HOLD');assert.equal(configChangeDecision({status:'ACTIVE'}).action,'NEXT_CYCLE');
});
test('Telegram links precede search; query fallback never publishes or forwards full text',()=>{
 assert.equal(discoveryPlan({...input,links:['https://news.example/a?utm_source=tg&id=1'],catalogTerms:['HBM']}).action,'RESOLVE_LINKS');
 const r=discoveryPlan({...input,links:['https://news.example/a'],linksResolved:true,catalogTerms:['HBM','기업']});assert.equal(r.action,'SEARCH_ORIGINAL');assert.equal(r.canPublish,false);
 assert.equal(discoveryPlan({...input,catalogTerms:['message\nbody']}).action,'HOLD');assert.equal(discoveryPlan({...input,originalFound:true}).canPublish,false);
 assert.equal(normalizeArticleUrl('https://news.example/a?id=1&page=2&utm_source=tg#x'),'https://news.example/a?id=1&page=2');
});
test('Probe dry run/private DNS/redirect/body/permission expiry and shared budget fail closed',async()=>{
 let calls=0;const transport=async()=>{calls++;return {status:200,body:Buffer.from('ok')};},lookupHost=async()=>[{address:'8.8.8.8'}];
 const base={endpoint,profile,now:()=>time,transport,lookupHost};
 assert.equal((await probe(base)).status,'DRY_RUN');assert.equal(calls,0);
 assert.equal((await probe({...base,execute:true,lookupHost:async()=>[{address:'127.0.0.1'}]})).reason,'NON_PUBLIC_DNS');assert.equal(calls,0);
 const budget=createProbeBudget({maxRequests:1});assert.equal((await probe({...base,execute:true,budget})).status,'HTTP_OK_UNPARSED');assert.equal((await probe({...base,execute:true,budget})).reason,'REQUEST_BUDGET_EXHAUSTED');
 const redirect=await probe({...base,execute:true,transport:async()=>({status:302,location:'https://169.254.169.254/',body:Buffer.alloc(0)})});assert.equal(redirect.reason,'HOST_NOT_ALLOWED');
 assert.equal((await probe({...base,execute:true,transport:async()=>({status:200,body:Buffer.alloc(1025)})})).reason,'RESPONSE_TOO_LARGE');
 assert.equal((await probe({...base,execute:true,now:()=> '2026-11-15'})).reason,'RIGHTS_EXPIRED');
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','fc00::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
});
test('Synthetic quotes cannot pass real quote quality; coverage rejects missing returns',()=>{
 const c={instrumentId:'KR000000',venue:'KRX',currency:'KRW',sessionId:'D',priceType:'CLOSE',adjustment:'SPLIT',maxAgeMs:600000};const q={...c,sampleKind:'SYNTHETIC',permissionVerified:true,price:110,referencePrice:100,asOf:time,receivedAt:time};
 assert.equal(quoteAssessment(q,c,time).percentChange,null);assert.equal(coverageAssessment([{quality:'VERIFIED'},{quality:'MISSING'}]).usable,false);
});
test('No real attempts means NOT_MEASURED not zero latency/free or successful supply',()=>{
 const b=supplyBaseline([{requests:0,status:'BLOCKED'}],{sampleKind:'PERMITTED_REAL'});assert.equal(b.status,'NOT_MEASURED');assert.equal(b.successRate,null);assert.equal(b.latency.max,null);assert.equal(b.cost.total,null);
});
test('Shared probe budget aggregates host requests and enforces one in-flight per host',async()=>{
 const b=createProbeBudget({maxRequests:3,hostLimits:{'news.example':1}}),release=b.acquire('news.example');assert.equal(b.acquire('news.example'),null);assert.equal(b.consume('news.example'),true);release();assert.equal(b.consume('news.example'),false);assert.equal(b.snapshot().active,0);
 const result=await probe({endpoint,profile,now:()=>time,execute:true,lookupHost:async()=>new Promise(()=>{}),limits:{timeoutMs:10,maxBytes:100,maxHops:1}});assert.equal(result.reason,'REQUEST_TIMEOUT');assert.equal(result.requests,0);
});
