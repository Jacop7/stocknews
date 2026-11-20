import assert from 'node:assert/strict';
import test from 'node:test';
import {screenArticleOriginality} from '../workers/ai-processing/src/originality-screen.ts';

const policy = {version:'fixture-wording-v1',headlineCharacters:12,passageCharacters:24};
const source = [
  {id:'publisher-headline',text:'변압기 장기 공급 계약을 체결한 국내 업체'},
  {id:'publisher-intro',text:'새로 확보한 공장 부지에서 2028년 이후 대형 전력 설비 생산을 단계적으로 시작할 예정이다.'},
];
const draft = {
  headline:'국내 전력 설비 증설이 납기에 미칠 영향',
  parts:[{id:'key-issues',text:'가동률과 초기 생산 수율이 실제 납기 단축 속도를 결정할 수 있다.'}],
};

test('spacing and punctuation changes still flag borrowed headline and passage wording',()=>{
  const candidate = {
    headline:'[속보] 변압기 장기 공급계약을 체결한 국내 업체',
    parts:[{id:'key-issues',text:'회사 설명에 따르면 새로 확보한 공장부지에서（２０２８년 이후）대형 전력 설비 생산을 단계적으로 시작할 예정이다.'}],
  };
  const outcome = screenArticleOriginality({policy,sourceParts:source,draft:candidate});
  assert.equal(outcome.state,'HOLD_SHARED_WORDING');
  assert.deepEqual(outcome.findings,[
    {draftPartId:'headline',sourcePartId:'publisher-headline',rule:'SHARED_HEADLINE_WORDING',matchedAtLeastCharacters:12},
    {draftPartId:'key-issues',sourcePartId:'publisher-intro',rule:'SHARED_PASSAGE',matchedAtLeastCharacters:24},
  ]);
  assert.doesNotMatch(JSON.stringify(outcome),/공급 계약|공장 부지/);
  assert.equal(outcome.publicationAuthorized,false);
});

test('short common terms do not count as a copied passage; missing sources hold',()=>{
  const outcome = screenArticleOriginality({policy,sourceParts:source,draft});
  assert.equal(outcome.state,'NO_LITERAL_MATCH');
  assert.equal(outcome.publicationAuthorized,false);
  assert.deepEqual(outcome.findings,[]);
  assert.equal(screenArticleOriginality({policy,sourceParts:[],draft}).state,'HOLD_NO_SOURCE');
});

test('rejects duplicate parts, an absent body and unsupported comparison values',()=>{
  const run = (overrides:Record<string,unknown>)=>screenArticleOriginality({policy,sourceParts:source,draft,...overrides});
  assert.throws(()=>run({sourceParts:[source[0],source[0]]}),/ARTICLE_ORIGINALITY_INPUT_INVALID/);
  assert.throws(()=>run({draft:{...draft,parts:[]}}),/ARTICLE_ORIGINALITY_INPUT_INVALID/);
  assert.throws(()=>run({policy:{...policy,passageCharacters:0}}),/ARTICLE_ORIGINALITY_INPUT_INVALID/);
});
