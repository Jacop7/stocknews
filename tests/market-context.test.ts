import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingMarketContext, type MarketCalendar } from '../packages/domain/src/index.ts';
// Explicit synthetic calendar records: weekdays are not inferred by production code.
const kr:Record<string,[string,string]|null>={
  '2026-11-11':['00:00','06:30'],'2026-11-12':['00:00','06:30'],'2026-11-13':['00:00','06:30'],
  '2026-11-14':null,'2026-11-15':null,'2026-11-16':['00:00','06:30'],'2026-11-17':null,'2026-11-18':['00:00','06:30'],
};
const us:Record<string,[string,string]|null>={'2026-11-12':['14:30','21:00'],'2026-11-13':['14:30','21:00'],'2026-11-14':null,'2026-11-15':null,'2026-11-16':['14:30','18:00'],'2026-11-17':['14:30','21:00']};
const calendar:MarketCalendar={sessionForDay:(market,date)=>{const value=(market==='KRX'?kr:us)[date];return value===undefined?'UNKNOWN':value===null?null:{tradingDayId:date,opensAt:date+'T'+value[0]+':00Z',closesAt:date+'T'+value[1]+':00Z'};}};
const context=(time:string,c=calendar)=>rankingMarketContext({now:()=>new Date(time)},c);
for(const [time,basis,target,start] of [
  ['2026-11-13T00:09:59Z','FOREIGN_US','2026-11-13','2026-11-12T06:30:00Z'],
  ['2026-11-13T00:10:00Z','KR','2026-11-13','2026-11-12T06:30:00Z'],
  ['2026-11-13T10:59:59Z','KR','2026-11-13','2026-11-12T06:30:00Z'],
  ['2026-11-13T11:00:00Z','FOREIGN_US','2026-11-16','2026-11-13T06:30:00Z'],
  ['2026-11-14T01:00:00Z','FOREIGN_US','2026-11-16','2026-11-13T06:30:00Z'],
  ['2026-11-15T01:00:00Z','FOREIGN_US','2026-11-16','2026-11-13T06:30:00Z'],
  ['2026-11-16T00:09:59Z','FOREIGN_US','2026-11-16','2026-11-13T06:30:00Z'],
  ['2026-11-16T00:10:00Z','KR','2026-11-16','2026-11-13T06:30:00Z'],
  ['2026-11-17T01:00:00Z','FOREIGN_US','2026-11-18','2026-11-16T06:30:00Z'],
] as const)test('P04a target day/window '+time,()=>{const r=context(time);assert.equal(r.status,'READY');assert.equal(r.selection_market_basis,basis);assert.equal(r.target_D,target);assert.equal(r.candidate_window_start,start);assert.equal(r.analysis_perspective,'KR_EQUITY');});
test('P04a US early close stays calendar-derived',()=>{assert.equal(context('2026-11-17T01:00:00Z').price_session?.closesAt,'2026-11-16T18:00:00Z');});
test('P04a missing future KR day blocks target attribution',()=>{assert.equal(context('2026-11-18T11:00:00Z').status,'CALENDAR_UNAVAILABLE');});
test('P04a unavailable calendar never fabricates fallback',()=>{const r=context('2026-11-13T11:00:00Z',{sessionForDay:()=> 'UNKNOWN'});assert.equal(r.status,'CALENDAR_UNAVAILABLE');assert.equal(r.selection_market_basis,null);});
test('P04a summer/winter US sessions and before-open latest completed selection',()=>{
  for(const [date,open,close] of [['2026-07-01','13:30','20:00'],['2026-11-13','14:30','21:00']]){
    const c:MarketCalendar={sessionForDay:(market,day)=>market==='KRX'?{tradingDayId:day,opensAt:day+'T00:00:00Z',closesAt:day+'T06:30:00Z'}:day===date?{tradingDayId:day,opensAt:day+'T'+open+':00Z',closesAt:day+'T'+close+':00Z'}:null};
    assert.equal(context(date+'T15:00:00Z',c).price_session?.opensAt,date+'T'+open+':00Z');
  }
  assert.equal(context('2026-11-13T11:00:00Z').price_session?.tradingDayId,'2026-11-12');
});
test('P04a rejects wrong session day and invalid instants',()=>{
  assert.equal(context('2026-11-13T00:10:00Z',{sessionForDay:()=>({tradingDayId:'wrong',opensAt:'bad',closesAt:'bad'})}).status,'CALENDAR_UNAVAILABLE');
  assert.throws(()=>context('invalid'),TypeError);
});
