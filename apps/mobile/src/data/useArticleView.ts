import {useCallback,useRef} from 'react';
import {AppState,Platform} from 'react-native';
import {useFocusEffect} from 'expo-router';
import * as Crypto from 'expo-crypto';
import type {PublicArticleDetail} from '@judoju/contracts';
import {useInstallation} from './InstallationContext';
import {installationAdapter} from './installation-adapter';
import {advanceVisit} from './view-visit.mjs';
import type {ViewTicket} from './installation-types';
type Visit={issue:string;version:string;visitId:string;eventKey:string;ticket:ViewTicket|null;elapsed:number;lastActiveAt:number|null;inFlight:boolean;done:boolean;retryAt:number};
export function useArticleView(routeId:string,article:PublicArticleDetail|null,loading:boolean){
 const installation=useInstallation(),current=useRef({article,loading,connected:Boolean(installation.state.settings)});
 current.current={article,loading,connected:Boolean(installation.state.settings)};
 const visit=useRef<Visit|null>(null);
 useFocusEffect(useCallback(()=>{
  let focused=true,foreground=AppState.currentState==='active';visit.current=null;
  const visible=()=>Platform.OS!=='web'||typeof document==='undefined'||document.visibilityState==='visible';
  const pause=()=>{if(visit.current)visit.current.lastActiveAt=null;};
  const app=AppState.addEventListener('change',state=>{foreground=state==='active';pause();});
  if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',pause);
  const tick=async()=>{
   const a=current.current.article,eligible=focused&&foreground&&visible()&&!current.current.loading&&current.current.connected&&a?.state==='PUBLISHED';
   if(!eligible||a?.state!=='PUBLISHED'){if(visit.current)advanceVisit(visit.current,false,performance.now());return;}
   if(!visit.current||visit.current.issue!==a.issue_id||visit.current.version!==a.version_id)visit.current={issue:a.issue_id,version:a.version_id,visitId:Crypto.randomUUID(),eventKey:Crypto.randomUUID(),ticket:null,elapsed:0,lastActiveAt:null,inFlight:false,done:false,retryAt:0};
   const v=visit.current,now=performance.now();if(v.done||v.inFlight||now<v.retryAt)return;
   if(!v.ticket){v.inFlight=true;
    try{const t=await installationAdapter.ticket({issue_id:v.issue,version_id:v.version,visit_id:v.visitId});if(focused&&visit.current===v){v.ticket=t;v.lastActiveAt=null;}}
    catch{v.retryAt=performance.now()+5000;}finally{v.inFlight=false;}return;
   }
   if(!advanceVisit(v,true,now))return;v.inFlight=true;
   try{const result=await installationAdapter.accept({ticket_id:v.ticket.ticket_id,event_key:v.eventKey});if(['ACCEPTED','EXCLUDED'].includes(result.state))v.done=true;}
   catch{v.retryAt=performance.now()+5000;}finally{v.inFlight=false;}
  };
  const timer=setInterval(()=>void tick(),250);void tick();
  return()=>{focused=false;visit.current=null;app.remove();clearInterval(timer);if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',pause);};
 },[routeId]));
}
