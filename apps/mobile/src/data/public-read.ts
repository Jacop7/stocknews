import { useCallback,useEffect,useRef,useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
const base=process.env.EXPO_PUBLIC_READ_API_URL??'http://127.0.0.1:62330';
export async function publicRead<T>(path:string,signal:AbortSignal):Promise<T>{
 if(!/^http:\/\/(127\.0\.0\.1|192\.168\.200\.132):62330$/.test(base))throw new Error('공개 개발 API 주소를 확인해 주세요.');
 const r=await fetch(base+path,{signal,credentials:'omit',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
 if(!r.ok)throw new Error(r.status===409?'분류 또는 기간이 바뀌었습니다. 첫 페이지부터 다시 확인해 주세요.':r.status===429?'잠시 후 다시 확인해 주세요.':'공개 데이터를 확인할 수 없습니다.');
 const value=await r.json();if(value.productId!=='judoju-news'||value.mode!=='LOCAL_SYNTHETIC'||!Object.hasOwn(value,'data'))throw new Error('개발 데이터 형식이 올바르지 않습니다.');
 return value.data as T;
}
export function usePublicRead<T>(path:string|null){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tick,setTick]=useState(0),generation=useRef(0);
 const retry=useCallback(()=>setTick(x=>x+1),[]);
 useFocusEffect(useCallback(()=>{
  let active=true,controller:AbortController|null=null;
  setData(null);setLoading(true);setError('');
  if(path===null){setLoading(false);return()=>{active=false;generation.current++;};}
  const readPath=path;
  async function read(){
   const current=++generation.current;controller?.abort();controller=new AbortController();const currentController=controller,signal=currentController.signal;
   // Keep the validated body while an active recheck is in flight; clearing it
   // would collapse ScrollView content and lose its position every ten seconds.
   // Errors, backgrounding and non-published responses still remove old content.
   setError('');const timeout=setTimeout(()=>currentController.abort(),7000);
   try{const value=await publicRead<T>(readPath,signal);if(active&&current===generation.current){setData(value);setError('');}}
   catch(e){if(active&&current===generation.current){setData(null);setError(e instanceof Error&&!(e instanceof TypeError)&&!['AbortError','TimeoutError'].includes(e.name)?e.message:'연결을 확인한 뒤 다시 시도해 주세요.');}}
   finally{clearTimeout(timeout);if(active&&current===generation.current)setLoading(false);}
  }
  void read();const interval=setInterval(()=>{if(AppState.currentState==='active')void read();},10000);
  const subscription=AppState.addEventListener('change',state=>{if(state==='active')void read();else{generation.current++;controller?.abort();setData(null);setLoading(true);}});
  return()=>{active=false;generation.current++;controller?.abort();clearInterval(interval);subscription.remove();};
 },[path,tick]));
 useEffect(()=>()=>{generation.current++;},[]);
 return {data,error,loading,retry};
}
