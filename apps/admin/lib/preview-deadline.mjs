// Server-only ADMIN_PREVIEW_DEADLINE_P3. Timer bounds host waiting, not remote cancellation.
import {AdminError} from './runtime-local.mjs';

export const previewLimits=Object.freeze({requestMs:8000,loginMs:45000,cleanupMs:3000,totalLoginMs:52000,responseBytes:262144,responseChunks:4096});
const clocks=new WeakMap();
const nativeClock=Object.freeze({now:()=>performance.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:timer=>clearTimeout(timer)});
const error=(code='PREVIEW_BACKEND_UNAVAILABLE',status=503)=>new AdminError(code,status);

/** A non-default clock is fixture-only. There are no caller-configurable relaxed budgets. */
export function createPreviewDeadlineTools(clock=nativeClock){
  if(!clock||typeof clock.now!=='function'||typeof clock.set!=='function'||typeof clock.clear!=='function')throw error('PREVIEW_CLOCK_INVALID');
  const now=()=>{const value=clock.now();if(!Number.isFinite(value)||value<0)throw error('PREVIEW_CLOCK_INVALID');return value;};
  const end=ms=>{if(!Number.isFinite(ms)||ms<0||ms>previewLimits.totalLoginMs)throw error('PREVIEW_DEADLINE_INVALID');return now()+ms;};
  const remaining=deadline=>{if(!Number.isFinite(deadline))throw error('PREVIEW_DEADLINE_INVALID');return Math.max(0,deadline-now());};
  function run(work,deadline,onLate=()=>{}){
    if(typeof work!=='function'||typeof onLate!=='function')return Promise.reject(error('PREVIEW_DEADLINE_INVALID'));
    let wait;try{wait=remaining(deadline);}catch(e){return Promise.reject(e);}
    if(wait<=0)return Promise.reject(error());
    const controller=new AbortController();
    return new Promise((resolve,reject)=>{
      let settled=false,timer;
      const finish=(ok,value)=>{if(settled){try{onLate();}catch{}return;}settled=true;clock.clear(timer);ok?resolve(value):reject(value);};
      timer=clock.set(()=>{if(settled)return;settled=true;controller.abort();reject(error());},wait);
      // Observe both branches even after timeout: no late success or rejection escapes to a caller.
      Promise.resolve().then(()=>{if(controller.signal.aborted)throw error();return work(controller.signal);}).then(value=>finish(true,value),e=>finish(false,e));
    });
  }
  const tools=Object.freeze({kind:clock===nativeClock?'NATIVE':'FIXTURE',now,end,remaining,run});clocks.set(tools,clock);return tools;
}
export const nativePreviewDeadlines=createPreviewDeadlineTools();
export function checkedPreviewDeadlines(tools,fixtureTransport){
  if(!clocks.has(tools)||tools.kind==='FIXTURE'&&!fixtureTransport)throw error('PREVIEW_CLOCK_INVALID');return tools;
}

/** Cancel once without awaiting an uncooperative stream. This never certifies remote cancellation. */
export function stopPreviewBody(response){
  try{const pending=response?.body?.cancel?.();if(pending&&typeof pending.then==='function')void Promise.resolve(pending).catch(()=>{});}catch{}
}

export async function readPreviewJson(response,signal){
  if(!response||typeof response.ok!=='boolean'||!Number.isInteger(response.status))throw error('BACKEND_RESPONSE_INVALID',502);
  if(signal.aborted){stopPreviewBody(response);throw error();}
  const declared=response.headers?.get?.('content-length');
  if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>previewLimits.responseBytes)){stopPreviewBody(response);throw error('BACKEND_RESPONSE_TOO_LARGE',502);}
  if(!response.body)return {};
  let reader;try{reader=response.body.getReader();}catch{throw error('BACKEND_RESPONSE_INVALID',502);}
  let size=0,count=0,finished=false,cancelled=false;const chunks=[];
  const cancel=()=>{if(cancelled)return;cancelled=true;try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)throw error();
      const part=await reader.read();
      if(signal.aborted)throw error();
      if(!part||typeof part.done!=='boolean')throw error('BACKEND_RESPONSE_INVALID',502);
      if(part.done){finished=true;break;}
      if(!(part.value instanceof Uint8Array))throw error('BACKEND_RESPONSE_INVALID',502);
      count++;size+=part.value.byteLength;
      // A zero-byte microtask stream also has a finite bound; it cannot starve the timer forever.
      if(size>previewLimits.responseBytes||count>previewLimits.responseChunks)throw error('BACKEND_RESPONSE_TOO_LARGE',502);
      chunks.push(Buffer.from(part.value));
    }
    if(!size)return {};
    try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{throw error('BACKEND_RESPONSE_INVALID',502);}
  }catch(e){if(e instanceof AdminError)throw e;throw error();}
  finally{signal.removeEventListener('abort',cancel);if(!finished)cancel();try{reader.releaseLock();}catch{}}
}
