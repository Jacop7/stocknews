// Time is a monotonic elapsed clock. Public-body validity and focus are inputs,
// not inferred from rerenders or polling intervals.
export function advanceVisit(visit,eligible,now){
 if(visit.done||!visit.ticket||!eligible){visit.lastActiveAt=null;return false;}
 if(visit.lastActiveAt!==null)visit.elapsed+=Math.max(0,now-visit.lastActiveAt);
 visit.lastActiveAt=now;
 return visit.elapsed>=3000&&!visit.inFlight&&now>=visit.retryAt;
}
