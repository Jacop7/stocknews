import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash,randomUUID,timingSafeEqual } from 'node:crypto';
import { mkdir,readFile,open,rename } from 'node:fs/promises';
assert.equal(process.env.JUDOJU_ENV,'local');
const key=process.env.M0_MOCK_KEY;assert.ok(key?.length>=32);
const directory='/data/receipts';await mkdir(directory,{recursive:true});
const pending=new Map();
const idFor=k=>createHash('sha256').update(k).digest('hex');
function authorized(value){if(typeof value!=='string'||value.length!==key.length)return false;return timingSafeEqual(Buffer.from(value),Buffer.from(key));}
async function get(effectKey){try{return JSON.parse(await readFile(directory+'/'+idFor(effectKey)+'.json','utf8'));}catch(error){if(error.code==='ENOENT')return {state:'UNKNOWN',terminal:false};throw error;}}
async function store(effectKey,value){
  const filename=directory+'/'+idFor(effectKey)+'.json',temp=filename+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
  await rename(temp,filename);const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}
async function accept(effectKey,mode){
  const prior=await get(effectKey);
  if(prior.state!=='UNKNOWN')return prior;
  const value=mode==='FAIL_BEFORE_ACCEPT'?{state:'NOT_ACCEPTED',terminal:true,proof:'MOCK_NOT_ACCEPTED:'+idFor(effectKey)}:{state:'ACCEPTED',terminal:true,receipt:'MOCK_RECEIPT:'+idFor(effectKey),acceptedCount:1};
  await store(effectKey,value);return value;
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/health'&&req.method==='GET'){send(res,200,{product:'judoju-news',mode:'LOCAL_MOCK_ONLY'});return;}
    if(!authorized(req.headers['x-mock-key'])){send(res,403,{code:'FORBIDDEN'});return;}
    if(req.method==='GET'&&req.url.startsWith('/effects/')){const effectKey=decodeURIComponent(req.url.slice('/effects/'.length));if(effectKey.length>200){send(res,400,{code:'INVALID_KEY'});return;}send(res,200,await get(effectKey));return;}
    if(req.method!=='POST'||req.url!=='/effects'){send(res,404,{code:'NOT_FOUND'});return;}
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096){send(res,413,{code:'TOO_LARGE'});return;}chunks.push(chunk);}
    const {effectKey,mode}=JSON.parse(Buffer.concat(chunks));
    if(typeof effectKey!=='string'||!effectKey.length||effectKey.length>200||!['NORMAL','ACK_DELAY','DROP_RESPONSE','FAIL_BEFORE_ACCEPT'].includes(mode)){send(res,400,{code:'INVALID_MOCK_REQUEST'});return;}
    // A promise per key serializes concurrent first acceptance before the durable rename.
    let operation=pending.get(effectKey);
    if(!operation){operation=accept(effectKey,mode);pending.set(effectKey,operation);operation.finally(()=>pending.delete(effectKey)).catch(()=>{});}
    const result=await operation;
    if(mode==='DROP_RESPONSE'){res.destroy();return;}
    send(res,result.state==='ACCEPTED'?200:409,result);
  }catch{if(!res.headersSent)send(res,500,{code:'MOCK_INTERNAL_ERROR'});else res.destroy();}
});
server.listen(7070,'0.0.0.0',()=>console.log(JSON.stringify({product:'judoju-news',component:'M0_MOCK_SINK',mode:'NETWORK_INTERNAL_ONLY'})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
