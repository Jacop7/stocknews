import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceVisit} from '../apps/mobile/src/data/view-visit.mjs';
const visit=()=>({done:false,ticket:{ticket_id:'SYNTHETIC'},elapsed:0,lastActiveAt:null,inFlight:false,retryAt:0});
test('Accumulates only eligible body time and pauses without counting a background gap',()=>{
 const v=visit();assert.equal(advanceVisit(v,true,0),false);advanceVisit(v,true,1200);advanceVisit(v,false,1300);
 advanceVisit(v,false,60000);advanceVisit(v,true,61000);assert.equal(v.elapsed,1200);assert.equal(advanceVisit(v,true,62800),true);assert.equal(v.elapsed,3000);
});
test('A pending body recheck, missing ticket or completed visit cannot create another view',()=>{
 const v=visit();advanceVisit(v,true,0);advanceVisit(v,true,2000);advanceVisit(v,false,3000);assert.equal(v.elapsed,2000);
 advanceVisit(v,true,4000);assert.equal(advanceVisit(v,true,5000),true);v.done=true;assert.equal(advanceVisit(v,true,9000),false);
 const noTicket=visit();noTicket.ticket=null;advanceVisit(noTicket,true,0);advanceVisit(noTicket,true,10000);assert.equal(noTicket.elapsed,0);
});
test('Only one request is in flight and retry uses the existing visit rather than resetting time',()=>{
 const v=visit();advanceVisit(v,true,0);v.inFlight=true;assert.equal(advanceVisit(v,true,4000),false);v.inFlight=false;v.retryAt=6000;assert.equal(advanceVisit(v,true,5000),false);assert.equal(advanceVisit(v,true,6000),true);
});
