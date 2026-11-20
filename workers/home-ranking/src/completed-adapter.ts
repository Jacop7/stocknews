/** NODE-ONLY SYNTHETIC_HOME_WORKER_P1. Internal memory fixture, never a public ranking DTO. */
import {SyntheticCompletedRanking,type K1RankingCommand} from '../../../packages/domain/src/pipeline-ranking.ts';
import {PipelineError,pipelineData,pipelineId} from '../../../packages/contracts/src/pipeline.ts';

export const HOME_WORKER_SCHEMA='SYNTHETIC_HOME_WORKER_P1' as const;
const OPERATIONS=['PROPOSE','COMPLETE','READ_LATEST','EXPORT_STATE','RESTORE_STATE','FALLBACK'] as const;
export type HomeWorkerOperation=typeof OPERATIONS[number];
type Results={
  PROPOSE:ReturnType<SyntheticCompletedRanking['propose']>;
  COMPLETE:ReturnType<SyntheticCompletedRanking['complete']>;
  READ_LATEST:ReturnType<SyntheticCompletedRanking['latest']>;
  EXPORT_STATE:ReturnType<SyntheticCompletedRanking['export']>;
  RESTORE_STATE:null;
  FALLBACK:ReturnType<SyntheticCompletedRanking['fallback']>;
};
type Payloads={
  PROPOSE:K1RankingCommand;
  COMPLETE:{snapshotId:string;expectedRevision:number};
  READ_LATEST:null;
  EXPORT_STATE:null;
  RESTORE_STATE:ReturnType<SyntheticCompletedRanking['export']>;
  /** The existing engine validates its current eligibility contract at runtime. */
  FALLBACK:unknown;
};
export type HomeWorkerEnvelope={
  [O in HomeWorkerOperation]:{schema:typeof HOME_WORKER_SCHEMA;sampleKind:'SYNTHETIC';operation:O;payload:Payloads[O]}
}[HomeWorkerOperation];
export type HomeWorkerResponse={
  [O in HomeWorkerOperation]:{schema:typeof HOME_WORKER_SCHEMA;sampleKind:'SYNTHETIC';persistence:'MEMORY_FIXTURE_ONLY';operation:O;result:Results[O]}
}[HomeWorkerOperation];
function invalid():never {throw new PipelineError('INVALID_INPUT');}

function message(raw:unknown):{operation:HomeWorkerOperation;payload:unknown} {
  // Inspect the constant-size shell without evaluating any input property getter.
  // Payload gets the engine's original depth/node/262144-character budget at depth zero.
  try {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid();
    const proto=Object.getPrototypeOf(raw),keys=Reflect.ownKeys(raw);
    if(proto!==Object.prototype&&proto!==null||keys.length!==4)invalid();
    const values:Record<string,unknown>={};
    for(const key of ['schema','sampleKind','operation','payload']){
      const d=Object.getOwnPropertyDescriptor(raw,key);
      if(!keys.includes(key)||!d||!d.enumerable||!('value' in d))invalid();
      values[key]=d.value;
    }
    if(values.schema!==HOME_WORKER_SCHEMA||values.sampleKind!=='SYNTHETIC'||!OPERATIONS.includes(values.operation as HomeWorkerOperation))invalid();
    const operation=values.operation as HomeWorkerOperation,payload=pipelineData(values.payload);
    if(operation==='READ_LATEST'||operation==='EXPORT_STATE'){
      if(payload!==null)invalid();
    } else if(operation==='COMPLETE') {
      if(!payload||typeof payload!=='object'||Array.isArray(payload))invalid();
      const p=payload as Record<string,unknown>;
      if(Object.keys(p).length!==2||!Object.hasOwn(p,'snapshotId')||!Object.hasOwn(p,'expectedRevision')||!pipelineId(p.snapshotId)||!Number.isSafeInteger(p.expectedRevision)||Number(p.expectedRevision)<0)invalid();
    }
    return {operation,payload};
  } catch(error) {
    if(error instanceof PipelineError)throw error;
    return invalid();
  }
}

/** Owns one private engine. No injection port, scheduler, I/O or live-mode activation. */
export class SyntheticHomeWorkerAdapter {
  #engine:SyntheticCompletedRanking;
  constructor(streamId='fixture-home',capacity=32){this.#engine=new SyntheticCompletedRanking(streamId,capacity);}
  dispatch(raw:unknown):HomeWorkerResponse {
    const {operation,payload}=message(raw);
    // Engine methods already detach their results and preflight aggregate state before commit.
    // The five response fields add only fixed enum metadata/constant JSON overhead. Do not
    // pipelineData() this wrapper after a mutation: that would impose a different budget.
    const respond=<O extends HomeWorkerOperation>(operation:O,result:Results[O])=>({schema:HOME_WORKER_SCHEMA,sampleKind:'SYNTHETIC' as const,persistence:'MEMORY_FIXTURE_ONLY' as const,operation,result});
    switch(operation){
      case 'PROPOSE':return respond(operation,this.#engine.propose(payload));
      case 'COMPLETE':{
        const p=payload as Payloads['COMPLETE'];
        return respond(operation,this.#engine.complete(p.snapshotId,p.expectedRevision));
      }
      case 'READ_LATEST':return respond(operation,this.#engine.latest());
      case 'EXPORT_STATE':return respond(operation,this.#engine.export());
      case 'RESTORE_STATE':this.#engine.restore(payload);return respond(operation,null);
      case 'FALLBACK':return respond(operation,this.#engine.fallback(payload));
    }
  }
}
