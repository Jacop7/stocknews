import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {AppState} from 'react-native';
import {installationAdapter} from './installation-adapter';
import type {InstallationSettings,InstallationState} from './installation-types';
const fallback={state:{state:'NOT_CONNECTED'} as InstallationState,busy:false,error:'',refresh:async()=>false,save:async(_s:InstallationSettings)=>false,rotate:async()=>false,disconnect:async()=>false,recover:async()=>false,newConnection:async()=>false};
const InstallationContext=createContext(fallback);
export function InstallationProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<InstallationState>({state:'CONNECTING'}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(state),inFlight=useRef(false);current.current=state;
 const run=useCallback(async(fn:()=>Promise<InstallationState>)=>{
  if(inFlight.current)return false;inFlight.current=true;setBusy(true);setError('');
  try{setState(await fn());return true;}catch(e){const code=e instanceof Error?e.message:'CONNECTION_FAILED';setError(code);
   if(/UNAUTHORIZED|EXPIRED|RECONNECT_REQUIRED/.test(code))setState({state:'RECONNECT_REQUIRED'});
   else try{setState(await installationAdapter.read());}catch{/* Preserve existing UI state; never infer a successful write. */}
   return false;
  }
  finally{inFlight.current=false;setBusy(false);}
 },[]);
 useEffect(()=>{void run(installationAdapter.initialize);const subscription=AppState.addEventListener('change',next=>{
  if(next!=='active')return;const x=current.current;
  if(x.settings&&x.expires_at&&Date.parse(x.expires_at)-Date.now()<=3600000&&Date.parse(x.expires_at)>Date.now())void run(installationAdapter.rotate);
  else void run(installationAdapter.read);
 });return()=>subscription.remove();},[run]);
 return <InstallationContext.Provider value={{state,busy,error,refresh:()=>run(installationAdapter.read),save:s=>run(()=>installationAdapter.save(s)),rotate:()=>run(installationAdapter.rotate),disconnect:()=>run(installationAdapter.disconnect),recover:()=>run(installationAdapter.recover),newConnection:()=>run(installationAdapter.newConnection)}}>{children}</InstallationContext.Provider>;
}
export const useInstallation=()=>useContext(InstallationContext);
