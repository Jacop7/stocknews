import {AdminError} from './runtime-local.mjs';
import {adminProfile} from './admin-profile.mjs';
let loginAttempts=[];
export function beforeLoginBody(){
  if(adminProfile()!=='preview')return;
  const now=Date.now();loginAttempts=loginAttempts.filter(t=>t>now-60000);
  if(loginAttempts.length>=5)throw new AdminError('LOGIN_RATE_LIMITED',429);
  loginAttempts.push(now);
}
// Bound the stream while reading, rather than after allocating an arbitrary request body.
export async function adminJson(request){
  if(Number(request.headers.get('content-length')??0)>131072)throw new AdminError('REQUEST_TOO_LARGE',413);
  const reader=request.body?.getReader();if(!reader)throw new AdminError('INVALID_JSON');
  let timer,size=0,finished=false;const chunks=[];
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AdminError('REQUEST_TIMEOUT',408)),3000);});
  try{
    while(true){const {done,value}=await Promise.race([reader.read(),deadline]);if(done){finished=true;break;}size+=value.length;if(size>131072)throw new AdminError('REQUEST_TOO_LARGE',413);chunks.push(value);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AdminError('INVALID_JSON');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new AdminError('INVALID_JSON');return data;
  }finally{
    clearTimeout(timer);
    // Cancellation may itself never settle. Start it once, observe rejection,
    // and release our reader without extending the response deadline.
    if(!finished)void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
