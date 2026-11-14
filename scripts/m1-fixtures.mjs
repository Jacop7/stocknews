import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authFixtures } from './m1-auth-fixtures.mjs';
import { login,session,editorRpc } from '../apps/admin/lib/runtime.mjs';
export const fixtureSectors=[
  {id:'51000000-0000-4000-8000-000000000001',name:'반도체 후공정/패키징',description:'합성 카탈로그 · 반도체 조립·검사·패키징 관련 이슈'},
  {id:'51000000-0000-4000-8000-000000000002',name:'전력',description:'합성 카탈로그 · 변압기·전력 설비 관련 이슈'},
  {id:'51000000-0000-4000-8000-000000000003',name:'원자력 SMR',description:'합성 카탈로그 · 원자력·소형모듈원자로 관련 이슈'}
];
export async function m1FixtureClient(){
  const f=await authFixtures();
  for(const [n,s]of fixtureSectors.entries()){
    const existing=f.sql('select name||\'|\'||sample_kind::text from private.sectors where id='+f.quote(s.id)+';');
    assert.ok(!existing||existing===s.name+'|SYNTHETIC','Do not adopt unknown catalog identity');
    f.sql('insert into private.sectors(id,name,description,display_order,catalog_version,sample_kind) values ('+f.quote(s.id)+','+f.quote(s.name)+','+f.quote(s.description)+','+n+",1,'SYNTHETIC') on conflict(id) do nothing;");
  }
  const credentials=f.state.users.admin,r=await login(credentials.email,credentials.password),s=await session(r.capability);
  const rpc=(name,data)=>editorRpc(name,data,s);
  async function create(){const x=await rpc('m1_create_draft',{p_request:randomUUID()});return rpc('m1_get_draft',{p_issue:x.issue_id});}
  return {...f,adminSession:s,capability:r.capability,editor:rpc,create};
}
export function fixtureContent(d,{kind='POSITIVE',schedule=[],title='SYNTHETIC · 합성 투자 이슈 검증'}={}){
  const path=(direction,conditional_direction='NONE',n=0)=>({sector_id:fixtureSectors[n].id,path_id:'p'+n+'_'+direction+'_'+conditional_direction,direction,conditional_direction,description:'실제 뉴스가 아닌 합성 한국 섹터 연결 근거',conditions:conditional_direction==='NONE'?[]:['합성 조건 충족 시'],evidence_ids:[d.claim_id]});
  const maps={POSITIVE:[path('BENEFIT')],BOTH:[path('BENEFIT'),path('DAMAGE','NONE',1)],DAMAGE:[path('DAMAGE')],RELATED:[path('RELATED')],NO_POSITIVE:[path('RELATED')],CONDITIONAL_NEGATIVE:[path('RELATED','NEGATIVE')],CONDITIONAL_POSITIVE:[path('RELATED','POSITIVE')],CONDITIONAL_BOTH:[path('RELATED','POSITIVE'),path('RELATED','NEGATIVE',1)]};
  const impacts=maps[kind];assert.ok(impacts);
  const positive=impacts.filter(x=>x.direction==='BENEFIT'||x.conditional_direction==='POSITIVE'),negative=impacts.filter(x=>x.direction==='DAMAGE'||x.conditional_direction==='NEGATIVE');
  const scenario=(direction,paths)=>({direction,title:direction==='POSITIVE'?'합성 조건 충족':'합성 조건 불충족',expected_result:'한국 섹터에 대한 합성 예상 결과',checks:['합성 확인 사항'],path_ids:paths.map(x=>x.path_id)});
  return {...d.content,title,summary:'실제 투자 정보가 아닌 관리자 게시·앱 노출 검증용 기사',primary_sector_id:fixtureSectors[0].id,key_issues:['합성 핵심 이슈','한국 주식 관점의 조건부 영향'],issue_analysis:'이 문단은 합성 데이터입니다. 해외 원문 시장과 한국 기업 영향 분석의 분리를 시험하며 실제 수혜나 피해를 확정하지 않습니다.',impacts,scenarios:positive.length?[scenario('POSITIVE',positive),...(negative.length?[scenario('NEGATIVE',negative)]:[])]:[],risks:['합성 리스크 · 실제 투자 판단에 사용 불가'],schedule};
}
