import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseCatalog,cellHash,splitOutsideParentheses,boldAt,findHeadings} from '../scripts/catalog/parse-catalog.mjs';
import {createPreview} from '../scripts/catalog/preview-catalog.mjs';
const sourcePath=new URL('./fixtures/catalog/source-20261114.json',import.meta.url),registryPath=new URL('./fixtures/catalog/registry-v1.json',import.meta.url);
const sourceBytes=readFileSync(sourcePath),source=JSON.parse(sourceBytes),registry=JSON.parse(readFileSync(registryPath));
const parse=(s=source,r=registry)=>parseCatalog(s,r,{sourceSha256:s===source?cellHash(sourceBytes):cellHash(JSON.stringify(s))});
const result=parse(),category=n=>result.categories.find(c=>c.sourceRow===n);
test('all frozen source values/formatting, 56 categories and 339 records survive; no executable import or fabricated stock data',()=>{
  assert.equal(cellHash(sourceBytes),'5c86278ab12d16979a1f5fd7a100e15368db2450f1ebcf47e70aced66d84a5d2');
  assert.deepEqual(result.rawSource,source);assert.equal(result.summary.categoryCount,56);assert.equal(result.summary.companySourceRecordCount,339);
  assert.equal(result.summary.structuralHoldCount,2);assert.equal(result.importable,false);assert.equal(result.companies.filter(c=>c.stockIdentity.state==='UNRESOLVED').length,339);
  assert.deepEqual(result.unresolved.filter(x=>x.code!=='STOCK_IDENTITY_UNVERIFIED').map(x=>[x.code,x.cell,x.company,x.categoryName]),[['LOWER_UPPER_MEMBERSHIP_DIFFERENCE','B333','현대건설','원자력 SMR'],['LOWER_UPPER_MEMBERSHIP_DIFFERENCE','B360','HB테크놀러지','반도체 유리기판']]);
  assert.ok(result.companies.every(c=>c.price===null&&c.changePercent===null&&c.stockUrl===null&&c.stockIdentity.code===null));
  for(const c of result.categories){assert.deepEqual(c.rawRow,source.values.values[c.sourceRow-1]);assert.equal(c.detailDescription,c.rawRow[2]);assert.equal(c.categorySearchMapping,c.rawRow[3]);assert.equal(c.categorySearchSuffixInstruction,c.rawRow[4]);assert.equal(c.foreignCompanies.US.raw,c.rawRow[17]??null);assert.equal(c.foreignCompanies.CN.raw,c.rawRow[18]??null);}
  for(const c of result.companies){assert.deepEqual(c.rawRow,source.values.values[c.sourceRow-1]);assert.equal(c.searchDescription,c.rawRow[4]??null);assert.equal(c.directSearchKeywords.raw,c.rawRow[3]??null);assert.equal(c.industrySearchKeywords.raw,c.rawRow[5]??null);}
  assert.equal(cellHash(readFileSync(sourcePath)),cellHash(sourceBytes));
});
test('the two reviewed parenthesis corrections preserve raw cells and split roles exactly',()=>{
  assert.equal(result.correctionLedger.length,2);assert.deepEqual(result.correctionLedger.map(c=>c.cell),['B5','B36']);
  assert.deepEqual(category(5).memberships.map(c=>c.name),['오픈엣지테크놀로지','퀄리타스반도체']);
  assert.equal(category(5).memberships[0].role,'NPU, 메모리(LPDDR, HBM) IP 보유');
  assert.equal(category(36).memberships.find(x=>x.name==='아이쓰리시스템').role,'유도무기 적외선 영상센서');
  assert.equal(category(36).memberships.find(x=>x.name==='현대로템').subgroupId,category(36).subgroups.find(x=>x.title==='전차').id);
  const changed=structuredClone(source);changed.values.values[4][1]+=' ';
  assert.ok(parse(changed).unresolved.some(x=>x.code==='CORRECTION_PRECONDITION_FAILED'&&x.cell==='B5'));
  const bad=structuredClone(registry);bad.corrections[0].after='deleted';assert.ok(parse(source,bad).unresolved.some(x=>x.code==='UNAPPROVED_CORRECTION'));
});
test('all nine plain headings survive; unknown plain prefix/hash drift hold instead of silently becoming a company',()=>{
  assert.deepEqual(category(10).subgroups.map(g=>g.title),registry.plainHeadings[0].titles);assert.deepEqual(category(37).subgroups.map(g=>g.title),registry.plainHeadings[1].titles);
  assert.ok([...category(10).subgroups,...category(37).subgroups].every(g=>g.evidence==='EXACT_PLAIN_REGISTRY'));
  const changed=structuredClone(source);changed.values.values[9][1]=changed.values.values[9][1].replace('FC-BGA :','새 제목 :');
  const p=parse(changed);assert.ok(p.unresolved.some(x=>x.code==='PLAIN_HEADING_REGISTRY_MISMATCH'));assert.ok(p.unresolved.some(x=>x.code==='SUBGROUP_UNRESOLVED'&&x.title==='새 제목'));
});
test('B5/B6 are retained category labels with null subgroups; B56 bold punctuation creates no subgroup',()=>{
  assert.equal(category(5).categoryLabel.title,'반도체 IP');assert.equal(category(6).categoryLabel.title,'팹리스');
  for(const n of [5,6]){assert.equal(category(n).subgroups.length,0);assert.ok(category(n).memberships.every(x=>x.subgroupId===null));}
  assert.equal(category(56).subgroups.length,0);assert.equal(category(56).memberships.length,11);
});
test('UTF-16, sparse zero and normal colon preserve title evidence without creating punctuation headings',()=>{
  const cell={textFormatRuns:[{format:{bold:true}},{startIndex:4,format:{bold:false}}]};assert.equal(boldAt(cell,0),true);assert.equal(boldAt(cell,3),true);assert.equal(boldAt(cell,4),false);
  assert.deepEqual(findHeadings('😀 장비 : 기업(안쪽: 설명)\n다음 : 회사').map(x=>[x.title,x.start]),[['😀 장비',0],['다음',19]]);
  for(const title of ['리플로우 장비','패키징 테스트 핸들러'])assert.equal(category(13).subgroups.find(g=>g.title===title).state,'PARSED_SOURCE');
});
test('nested role parentheses, commas and newlines split only outside parentheses',()=>{
  assert.deepEqual(splitOutsideParentheses('회사(NPU, 메모리(LPDDR, HBM)), 기업(설명)\n세번째').map(x=>x.text),['회사(NPU, 메모리(LPDDR, HBM))','기업(설명)','세번째']);
  assert.throws(()=>splitOutsideParentheses('회사(누락'),/UNBALANCED/);
  assert.deepEqual(findHeadings('묶음 : 회사(설명\n안쪽: 설명)\n다음 : 기업').map(x=>x.title),['묶음','다음']);
});
test('same company retains different subgroup roles, independent from lower-E display text',()=>{
  const robot=category(25),r=robot.memberships.filter(x=>x.name==='로보티즈');assert.equal(r.length,2);assert.notEqual(r[0].subgroupId,r[1].subgroupId);assert.notEqual(r[0].role,r[1].role);assert.ok(r.every(x=>!x.exactMembershipDuplicate));
  const c=result.companies.find(x=>x.name==='로보티즈');assert.equal(c.searchDescription,source.values.values[c.sourceRow-1][4]);assert.ok(c.categoryRefs.length>1);
});
test('NFC outer trim ledger preserves A45 raw space and all four lower steel links; collision never auto-merges',()=>{
  assert.equal(category(45).rawName,'철강 ');assert.equal(category(45).name,'철강');assert.ok(result.normalizationLedger.some(x=>x.cell==='A45'&&x.before==='철강 '&&x.after==='철강'));
  assert.deepEqual(result.companies.filter(c=>c.categoryRefs.some(r=>r.categoryId===category(45).id)).map(c=>c.sourceRow),[156,157,339,389]);
  const changed=structuredClone(source);changed.values.values[1][0]='철강';const p=parse(changed);assert.equal(p.categories.length,56);assert.ok(p.unresolved.some(x=>x.code==='CATEGORY_NAME_COLLISION'));
});
test('cross-category keywords and foreign raw roles remain; approved 11 parents cover exactly once and 엔터 remains separate',()=>{
  assert.ok(result.categories.filter(c=>c.keywords.some(k=>k.value==='HBM')).length>5);
  const entertainment=result.categories.find(c=>c.name==='엔터'),parent=result.parents.find(p=>p.id===entertainment.parentId);assert.equal(parent.name,'통신 · 엔터 · 게임');
  assert.ok(!result.parents.find(p=>p.name==='소비재').categories.includes('엔터'));assert.ok(!result.categories.some(c=>c.name==='편의점'));
  assert.equal(result.parents.find(p=>p.id===result.categories.find(c=>c.name==='피팅·밸브').parentId).name,'에너지');
  assert.equal(new Set(result.parents.flatMap(p=>p.categories)).size,56);
});
test('unrecognized company, header drift, registry collisions, and rename proposals fail closed',()=>{
  let changed=structuredClone(source);changed.values.values[1][1]='없는기업(역할)';assert.ok(parse(changed).unresolved.some(x=>x.code==='ROLE_COMPANY_UNRESOLVED'));
  changed=structuredClone(source);changed.values.values[60][4]='직접 검색어';assert.throws(()=>parse(changed),/HEADER/);
  changed=structuredClone(source);changed.values.values[1][0]='새 섹터';const p=parse(changed);assert.equal(p.categories[0].id,result.categories[0].id);assert.ok(p.differences.some(d=>d.kind==='RENAME_PROPOSAL'));assert.ok(p.unresolved.some(x=>x.code==='SOURCE_CHANGED_REQUIRES_REVIEW'));
  const bad=structuredClone(registry);bad.companies[0].id=bad.categories[0].id;assert.throws(()=>parse(source,bad),/REGISTRY_ID_COLLISION/);
  assert.deepEqual(parse().categories.map(c=>c.id),parse().categories.map(c=>c.id));
});
test('subgroup rename keeps a stable-ID proposal and membership context without approving it',()=>{
  const changed=structuredClone(source),before=JSON.stringify(registry);
  changed.values.values[12][1]=changed.values.values[12][1].replace('리플로우 장비','리플로우 설비');
  const p=parse(changed),g=p.categories.find(c=>c.sourceRow===13).subgroups.find(g=>g.title==='리플로우 설비');
  const old=registry.subgroups.find(g=>g.sourceCell==='B13'&&g.title==='리플로우 장비');
  assert.equal(g.id,null);assert.equal(g.proposedId,old.id);assert.equal(g.state,'HOLD');
  assert.ok(p.differences.some(d=>d.kind==='SUBGROUP_RENAME_PROPOSAL'&&d.id===old.id&&d.before==='리플로우 장비'&&d.after==='리플로우 설비'&&d.cell==='B13'));
  assert.ok(p.categories.find(c=>c.sourceRow===13).memberships.filter(m=>m.subgroupSource?.title==='리플로우 설비').every(m=>m.proposedSubgroupId===old.id&&m.subgroupId===null&&m.state==='HOLD'));
  assert.equal(JSON.stringify(registry),before);assert.equal(p.importable,false);
});
test('subgroup moves and ambiguous renames remain explicit stable-ID decisions',()=>{
  const changed=structuredClone(source);
  const line=changed.values.values[12][1].split('\n').find(x=>x.startsWith('리플로우 장비'));
  changed.values.values[12][1]=changed.values.values[12][1].replace(line+'\n','');
  changed.values.values[6][1]+='\n'+line;
  const moved=parse(changed),old=registry.subgroups.find(g=>g.sourceCell==='B13'&&g.title==='리플로우 장비');
  assert.ok(moved.differences.some(d=>d.kind==='SUBGROUP_MOVE_PROPOSAL'&&d.id===old.id&&d.beforeCell==='B13'&&d.cell==='B7'));
  assert.ok(!moved.differences.some(d=>d.kind==='SUBGROUP_DEACTIVATE_PROPOSAL'&&d.id===old.id));
  const ambiguous=structuredClone(source);
  ambiguous.values.values[12][1]=ambiguous.values.values[12][1].replace('리플로우 장비','새로운 장비').replace('TC 본더','새 본더');
  const p=parse(ambiguous),proposals=p.differences.filter(d=>d.kind==='SUBGROUP_AMBIGUOUS_PROPOSAL'&&d.cell==='B13');
  assert.equal(proposals.length,2);assert.ok(proposals.every(d=>d.id===null&&d.beforeCandidates.length===2));
  assert.ok(p.categories.find(c=>c.sourceRow===13).subgroups.filter(g=>['새로운 장비','새 본더'].includes(g.title)).every(g=>g.id===null&&!g.proposedId));
  assert.ok(p.categories.find(c=>c.sourceRow===13).memberships.filter(m=>['새로운 장비','새 본더'].includes(m.subgroupSource?.title)).every(m=>m.state==='HOLD'));
});
test('unknown parent members hold and keyword comparison uses NFC without changing raw values',()=>{
  const bad=structuredClone(registry);bad.parents[0].categories.push('없는 섹터');
  assert.ok(parse(source,bad).unresolved.some(x=>x.code==='PARENT_CATEGORY_NOT_IN_SOURCE'&&x.name==='없는 섹터'));
  const changed=structuredClone(source);changed.values.values[1][5]='한글';changed.values.values[1][6]='한글'.normalize('NFD');
  const c=parse(changed).categories[0];assert.equal(c.rawRow[6],'한글'.normalize('NFD'));
  assert.ok(c.keywordDuplicates.some(k=>k.comparisonKey==='한글'&&k.cell==='G2'&&k.firstCell==='F2'));
  assert.equal(c.keywords.find(k=>k.cell==='G2').value,'한글'.normalize('NFD'));
});
test('offline CLI restricts output, rejects apply/unknown flags, and never overwrites existing preview',()=>{
  const output='test-'+process.pid+'.json',p=new URL('../.local-data/catalog-previews/'+output,import.meta.url);
  try{const options={input:'tests/fixtures/catalog/source-20261114.json',registry:'tests/fixtures/catalog/registry-v1.json',output};const r=createPreview(options);assert.equal(r.importable,false);assert.throws(()=>createPreview(options),/EEXIST/);assert.equal(JSON.parse(readFileSync(p)).summary.companySourceRecordCount,339);assert.throws(()=>createPreview({...options,output:'../../source.json'}),/BASENAME/);
    const bad=spawnSync(process.execPath,['scripts/catalog/preview-catalog.mjs','--apply','true'],{encoding:'utf8'});assert.notEqual(bad.status,0);
  }finally{if(existsSync(p))unlinkSync(p);}
});
