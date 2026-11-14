import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localClient } from './m0-test-client.mjs';
import { writePrivate } from './local-runtime.mjs';
const {sql,rpc,request,jwt,quote:q}=localClient(),run=randomUUID(),cases=[],sector=randomUUID(),other=randomUUID(),issues=[];
// Legacy M0 publication is now a local service-fixture endpoint; real editor authorization is exercised by M1 tests.
const admin=undefined,activePolicy=Number(sql('select version from private.policies where active;'));
async function test(name,fn){const t=Date.now();try{await fn();cases.push({name,status:'PASS',durationMs:Date.now()-t});console.log(JSON.stringify(cases.at(-1)));}catch(e){cases.push({name,status:'FAIL',error:e.message});throw e;}}
async function ok(name,args={},opts={}){const r=await rpc(name,args,opts);assert.equal(r.status,200,name+' failed ('+(r.body?.message??r.body?.code??'unknown')+')');return r.body;}
async function denied(name,args,pattern,opts={}){const r=await rpc(name,args,opts);assert.ok(r.status>=400,name+' must fail');if(pattern)assert.match(r.body?.message??'',pattern);return r;}
sql('insert into private.sectors(id,name,catalog_version,sample_kind) values ('+q(sector)+',\'SYNTHETIC M0 '+run+"',1,'SYNTHETIC'),("+q(other)+",'SYNTHETIC M0 other',1,'SYNTHETIC');");
function fixture({macro=false,official=true,real=false}={}){
  const issue=randomUUID(),story=randomUUID(),claim=randomUUID();issues.push(issue);
  sql('insert into private.stories(id,event_key) values ('+q(story)+','+q(run+':'+story)+'); insert into private.issues(id,story_id,angle_key,primary_sector_id,sample_kind) values ('+q(issue)+','+q(story)+",'SYNTHETIC',"+q(sector)+','+q(real?'PERMITTED_REAL':'SYNTHETIC')+'); insert into private.claims(id,issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,sample_kind) values ('+q(claim)+','+q(issue)+','+q(macro?'SYSTEMIC_MACRO':'ORDINARY_FACT')+',true,true,'+official+",true,'SYNTHETIC');");
  return {issue,claim};
}
const pos={direction:'POSITIVE',title:'합성 긍정 조건',expected_result:'합성 결과',checks:['합성 확인']},neg={...pos,direction:'NEGATIVE'};
const base={key_issues:['SYNTHETIC 검증용'],issue_analysis:'실제 기사 아님',sources:[{url:'https://example.invalid/synthetic',name:'SYNTHETIC'}],schedule:[{event_at:'2099-01-01T00:00:00Z',title:'future'},{event_at:'2000-01-01T00:00:00Z',title:'expired'}],visible_sections:['SECRET_CLIENT_OVERRIDE'],view_count:99999,source_market:'US',selection_market_basis:'FOREIGN_US'};
const profiles={POSITIVE_ONLY:{scenarios:[pos],benefit_sector_ids:[sector]},POSITIVE_NEGATIVE:{scenarios:[pos,neg],benefit_sector_ids:[sector],damage_sector_ids:[other]},DAMAGE_ONLY:{scenarios:[],damage_sector_ids:[other],risks:['SYNTHETIC 주의']},RELATED_CONDITIONAL:{scenarios:[pos],related_sector_ids:[sector]}};
const args=(issue,profile,body,extra={})=>({p_issue:issue,p_expected_revision:0,p_title:'SYNTHETIC M0 '+run,p_summary:'실제 기사 아님',p_body:{...base,...body},p_profile:profile,p_policy:activePolicy,p_catalog:1,p_effect_key:run+':publish:'+issue,...extra});
let failed,published;
try{
  for(const [profile,body] of Object.entries(profiles))await test('P03a: server visibility '+profile,async()=>{
    const f=fixture(),a=args(f.issue,profile,body);
    await denied('m0_publish',{...a,p_expected_revision:null},/REVISION_CONFLICT/,{token:admin});
    assert.equal(sql('select revision from private.issues where id='+q(f.issue)+';'),'0');assert.equal(sql('select count(*) from private.outbox where issue_id='+q(f.issue)+';'),'0');
    const result=await ok('m0_publish',a,{token:admin});published??=f.issue;
    assert.equal(result.status,'APPLIED');assert.ok(!result.visible_sections.includes('SECRET_CLIENT_OVERRIDE'));
    await denied('m0_set_publication_state',{p_issue:f.issue,p_expected_revision:null,p_state:'HIDDEN'},/REVISION_CONFLICT/,{token:admin});assert.equal(sql('select revision from private.issues where id='+q(f.issue)+';'),'1');
    const pub=await ok('get_public_article',{p_issue:f.issue},{role:'anon'});assert.equal(pub.state,'PUBLISHED');assert.equal(pub.body.schedule.length,1);assert.equal(pub.body.schedule[0].title,'future');assert.ok(!Object.hasOwn(pub.body,'view_count'));
    assert.equal(Object.hasOwn(pub.body,'scenarios'),profile!=='DAMAGE_ONLY');assert.equal(Object.hasOwn(pub.body,'benefit_sector_ids'),profile==='POSITIVE_ONLY'||profile==='POSITIVE_NEGATIVE');assert.equal(Object.hasOwn(pub.body,'damage_sector_ids'),profile==='DAMAGE_ONLY'||profile==='POSITIVE_NEGATIVE');
    assert.equal(sql('select analysis_perspective from private.article_versions where id='+q(result.version_id)+';'),'KR_EQUITY');
    assert.equal((await ok('m0_publish',a)).status,'ALREADY_APPLIED');
    await denied('m0_publish',{...a,p_summary:'different'},/EFFECT_PAYLOAD_CONFLICT/);
  });
  await test('Atomic publication: CAS, outbox, policy/catalog, synthetic boundary',async()=>{
    const f=fixture(),a=args(f.issue,'POSITIVE_ONLY',profiles.POSITIVE_ONLY);
    await denied('m0_publish',{...a,p_policy:999},/STALE_POLICY_OR_CATALOG/);assert.equal(sql('select count(*) from private.article_versions where issue_id='+q(f.issue)+';'),'0');
    const results=await Promise.all([rpc('m0_publish',a),rpc('m0_publish',{...a,p_effect_key:a.p_effect_key+':second'})]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(sql('select count(*) from private.outbox where issue_id='+q(f.issue)+';'),'1');
    const real=fixture({real:true});await denied('m0_publish',args(real.issue,'POSITIVE_ONLY',profiles.POSITIVE_ONLY),/REAL_PUBLICATION_NOT_ENABLED/);
    const invalid=fixture();await denied('m0_publish',args(invalid.issue,'DAMAGE_ONLY',{...profiles.DAMAGE_ONLY,scenarios:[pos]}),/DAMAGE_ONLY_NO_SCENARIO/);
  });
  await test('P03a: conditional positive+negative with no schedule keeps only applicable sections',async()=>{
    const f=fixture(),body={...profiles.RELATED_CONDITIONAL,scenarios:[pos,neg],schedule:[]};await ok('m0_publish',args(f.issue,'RELATED_CONDITIONAL',body));
    const r=await ok('get_public_article',{p_issue:f.issue},{role:'anon'});assert.equal(r.body.scenarios.length,2);assert.ok(!Object.hasOwn(r.body,'schedule'));assert.ok(!r.body.visible_sections.includes('SCHEDULE'));assert.ok(!Object.hasOwn(r.body,'benefit_sector_ids'));assert.ok(!Object.hasOwn(r.body,'damage_sector_ids'));
  });
  await test('Macro evidence: duplicated origin fails; distinct verified three passes',async()=>{
    const f=fixture({macro:true,official:false}),a=args(f.issue,'POSITIVE_ONLY',profiles.POSITIVE_ONLY);
    await denied('m0_publish',a,/MACRO_INDEPENDENT_THREE_REQUIRED/);
    const rows=[1,2,3].map(n=>'('+q(f.claim)+",'origin-same',"+q('newsroom-'+n)+','+q('group-'+n)+',true,true,true,true)').join(',');
    sql('insert into private.evidence_edges(claim_id,origin_group_id,newsroom_id,owner_group_id,origin_verified,newsroom_verified,owner_group_verified,independent_fact_verified) values '+rows+';');
    await denied('m0_publish',a,/MACRO_INDEPENDENT_THREE_REQUIRED/);
    sql("update private.evidence_edges set origin_group_id=newsroom_id where claim_id="+q(f.claim)+';');assert.equal((await ok('m0_publish',a)).status,'APPLIED');
  });
  await test('Hidden/correction/withdrawal clear public stale content and saved aliases',async()=>{
    for(const state of ['HIDDEN','CORRECTION_PENDING','WITHDRAWN']){
      const f=fixture(),a=args(f.issue,'POSITIVE_ONLY',profiles.POSITIVE_ONLY);await ok('m0_publish',a);
      const alias=randomUUID();sql('insert into private.issue_aliases(alias_id,canonical_issue_id) values ('+q(alias)+','+q(f.issue)+');');
      await ok('m0_set_publication_state',{p_issue:f.issue,p_expected_revision:1,p_state:state});
      const resolved=await ok('get_public_article',{p_issue:alias},{role:'anon'});assert.equal(resolved.state,state);assert.ok(!Object.hasOwn(resolved,'body'));
      const list=await request('news_list?issue_id=eq.'+f.issue,{role:'anon'});assert.equal(list.status,200);assert.equal(list.body.length,0);
      assert.equal(sql('select body is null and title is null from public.news_public where issue_id='+q(f.issue)+';'),'t');
      if(state!=='CORRECTION_PENDING')await denied('m0_publish',{...a,p_expected_revision:2,p_effect_key:a.p_effect_key+':new'},/NO_AUTOMATIC_REPUBLISH/);
    }
  });
  await test('Installation ownership: A cannot read B; rotate/expiry/revoke; private views',async()=>{
    const a=await ok('m0_create_installation'),b=await ok('m0_create_installation');
    const capability=x=>({p_install:x.installation_id,p_secret:x.secret,p_version:x.secret_version});
    await denied('m0_get_settings',{...capability(b),p_secret:a.secret},/INSTALLATION_UNAUTHORIZED/);
    await ok('m0_update_settings',{...capability(a),p_morning:true,p_closing:false,p_favorite:true,p_sector_ids:[sector]});
    const inactive=randomUUID();sql('insert into private.sectors(id,name,catalog_version,sample_kind,active) values ('+q(inactive)+",'SYNTHETIC inactive',1,'SYNTHETIC',false);");
    const before=await ok('m0_get_settings',capability(a));
    for(const [ids,pattern] of [[[inactive],/INACTIVE_SECTOR/],[[randomUUID()],/INACTIVE_SECTOR/],[[sector,sector],/DUPLICATE_OR_NULL_SECTOR/],[[null],/DUPLICATE_OR_NULL_SECTOR/]]){
      await denied('m0_update_settings',{...capability(a),p_morning:false,p_closing:true,p_favorite:false,p_sector_ids:ids},pattern);
      assert.deepEqual(await ok('m0_get_settings',capability(a)),before,'Rejected sector request must leave settings unchanged');
    }
    assert.equal((await ok('m0_get_settings',capability(b))).morning_issue,false);
    const rotated=await ok('m0_rotate_installation',capability(a));await denied('m0_get_settings',capability(a),/INSTALLATION_UNAUTHORIZED/);
    await ok('m0_get_settings',capability(rotated));
    const event={...capability(rotated),p_issue:published,p_event_key:run+':view'};assert.equal((await ok('m0_record_view',event)).recorded,true);assert.equal((await ok('m0_record_view',event)).recorded,false);
    assert.equal(await ok('m0_admin_view_count',{p_issue:published},{token:admin}),1);await denied('m0_admin_view_count',{p_issue:published},null,{role:'anon'});
    const article=await ok('get_public_article',{p_issue:published},{role:'anon'});assert.ok(!JSON.stringify(article).includes('view_count'));
    sql('update private.installations set expires_at=now()-interval \'1 second\' where id='+q(b.installation_id)+';');await denied('m0_get_settings',capability(b),/INSTALLATION_UNAUTHORIZED/);
    sql('update private.installations set revoked_at=now() where id='+q(rotated.installation_id)+';');await denied('m0_get_settings',capability(rotated),/INSTALLATION_UNAUTHORIZED/);
  });
  await test('Alias depth/cycles fail closed instead of serving intermediate stale article',async()=>{
    const chain=Array.from({length:18},()=>fixture().issue);
    await ok('m0_publish',args(chain[16],'POSITIVE_ONLY',profiles.POSITIVE_ONLY));
    await ok('m0_set_publication_state',{p_issue:chain[17],p_expected_revision:0,p_state:'HIDDEN'});
    sql('insert into private.issue_aliases(alias_id,canonical_issue_id) values '+chain.slice(0,-1).map((id,n)=>'('+q(id)+','+q(chain[n+1])+')').join(',')+';');
    await denied('get_public_article',{p_issue:chain[0]},/ALIAS_CHAIN_LIMIT/,{role:'anon'});
    assert.equal((await ok('get_public_article',{p_issue:chain[1]},{role:'anon'})).state,'HIDDEN','Exactly16 hops must reach final hidden state');
    const a=fixture().issue,b=fixture().issue;sql('insert into private.issue_aliases(alias_id,canonical_issue_id) values ('+q(a)+','+q(b)+'),('+q(b)+','+q(a)+');');
    await denied('get_public_article',{p_issue:a},/ALIAS_CYCLE/,{role:'anon'});
  });
  await test('Source state: version/permission/technical checks before explicit SHADOW',async()=>{
    const source='source-'+run,profile='profile-'+run,endpoint='endpoint-'+run,adapter='adapter-'+run;
    sql('insert into private.sources(id,name,source_type,market,sample_kind) values ('+q(source)+",'SYNTHETIC','TELEGRAM','KR','SYNTHETIC');insert into private.permission_profiles(id,version,status,purposes,evidence,verified_at,expires_at,sample_kind) values ("+q(profile)+",'1','VERIFIED','{\"MACHINE_ACCESS\":\"ALLOW\",\"DISCOVERY\":\"ALLOW\"}','[\"SYNTHETIC_NOT_REAL_PERMISSION\"]',now(),now()+interval '1 hour','SYNTHETIC');insert into private.adapters(id,version,verification_state) values ("+q(adapter)+",'1','PASSED');insert into private.endpoints(id,source_id,url,permission_profile_id,permission_version,adapter_id,adapter_version,status,schedule_class,origin_resolution_rule) values ("+q(endpoint)+','+q(source)+",'https://example.invalid/synthetic',"+q(profile)+",'1',"+q(adapter)+",'1','TECH_TEST','TELEGRAM_EVENT','PLATFORM_RESOLVE');");
    const a={p_endpoint:endpoint,p_permission_version:'1',p_adapter_version:'1',p_checks:{listing:true,detail:true,id:true,time:true,pagination:true,failure_handling:true}};
    await denied('m0_source_technical_result',{...a,p_adapter_version:'2'},/TECH_TEST_VERSION_CONFLICT/);
    await denied('m0_source_technical_result',{...a,p_permission_version:null},/TECH_TEST_VERSION_CONFLICT/);
    await denied('m0_source_technical_result',{...a,p_checks:{listing:true}},/TECH_CHECK_INCOMPLETE/);
    const r=await ok('m0_source_technical_result',a);assert.equal(r.state,'SHADOW');assert.equal(r.live_enabled,false);assert.equal(r.action,'TECH_TEST_VERIFIED_ENTER_SHADOW');
  });
}catch(e){failed=e;}finally{writePrivate('m0-publication-'+run+'.json',{productId:'judoju-news',run,status:failed?'FAIL':'PASS',sample_kind:'SYNTHETIC',cases,createdAt:new Date().toISOString(),actualNewsRequests:0});}
if(failed)throw failed;
