import test from 'node:test';
import assert from 'node:assert/strict';
import { marketWindow,marketContext,formatKorea } from '../packages/domain/src/index.ts';
for(const [time,expected] of [['2026-11-13T00:09:59Z','FOREIGN_US'],['2026-11-13T00:10:00Z','KR'],['2026-11-13T10:59:59Z','KR'],['2026-11-13T11:00:00Z','FOREIGN_US']] as const)test('Korea time window '+time,()=>assert.equal(marketWindow(new Date(time)),expected));
test('invalid clock fails before calendar access',()=>assert.throws(()=>marketContext({now:()=>new Date('invalid')},{sessionForDay:()=>{throw new Error('Must not be called');}}),TypeError));
test('missing Korean calendar cannot invent a basis',()=>{
  const result=marketContext({now:()=>new Date('2026-11-13T01:00:00Z')},{sessionForDay:(market,date)=>{assert.equal(market,'KRX');assert.equal(date,'2026-11-13');return 'UNKNOWN';}});
  assert.equal(result.status,'CALENDAR_UNAVAILABLE');assert.equal(result.selection_market_basis,null);
});
test('verified Korean weekend falls back to US local trading date',()=>{
  const calls:string[]=[];
  const session={tradingDayId:'2026-11-13',opensAt:'2026-11-13T14:30:00Z',closesAt:'2026-11-13T21:00:00Z'};
  const result=marketContext({now:()=>new Date('2026-11-14T01:00:00Z')},{sessionForDay:(market,date)=>{calls.push(`${market}:${date}`);return market==='KRX'?null:session;}});
  assert.deepEqual(calls,['KRX:2026-11-14','NYSE:2026-11-13']);assert.equal(result.selection_market_basis,'FOREIGN_US');assert.equal(result.status,'READY');assert.equal(result.analysis_perspective,'KR_EQUITY');
});
test('Korean trading day retains Korean basis after regular close until 20:00',()=>{
  const session={tradingDayId:'2026-11-13',opensAt:'2026-11-13T00:00:00Z',closesAt:'2026-11-13T06:30:00Z'};
  const result=marketContext({now:()=>new Date('2026-11-13T10:59:59Z')},{sessionForDay:(market)=>{assert.equal(market,'KRX');return session;}});
  assert.equal(result.selection_market_basis,'KR');assert.equal(result.status,'READY');assert.deepEqual(result.session,session);
});
test('US summer and winter sessions come from calendar without fixed UTC hours',()=>{
  for(const [date,open,close] of [['2026-07-01','13:30','20:00'],['2026-11-13','14:30','21:00']]){
    const session={tradingDayId:date,opensAt:`${date}T${open}:00Z`,closesAt:`${date}T${close}:00Z`};
    const result=marketContext({now:()=>new Date(`${date}T15:00:00Z`)},{sessionForDay:(market,day)=>{assert.equal(market,'NYSE');assert.equal(day,date);return session;}});
    assert.equal(result.selection_market_basis,'FOREIGN_US');assert.deepEqual(result.session,session);
  }
});
test('verified US closure stays explicit',()=>{
  const result=marketContext({now:()=>new Date('2026-11-15T15:00:00Z')},{sessionForDay:()=>null});
  assert.equal(result.status,'NO_TRADING_SESSION');assert.equal(result.session,null);
});
test('unavailable US calendar stays explicit',()=>{
  const result=marketContext({now:()=>new Date('2026-11-13T11:00:00Z')},{sessionForDay:()=> 'UNKNOWN'});
  assert.equal(result.status,'CALENDAR_UNAVAILABLE');assert.equal(result.session,'UNKNOWN');
});
test('Korea display date crosses UTC midnight correctly',()=>assert.match(formatKorea(new Date('2026-11-13T16:00:00Z')),/11\. 14\./));
