import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MainOwnedP4Postgres} from '../scripts/test-main-p4-integration.mjs';
import {screenCollectedDraft} from '../workers/ai-processing/src/draft-originality.ts';
import {collectAnalysisInput,collectorSql} from './fixtures/collected-analysis-input.mjs';

const policy = {version:'fixture-ko-v1',headlineCharacters:12,passageCharacters:24};
const article = {
  title:'SYNTHETIC 변압기 장기 공급 계약을 체결한 국내 업체',
  lead:'새 공장 건설과 전력 설비 생산 계획을 발표했다.',
  body:'새로 확보한 공장 부지에서 2028년 이후 대형 전력 설비 생산을 단계적으로 시작할 예정이다.',
};
const draft = {
  title:'공급 계약이 국내 전력 장비 업체에 미칠 영향',
  summary:'생산량이 늘어나는 시기는 신규 공장 인허가 일정에 따라 달라진다.',
  issue_analysis:'실제 수익성은 제품별 원가와 계약 조건에 좌우될 수 있다.',
  article_kind:'SECTOR',source_market:'SYNTHETIC',selection_market_basis:'KR',
  analysis_perspective:'KR_EQUITY',primary_sector_id:'power',key_issues:[],risks:[],sources:[],
  impacts:[],scenarios:[],schedule:[],
};

test('wording preflight screens all draft sections against the current collected original', {timeout:60_000}, async()=>{
  const db = new MainOwnedP4Postgres('COLLECTOR_DB_CAPTURE_V1',collectorSql);
  try {
    await db.start();
    const input = await collectAnalysisInput(db,article);
    const request = {source:input.source,sectorIds:['power'],versions:{analysisPolicyVersion:'policy-v1',
      catalogVersion:'catalog-v1',promptVersion:'prompt-v1',generatorVersion:'generator-v1'}};
    const original = await screenCollectedDraft(input.port,[request],draft,policy);
    assert.equal(original.state,'NO_LITERAL_MATCH');
    assert.equal(original.checkedSources[0].bodyDigest,input.source.expectedBodyHash);
    assert.equal(original.checkedSources[0].deliveryId,input.source.deliveryId);
    assert.equal(original.publicationAuthorized,false);
    const candidate = { ...draft,
      scenarios:[{direction:'POSITIVE',title:'증설 시나리오',expected_result:'공급 능력이 확대될 수 있다.',
        checks:[article.body.replaceAll(' ','')],path_ids:[]}],
    };
    const copied = await screenCollectedDraft(input.port,[request],candidate,policy);
    assert.equal(copied.state,'HOLD_SHARED_WORDING');
    assert.notEqual(copied.draftDigest,original.draftDigest);
    assert.deepEqual(copied.findings,[{
      draftPartId:'scenario-0-checks-0',sourcePartId:input.source.deliveryId+'-body',
      rule:'SHARED_PASSAGE',matchedAtLeastCharacters:24,
    }]);
    assert.doesNotMatch(JSON.stringify(copied),/확보한 공장/);
    const extended = {
      ...draft,issue_analysis:'검'.repeat(19_000)+' '+article.body,
      impacts:Array.from({length:30},(_,n)=>({
        sector_id:'power',path_id:'path-'+n,direction:'RELATED',conditional_direction:'NONE',
        description:'해당 기업의 공급 여부를 확인한다.',conditions:['수주 공시 대조'],evidence_ids:[],
      })),
    };
    const extendedResult = await screenCollectedDraft(input.port,[request],extended,policy);
    assert.equal(extendedResult.state,'HOLD_SHARED_WORDING');
    assert.deepEqual(extendedResult.findings.map(finding=>finding.draftPartId),['issue-analysis']);
    const stale = {...request,source:{...request.source,expectedBodyHash:'0'.repeat(64)}};
    assert.equal((await screenCollectedDraft(input.port,[stale],draft,policy)).state,'HOLD_SOURCE_NOT_CURRENT');
    assert.equal((await screenCollectedDraft(input.port,[request,request],draft,policy)).state,'HOLD_SOURCE_NOT_CURRENT');
    assert.equal((await screenCollectedDraft({},[request],draft,policy)).state,'HOLD_SOURCE_NOT_CURRENT');
  } finally {
    await db.close();
  }
});
