import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PipelineError} from '../packages/contracts/src/pipeline.ts';
import {compileCollectorInventory,SYNTHETIC_COLLECTOR_INVENTORY_P1} from '../workers/collectors/src/inventory.ts';
import {resolveBlockedSiteRecipe,BLOCKED_SITE_RECIPE_P1,DECLARED_PURPOSES} from '../workers/collectors/src/adapters/site-recipes.ts';

// The only file reads in this suite are these three declared provider fixtures.
const registry=JSON.parse(readFileSync(new URL('../data/providers/approved-registry.json',import.meta.url),'utf8'));
const routes=JSON.parse(readFileSync(new URL('../data/providers/routes.json',import.meta.url),'utf8'));
const profiles=JSON.parse(readFileSync(new URL('../data/providers/permission-profiles.json',import.meta.url),'utf8'));
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const actual=()=>({registry:clone(registry),routes:clone(routes),profiles:clone(profiles)});
const compile=(v:ReturnType<typeof actual>)=>compileCollectorInventory(v.registry,v.routes,v.profiles);
const invalid=(run:()=>unknown)=>assert.throws(run,(error:unknown)=>error instanceof PipelineError&&error.code==='INVALID_INPUT');
const minimal=()=>{
  const v=actual();v.registry.sources=v.registry.sources.slice(0,1);v.routes.routes=v.routes.routes.slice(0,1);
  const endpointIds=v.routes.routes[0].endpoint_ids;
  v.routes.endpoints=v.routes.endpoints.filter((e:{endpoint_id:string})=>endpointIds.includes(e.endpoint_id));
  v.profiles.profiles=v.profiles.profiles.filter((p:{endpoint_id:string})=>endpointIds.includes(p.endpoint_id));return v;
};

test('current registry has complete 106/112/112 projection; every declaration is blocked',()=>{
  const v=actual(),out=compile(v);
  assert.equal(out.schema,SYNTHETIC_COLLECTOR_INVENTORY_P1);assert.equal(out.schemaVersion,1);
  assert.equal(out.sourcePolicyVersion,'source-policy-v1');assert.equal(out.dataKind,'DECLARED_CONFIG_ONLY');assert.equal(out.executionEnabled,false);
  assert.equal(out.sourceCount,106);assert.equal(out.endpointCount,112);assert.equal(out.profileCount,112);
  assert.deepEqual(out.sources.map(s=>s.source),registry.sources);
  assert.deepEqual(out.registryProvenance,Object.fromEntries(Object.entries(registry).filter(([k])=>k!=='sources')));
  const used=new Set<string>();let multi=0;
  for(const source of out.sources){
    const route=routes.routes.find((r:{source_id:string})=>r.source_id===source.sourceId);
    assert.deepEqual(source.route,route);
    if(source.endpoints.length===2)multi++;
    assert.deepEqual(source.endpoints.map(e=>e.endpoint.url),source.source.urls);
    assert.deepEqual(source.endpoints.map(e=>e.endpoint.endpoint_id),route.endpoint_ids);
    for(const joined of source.endpoints){
      const endpoint=joined.endpoint,profile=joined.permissionProfile,recipe=joined.recipe;
      assert.deepEqual(endpoint,routes.endpoints.find((e:{endpoint_id:unknown})=>e.endpoint_id===endpoint.endpoint_id));
      assert.deepEqual(profile,profiles.profiles.find((p:{id:unknown})=>p.id===endpoint.permission_profile_id));
      assert.equal(used.has(endpoint.endpoint_id as string),false);used.add(endpoint.endpoint_id as string);
      assert.equal(recipe.schema,BLOCKED_SITE_RECIPE_P1);assert.equal(recipe.status,'BLOCKED');assert.equal(recipe.executionEnabled,false);
      assert.equal(recipe.dataKind,'DECLARED_CONFIG_ONLY');assert.equal(recipe.endpointId,endpoint.endpoint_id);assert.equal(recipe.permissionProfileId,profile.id);
      assert.ok(recipe.reasons.includes('RIGHTS_UNVERIFIED'));assert.ok(recipe.reasons.includes('ADAPTER_VERSION_UNCONFIRMED'));
      assert.ok(recipe.reasons.includes('NO_SEPARATELY_REVIEWED_ADAPTER'));assert.ok(recipe.reasons.includes('NAVIGATION_RECIPE_MISSING'));assert.ok(recipe.reasons.includes('TAB_RECIPE_MISSING'));
      assert.ok(recipe.reasons.includes('PURPOSE_NOT_ALLOWED:MACHINE_ACCESS'));assert.deepEqual(recipe.reasons,[...new Set(recipe.reasons)].sort());
      assert.deepEqual(Object.keys(recipe).sort(),['schema','dataKind','endpointId','permissionProfileId','status','executionEnabled','reasons'].sort());
    }
  }
  assert.equal(multi,6);assert.equal(used.size,112);assert.deepEqual(v,actual());
  assert.equal(out.sources.find(s=>s.source.row===69)!.source.category,' 종목');
  assert.equal(out.sources.find(s=>s.source.row===58)!.endpoints[0].endpoint.url,registry.sources.find((s:{row:number})=>s.row===58).urls[0]);
});

test('source order and exact positional URL correspondence survive row lookup and distinct tabs',()=>{
  const v=actual();v.routes.routes.reverse();v.routes.endpoints.reverse();v.profiles.profiles.reverse();
  const multi=v.registry.sources.find((s:{urls:string[]})=>s.urls.length===2);
  const route=v.routes.routes.find((r:{original_row:number})=>r.original_row===multi.row);
  const a=v.routes.endpoints.find((e:{endpoint_id:string})=>e.endpoint_id===route.endpoint_ids[0]);
  const b=v.routes.endpoints.find((e:{endpoint_id:string})=>e.endpoint_id===route.endpoint_ids[1]);
  a.navigation_path=['research','company'];a.tab_recipe={tab:'company',selector:'#company'};
  b.navigation_path=['research','industry'];b.tab_recipe={tab:'industry',selector:'#industry'};
  const out=compile(v),joined=out.sources.find(s=>s.source.row===multi.row)!;
  assert.deepEqual(out.sources.map(s=>s.source.row),registry.sources.map((s:{row:number})=>s.row));
  assert.deepEqual(joined.endpoints.map(e=>e.endpoint.tab_recipe),[a.tab_recipe,b.tab_recipe]);
  assert.deepEqual(joined.endpoints.map(e=>e.endpoint.navigation_path),[a.navigation_path,b.navigation_path]);
  assert.deepEqual(joined.endpoints.map(e=>e.endpoint.url),multi.urls);
  for(const e of joined.endpoints){assert.equal(e.recipe.executionEnabled,false);assert.ok(e.recipe.reasons.includes('TAB_RECIPE_UNAPPROVED'));}
  route.endpoint_ids.reverse();invalid(()=>compile(v));
});

test('missing, orphaned and duplicate rows, routes, endpoints and profiles are rejected',()=>{
  const mutations=[
    (v:ReturnType<typeof actual>)=>v.registry.sources.pop(),
    (v:ReturnType<typeof actual>)=>v.routes.routes.pop(),
    (v:ReturnType<typeof actual>)=>v.routes.endpoints.pop(),
    (v:ReturnType<typeof actual>)=>v.profiles.profiles.pop(),
    (v:ReturnType<typeof actual>)=>v.registry.sources.push(clone(v.registry.sources[0])),
    (v:ReturnType<typeof actual>)=>v.routes.routes.push(clone(v.routes.routes[0])),
    (v:ReturnType<typeof actual>)=>v.routes.endpoints.push(clone(v.routes.endpoints[0])),
    (v:ReturnType<typeof actual>)=>v.profiles.profiles.push(clone(v.profiles.profiles[0])),
    (v:ReturnType<typeof actual>)=>{v.routes.routes[1].source_id=v.routes.routes[0].source_id;},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[1].original_row=v.routes.routes[0].original_row;},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[1].endpoint_id=v.routes.endpoints[0].endpoint_id;},
    (v:ReturnType<typeof actual>)=>{v.profiles.profiles[1].id=v.profiles.profiles[0].id;},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[0].endpoint_ids=['missing'];},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[0].permission_profile_id='missing';},
    (v:ReturnType<typeof actual>)=>{v.profiles.profiles[0].endpoint_id='missing';},
  ];
  for(const mutate of mutations){const v=actual();mutate(v);invalid(()=>compile(v));}
});

test('MPP1-02 rejects endpoint sharing, multi-source endpoints and multiple profiles per endpoint',()=>{
  const shared=actual();shared.routes.routes[1].endpoint_ids=[shared.routes.routes[0].endpoint_ids[0]];
  shared.registry.sources[1].urls=[shared.registry.sources[0].urls[0]];invalid(()=>compile(shared));
  const multipleSources=actual();multipleSources.routes.endpoints[0].source_ids.push(multipleSources.routes.routes[1].source_id);invalid(()=>compile(multipleSources));
  const multipleProfiles=actual();multipleProfiles.profiles.profiles[1].endpoint_id=multipleProfiles.profiles.profiles[0].endpoint_id;invalid(()=>compile(multipleProfiles));
  const duplicateEndpoint=actual();duplicateEndpoint.routes.routes[0].endpoint_ids.push(duplicateEndpoint.routes.routes[0].endpoint_ids[0]);invalid(()=>compile(duplicateEndpoint));
});

test('bad joins, metadata mismatches, mixed versions and unsupported types fail closed',()=>{
  const mutations=[
    (v:ReturnType<typeof actual>)=>{v.routes.policy_version='source-policy-v2';},
    (v:ReturnType<typeof actual>)=>{v.registry.schema_version=2;},
    (v:ReturnType<typeof actual>)=>{v.routes.schema_version=2;},
    (v:ReturnType<typeof actual>)=>{v.profiles.schema_version=2;},
    (v:ReturnType<typeof actual>)=>{v.registry.product_id='other';},
    (v:ReturnType<typeof actual>)=>{v.profiles.profiles[0].version='2';},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[0].source_ids=['S999'];},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[0].source_id='S999';v.routes.endpoints[0].source_ids=['S999'];},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[0].market='미국주식';},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[0].source_type='뉴스';},
    (v:ReturnType<typeof actual>)=>{v.registry.sources[0].type='UNKNOWN';},
    (v:ReturnType<typeof actual>)=>{v.routes.routes[0].effective_kind='EXECUTABLE';},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[0].endpoint_id='bad id';},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[0].status='RUN';},
    (v:ReturnType<typeof actual>)=>{v.routes.endpoints[0].url+='?extra=1';},
    (v:ReturnType<typeof actual>)=>{v.registry.sources[0].urls.push('https://extra.invalid/');},
    (v:ReturnType<typeof actual>)=>{v.registry.sources[0].urls[0]='file:///unsafe';},
    (v:ReturnType<typeof actual>)=>{v.registry.sources[0].extra=true;},
    (v:ReturnType<typeof actual>)=>{delete v.routes.endpoints[0].tab_recipe;},
    (v:ReturnType<typeof actual>)=>{delete v.profiles.profiles[0].purposes.MACHINE_ACCESS;},
  ];
  for(const mutate of mutations){const v=actual();mutate(v);invalid(()=>compile(v));}
});

test('VERIFIED declarations with filled selectors and adapter version still cannot become approved recipes',()=>{
  const v=minimal(),endpoint=v.routes.endpoints[0],profile=v.profiles.profiles[0];
  endpoint.status='ACTIVE';endpoint.adapter_version='fixture-v1';endpoint.navigation_path=['reports'];endpoint.tab_recipe={selector:'.company',tab:'company'};
  profile.status='VERIFIED';profile.verified_at='2026-11-01T00:00:00Z';profile.expires_at='2026-12-01T00:00:00Z';profile.evidence=['fixture:permission'];
  profile.purposes=Object.fromEntries(DECLARED_PURPOSES.map(p=>[p,'ALLOW']));
  const recipe=compile(v).sources[0].endpoints[0].recipe;
  assert.equal(recipe.status,'BLOCKED');assert.equal(recipe.executionEnabled,false);
  assert.deepEqual(recipe.reasons,['ADAPTER_VERSION_UNAPPROVED','NAVIGATION_RECIPE_UNAPPROVED','NO_SEPARATELY_REVIEWED_ADAPTER','RIGHTS_VALIDITY_NOT_EVALUATED','SELECTOR_RECIPE_UNAPPROVED','TAB_RECIPE_UNAPPROVED']);
  const input={endpointId:endpoint.endpoint_id,permissionProfileId:profile.id,permissionStatus:profile.status,endpointStatus:endpoint.status,
    adapterVersion:endpoint.adapter_version,navigationPath:endpoint.navigation_path,tabRecipe:endpoint.tab_recipe,purposes:profile.purposes};
  assert.deepEqual(resolveBlockedSiteRecipe(input),recipe);
  for(const extra of [{executionEnabled:true},{status:'APPROVED'},{reasons:[]},{fetch:()=>{throw Error('must not run');}}])invalid(()=>resolveBlockedSiteRecipe({...input,...extra}));
  const missing=clone(input);delete missing.tabRecipe;invalid(()=>resolveBlockedSiteRecipe(missing));
});

test('safe boundary rejects getters without invoking them, cycles, prototypes and oversized inputs',()=>{
  for(const document of ['registry','routes','profiles'] as const){
    const v=actual();let calls=0;Object.defineProperty(v[document],'schema_version',{enumerable:true,get(){calls++;return 1;}});
    invalid(()=>compile(v));assert.equal(calls,0);
  }
  const cyclic=minimal();cyclic.routes.endpoints[0].tab_recipe=cyclic.routes;invalid(()=>compile(cyclic));
  const inherited=minimal();Object.setPrototypeOf(inherited.registry.sources[0],{extra:true});invalid(()=>compile(inherited));
  const tooManySources=minimal();tooManySources.registry.sources=Array.from({length:301},()=>clone(tooManySources.registry.sources[0]));invalid(()=>compile(tooManySources));
  const tooManyEndpoints=minimal();tooManyEndpoints.routes.endpoints=Array.from({length:1001},()=>clone(tooManyEndpoints.routes.endpoints[0]));invalid(()=>compile(tooManyEndpoints));
  const largeText=minimal();largeText.registry.sources[0].name='x'.repeat(65537);invalid(()=>compile(largeText));
  const deep=minimal();let cursor:any={};deep.routes.endpoints[0].tab_recipe=cursor;for(let n=0;n<13;n++){cursor.child={};cursor=cursor.child;}invalid(()=>compile(deep));
  const manyNodes=minimal();manyNodes.profiles.profiles[0].evidence=Array.from({length:300},()=>Array(40).fill(null));invalid(()=>compile(manyNodes));
  const tooMuchJson=minimal();tooMuchJson.profiles.profiles[0].evidence=Array.from({length:6},()=> 'x'.repeat(50000));invalid(()=>compile(tooMuchJson));
  const hole=minimal();delete hole.registry.sources[0].urls[0];invalid(()=>compile(hole));
});

test('results are detached declarations and compilation runs without invoking fetch',()=>{
  const v=actual(),before=clone(v),oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(()=>{calls++;throw new Error('IO forbidden');}) as typeof fetch;
  try{
    const out=compile(v);out.sources[0].source.name='changed';out.sources[0].route.endpoint_ids=['changed'];
    out.sources[0].endpoints[0].endpoint.navigation_path=['changed'];out.sources[0].endpoints[0].permissionProfile.purposes={};
    out.sources[0].endpoints[0].recipe.reasons.length=0;out.registryProvenance.product_id='changed';
    assert.deepEqual(v,before);const again=compile(v);
    assert.equal(again.sources[0].source.name,registry.sources[0].name);assert.ok(again.sources[0].endpoints[0].recipe.reasons.length>0);
    v.registry.sources[0].name='input changed';assert.equal(again.sources[0].source.name,registry.sources[0].name);assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
