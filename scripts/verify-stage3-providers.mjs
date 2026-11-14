import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { probe } from './providers/probe.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p).toString('utf8'));
const digest=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en'))):v);
let checks=0;const check=(ok,msg)=>{assert.ok(ok,msg);checks++;};
const original=json('data/providers/approved-registry.json'),{routes,endpoints}=json('data/providers/routes.json'),{profiles}=json('data/providers/permission-profiles.json');
check(original.original_sha256==='e3c73be287b9a4eedf11218da402eef6346979cee3e22d3f87a338c6fea407fa'&&original.original_bytes===25821,'Frozen original pointer');
check(original.rows_canonical_sha256==='56892655472db18bbd8dcabca018df9fc8a28a30a38449e74e6ef93f9f60ee41'&&digest(canonical(original.sources))===original.rows_canonical_sha256,'All original row fields/order/URL bytes');
check(!JSON.stringify(original).includes('docs.google.com')&&!('sheet'in original)&&original.source_locator==='approved-source-registry/2026-11-13','Logical locator replaces original sheet metadata only');
check(original.sources.length===106&&original.sources.reduce((n,x)=>n+x.urls.length,0)===112,'106 rows /112 original URL associations');
check(routes.length===106&&endpoints.length===112&&profiles.length===112,'Complete endpoint registration');
const endpointIds=new Set(endpoints.map(e=>e.endpoint_id));check(endpointIds.size===endpoints.length,'Unique endpoint identities');
for(const s of original.sources){const r=routes.find(x=>x.original_row===s.row);check(r?.source_id===`S${String(s.row).padStart(3,'0')}`&&r.market===s.market&&r.source_type===s.type,'Original row relation');assert.deepEqual(r.endpoint_ids.map(id=>endpoints.find(e=>e.endpoint_id===id)?.url),s.urls);checks++;check(r.independence_status==='UNRESOLVED'&&!!r.origin_resolution_rule&&!!r.schedule_class,'No invented independence');}
const required=['endpoint_id','publisher_id','owner_group_id','origin_group_id','url','navigation_path','tab_recipe','enabled_scopes','permission_profile_id','permission_profile_version','adapter_version','checkpoint','overlap_window_minutes','correction_watch','max_rps','timeout_ms','concurrency','health_state'];
let called=0;
for(const e of endpoints){for(const f of required)check(Object.hasOwn(e,f),'Required registry field '+f);check(e.status==='RIGHTS_HOLD'&&e.enabled_scopes.length===0,'No unapproved active routes');const p=profiles.find(p=>p.id===e.permission_profile_id);check(p?.endpoint_id===e.endpoint_id&&p.version===e.permission_profile_version&&p.status==='UNVERIFIED','Purpose-specific profile binding');const result=await probe({endpoint:e,profile:p,execute:true,transport:async()=>{called++;throw new Error('Must never call');}});check(result.requests===0&&result.status==='BLOCKED','Unverified transport blocked');}
check(called===0,'All112 unverified endpoints made zero transport calls');
for(const p of json('data/providers/supplemental-paths.json').paths)check(p.enabled===false&&p.status==='RIGHTS_HOLD'&&p.max_requests===0,'Supplemental search/official/quote path disabled');
const qa=json('data/providers/acceptance-map.json');assert.deepEqual(qa.cases.map(x=>x.id),['A34','A35','A36','A37','A38','A43','A48','A52','A53','A54','U06']);checks++;
const tests=read('tests/providers.test.mjs').toString('utf8');for(const c of qa.cases)check(c.external_status==='EXTERNAL_PENDING'&&c.sample_kind==='SYNTHETIC'&&tests.includes(`test('${c.id}:`),'Acceptance cases mapped to tests and pending real supply');
const coverage=json('data/providers/supply-coverage.json'),status=json('docs/development-status.json');check(coverage.real_requests_executed===0&&coverage.live_approved_routes===0&&coverage.stage7_live_gate==='CLOSED'&&coverage.stage8_live_gate==='CLOSED','No live supply success');check(status.state==='IMPLEMENTED_SUPPLY_PENDING'&&status.supplyTrack.m1IndependentStages.join(',')==='4,5,6','M1 independence without completed supply');
check(json('data/providers/baseline.json').status==='NOT_MEASURED'&&json('data/providers/baseline.json').success_rate===null,'No fabricated baseline');
check(json('data/providers/label-fixtures.json').sample_kind==='SYNTHETIC'&&json('data/providers/label-fixtures.json').publishable===false,'Synthetic labels never live evidence');
console.log(JSON.stringify({status:'PASS',stage:3,checks,originalRows:106,originalUrls:112,unapprovedTransportCalls:called,supplyState:'IMPLEMENTED_SUPPLY_PENDING',limitations:'Local contracts and synthetic boundary checks only; real permissions, quote/calendar supply and live publication not verified.'},null,2));
