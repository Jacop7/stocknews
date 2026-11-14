import { sourcePreflight,freePorts,ensureNetwork } from './local-runtime.mjs';
const mode=process.argv[2];
if(!['preflight','network'].includes(mode))throw new Error('Usage: node scripts/setup-local.mjs preflight|network');
const result=sourcePreflight();const ports=await freePorts();
if(mode==='network'){const n=ensureNetwork();console.log(JSON.stringify({...result,status:'NETWORK_CREATED',networkId:n.networkId,ports,noDatabaseStarted:true}));}
else console.log(JSON.stringify({...result,status:'PREFLIGHT_PASS',ports,noResourcesCreated:true}));
