/** Preflight for a composed draft using currently authorized collector originals. */
import {collectorDataV1,collectorRecordV1} from '../../collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1} from '../../collectors/src/collector-db-canonical-v1.ts';
import {isOwnedDurableAnalysisInputPort,type DurableAnalysisRequestV1,type OwnedDurableAnalysisInputPort} from './durable-input.ts';
import {readSyntheticArticleEnvelope} from './article-envelope.ts';
import {screenArticleOriginality} from './originality-screen.ts';

const encoder = new TextEncoder();
const draftText = (value:unknown):string => {
  if (typeof value!=='string') throw new Error('DRAFT_WORDING_INPUT_INVALID');
  return value;
};
function rows(value:unknown):unknown[] {
  if (!Array.isArray(value)) throw new Error('DRAFT_WORDING_INPUT_INVALID');
  return value;
}

/** Collect editorial prose in the same order it appears in editor content. */
function projectDraftWording(draft:Record<string,unknown>) {
  const parts:Array<{id:string;text:string}> = [];
  const add = (id:string, value:unknown) => {
    const text = draftText(value);
    if (text.trim()) parts.push({id,text});
  };
  const addList = (id:string, value:unknown) => rows(value).forEach((text,n)=>add(id+'-'+n,text));
  add('summary',draft.summary);
  addList('key-issues',draft.key_issues);
  add('issue-analysis',draft.issue_analysis);
  rows(draft.scenarios).forEach((raw,n)=>{
    const item = collectorRecordV1(raw);
    const prefix = 'scenario-'+n;
    add(prefix+'-title',item.title);
    add(prefix+'-outcome',item.expected_result);
    addList(prefix+'-checks',item.checks);
  });
  rows(draft.impacts).forEach((raw,n)=>{
    const item = collectorRecordV1(raw);
    const prefix = 'impact-'+n;
    add(prefix+'-description',item.description);
    addList(prefix+'-conditions',item.conditions);
  });
  addList('risks',draft.risks);
  rows(draft.schedule).forEach((raw,n)=>{
    const item = collectorRecordV1(raw);
    add('schedule-'+n+'-title',item.title);
    if (item.kind==='PERIOD') add('schedule-'+n+'-period',item.period_label);
  });
  return {headline:draftText(draft.title),parts};
}

export async function screenCollectedDraft(
  port:OwnedDurableAnalysisInputPort,
  requests:readonly DurableAnalysisRequestV1[],
  rawDraft:unknown,
  rawPolicy:unknown,
) {
  const draft = collectorRecordV1(collectorDataV1(rawDraft));
  const policy = collectorDataV1(rawPolicy);
  const snapshot = collectorDataV1(requests) as DurableAnalysisRequestV1[];
  if (!Array.isArray(snapshot) || snapshot.length>8) throw new Error('DRAFT_WORDING_INPUT_INVALID');
  const draftDigest = collectorBodyHashV1(encoder.encode(JSON.stringify(draft)));
  const held = () => ({
    state:'HOLD_SOURCE_NOT_CURRENT' as const,draftDigest,findings:[],
    fixtureOnly:true as const,publicationAuthorized:false as const,
  });
  if (!snapshot.length || !isOwnedDurableAnalysisInputPort(port)) return held();
  const ids = new Set<string>();
  const handles:object[] = [];
  for (const request of snapshot) {
    const current = await port.readForAnalysis(request);
    if (current.disposition!=='READY_SYNTHETIC_INPUT' || ids.has(current.input.source.identity.deliveryId)) return held();
    ids.add(current.input.source.identity.deliveryId);
    handles.push(current.handle);
  }
  const sourceParts:Array<{id:string;text:string}> = [];
  const checkedSources:Array<{deliveryId:string;bodyDigest:string;checkedAt:string}> = [];
  for (const [n,handle] of handles.entries()) {
    const current = await port.readOwnedAnalysisInput(handle);
    if (current.disposition!=='READY_SYNTHETIC_INPUT') return held();
    const {text} = current.input.content;
    let article;
    try {article=readSyntheticArticleEnvelope(text);} catch {return held();}
    const deliveryId = current.input.source.identity.deliveryId;
    checkedSources.push({deliveryId,bodyDigest:snapshot[n].source.expectedBodyHash,checkedAt:current.checkedAt});
    for (const [part,words] of Object.entries(article)) {
      if (words.trim()) sourceParts.push({id:deliveryId+'-'+part,text:words});
    }
  }
  const comparison = screenArticleOriginality({policy,sourceParts,draft:projectDraftWording(draft)});
  return {...comparison,draftDigest,checkedSources};
}
