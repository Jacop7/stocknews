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
