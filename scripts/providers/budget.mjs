export function createProbeBudget({maxRequests=1,maxConcurrent=2,maxHostConcurrent=1,hostLimits={}}={}){
  for(const n of [maxRequests,maxConcurrent,maxHostConcurrent,...Object.values(hostLimits)])if(!Number.isInteger(n)||n<0)throw new Error('INVALID_BUDGET');
  let remaining=maxRequests,active=0;const hostActive=new Map(),hostRemaining=new Map(Object.entries(hostLimits));
  return {
    acquire(host){
      if(active>=maxConcurrent||(hostActive.get(host)??0)>=maxHostConcurrent)return null;
      active++;hostActive.set(host,(hostActive.get(host)??0)+1);let released=false;
      return ()=>{if(!released){active--;hostActive.set(host,hostActive.get(host)-1);released=true;}};
    },
    consume(host){const available=hostRemaining.get(host)??maxRequests;if(remaining<=0||available<=0)return false;remaining--;hostRemaining.set(host,available-1);return true;},
    snapshot(){return {remaining,active,hostRemaining:Object.fromEntries(hostRemaining),hostActive:Object.fromEntries(hostActive)};}
  };
}
