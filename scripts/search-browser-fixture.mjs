// Explicit local-only UI harness. No DB writes, live source or private endpoint.
import {createPublicGateway,publicConfig,upstream} from './public-read-gateway.mjs';
import {CatalogReadError} from './catalog/public-route.mjs';
import {writePrivate} from './local-runtime.mjs';
const mode=process.argv[2];if(!['catalog429','modal','article-delay','article-scroll'].includes(mode)||process.argv.length!==3)throw new Error('EXPLICIT_LOCAL_UI_FIXTURE_MODE_REQUIRED');
const c=publicConfig(),started=Date.now(),events=[],company='83000000-0000-4000-8000-000000000006';let articleReads=0,articleArmed=false,articleHidden=false;
const record=(state='RUNNING')=>writePrivate('search-browser-fixture-'+mode+'.json',{mode,state,localOnly:true,dbWrites:0,realSourceRequests:0,events,articleReads});
const tree=await upstream(c,'catalog_public_tree',{p_expected:null});
const sectors=tree.parents.flatMap(p=>p.sectors).slice(0,40).map(s=>({id:s.id,name:s.name,display_order:s.order}));
const transport=async(config,name,args)=>{
 events.push({name,at_ms:Date.now()-started});record();
 if(mode==='catalog429'&&name==='catalog_public_tree')throw new CatalogReadError('RATE_LIMITED',429);
 if(mode==='modal'&&name==='catalog_public_search_companies'&&args.p_query==='synthetic6c-modal')return {catalog_version:tree.catalog_version,items:[{source_company_ref:company,name:'SYNTHETIC 6C 팝업 시험',search_description:'실제 기업 아님 · 브라우저 검증 전용',metadata_kind:'USER_REFERENCE_UNVERIFIED',stock_identity_state:'UNRESOLVED',stock_code:null,price:null,change_percent:null,stock_url:null,related_sectors:sectors.slice(0,3),has_more_sectors:true}],next:null};
 if(mode==='modal'&&name==='catalog_public_company_sectors'&&args.p_company===company)return {catalog_version:tree.catalog_version,state:'AVAILABLE',items:sectors.slice(args.p_offset,args.p_offset+args.p_limit),next_offset:args.p_offset+args.p_limit<sectors.length?args.p_offset+args.p_limit:null};
 if(mode==='article-delay'&&name==='m1_public_article'&&args.p_issue==='32122f1f-7e06-465d-8e07-744f15427f24'&&++articleReads>1){await new Promise(resolve=>setTimeout(resolve,2500));return {state:'HIDDEN',message:'현재 제공하지 않는 글',canonical_issue_id:args.p_issue};}
 if(mode==='article-scroll'&&articleArmed&&name==='m1_public_article'&&args.p_issue==='32122f1f-7e06-465d-8e07-744f15427f24'){
  const read=++articleReads;if(read>1)await new Promise(resolve=>setTimeout(resolve,3500));
  if(articleHidden)return {state:'HIDDEN',message:'현재 제공하지 않는 글',canonical_issue_id:args.p_issue};
 }
 return upstream(config,name,args);
};
const gateway=await createPublicGateway(c,{transport});let closed=false;
async function close(){if(closed)return;closed=true;await gateway.close();process.stdin.pause();record('CLOSED');console.log(JSON.stringify({component:'6C_UI_FIXTURE',mode,state:'CLOSED',events:events.length}));}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{if(text.trim()==='close')void close();if(text.trim()==='arm'&&mode==='article-scroll'){articleReads=1;articleArmed=true;record();console.log('SCROLL_FIXTURE_ARMED');}if(text.trim()==='hide'&&mode==='article-scroll'){articleHidden=true;record();console.log('SCROLL_FIXTURE_HIDDEN');}});
const timer=setTimeout(()=>void close(),120000);timer.unref();
console.log(JSON.stringify({component:'6C_UI_FIXTURE',mode,host:gateway.host,port:gateway.port,localOnly:true,dbWrites:0,ttlSeconds:120}));
