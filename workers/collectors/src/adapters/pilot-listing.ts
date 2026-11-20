/** COLLECTION_READ_P3 pure offline fixture parsers. No HTML selectors, authority claims, search or requests. */
import {
  OFFLINE_READ_FLAGS,collectionRecord,collectionExact,collectionId,collectionText,collectionNumber,collectionStamp,collectionTime,collectionStrings,collectionHash,collectionClone,collectionReject,validateCollectionAnalysisRead,
  type CollectionObservationMetadata,
} from '../collection-read-contracts.ts';
export const PILOT_LISTING_VERSION='pilot-json-listing-p3-v1' as const;
export const PILOT_TELEGRAM_VERSION='pilot-telegram-links-p3-v1' as const;
export interface PilotListingCandidate {
  sourceId:string;endpointId:string;nativeId:string;url:string;title:string;lead:string;publisherId:string;originId:string|null;independenceGroupId:string|null;
  publishedAt:string|null;updatedAt:string|null;timeQuality:'KNOWN'|'PENDING_TIME';parserVersion:typeof PILOT_LISTING_VERSION;bytesDigest:string;originalAccess:'REQUIRES_SEPARATE_GRANT';
}
export interface PilotListingResult {
  schema:'COLLECTION_READ_P3';mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;
  parserKind:'STRUCTURED_JSON_LISTING';status:'COMPLETE'|'PARTIAL'|'PARSE_HOLD';reasons:string[];candidates:PilotListingCandidate[];nextCursor:string|null;checkpointEnabled:false;
}
export interface PilotTelegramEvent {
  sourceId:string;endpointId:string;channelId:string;messageId:string;editVersion:number;eventAt:string;eventKind:'CREATE'|'EDIT'|'DELETE';identity:string;
  links:Array<{url:string;originalAccess:'REQUIRES_SEPARATE_GRANT'}>;requiresDependencyRecheck:boolean;withdrawOriginal:false;independentEvidence:false;parserVersion:typeof PILOT_TELEGRAM_VERSION;bytesDigest:string;
}
const listing=(status:PilotListingResult['status'],reasons:string[],candidates:PilotListingCandidate[]=[],nextCursor:string|null=null):PilotListingResult=>({...OFFLINE_READ_FLAGS,parserKind:'STRUCTURED_JSON_LISTING',status,reasons:[...new Set(reasons)].sort(),candidates,nextCursor,checkpointEnabled:false});
const parseRange=(raw:unknown):{from:string;to:string}=>{const value=collectionRecord(raw);collectionExact(value,['from','to']);const from=collectionStamp(value.from),to=collectionStamp(value.to);if(collectionTime(from)>collectionTime(to))collectionReject();return {from,to};};
/** Native JSON syntax plus a linear duplicate-key check, including escaped aliases. No HTML parsing. */
function parseFixtureJson(text:string):Record<string,unknown> {
  const parsed=JSON.parse(text),stack:Array<Set<string>|null>=[];
  for(let at=0;at<text.length;at++){
    const char=text[at];if(char==='{')stack.push(new Set());else if(char==='[')stack.push(null);else if(char==='}'||char===']')stack.pop();
    else if(char==='"'){
      const start=at;for(at++;at<text.length;at++){if(text[at]==='\\')at++;else if(text[at]==='"')break;}
      let next=at+1;while(next<text.length&&/\s/.test(text[next]))next++;
      if(text[next]===':'){const keys=stack.at(-1),key=JSON.parse(text.slice(start,at+1)) as string;if(!keys||keys.has(key))collectionReject();keys.add(key);}
    }
  }
  return collectionRecord(parsed);
}
function declaredLink(raw:unknown):string {
  const text=collectionText(raw);let value:URL;try{value=new URL(text);}catch{collectionReject();}
  if(value!.protocol!=='https:'||value!.username||value!.password||value!.port||value!.hash||value!.href!==text||/^\[|^[0-9.]+$/.test(value!.hostname)||value!.hostname==='localhost'||value!.hostname.endsWith('.localhost')||value!.hostname.endsWith('.local'))collectionReject();return text;
}
function candidate(raw:unknown,metadata:CollectionObservationMetadata):PilotListingCandidate {
  const value=collectionRecord(raw);collectionExact(value,['nativeId','url','title','lead','publishedAt','updatedAt','timeQuality']);const nativeId=collectionId(value.nativeId),url=declaredLink(value.url),title=collectionText(value.title,500);
  if(typeof value.lead!=='string'||value.lead.length>4000)collectionReject();
  const publishedAt=value.publishedAt===null?null:collectionStamp(value.publishedAt),updatedAt=value.updatedAt===null?null:collectionStamp(value.updatedAt);
  if(value.timeQuality==='KNOWN'){if(publishedAt===null)collectionReject();}else if(value.timeQuality!=='PENDING_TIME'||publishedAt!==null)collectionReject();
  for(const time of [publishedAt,updatedAt])if(time!==null&&collectionTime(time)>collectionTime(metadata.receivedAt))collectionReject();if(publishedAt!==null&&updatedAt!==null&&collectionTime(updatedAt)<collectionTime(publishedAt))collectionReject();
  return {sourceId:metadata.sourceId,endpointId:metadata.endpointId,nativeId,url,title,lead:value.lead,publisherId:metadata.publisherId,originId:metadata.originId,independenceGroupId:metadata.independenceGroupId,publishedAt,updatedAt,timeQuality:value.timeQuality as PilotListingCandidate['timeQuality'],parserVersion:PILOT_LISTING_VERSION,bytesDigest:metadata.bodyHash,originalAccess:'REQUIRES_SEPARATE_GRANT'};
}

/** Validates declared fixture bytes only. This pure parser does not authenticate artifact ownership or rights. */
export function parsePilotListing(raw:unknown):PilotListingResult {
  const input=collectionRecord(raw);collectionExact(input,['artifact','expectedTab','expectedRange']);const artifact=validateCollectionAnalysisRead(input.artifact),expectedTab=collectionText(input.expectedTab,100),expectedRange=parseRange(input.expectedRange);
  if(artifact.metadata.purpose!=='DISCOVERY')return listing('PARSE_HOLD',['PURPOSE_KIND_MISMATCH']);
  if(artifact.metadata.contentType!=='application/json')return listing('PARSE_HOLD',['UNSUPPORTED_CONTENT_TYPE']);if(artifact.metadata.parserVersion!==PILOT_LISTING_VERSION)return listing('PARSE_HOLD',['PARSER_VERSION_UNAPPROVED']);
  let document:Record<string,unknown>;try{document=parseFixtureJson(artifact.text);}catch{return listing('PARSE_HOLD',['INVALID_JSON_LISTING']);}
  try{
    collectionExact(document,['schema','tab','range','complete','partial','nextCursor','previousCursors','items']);if(document.schema!=='PILOT_JSON_LISTING_P3'||typeof document.complete!=='boolean'||typeof document.partial!=='boolean'||!Array.isArray(document.items)||document.items.length>300||document.complete&&document.partial)collectionReject();
    const tab=collectionText(document.tab,100),range=parseRange(document.range),previous=collectionStrings(document.previousCursors,100,4096),next=document.nextCursor===null?null:collectionText(document.nextCursor,4096),reasons:string[]=[];
    if(tab!==expectedTab)reasons.push('TAB_GAP');if(range.from!==expectedRange.from||range.to!==expectedRange.to)reasons.push('RANGE_GAP');if(next!==null&&previous.includes(next))reasons.push('CURSOR_CYCLE');
    const candidates=document.items.map(item=>candidate(item,artifact.metadata));if(new Set(candidates.map(c=>c.nativeId)).size!==candidates.length)reasons.push('DUPLICATE_NATIVE_ID');if(new Set(candidates.map(c=>c.url)).size!==candidates.length)reasons.push('DUPLICATE_URL');
    if(reasons.length)return listing('PARSE_HOLD',reasons);
    if(!document.complete||document.partial||next!==null)return listing('PARTIAL',['LISTING_INCOMPLETE'],candidates,next);return listing('COMPLETE',[],candidates,null);
  }catch{return listing('PARSE_HOLD',['INVALID_LISTING_STRUCTURE']);}
}

export function parsePilotTelegramLinks(raw:unknown){
  const input=collectionRecord(raw);collectionExact(input,['artifact']);const artifact=validateCollectionAnalysisRead(input.artifact);
  const result=(reasons:string[],events:PilotTelegramEvent[]=[])=>({...OFFLINE_READ_FLAGS,parserKind:'TELEGRAM_LINK_ENTITIES' as const,status:reasons.length?'PARSE_HOLD' as const:'COMPLETE' as const,reasons:[...new Set(reasons)].sort(),events,checkpointEnabled:false as const,searchFallbackEnabled:false as const});
  if(artifact.metadata.purpose!=='LINK_EXTRACTION')return result(['PURPOSE_KIND_MISMATCH']);
  if(artifact.metadata.contentType!=='application/json')return result(['UNSUPPORTED_CONTENT_TYPE']);if(artifact.metadata.parserVersion!==PILOT_TELEGRAM_VERSION)return result(['PARSER_VERSION_UNAPPROVED']);
  try{
    const document=parseFixtureJson(artifact.text);collectionExact(document,['schema','events']);if(document.schema!=='PILOT_TELEGRAM_LINKS_P3'||!Array.isArray(document.events)||document.events.length>100)collectionReject();
    const identities=new Set<string>(),events:PilotTelegramEvent[]=[];
    for(const rawEvent of document.events){const value=collectionRecord(rawEvent);collectionExact(value,['channelId','messageId','editVersion','eventAt','eventKind','links']);
      const channelId=collectionId(value.channelId),messageId=collectionId(value.messageId),editVersion=collectionNumber(value.editVersion),eventAt=collectionStamp(value.eventAt);if(collectionTime(eventAt)>collectionTime(artifact.metadata.receivedAt)||!['CREATE','EDIT','DELETE'].includes(value.eventKind as string)||!Array.isArray(value.links)||value.links.length>32||value.eventKind==='DELETE'&&value.links.length!==0)collectionReject();
      const urls=value.links.map(rawLink=>{const link=collectionRecord(rawLink);collectionExact(link,['url']);return declaredLink(link.url);});if(new Set(urls).size!==urls.length)collectionReject();const identity=collectionHash({channelId,messageId,editVersion,eventKind:value.eventKind});if(identities.has(identity))return result(['DUPLICATE_EVENT_IDENTITY']);identities.add(identity);
      events.push({sourceId:artifact.metadata.sourceId,endpointId:artifact.metadata.endpointId,channelId,messageId,editVersion,eventAt,eventKind:value.eventKind as PilotTelegramEvent['eventKind'],identity,links:urls.map(url=>({url,originalAccess:'REQUIRES_SEPARATE_GRANT'})),requiresDependencyRecheck:value.eventKind!=='CREATE',withdrawOriginal:false,independentEvidence:false,parserVersion:PILOT_TELEGRAM_VERSION,bytesDigest:artifact.metadata.bodyHash});
    }
    return collectionClone(result([],events));
  }catch{return result(['INVALID_TELEGRAM_STRUCTURE']);}
}
