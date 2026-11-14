import type { SelectionMarketBasis } from '@judoju/contracts';
export interface Clock { now():Date; }
export interface TradingSession {tradingDayId:string; opensAt:string; closesAt:string;}
export interface MarketCalendar {
  // Day lookup: a regular-session close does not end Korea's 09:10–20:00 basis.
  // null means a verified closed day; UNKNOWN means unavailable calendar data.
  sessionForDay(market:'KRX'|'NYSE'|'NASDAQ',tradingDate:string):TradingSession|null|'UNKNOWN';
}
export function marketWindow(instant:Date):SelectionMarketBasis {
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid instant');
  const korea = new Date(instant.getTime()+9*60*60*1000);
  const minutes=korea.getUTCHours()*60+korea.getUTCMinutes();
  return minutes>=550 && minutes<1200 ? 'KR' : 'FOREIGN_US';
}
function localDate(instant:Date,timeZone:string):string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function marketContext(clock:Clock,calendar:MarketCalendar) {
  const instant=clock.now();
  const window=marketWindow(instant);
  let basis:SelectionMarketBasis=window;
  let session:TradingSession|null|'UNKNOWN';
  if(window==='KR') {
    session=calendar.sessionForDay('KRX',localDate(instant,'Asia/Seoul'));
    if(session==='UNKNOWN') return {instant:instant.toISOString(),selection_market_basis:null,analysis_perspective:'KR_EQUITY' as const,status:'CALENDAR_UNAVAILABLE' as const,session};
    if(session!==null) return {instant:instant.toISOString(),selection_market_basis:basis,analysis_perspective:'KR_EQUITY' as const,status:'READY' as const,session};
    basis='FOREIGN_US';
  }
  session=calendar.sessionForDay('NYSE',localDate(instant,'America/New_York'));
  return {instant:instant.toISOString(),selection_market_basis:basis,analysis_perspective:'KR_EQUITY' as const,status:session==='UNKNOWN'?'CALENDAR_UNAVAILABLE' as const:session===null?'NO_TRADING_SESSION' as const:'READY' as const,session};
}
export function formatKorea(instant:Date):string { return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(instant); }

// Calendar-derived ranking context. Missing coverage never becomes a guessed holiday.
export function rankingMarketContext(clock:Clock,calendar:MarketCalendar) {
  const instant=clock.now(),window=marketWindow(instant),today=localDate(instant,'Asia/Seoul');
  const unavailable=()=>({status:'CALENDAR_UNAVAILABLE' as const,selection_market_basis:null,analysis_perspective:'KR_EQUITY' as const,target_D:null,candidate_window_start:null,price_session:null});
  const day=(value:string,delta:number)=>new Date(Date.parse(value+'T12:00:00Z')+delta*86400000).toISOString().slice(0,10);
  const valid=(session:TradingSession,date:string)=>session.tradingDayId===date&&Number.isFinite(Date.parse(session.opensAt))&&Number.isFinite(Date.parse(session.closesAt))&&Date.parse(session.opensAt)<Date.parse(session.closesAt);
  const kr=calendar.sessionForDay('KRX',today);if(kr==='UNKNOWN'||kr&&!valid(kr,today))return unavailable();
  const basis:SelectionMarketBasis=window==='KR'&&kr!==null?'KR':'FOREIGN_US';
  const koreaMinutes=instant.getUTCHours()*60+instant.getUTCMinutes()+540;
  const after20=(koreaMinutes%1440)>=1200;
  let target:string|null=null;
  for(let n=after20?1:0;n<=14;n++){
    const date=day(today,n),session=n===0?kr:calendar.sessionForDay('KRX',date);
    if(session==='UNKNOWN'||session&&!valid(session,date))return unavailable();
    if(session){target=date;break;}
  }
  if(!target)return unavailable();
  let previous:TradingSession|null=null;
  for(let n=1;n<=14;n++){
    const date=day(target,-n),session=calendar.sessionForDay('KRX',date);
    if(session==='UNKNOWN'||session&&!valid(session,date))return unavailable();
    if(session){previous=session;break;}
  }
  if(!previous)return unavailable();
  let priceSession:TradingSession|null=basis==='KR'?kr:null;
  if(basis==='FOREIGN_US'){
    const nyToday=localDate(instant,'America/New_York');
    for(let n=0;n<=14;n++){
      const date=day(nyToday,-n),session=calendar.sessionForDay('NYSE',date);
      if(session==='UNKNOWN'||session&&!valid(session,date))return unavailable();
      if(session&&Date.parse(session.opensAt)<=instant.getTime()){priceSession=session;break;}
    }
  }
  if(!priceSession)return unavailable();
  return {status:'READY' as const,selection_market_basis:basis,analysis_perspective:'KR_EQUITY' as const,target_D:target,candidate_window_start:previous.closesAt,price_session:priceSession};
}
