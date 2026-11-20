/** A literal wording screen for editorial fixtures. It grants no publication authority. */
import {pipelineId} from '../../../packages/contracts/src/pipeline.ts';
import {
  COLLECTOR_DB_LIMITS_V1,collectorExactV1,collectorIsProxyV1,collectorRecordV1,collectorUtf8V1,
} from '../../collectors/src/collector-db-contracts-v1.ts';

type TextPart = {id:string;text:string};
type OriginalityFinding = {
  draftPartId:string;
  sourcePartId:string;
  rule:'SHARED_HEADLINE_WORDING'|'SHARED_PASSAGE';
  matchedAtLeastCharacters:number;
};

function invalid():never {throw new Error('ARTICLE_ORIGINALITY_INPUT_INVALID');}

function text(value:unknown,max:number):string {
  if (typeof value!=='string' || value.length>max || !value.trim()) invalid();
  return value;
}
function identifier(value:unknown):string {
  if (!pipelineId(value)) invalid();
  return value;
}
export function normalizeComparableWording(value:string):string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu,'');
}
function parts(raw:unknown,maxCount:number,partBytes:number,totalBytes:number):TextPart[] {
  if (collectorIsProxyV1(raw) || !Array.isArray(raw) || Object.getPrototypeOf(raw)!==Array.prototype ||
      raw.length>maxCount || Reflect.ownKeys(raw).length!==raw.length+1) invalid();
  const result:TextPart[] = [];
  let remaining = totalBytes;
  for (let n=0; n<raw.length; n++) {
    const entry = Object.getOwnPropertyDescriptor(raw,String(n));
    if (!entry || !entry.enumerable || !('value' in entry)) invalid();
    const part = collectorRecordV1(entry.value);
    collectorExactV1(part,['id','text']);
    const value = text(part.text,partBytes);
    const bytes = collectorUtf8V1(value).byteLength;
    remaining -= bytes;
    if (bytes>partBytes || remaining<0) invalid();
    result.push({id:identifier(part.id),text:value});
  }
  if (new Set(result.map(value=>value.id)).size!==result.length) invalid();
  return result;
}
function width(value:unknown):number {
  if (typeof value!=='number' || !Number.isInteger(value) || value<8 || value>120) invalid();
  return value;
}

export function screenArticleOriginality(raw:unknown) {
  const input = collectorRecordV1(raw);
  collectorExactV1(input,['policy','sourceParts','draft']);
  const policy = collectorRecordV1(input.policy);
  collectorExactV1(policy,['version','headlineCharacters','passageCharacters']);
  const version = identifier(policy.version);
  const headlineWidth = width(policy.headlineCharacters);
  const passageWidth = width(policy.passageCharacters);
  const sourceParts = parts(input.sourceParts,24,COLLECTOR_DB_LIMITS_V1.bodyBytes,8*COLLECTOR_DB_LIMITS_V1.bodyBytes);
  const draft = collectorRecordV1(input.draft);
  collectorExactV1(draft,['headline','parts']);
  const draftLimit = COLLECTOR_DB_LIMITS_V1.wireBytes;
  const headline = text(draft.headline,draftLimit);
  const remainingDraftBytes = draftLimit-collectorUtf8V1(headline).byteLength;
  if (remainingDraftBytes<0) invalid();
  const draftParts = [
    {id:'headline',text:headline,width:headlineWidth,rule:'SHARED_HEADLINE_WORDING' as const},
    ...parts(draft.parts,COLLECTOR_DB_LIMITS_V1.nodes,draftLimit,remainingDraftBytes)
      .map(part=>({...part,width:passageWidth,rule:'SHARED_PASSAGE' as const})),
  ];
  if (draftParts.length<2 || new Set(draftParts.map(part=>part.id)).size!==draftParts.length) invalid();
  const output = {policyVersion:version,comparison:'NFKC_LETTER_NUMBER_MARK_RUNS_V1' as const,
    fixtureOnly:true as const,publicationAuthorized:false as const};
  const sources = sourceParts.map(part=>({id:part.id,characters:Array.from(normalizeComparableWording(part.text))}));
  if (sources.some(source=>source.characters.length===0)) invalid();
  if (!sources.length) return {...output,state:'HOLD_NO_SOURCE' as const,findings:[]};
  const indexes = new Map<number,Map<string,Set<number>>>();
  for (const [partNumber,part] of draftParts.entries()) {
    const characters = Array.from(normalizeComparableWording(part.text));
    if (!characters.length) invalid();
    let windows = indexes.get(part.width);
    if (!windows) indexes.set(part.width,windows=new Map());
    for (let start=0; start+part.width<=characters.length; start++) {
      const window = characters.slice(start,start+part.width).join('');
      let targets = windows.get(window);
      if (!targets) windows.set(window,targets=new Set());
      targets.add(partNumber);
    }
  }
  const found = new Map<number,OriginalityFinding>();
  for (const [charactersRequired,windows] of indexes) {
    if (!windows.size) continue;
    for (const source of sources) {
      const characters = source.characters;
      for (let start=0; windows.size && start+charactersRequired<=characters.length; start++) {
        const window = characters.slice(start,start+charactersRequired).join('');
        const matches = windows.get(window);
        if (!matches) continue;
        for (const partNumber of matches) {
          const part = draftParts[partNumber];
          if (!found.has(partNumber)) found.set(partNumber,{
            draftPartId:part.id,sourcePartId:source.id,rule:part.rule,
            matchedAtLeastCharacters:charactersRequired,
          });
        }
        windows.delete(window);
      }
    }
  }
  return {...output,state:found.size?'HOLD_SHARED_WORDING' as const:'NO_LITERAL_MATCH' as const,
    findings:[...found].sort(([a],[b])=>a-b).map(([,finding])=>finding)};
}
