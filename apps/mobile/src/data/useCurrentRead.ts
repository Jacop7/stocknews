import {useCallback,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {publicRead,PublicReadError} from './public-read';
// Search/saved never retain an earlier body after a query, failure or background
// transition. A response belongs to one path AND one active generation.
export function useCurrentRead<T>(path:string|null,delay=0,pollMs=10000){
 const generation=useRef(0),cooldown=useRef(0),[tick,setTick]=useState(0);
 const [state,setState]=useState<{path:string|null;data:T|null;loading:boolean;error:string;status:number;retryAt:number}>({path:null,data:null,loading:false,error:'',status:0,retryAt:0});
 const retry=useCallback(()=>{if(Date.now()>=cooldown.current)setTick(x=>x+1);},[]);
 useFocusEffect(useCallback(()=>{
  let active=true,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|null=null;
  const clear=()=>{generation.current++;controller?.abort();if(timer)clearTimeout(timer);};
  const blank={path,data:null,loading:Boolean(path),error:'',status:0,retryAt:0};setState(blank);
  async function read(){
   clear();if(!path||!active||AppState.currentState!=='active')return;
   if(Date.now()<cooldown.current){setState({...blank,loading:false,error:'요청이 많습니다. 잠시 후 다시 확인해 주세요.',status:429,retryAt:cooldown.current});return;}
   const current=++generation.current,ac=new AbortController();controller=ac;
   setState(blank);const timeout=setTimeout(()=>ac.abort(),7000);
   try{const data=await publicRead<T>(path,ac.signal);if(active&&generation.current===current)setState({...blank,data,loading:false});}
   catch(e){if(active&&generation.current===current){const error=e instanceof PublicReadError?e:null;cooldown.current=error?.retryAt??0;setState({...blank,loading:false,error:error?.message??'연결을 확인한 뒤 다시 시도해 주세요.',status:error?.status??0,retryAt:error?.retryAt??0});}}
   finally{clearTimeout(timeout);}
  }
  if(path)timer=setTimeout(()=>void read(),delay);
  const interval=pollMs>0?setInterval(()=>void read(),pollMs):null;
  const subscription=AppState.addEventListener('change',next=>{clear();setState(blank);if(next==='active')void read();});
  return()=>{active=false;clear();if(interval)clearInterval(interval);subscription.remove();};
 },[path,delay,pollMs,tick]));
 const current=state.path===path?state:{path,data:null,loading:Boolean(path),error:'',status:0,retryAt:0};return {...current,retry};
}
