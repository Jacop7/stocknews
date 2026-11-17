/** Node-only COLLECTION_READ_P3. Checks offline observations; opens no socket and has no default transport. */
import {PipelineError} from '../../../packages/contracts/src/pipeline.ts';
import {PILOT_TELEGRAM_VERSION,parsePilotTelegramLinks} from './adapters/pilot-listing.ts';
import {
  OFFLINE_READ_FLAGS,DEFAULT_COLLECTION_READ_LIMITS,collectionReject,collectionClone,collectionCanonical,collectionHash,collectionBytesHash,collectionBackend,collectionRecord,collectionExact,collectionId,collectionText,collectionNumber,collectionTime,collectionStamp,collectionDigest,collectionStrings,collectionResponseRecord,
  validateCollectionGrant,validatePrepareCollectionRead,validateCollectionReadLimits,validateCollectionCacheRef,validateCollectionMetadata,
  type OfflineFixtureAuthority,type CollectionGrant,type CollectionPurpose,type CollectionReadTicket,type CollectionObservationMetadata,type CollectionAnalysisRead,type CollectionReadLimits,type PrepareCollectionRead,type CollectionSourceAssertion,type CollectionCacheRef,
} from './collection-read-contracts.ts';
declare const process:{getBuiltinModule(name:'node:net'):{isIP(value:string):number;};getBuiltinModule(name:'node:zlib'):{gunzipSync(raw:Uint8Array,options:{maxOutputLength:number}):Uint8Array;}};
const net=process.getBuiltinModule('node:net'),zlib=process.getBuiltinModule('node:zlib');
const owned=new WeakSet<object>(),encoder=new TextEncoder();
interface TicketEntry {ticket:CollectionReadTicket;grant:CollectionGrant;source:CollectionSourceAssertion;parserVersion:string;requestCanonical:string;phase:'OPEN'|'REDIRECTED'|'ACCEPTED';redirectCanonical:string|null;redirectTicketId:string|null;responseCanonical:string|null;observationId:string|null;}
interface Observation {metadata:CollectionObservationMetadata;grant:CollectionGrant;etag:string|null;}
interface Ledger {grantId:string;generation:number;digest:string;requests:number;reservedRawBytes:number;}
interface State {backendGeneration:string;watermark:string|null;tickets:TicketEntry[];observations:Observation[];ledgers:Ledger[];}
interface PrivateBody {raw:Uint8Array;text:string;}
const equal=(a:unknown,b:unknown):boolean=>collectionCanonical(a)===collectionCanonical(b);

/** WeakSet ownership is an offline object boundary, not rights authentication. Proxies are not owned. */
export function isOwnedCollectionReadBoundary(value:unknown):value is OfflineCollectionReadBoundary {
  return !!value&&typeof value==='object'&&owned.has(value)&&Object.getPrototypeOf(value)===OfflineCollectionReadBoundary.prototype;
}
export class OfflineCollectionReadBoundary {
  #authority:OfflineFixtureAuthority;#limits:CollectionReadLimits;#state:State;#bodies=new Map<string,PrivateBody>();
  constructor(authority:OfflineFixtureAuthority,limits:unknown=DEFAULT_COLLECTION_READ_LIMITS){
    if(new.target!==OfflineCollectionReadBoundary||!authority||typeof authority.current!=='function')collectionReject();
    this.#authority=authority;this.#limits=validateCollectionReadLimits(limits);this.#state={backendGeneration:collectionBackend(),watermark:null,tickets:[],observations:[],ledgers:[]};owned.add(this);
  }
  get backendGeneration():string {return this.#state.backendGeneration;}
  #owned():void {if(!isOwnedCollectionReadBoundary(this))collectionReject('INVALID_INPUT');}
  #now(raw:unknown):string {const now=collectionStamp(raw);if(this.#state.watermark!==null&&collectionTime(now)<collectionTime(this.#state.watermark))collectionReject('POLICY_STALE');return now;}
  #grant(sourceId:string,endpointId:string,now:string,required:CollectionPurpose[],expectedGeneration?:number,expectedDigest?:string):CollectionGrant {
    const grant=validateCollectionGrant(this.#authority.current(sourceId,endpointId,now)),digest=collectionHash(grant);
    if(grant.sourceId!==sourceId||grant.endpointId!==endpointId)collectionReject('RIGHTS_HOLD');
    if(expectedGeneration!==undefined&&grant.generation!==expectedGeneration||expectedDigest!==undefined&&digest!==expectedDigest)collectionReject('POLICY_STALE');
    const known=this.#state.ledgers.filter(l=>l.grantId===grant.grantId);
    if(known.some(l=>l.generation>grant.generation||l.generation===grant.generation&&l.digest!==digest))collectionReject('POLICY_STALE');
    if(collectionTime(grant.knownAt)>collectionTime(now)||collectionTime(grant.expiresAt)<=collectionTime(now)||required.some(p=>!grant.purposes[p]))collectionReject('RIGHTS_HOLD');return grant;
  }
  #url(raw:string,grant:CollectionGrant):string {
    let url:URL;try{url=new URL(raw);}catch{collectionReject('RIGHTS_HOLD');}
    // Canonical ASCII-only URL and exact path scope avoid encoded separators/dot normalization ambiguity.
    if(url!.protocol!=='https:'||url!.username||url!.password||url!.port||url!.hash||url!.href!==raw||/[\\%]/.test(url!.pathname)||net.isIP(url!.hostname.replace(/^\[|\]$/g,''))!==0||url!.hostname==='localhost'||url!.hostname.endsWith('.localhost')||url!.hostname.endsWith('.local')||!grant.scope.hosts.includes(url!.hostname)||!grant.scope.paths.includes(url!.pathname)||[...url!.searchParams.keys()].some(k=>!grant.scope.queryKeys.includes(k)))collectionReject('RIGHTS_HOLD');return url!.href;
  }
  #dns(raw:unknown):string[] {
    const addresses=collectionStrings(raw,16,64);if(!addresses.length)collectionReject('RIGHTS_HOLD');
    for(const address of addresses){
      // P3 supports IPv4 fixture observations only. All IPv6/mapped addresses fail closed.
      if(net.isIP(address)!==4)collectionReject('RIGHTS_HOLD');const [a,b,c]=address.split('.').map(Number);
      if(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)collectionReject('RIGHTS_HOLD');
    }
    return [...addresses].sort();
  }
  #entry(rawTicket:unknown,now:string,extraPurposes:CollectionPurpose[]=[]):{entry:TicketEntry;grant:CollectionGrant} {
    const value=collectionRecord(rawTicket),id=collectionId(value.ticketId),entry=this.#state.tickets.find(t=>t.ticket.ticketId===id);
    if(!entry||value.backendGeneration!==this.backendGeneration||!equal(value,entry.ticket))collectionReject('EFFECT_CONFLICT');
    const ticket=entry.ticket,grant=this.#grant(ticket.sourceId,ticket.endpointId,now,[ticket.purpose,'STORAGE',...(entry.parserVersion===PILOT_TELEGRAM_VERSION?['LINK_EXTRACTION' as const]:[]),...extraPurposes],ticket.grantGeneration,ticket.grantDigest);this.#url(ticket.url,grant);return {entry,grant};
  }
  #reserve(state:State,grant:CollectionGrant):void {
    const digest=collectionHash(grant);let ledger=state.ledgers.find(l=>l.grantId===grant.grantId&&l.generation===grant.generation);
    if(!ledger){ledger={grantId:grant.grantId,generation:grant.generation,digest,requests:0,reservedRawBytes:0};state.ledgers.push(ledger);}
    if(ledger.digest!==digest)collectionReject('POLICY_STALE');
    if(ledger.requests+1>grant.budget.maxRequests||ledger.reservedRawBytes+grant.budget.maxRawBytes>grant.budget.totalRawBytes)collectionReject('RATE_LIMITED');
    ledger.requests++;ledger.reservedRawBytes+=grant.budget.maxRawBytes;
  }
  #save<T>(now:string,state:State,result:T,newBody?:{observationId:string;body:PrivateBody}):T {
    if(state.tickets.length>this.#limits.tickets||state.observations.length>this.#limits.observations)collectionReject('RATE_LIMITED');
    let privateBytes=0;for(const body of this.#bodies.values())privateBytes+=body.raw.byteLength+body.text.length*2;
    if(newBody)privateBytes+=newBody.body.raw.byteLength+newBody.body.text.length*2;if(privateBytes>this.#limits.privateBytes)collectionReject('RATE_LIMITED');
    state.watermark=now;let detached:State;try{detached=collectionClone(state);}catch(error){if(error instanceof PipelineError&&error.code==='INVALID_INPUT')collectionReject('RATE_LIMITED');throw error;}
    const output=collectionClone(result);if(newBody)this.#bodies.set(newBody.observationId,{raw:Uint8Array.prototype.slice.call(newBody.body.raw) as Uint8Array,text:newBody.body.text});this.#state=detached;return output;
  }
  #cache(ref:CollectionCacheRef,grant:CollectionGrant,url:string,representation:PrepareCollectionRead['representation'],purpose:PrepareCollectionRead['purpose'],now:string):Observation {
    const cached=this.#state.observations.find(o=>o.metadata.observationId===ref.observationId),body=this.#bodies.get(ref.observationId);
    if(!cached||!body||cached.metadata.backendGeneration!==this.backendGeneration||cached.metadata.bodyHash!==ref.bodyHash)collectionReject('EFFECT_CONFLICT');
    if(cached.metadata.url!==url||!equal(cached.metadata.representation,representation)||cached.metadata.purpose!==purpose||cached.metadata.grantGeneration!==grant.generation||cached.metadata.grantDigest!==collectionHash(grant))collectionReject('POLICY_STALE');
    if(collectionTime(cached.metadata.retentionUntil)<=collectionTime(now)||!cached.etag)collectionReject('RIGHTS_HOLD');return cached;
  }
  prepareRead(raw:unknown):CollectionReadTicket {
    this.#owned();const input=validatePrepareCollectionRead(raw);
    if(input.parserVersion.startsWith('pilot-telegram-')&&input.purpose!=='LINK_EXTRACTION'||input.parserVersion.startsWith('pilot-json-listing-')&&input.purpose!=='DISCOVERY'||input.purpose==='LINK_EXTRACTION'&&input.parserVersion!==PILOT_TELEGRAM_VERSION)collectionReject('RIGHTS_HOLD');
    const now=this.#now(input.checkedAt),grant=this.#grant(input.sourceId,input.endpointId,now,[input.purpose,'STORAGE',...(input.parserVersion===PILOT_TELEGRAM_VERSION?['LINK_EXTRACTION' as const]:[])],input.expectedGrantGeneration),url=this.#url(input.url,grant),dnsAddresses=this.#dns(input.dnsAddresses);
    if(!grant.scope.methods.includes(input.method))collectionReject('RIGHTS_HOLD');const {checkedAt:_at,...identity}=input,requestCanonical=collectionCanonical({...identity,dnsAddresses}),old=this.#state.tickets.find(t=>t.ticket.requestId===input.requestId&&t.ticket.hop===0);
    if(old){if(old.requestCanonical!==requestCanonical||old.ticket.grantDigest!==collectionHash(grant))collectionReject('EFFECT_CONFLICT');return this.#save(now,collectionClone(this.#state),old.ticket);}
    if(input.cacheRef){const cached=this.#cache(input.cacheRef,grant,url,input.representation,input.purpose,now);if(!this.#sameSource(input.source,cached.metadata)||input.parserVersion!==cached.metadata.parserVersion)collectionReject('EFFECT_CONFLICT');}
    const base={...OFFLINE_READ_FLAGS,backendGeneration:this.backendGeneration,requestId:input.requestId,sourceId:input.sourceId,endpointId:input.endpointId,grantGeneration:grant.generation,grantDigest:collectionHash(grant),url,method:input.method,purpose:input.purpose,representation:input.representation,dnsAddresses,requestedAt:now,hopStartedAt:now,deadlineAt:new Date(Math.min(collectionTime(now)+grant.budget.deadlineMs,collectionTime(grant.expiresAt))).toISOString(),hop:0,parentTicketId:null,cacheRef:input.cacheRef};
    const ticket:CollectionReadTicket={...base,ticketId:'read-'+collectionHash(base)},next=collectionClone(this.#state);this.#reserve(next,grant);next.tickets.push({ticket,grant,source:input.source,parserVersion:input.parserVersion,requestCanonical,phase:'OPEN',redirectCanonical:null,redirectTicketId:null,responseCanonical:null,observationId:null});return this.#save(now,next,ticket);
  }
  validateRedirect(raw:unknown):CollectionReadTicket {
    this.#owned();const r=this.#response(raw,'REDIRECT'),{value,entry,grant,now}=r,location=collectionText(r.headers.get('location')),dnsAddresses=this.#dns(value.nextDnsAddresses),names=collectionStrings(value.forwardedHeaderNames,32,100).map(n=>n.toLowerCase());
    // No opaque/custom credential-bearing request headers exist in this minimal offline contract.
    if(![301,302,303,307,308].includes(value.status as number)||names.some(n=>!['accept','accept-language'].includes(n)))collectionReject('RIGHTS_HOLD');
    if(collectionTime(now)>collectionTime(entry.ticket.deadlineAt)||entry.ticket.hop>=grant.budget.maxRedirects)collectionReject('RIGHTS_HOLD');
    let absolute:string;try{absolute=new URL(location,entry.ticket.url).href;}catch{collectionReject('RIGHTS_HOLD');}const url=this.#url(absolute!,grant);
    let parent:TicketEntry|undefined=entry;while(parent){if(parent.ticket.url===url)collectionReject('RETRYABLE_READ_FAILURE');parent=parent.ticket.parentTicketId===null?undefined:this.#state.tickets.find(t=>t.ticket.ticketId===parent!.ticket.parentTicketId);}
    const canonical=collectionCanonical({response:r.canonical,url,nextDnsAddresses:dnsAddresses,forwardedHeaderNames:names});
    if(entry.phase==='REDIRECTED'){if(entry.redirectCanonical!==canonical)collectionReject('EFFECT_CONFLICT');return this.#save(now,collectionClone(this.#state),this.#state.tickets.find(t=>t.ticket.ticketId===entry.redirectTicketId)!.ticket);}
    if(entry.phase!=='OPEN')collectionReject('EFFECT_CONFLICT');const {ticketId:_id,...prior}=entry.ticket,base={...prior,url,dnsAddresses,hop:entry.ticket.hop+1,hopStartedAt:now,parentTicketId:entry.ticket.ticketId,cacheRef:null},ticket:CollectionReadTicket={...base,ticketId:'read-'+collectionHash(base)},next=collectionClone(this.#state);this.#reserve(next,grant);
    const old=next.tickets.find(t=>t.ticket.ticketId===entry.ticket.ticketId)!;old.phase='REDIRECTED';old.redirectCanonical=canonical;old.redirectTicketId=ticket.ticketId;next.tickets.push({...entry,ticket,phase:'OPEN',redirectCanonical:null,redirectTicketId:null,responseCanonical:null,observationId:null});return this.#save(now,next,ticket);
  }
  #headers(raw:unknown,grant:CollectionGrant):Map<string,string> {
    if(!Array.isArray(raw)||raw.length>grant.budget.maxHeaderCount)collectionReject('RATE_LIMITED');const headers=new Map<string,string>();let size=0;
    for(const item of raw){const value=collectionRecord(item);collectionExact(value,['name','value']);if(typeof value.name!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(value.name)||typeof value.value!=='string'||/[\r\n\0]/.test(value.value))collectionReject();const name=value.name.toLowerCase();
      if(['set-cookie','cookie','authorization','proxy-authorization','proxy-authenticate','www-authenticate'].includes(name))collectionReject('RIGHTS_HOLD');if(headers.has(name))collectionReject();size+=encoder.encode(name+':'+value.value+'\r\n').length;if(size>grant.budget.maxHeaderBytes)collectionReject('RATE_LIMITED');headers.set(name,value.value);
      if(!['content-type','content-length','content-encoding','etag','last-modified','cache-control','vary','location','date','age','content-language','accept-ranges'].includes(name))collectionReject('RIGHTS_HOLD');
    }
    const vary=headers.get('vary');if(vary&&vary.toLowerCase().split(',').some(k=>!['accept','accept-language'].includes(k.trim())))collectionReject('RIGHTS_HOLD');
    if(/(?:^|,)\s*no-store(?:\s|,|$)/i.test(headers.get('cache-control')??''))collectionReject('RIGHTS_HOLD');return headers;
  }
  #response(raw:unknown,kind:'NORMAL'|'NOT_MODIFIED'|'REDIRECT'='NORMAL'){
    const {value,bytes}=collectionResponseRecord(raw,kind),now=this.#now(value.checkedAt),receivedAt=collectionStamp(value.receivedAt),{entry,grant}=this.#entry(value.ticket,now),headers=this.#headers(value.headers,grant),network=collectionRecord(value.network);collectionExact(network,['dnsAddresses','peerAddress']);
    const dns=this.#dns(network.dnsAddresses),peer=collectionText(network.peerAddress,64);this.#dns([peer]);if(!equal(dns,entry.ticket.dnsAddresses)||!dns.includes(peer))collectionReject('RIGHTS_HOLD');
    if(collectionTime(receivedAt)<collectionTime(entry.ticket.hopStartedAt)||collectionTime(receivedAt)>collectionTime(now)||collectionTime(now)>collectionTime(entry.ticket.deadlineAt))collectionReject('RIGHTS_HOLD');
    if(entry.phase==='REDIRECTED'&&kind!=='REDIRECT')collectionReject('EFFECT_CONFLICT');if(bytes.byteLength>grant.budget.maxRawBytes)collectionReject('RATE_LIMITED');collectionDigest(value.rawBytesHash);collectionDigest(value.decodedBytesHash);if(collectionBytesHash(bytes)!==value.rawBytesHash)collectionReject('INVALID_INPUT');
    const contentLength=headers.get('content-length');if(contentLength!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(contentLength)||Number(contentLength)!==bytes.byteLength))collectionReject();
    collectionNumber(value.status,100,599);const type=headers.get('content-type');if(type!==undefined&&!/^(application\/json|text\/plain|text\/html)(?:;\s*charset=utf-8)?$/i.test(type))collectionReject('RIGHTS_HOLD');
    const encoding=headers.get('content-encoding')??'identity';let decoded:Uint8Array;
    if(encoding==='identity')decoded=bytes;else if(encoding==='gzip'){try{decoded=zlib.gunzipSync(bytes,{maxOutputLength:grant.budget.maxDecodedBytes});}catch{collectionReject('RATE_LIMITED');}}else collectionReject('RIGHTS_HOLD');
    if(decoded!.byteLength>grant.budget.maxDecodedBytes)collectionReject('RATE_LIMITED');if(collectionBytesHash(decoded!)!==value.decodedBytesHash)collectionReject();let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decoded!);}catch{collectionReject();}
    if(text!.length>grant.budget.maxTextChars||!equalBytes(encoder.encode(text!),decoded!))collectionReject('RATE_LIMITED');
    const canonical=collectionCanonical({receivedAt,status:value.status,headers:[...headers].sort(([a],[b])=>a.localeCompare(b)),dns,peer,rawBytesHash:value.rawBytesHash,decodedBytesHash:value.decodedBytesHash,...(kind==='NOT_MODIFIED'?{cacheRef:validateCollectionCacheRef(value.cacheRef)}:{})});
    return {value,bytes,now,receivedAt,entry,grant,headers,canonical,decoded:decoded!,text:text!};
  }
  #sameSource(source:CollectionSourceAssertion,metadata:CollectionObservationMetadata):boolean {return equal(source,{publisherId:metadata.publisherId,originId:metadata.originId,independenceGroupId:metadata.independenceGroupId,publishedAt:metadata.sourcePublishedAt,updatedAt:metadata.sourceUpdatedAt,timeQuality:metadata.timeQuality});}
  acceptResponse(raw:unknown):CollectionObservationMetadata {
    this.#owned();const r=this.#response(raw);if(r.value.status!==200)collectionReject('RETRYABLE_READ_FAILURE');
    if(r.entry.phase==='ACCEPTED'){if(r.entry.responseCanonical!==r.canonical)collectionReject('EFFECT_CONFLICT');return this.#save(r.now,collectionClone(this.#state),this.#state.observations.find(o=>o.metadata.observationId===r.entry.observationId)!.metadata);}
    const type=r.headers.get('content-type');if(!type||!/^(application\/json|text\/plain|text\/html)(?:;\s*charset=utf-8)?$/i.test(type))collectionReject('RIGHTS_HOLD');const contentType=type.split(';')[0].toLowerCase();if(contentType!==r.entry.ticket.representation.accept)collectionReject('RIGHTS_HOLD');
    const {decoded,text}=r;
    const etag=r.headers.get('etag')??null;if(etag!==null&&(etag.length>512||!/^W\/"[^"\x00-\x1f]*"$|^"[^"\x00-\x1f]*"$/.test(etag)))collectionReject();
    const ticket=r.entry.ticket,source=r.entry.source,base={backendGeneration:this.backendGeneration,ticketId:ticket.ticketId,requestId:ticket.requestId,sourceId:ticket.sourceId,endpointId:ticket.endpointId,profileId:r.grant.profileId,profileVersion:r.grant.profileVersion,adapterVersion:r.grant.adapterVersion,sourcePolicyVersion:r.grant.sourcePolicyVersion,grantGeneration:r.grant.generation,grantDigest:ticket.grantDigest,purpose:ticket.purpose,url:ticket.url,representation:ticket.representation,bodyHash:collectionBytesHash(decoded!),rawBytesHash:collectionBytesHash(r.bytes),contentType,status:200 as const,rawByteLength:r.bytes.byteLength,decodedByteLength:decoded!.byteLength,textLength:text!.length,requestedAt:ticket.requestedAt,receivedAt:r.receivedAt,acceptedAt:r.now,retentionUntil:new Date(Math.min(collectionTime(r.now)+r.grant.retentionMs,collectionTime(r.grant.expiresAt))).toISOString(),publisherId:source.publisherId,originId:source.originId,independenceGroupId:source.independenceGroupId,sourcePublishedAt:source.publishedAt,sourceUpdatedAt:source.updatedAt,timeQuality:source.timeQuality,parserVersion:r.entry.parserVersion};
    const metadata=validateCollectionMetadata({...base,observationId:'observation-'+collectionHash({ticket:ticket.ticketId,response:r.canonical})});
    // Reserve the complete future analysis envelope now; no post-accept wrapper-size failure.
    const artifact=collectionClone({...OFFLINE_READ_FLAGS,metadata,text:text!});let declaredProtocol:unknown=null;try{const document=JSON.parse(text);if(document&&typeof document==='object'&&!Array.isArray(document))declaredProtocol=document.schema;}catch{/* Ordinary text is not a structured pilot protocol. */}
    if(declaredProtocol==='PILOT_JSON_LISTING_P3'&&(ticket.purpose!=='DISCOVERY'||!r.entry.parserVersion.startsWith('pilot-json-listing-')))collectionReject('RIGHTS_HOLD');
    if(declaredProtocol==='PILOT_TELEGRAM_LINKS_P3'&&(ticket.purpose!=='LINK_EXTRACTION'||r.entry.parserVersion!==PILOT_TELEGRAM_VERSION))collectionReject('RIGHTS_HOLD');
    // Owned validation executes before any raw/text map or observation mutation. No caller parse flag exists.
    if(ticket.purpose==='LINK_EXTRACTION'||r.entry.parserVersion.startsWith('pilot-telegram-')){
      if(contentType!=='application/json'||ticket.purpose!=='LINK_EXTRACTION'||r.entry.parserVersion!==PILOT_TELEGRAM_VERSION||parsePilotTelegramLinks({artifact}).status!=='COMPLETE')collectionReject('RIGHTS_HOLD');
    }
    const next=collectionClone(this.#state),entry=next.tickets.find(t=>t.ticket.ticketId===ticket.ticketId)!;entry.phase='ACCEPTED';entry.responseCanonical=r.canonical;entry.observationId=metadata.observationId;next.observations.push({metadata,grant:r.grant,etag});return this.#save(r.now,next,metadata,{observationId:metadata.observationId,body:{raw:r.bytes,text:text!}});
  }
  acceptNotModified(raw:unknown):CollectionObservationMetadata {
    this.#owned();const r=this.#response(raw,'NOT_MODIFIED'),ref=validateCollectionCacheRef(r.value.cacheRef);if(r.value.status!==304||!ref||!r.entry.ticket.cacheRef||!equal(ref,r.entry.ticket.cacheRef)||r.bytes.byteLength!==0||r.value.decodedBytesHash!==collectionBytesHash(new Uint8Array())||!['identity',undefined].includes(r.headers.get('content-encoding')))collectionReject('RIGHTS_HOLD');
    const cached=this.#cache(ref,r.grant,r.entry.ticket.url,r.entry.ticket.representation,r.entry.ticket.purpose,r.now);if(r.headers.get('etag')!==cached.etag||r.headers.has('content-type')&&r.headers.get('content-type')!.split(';')[0].toLowerCase()!==cached.metadata.contentType||!this.#sameSource(r.entry.source,cached.metadata)||r.entry.parserVersion!==cached.metadata.parserVersion)collectionReject('EFFECT_CONFLICT');
    if(r.entry.phase==='ACCEPTED'){if(r.entry.responseCanonical!==r.canonical||r.entry.observationId!==cached.metadata.observationId)collectionReject('EFFECT_CONFLICT');return this.#save(r.now,collectionClone(this.#state),cached.metadata);}
    const next=collectionClone(this.#state),entry=next.tickets.find(t=>t.ticket.ticketId===r.entry.ticket.ticketId)!;entry.phase='ACCEPTED';entry.responseCanonical=r.canonical;entry.observationId=cached.metadata.observationId;
    // Reuse the original artifact and its original retention; never pretend HTTP 304 supplied a new body.
    return this.#save(r.now,next,cached.metadata);
  }
  readForAnalysis(observationId:string,expectedBodyHash:string,checkedAt:string):CollectionAnalysisRead {
    if(!isOwnedCollectionReadBoundary(this))collectionReject();collectionId(observationId);collectionDigest(expectedBodyHash);const now=this.#now(checkedAt),observation=this.#state.observations.find(o=>o.metadata.observationId===observationId),body=this.#bodies.get(observationId);
    if(!observation||!body||observation.metadata.bodyHash!==expectedBodyHash||observation.metadata.backendGeneration!==this.backendGeneration)collectionReject('EFFECT_CONFLICT');
    const metadata=observation.metadata,entry=this.#state.tickets.find(t=>t.ticket.ticketId===metadata.ticketId)!;this.#entry(entry.ticket,now,['ANALYSIS']);
    if(collectionTime(metadata.acceptedAt)>collectionTime(now)||collectionTime(metadata.retentionUntil)<=collectionTime(now))collectionReject('RIGHTS_HOLD');
    if(collectionBytesHash(encoder.encode(body.text))!==expectedBodyHash||collectionBytesHash(body.raw)!==metadata.rawBytesHash)collectionReject('EFFECT_CONFLICT');return collectionClone({...OFFLINE_READ_FLAGS,metadata,text:body.text});
  }
  inspect(){
    this.#owned();let privateBytes=0;for(const body of this.#bodies.values())privateBytes+=body.raw.byteLength+body.text.length*2;
    return collectionClone({...OFFLINE_READ_FLAGS,backendGeneration:this.backendGeneration,watermark:this.#state.watermark,stateDigest:collectionHash(this.#state),tickets:this.#state.tickets.length,observations:this.#state.observations.map(o=>o.metadata),reservedRequests:this.#state.ledgers.reduce((n,l)=>n+l.requests,0),reservedRawBytes:this.#state.ledgers.reduce((n,l)=>n+l.reservedRawBytes,0),privateBytes,networkCalls:0,databaseWrites:0,socketSafetyProven:false});
  }
}
function equalBytes(a:Uint8Array,b:Uint8Array):boolean {return a.byteLength===b.byteLength&&a.every((value,index)=>value===b[index]);}
