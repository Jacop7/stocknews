// Pure offline transformation. No database, app, network or environment imports.
import { createHash } from 'node:crypto';

export const PARSER_VERSION = '6A/1';
export const cellHash = value => createHash('sha256').update(value).digest('hex');
export const comparisonKey = value => value.normalize('NFC').trim();
const copy = value => structuredClone(value);
const CATEGORY_HEADER = ['카테고리','기업명(카테고리)','섹터 상세 설명글','검색페이지 설명글','검색페이지 설명글 \n텍스트 추가','연관 검색어','핵심키워드',...Array.from({length:10},(_,i)=>'추가키워드 '+String(i+1).padStart(2,'0')),'연관 미국기업','연관 중국기업'];
const COMPANY_HEADER = ['기업명','해당 카테고리','3열','직접 적용 검색어','검색 시 설명글','산업·수요 연관 검색어'];

export function splitOutsideParentheses(text) {
  const result=[]; let depth=0,start=0;
  const take=end=>{const raw=text.slice(start,end);if(raw.trim())result.push({raw,start,end,text:raw.trim()});start=end+1;};
  for(let i=0;i<text.length;i++){
    const ch=text[i]; if(ch==='(')depth++;else if(ch===')'){if(--depth<0)throw new Error('UNBALANCED_PARENTHESES');}
    else if(depth===0&&(ch===','||ch==='\n'||ch===';'))take(i);
  }
  if(depth!==0)throw new Error('UNBALANCED_PARENTHESES');take(text.length);return result;
}

export function boldAt(cell,index) {
  const runs=cell.textFormatRuns??[];
  let bold=cell.userEnteredFormat?.textFormat?.bold===true;
  for(const run of runs){if((run.startIndex??0)>index)break;bold=run.format?.bold??(cell.userEnteredFormat?.textFormat?.bold===true);}
  return bold;
}

export function findHeadings(text) {
  const headings=[];let offset=0,depth=0;
  for(const line of text.split('\n')){
    const before=depth;let found=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];if(ch==='(')depth++;else if(ch===')')depth--;
      else if(ch===':'&&depth===0&&before===0&&!found){
        const rawTitle=line.slice(0,i),title=rawTitle.trim();
        if(/[\p{L}\p{N}]/u.test(title))headings.push({title,start:offset+rawTitle.search(/\S/u),colon:offset+i,contentStart:offset+i+1,prefix:line.slice(0,i+1)});
        // Continue counting parentheses in the body, but never add a second heading.
        found=true;
      }
    }
    offset+=line.length+1;
  }
  return headings;
}

function keywordEntries(raw,cell) {
  if(raw==null||raw==='')return [];
  try{return splitOutsideParentheses(String(raw)).map(x=>({...x,cell,value:x.text,comparisonKey:comparisonKey(x.text)}));}
  catch{return [{raw:String(raw),value:String(raw).trim(),comparisonKey:comparisonKey(String(raw)),cell,start:0,end:String(raw).length,parseState:'UNRESOLVED_DELIMITERS'}];}
}

// These are proposals against the immutable registry, never approved identity changes.
// First reserve every exact match, then reconcile only unique missing/observed pairs.
function subgroupDifferences(categories,registry,differences,hold) {
  const observed=categories.flatMap(c=>c.subgroups);
  const missing=registry.subgroups.filter(old=>!observed.some(g=>g.id===old.id));
  const unknown=observed.filter(g=>g.id===null);
  const used=new Set(),claimed=new Set();
  const propose=(group,old,kind)=>{
    used.add(old.id);claimed.add(group);
    group.proposedId=old.id;
    differences.push({kind,entity:'SUBGROUP',id:old.id,before:old.title,after:group.title,beforeCell:old.sourceCell,cell:group.sourceCell,state:'HOLD_REQUIRES_DECISION'});
  };
  // An unchanged title at a new cell is a move candidate only when both ends are unique.
  for(const group of unknown){
    const candidates=missing.filter(old=>!used.has(old.id)&&old.title===group.title);
    if(candidates.length===1&&unknown.filter(g=>g.title===group.title).length===1)propose(group,candidates[0],'SUBGROUP_MOVE_PROPOSAL');
  }
  // Same-cell renames are safe to propose only when there is one unmatched title per end.
  for(const group of unknown.filter(g=>!claimed.has(g))){
    const candidates=missing.filter(old=>!used.has(old.id)&&old.sourceCell===group.sourceCell);
    const peers=unknown.filter(g=>!claimed.has(g)&&g.sourceCell===group.sourceCell);
    if(candidates.length===1&&peers.length===1)propose(group,candidates[0],'SUBGROUP_RENAME_PROPOSAL');
  }
  for(const group of unknown.filter(g=>!claimed.has(g))){
    const candidates=missing.filter(old=>!used.has(old.id)&&(old.sourceCell===group.sourceCell||old.title===group.title));
    group.candidateIds=candidates.map(old=>old.id);
    differences.push({kind:candidates.length?'SUBGROUP_AMBIGUOUS_PROPOSAL':'SUBGROUP_ADD_PROPOSAL',entity:'SUBGROUP',id:null,cell:group.sourceCell,after:group.title,beforeCandidates:candidates.map(old=>({id:old.id,title:old.title,cell:old.sourceCell})),state:'HOLD_REQUIRES_DECISION'});
  }
  for(const old of missing.filter(old=>!used.has(old.id))){
    differences.push({kind:'SUBGROUP_DEACTIVATE_PROPOSAL',entity:'SUBGROUP',id:old.id,cell:old.sourceCell,before:old.title,state:'HOLD_REQUIRES_DECISION'});
    hold('SUBGROUP_REMOVAL_REQUIRES_DECISION',old.sourceCell,{id:old.id,title:old.title});
  }
  for(const category of categories){
    const seen=new Set();
    for(const member of category.memberships){
      const group=category.subgroups.find(g=>g.start===member.subgroupSource?.start);
      if(group?.proposedId)member.proposedSubgroupId=group.proposedId;
      // Two unresolved headings must not collapse into the same null-subgroup identity.
      const key=JSON.stringify([member.categoryId,member.subgroupId??member.subgroupSource,member.sourceCompanyRef]);
      member.exactMembershipDuplicate=seen.has(key);seen.add(key);
    }
  }
}

export function parseCatalog(source,registry,{sourceSha256=null}={}) {
  const unresolved=[],normalizationLedger=[],correctionLedger=[],differences=[];
  const hold=(code,cell,details={})=>unresolved.push({code,cell,...details});
  const rows=source.values?.values;
  const sheet=source.source?.sheets?.find(s=>s.properties?.sheetId===518421851);
  if(!Array.isArray(rows)||rows.length!==400||source.values?.range!=="'합의 11'!A1:AA420"||source.values?.majorDimension!=='ROWS'||!sheet||sheet.properties.title!=='합의 11'||source.source?.properties?.title!=='카테고리 3')throw new Error('SOURCE_SCHEMA_MISMATCH');
  if(JSON.stringify(rows[0])!==JSON.stringify(CATEGORY_HEADER)||JSON.stringify(rows[60])!==JSON.stringify(COMPANY_HEADER))throw new Error('SOURCE_HEADER_MISMATCH');
  if(registry.schemaVersion!==1||registry.namespace!=='judoju-news-catalog-v1')throw new Error('REGISTRY_SCHEMA_MISMATCH');
  for(const key of ['categories','companies'])if(new Set(registry[key].map(x=>x.sourceCell)).size!==registry[key].length)throw new Error('REGISTRY_SOURCE_CELL_COLLISION');
  const ids=[...registry.parents,...registry.categories,...registry.companies,...registry.subgroups].map(x=>x.id);
  if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw new Error('REGISTRY_ID_COLLISION');
  if(sourceSha256!==registry.sourceSha256)hold('SOURCE_CHANGED_REQUIRES_REVIEW',source.values.range);
  const normalized=(raw,cell,rawCell=raw)=>{const value=comparisonKey(raw);if(raw!==value)normalizationLedger.push({rule:'NFC_OUTER_TRIM_ONLY',cell,cellSha256:cellHash(rawCell),rawCell,before:raw,after:value});return value;};
  const names=new Map();
  const categories=rows.slice(1,57).map((row,i)=>{
    const sourceRow=i+2,cell='A'+sourceRow,raw=row[0];if(typeof raw!=='string')throw new Error('CATEGORY_NAME_REQUIRED');
    const name=normalized(raw,cell),entry=registry.categories.find(x=>x.sourceCell===cell);
    if(names.has(name))hold('CATEGORY_NAME_COLLISION',cell,{otherCell:names.get(name),name});else names.set(name,cell);
    if(!entry||entry.name!==raw){hold(entry?'CATEGORY_RENAME_REQUIRES_DECISION':'CATEGORY_ADDITION_REQUIRES_ID',cell,{before:entry?.name??null,after:raw});differences.push({kind:entry?'RENAME_PROPOSAL':'ADD_PROPOSAL',cell,id:entry?.id??null,before:entry?.name??null,after:raw});}
    const parents=registry.parents.filter(p=>p.categories.some(x=>comparisonKey(x)===name));
    if(parents.length!==1||entry?.parentId!==parents[0]?.id)hold('PARENT_MAPPING_MISMATCH',cell);
    const keywords=['F','G',...'HIJKLMNOPQ'].flatMap((col,n)=>keywordEntries(row[n+5],col+sourceRow));
    const seen=new Map(),keywordDuplicates=[];
    for(const word of keywords){if(seen.has(word.comparisonKey))keywordDuplicates.push({value:word.value,comparisonKey:word.comparisonKey,cell:word.cell,firstCell:seen.get(word.comparisonKey)});else seen.set(word.comparisonKey,word.cell);}
    return {id:entry?.id??null,sourceRow,sourceCell:cell,rawName:raw,name,parentId:parents[0]?.id??null,rawRow:copy(row),detailDescription:row[2]??null,categorySearchMapping:row[3]??null,categorySearchSuffixInstruction:row[4]??null,keywords,keywordDuplicates,foreignCompanies:{US:{raw:row[17]??null,verification:'UNVERIFIED_SOURCE',entries:keywordEntries(row[17],'R'+sourceRow)},CN:{raw:row[18]??null,verification:'UNVERIFIED_SOURCE',entries:keywordEntries(row[18],'S'+sourceRow)}},subgroups:[],memberships:[],categoryLabel:null};
  });
  for(const parent of registry.parents)for(const name of parent.categories)if(!names.has(comparisonKey(name))){
    hold('PARENT_CATEGORY_NOT_IN_SOURCE',null,{parentId:parent.id,name});
    differences.push({kind:'PARENT_CATEGORY_REMOVAL_PROPOSAL',parentId:parent.id,before:name,state:'HOLD_REQUIRES_DECISION'});
  }
  // Every lower-table record survives, including unresolved identities and unused legacy C.
  const companies=rows.slice(61).map((row,i)=>{
    const sourceRow=i+62,cell='A'+sourceRow,name=normalized(row[0],cell),entry=registry.companies.find(x=>x.sourceCell===cell);
    if(!entry||entry.name!==row[0]){hold(entry?'COMPANY_RENAME_REQUIRES_DECISION':'COMPANY_ADDITION_REQUIRES_ID',cell);differences.push({kind:entry?'RENAME_PROPOSAL':'ADD_PROPOSAL',cell,id:entry?.id??null,before:entry?.name??null,after:row[0]});}
    const categoryRefs=[];
    for(const part of String(row[1]??'').split('\n')){
      const key=normalized(part,'B'+sourceRow,String(row[1]??'')),matches=categories.filter(c=>c.name===key);
      if(matches.length===1)categoryRefs.push({categoryId:matches[0].id,sourceCell:'B'+sourceRow,raw:part});else hold('COMPANY_CATEGORY_UNRESOLVED','B'+sourceRow,{raw:part});
    }
    hold('STOCK_IDENTITY_UNVERIFIED',cell,{sourceCompanyRef:entry?.id??null});
    return {sourceCompanyRef:entry?.id??null,sourceRow,sourceCell:cell,rawRow:copy(row),rawName:row[0],name,categoryRefs,legacyColumnC:row[2]??null,directSearchKeywords:{raw:row[3]??null,entries:keywordEntries(row[3],'D'+sourceRow)},searchDescription:row[4]??null,industrySearchKeywords:{raw:row[5]??null,entries:keywordEntries(row[5],'F'+sourceRow)},stockIdentity:{state:'UNRESOLVED',market:null,code:null,shareClass:null},price:null,changePercent:null,stockUrl:null};
  });
  const dictionary=new Map();for(const company of companies){const list=dictionary.get(company.name)??[];list.push(company);dictionary.set(company.name,list);}
  for(const [name,entries]of dictionary)if(entries.length>1)hold('COMPANY_NAME_COLLISION',entries[0].sourceCell,{name,cells:entries.map(x=>x.sourceCell)});
  const knownNames=[...dictionary.keys()].sort((a,b)=>b.length-a.length);
  const formatSheet=source.subcategoryCellFormatting?.sheets?.find(s=>s.properties?.sheetId===518421851);
  const formatGrid=formatSheet?.data?.find(g=>(g.startRow??0)===1&&(g.startColumn??0)===1);
  if(!formatGrid?.rowData||formatGrid.rowData.length!==56)throw new Error('FORMATTING_RANGE_MISMATCH');
  for(const category of categories){
    const cell='B'+category.sourceRow,raw=category.rawRow[1]??'',format=copy(formatGrid.rowData[category.sourceRow-2]?.values?.[0]??{});
    category.rawRoleCell={cell,value:raw,sha256:cellHash(raw),format};
    if(format.formattedValue!==raw||format.userEnteredValue?.stringValue!==raw)hold('FORMATTING_VALUE_MISMATCH',cell);
    let text=raw;const edits=[];
    for(const correction of registry.corrections.filter(c=>c.cell===cell)){
      const allowed={B5:['HBM) IP 보유, 퀄리타스반도체','HBM) IP 보유), 퀄리타스반도체'],B36:['유도무기 적외선 영상센서\n전차 :','유도무기 적외선 영상센서)\n전차 :']}[cell];
      if(!allowed||correction.before!==allowed[0]||correction.after!==allowed[1]){hold('UNAPPROVED_CORRECTION',cell);continue;}
      if(cellHash(raw)!==correction.cellSha256||text.split(correction.before).length!==2){hold('CORRECTION_PRECONDITION_FAILED',cell);continue;}
      const at=text.indexOf(correction.before),delta=correction.after.length-correction.before.length;
      correctionLedger.push({...copy(correction),rule:'APPROVED_SINGLE_CLOSING_PAREN',beforeCell:raw,afterCell:text.replace(correction.before,correction.after)});
      // Approved corrections insert exactly one ')' and preserve all other text.
      let insertion=0;while(correction.before[insertion]===correction.after[insertion])insertion++;
      edits.push({at:at+insertion,delta});text=text.replace(correction.before,correction.after);
    }
    const originalIndex=index=>index-edits.filter(e=>e.at<index).reduce((n,e)=>n+e.delta,0);
    category.previewRoleText=text;
    const headings=findHeadings(text),plain=registry.plainHeadings.find(x=>x.cell===cell),label=registry.categoryLabels.find(x=>x.cell===cell);
    if(plain&&(plain.cellSha256!==cellHash(raw)||JSON.stringify(plain.titles)!==JSON.stringify(headings.map(h=>h.title))))hold('PLAIN_HEADING_REGISTRY_MISMATCH',cell);
    if(label&&(label.cellSha256!==cellHash(raw)||label.categoryName!==category.name||headings.length!==1||headings[0].title!==label.title))hold('CATEGORY_LABEL_REGISTRY_MISMATCH',cell);
    const sections=headings.length?headings.map((h,i)=>({...h,end:headings[i+1]?.start??text.length})): [{start:0,contentStart:0,end:text.length,title:null}];
    // Text before a heading is not silently dropped.
    if(headings.length&&text.slice(0,headings[0].start).trim())hold('UNPARSED_HEADING_PREFIX',cell,{raw:text.slice(0,headings[0].start)});
    for(const section of sections){
      let subgroup=null;
      if(section.title!==null){
        const titlePositions=[];for(let i=section.start;i<section.colon;i++)if(/[\p{L}\p{N}]/u.test(text[i]))titlePositions.push(originalIndex(i));
        const bold=titlePositions.length>0&&titlePositions.every(i=>boldAt(format,i));
        const plainAccepted=plain&&plain.cellSha256===cellHash(raw)&&JSON.stringify(plain.titles)===JSON.stringify(headings.map(h=>h.title));
        const labelAccepted=label&&label.cellSha256===cellHash(raw)&&headings.length===1&&section.title===label.title&&category.name===label.categoryName;
        if(labelAccepted)category.categoryLabel={...copy(section),sourceCell:cell,offsetSpace:'PREVIEW_UTF16',rawCellPrefix:raw.slice(0,originalIndex(section.contentStart))};
        else {
          const stable=registry.subgroups.find(x=>x.sourceCell===cell&&x.title===section.title);
          const approved=Boolean((bold||plainAccepted)&&stable);
          if(!approved)hold('SUBGROUP_UNRESOLVED',cell,{title:section.title,bold});
          subgroup={id:stable?.id??null,title:section.title,state:approved?'PARSED_SOURCE':'HOLD',evidence:bold?'BOLD_TITLE_LETTERS':plainAccepted?'EXACT_PLAIN_REGISTRY':'UNAPPROVED',sourceCell:cell,start:section.start,end:section.colon,offsetSpace:'PREVIEW_UTF16'};category.subgroups.push(subgroup);
        }
      }
      const content=text.slice(section.contentStart,section.end);let items=[];
      try{items=splitOutsideParentheses(content);}catch{hold('ROLE_LIST_UNBALANCED',cell,{subgroup:section.title,raw:content});continue;}
      for(const item of items){
        const token=item.text;
        const name=knownNames.find(n=>token.startsWith(n)&&(!token[n.length]||/\s|\(/u.test(token[n.length])));
        const matches=name?dictionary.get(name):[];
        const rest=name?token.slice(name.length).trim():'';
        if(!name||matches.length!==1||(rest&&!(rest.startsWith('(')&&rest.endsWith(')')))){hold('ROLE_COMPANY_UNRESOLVED',cell,{raw:item.raw,subgroup:section.title});continue;}
        const company=matches[0],role=rest?rest.slice(1,-1):null;
        const membership={categoryId:category.id,subgroupId:subgroup?.id??null,subgroupSource:subgroup?{cell,start:subgroup.start,title:subgroup.title}:null,sourceCompanyRef:company.sourceCompanyRef,name,role,sourceCell:cell,raw:item.raw,start:section.contentStart+item.start,end:section.contentStart+item.end,offsetSpace:'PREVIEW_UTF16',state:subgroup?.state==='HOLD'?'HOLD':'PARSED_SOURCE'};
        if(!company.categoryRefs.some(x=>x.categoryId===category.id)){hold('UPPER_LOWER_MEMBERSHIP_DIFFERENCE',cell,{company:name});membership.state='HOLD';}
        category.memberships.push(membership);
      }
    }
  }
  subgroupDifferences(categories,registry,differences,hold);
  const upperConnections=new Set(categories.flatMap(c=>c.memberships.map(m=>JSON.stringify([m.categoryId,m.sourceCompanyRef]))));
  for(const company of companies)for(const ref of company.categoryRefs)if(!upperConnections.has(JSON.stringify([ref.categoryId,company.sourceCompanyRef])))hold('LOWER_UPPER_MEMBERSHIP_DIFFERENCE',ref.sourceCell,{company:company.name,categoryId:ref.categoryId,categoryName:categories.find(c=>c.id===ref.categoryId)?.name??null});
  for(const entry of registry.categories)if(!categories.some(c=>c.sourceCell===entry.sourceCell))differences.push({kind:'DEACTIVATE_PROPOSAL',id:entry.id,cell:entry.sourceCell});
  return {schemaVersion:1,parserVersion:PARSER_VERSION,mode:'OFFLINE_PREVIEW_ONLY',importable:false,sourceSha256,registrySourceSha256:registry.sourceSha256,sourceBytesPreserved:true,rawSource:copy(source),parents:copy(registry.parents),categories,companies,normalizationLedger,correctionLedger,differences,unresolved,summary:{categoryCount:categories.length,companySourceRecordCount:companies.length,subgroupCount:categories.reduce((n,c)=>n+c.subgroups.length,0),membershipCount:categories.reduce((n,c)=>n+c.memberships.length,0),unverifiedStockIdentities:companies.length,structuralHoldCount:unresolved.filter(x=>x.code!=='STOCK_IDENTITY_UNVERIFIED').length,sourceWrites:0,databaseWrites:0,networkRequests:0},status:unresolved.length?'PREVIEW_WITH_HOLDS':'PREVIEW_ONLY'};
}
