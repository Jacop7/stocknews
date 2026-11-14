import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readRoute} from '../scripts/public-read-gateway.mjs';
import {searchResponse,normalizeSearch} from '../scripts/catalog/search-route.mjs';
import {parseBookmarks,emptyBookmarks,changeBookmark,resolveBookmarkAliases,createBookmarkStore,BookmarkChanged} from '../apps/mobile/src/data/bookmarks.mjs';
const id=n=>'81000000-0000-4000-8000-'+n.toString().padStart(12,'0'),when='2026-11-15T00:00:00.000Z';
test('bounded literal query normalization and cursor bound to tab/query/limit/catalog',()=>{
 assert.equal(normalizeSearch('  ＨＢＭ  Test '),'ｈｂｍ test');assert.equal(normalizeSearch('삼성'),'삼성');
 for(const q of ['', ' '.repeat(5),'a '.repeat(7),'a'.repeat(81),'a\u0000b'])assert.throws(()=>normalizeSearch(q));
 const route=readRoute('/v2/search/news?version=38&q=HBM&limit=2'),card={issue_id:id(1),sample_kind:'SYNTHETIC',title:'합성',summary:'검증',first_published_at:when};
 const value=searchResponse(route,{catalog_version:'38',as_of:when,items:[card],next:{last_id:id(1),last_time:when}}),cursor=encodeURIComponent(value.next_cursor);
 assert.equal(readRoute('/v2/search/news?version=38&q=hbm&limit=2&cursor='+cursor).args.p_last_id,id(1));
 for(const url of ['/v2/search/companies?version=38&q=hbm&limit=2','/v2/search/news?version=39&q=hbm&limit=2','/v2/search/news?version=38&q=foo&limit=2','/v2/search/news?version=38&q=hbm&limit=3'])assert.throws(()=>readRoute(url+'&cursor='+cursor),e=>e.status===409);
 for(const url of ['/v2/search/news?version=38&q=a&limit=21','/v2/search/news?version=38&q=a&q=b','/v2/saved?version=38&ids='+id(1)+','+id(1),'/v2/saved?version=38&ids='+Array.from({length:21},(_,i)=>id(i)).join(',')])assert.throws(()=>readRoute(url));
});
test('public saved/search DTO rejects stale bodies and invented price identity',()=>{
 const route=readRoute('/v2/saved?version=38&ids='+id(1));
 assert.throws(()=>searchResponse(route,{catalog_version:'38',items:[{requested_issue_id:id(1),state:'HIDDEN',title:'old'}]}));
 const company=readRoute('/v2/search/companies?version=38&q=hbm');
 assert.throws(()=>searchResponse(company,{catalog_version:'38',items:[{source_company_ref:id(1),name:'A',search_description:'B',metadata_kind:'USER_REFERENCE_UNVERIFIED',stock_identity_state:'UNRESOLVED',stock_code:'000001',price:100,change_percent:0,stock_url:null}],next:null}));
});
test('minimal device envelope preserves first timestamp, deduplicates and rejects cross-environment/corruption',()=>{
 let v=changeBookmark(emptyBookmarks(),id(1),true,when);v=changeBookmark(v,id(1),true,'2026-11-16T00:00:00.000Z');assert.equal(v.entries.length,1);assert.equal(v.entries[0].saved_at,when);
 v=changeBookmark(v,id(2),true,'2026-11-16T00:00:00.000Z');v=resolveBookmarkAliases(v,{[id(1)]:id(2)});assert.deepEqual(v.entries,[{issue_id:id(2),saved_at:when}]);
 for(const raw of ['{',JSON.stringify({...v,environment:'production'}),JSON.stringify({...v,entries:[{...v.entries[0],title:'no cache'}]})])assert.throws(()=>parseBookmarks(raw));
 assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(v)).entries[0]).sort(),['issue_id','saved_at']);
});
test('500 cap fails without eviction; removal remains available',()=>{
 let v=emptyBookmarks();for(let n=0;n<500;n++)v=changeBookmark(v,id(n),true,when);
 assert.throws(()=>changeBookmark(v,id(501),true,when));assert.equal(v.entries.length,500);v=changeBookmark(v,id(0),false);assert.equal(changeBookmark(v,id(501),true,when).entries.length,500);
});
test('hydration, serialized writes and persistence failures never announce false success',async()=>{
 let raw=null,release;const pending=new Promise(r=>release=r);let reads=0,failWrite=false,tail=Promise.resolve();
 const adapter={read:async()=>{reads++;if(reads===1)await pending;return raw;},update(fn){const job=tail.then(()=>{const next=fn(parseBookmarks(raw));if(failWrite)throw new Error('quota');raw=JSON.stringify(next);return next;});tail=job.catch(()=>{});return job;}};
 const store=createBookmarkStore(adapter);assert.equal(store.getSnapshot().hydrated,false);const first=store.set(id(1),true);release();await first;
 await Promise.all([store.set(id(2),true),store.set(id(3),true),store.set(id(1),false)]);assert.deepEqual(new Set(store.getSnapshot().entries.map(e=>e.issue_id)),new Set([id(2),id(3)]));
 failWrite=true;await assert.rejects(store.set(id(4),true));assert.equal(store.getSnapshot().entries.some(e=>e.issue_id===id(4)),false);assert.equal(parseBookmarks(raw).entries.length,2);
 failWrite=false;await store.set(id(3),false);await store.aliases({[id(3)]:id(4)});assert.equal(parseBookmarks(raw).entries.some(e=>e.issue_id===id(4)),false);
 raw='{';await assert.rejects(store.reload());await assert.rejects(store.set(id(5),true));assert.equal(raw,'{');
});
test('alias then stale-ID removal and removal then alias preserve the same logical delete',async()=>{
 const make=()=>{let raw=JSON.stringify(changeBookmark(emptyBookmarks(),id(1),true,when)),tail=Promise.resolve();return {read:async()=>raw,update(fn){const p=tail.then(()=>{const v=fn(parseBookmarks(raw));raw=JSON.stringify(v);return v;});tail=p.catch(()=>{});return p;}};};
 let adapter=make(),a=createBookmarkStore(adapter);await a.reload();await a.aliases({[id(1)]:id(2)});await a.set(id(1),false);assert.equal(parseBookmarks(await adapter.read()).entries.length,0);
 adapter=make();a=createBookmarkStore(adapter);const b=createBookmarkStore(adapter);await Promise.all([a.reload(),b.reload()]);
 await b.aliases({[id(1)]:id(2)});await a.set(id(1),false,id(2));assert.equal(parseBookmarks(await adapter.read()).entries.length,0);
 await a.set(id(1),true);await a.set(id(1),false);await b.aliases({[id(1)]:id(2)});assert.equal(parseBookmarks(await adapter.read()).entries.length,0);
});
test('unknown cross-tab rewrite is an explicit conflict, never a false-success no-op or guessed delete',async()=>{
 let raw=JSON.stringify(changeBookmark(emptyBookmarks(),id(1),true,when));const adapter={read:async()=>raw,async update(fn){const v=fn(parseBookmarks(raw));raw=JSON.stringify(v);return v;}};
 const a=createBookmarkStore(adapter);await a.reload();raw=JSON.stringify(resolveBookmarkAliases(parseBookmarks(raw),{[id(1)]:id(2)}));
 await assert.rejects(a.set(id(1),false),BookmarkChanged);assert.equal(a.getSnapshot().entries[0].issue_id,id(2));assert.ok(a.getSnapshot().error);assert.equal(parseBookmarks(raw).entries.length,1);
 await a.set(id(2),false);assert.equal(parseBookmarks(raw).entries.length,0);
});
