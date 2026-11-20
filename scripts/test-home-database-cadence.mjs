/** Measure consecutive ranked cutoffs using the isolated database's clock and roles. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {MainOwnedP4Postgres,prepareHomeContext} from './test-main-p4-integration.mjs';
import {makeHomeCadenceFixture} from './test-home-database-postgres.mjs';
import {
  validateHomeDatabaseReply,validateHomeDatabaseRequest,validateHomeDatabaseResource,
} from '../workers/home-ranking/src/database-contracts.ts';
import {createHomeDatabaseAdapter,createHomeDatabaseCoordinator} from '../workers/home-ranking/src/database-adapter.ts';
import {createHomeDatabaseEvaluator} from '../workers/home-ranking/src/database-evaluator.ts';

const slotMs = 300_000;
const floor = time => Math.floor(Date.parse(time) / slotMs) * slotMs;
const stamp = time => new Date(time).toISOString();
const captureRole = 'home_v1_capture_worker';
const fixtureRole = 'home_v1_fixture_writer';
class CadenceHold extends Error {}
const requireTiming = (ok, reason) => {
  if (!ok) throw new CadenceHold(reason);
};

export async function runHomeDatabaseCadence({smoke = false} = {}) {
  const requestedSlots = smoke ? 1 : 32;
  const db = new MainOwnedP4Postgres('HOME_DB_BOUND_V1','supabase/home-bound-v1/contract.sql');
  const evidence = {schema:'HOME_DB_REALTIME_CADENCE_V1',scope:'ISOLATED_SYNTHETIC',
    status:'RUNNING',requestedSlots,resourceIdentity:null,namespaceId:randomUUID(),
    backendGeneration:null,postmasterStartedAt:null,slots:[],actualProviderCalls:0};
  const streamId = 'home-cadence';
  const output = db.outputDirectory;
  console.log(JSON.stringify({stage:'HOME_REALTIME_CADENCE',requestedSlots,output}));
  const write = (leaf, value) => writeFile(join(output,leaf),JSON.stringify(value,null,2)+'\n',{flag:'wx'});

  try {
    await db.start();
    const context = await prepareHomeContext(db);
    const identity = validateHomeDatabaseResource(context.resourceIdentity);
    evidence.resourceIdentity = identity;
    const rpc = async (role, operation, input) => {
      const request = validateHomeDatabaseRequest(operation,input);
      const reply = validateHomeDatabaseReply(operation,
        await context.transport({role,rpc:operation,args:{p_request:request}}));
      assert.equal(reply.resourceId,identity.resourceId);
      assert.equal(reply.principal.runId,identity.runId);
      assert.equal(reply.principal.componentRole,role);
      return reply;
    };
    const clock = async () => {
      const observation = await rpc(captureRole,'resource_identity',{resourceId:identity.resourceId});
      assert.deepEqual(validateHomeDatabaseResource(observation.result.resourceIdentity),identity);
      evidence.postmasterStartedAt ??= observation.result.postmasterStartedAt;
      requireTiming(observation.result.postmasterStartedAt===evidence.postmasterStartedAt,'POSTMASTER_CHANGED');
      return observation.serverCheckedAt;
    };
    const namespaceId = evidence.namespaceId;
    const now = await clock();
    const nextCutoff = floor(now) + slotMs;
    const firstCutoff = smoke && nextCutoff-Date.parse(now)>30_000 ? nextCutoff-slotMs : nextCutoff;
    const fixture = makeHomeCadenceFixture(stamp(firstCutoff));
    const namespace = await rpc(fixtureRole,'fixture_apply',{action:'CREATE_NAMESPACE',resourceId:identity.resourceId,
      namespaceId,effectKey:randomUUID(),initialStreamId:streamId});
    evidence.backendGeneration = namespace.backendGeneration;
    const coordinator = createHomeDatabaseCoordinator({
      adapter:createHomeDatabaseAdapter({namespaceId,streamId,expectedResourceIdentity:identity,transport:context.transport}),
      evaluator:createHomeDatabaseEvaluator(),
    });
    const previousHead = await coordinator.getHead();
    let expectedHead = previousHead.result.head;
    let previousClock = Date.parse(now);
    requireTiming(previousHead.backendGeneration===evidence.backendGeneration,'BACKEND_GENERATION_CHANGED');
    assert.equal(expectedHead.revision,'0');

    const waitForSlot = async cutoff => {
      const deadline = performance.now() + slotMs + 30_000;
      for (;;) {
        const observed = await clock();
        const ms = Date.parse(observed);
        requireTiming(ms>=previousClock,'DATABASE_CLOCK_REGRESSION');
        previousClock=ms;
        requireTiming(ms<cutoff+slotMs,'SLOT_MISSED');
        if (ms>=cutoff) return observed;
        requireTiming(performance.now()<deadline,'DATABASE_CLOCK_WAIT_TIMEOUT');
        await delay(Math.min(1000,cutoff-ms));
      }
    };
    for (let n=0; n<requestedSlots; n++) {
      const cutoff = firstCutoff + n*slotMs;
      const observedAt = await waitForSlot(cutoff);
      if (n===0) {
        await rpc(fixtureRole,'fixture_apply',{action:'APPEND',namespaceId,effectKey:randomUUID(),expectedInputRevision:'0',
          observations:fixture.observations,publicationBindings:fixture.bindings});
      }
      const roundId = randomUUID();
      const captureEffect = randomUUID();
      const commitEffect = randomUUID();
      const rankingCutoff = stamp(cutoff);
      const handle = await coordinator.captureEvaluate({
        namespaceId,effectKey:captureEffect,roundId,streamId,rankingCutoff,expectedHead,supersedesRoundId:null,
      });
      const prepared = coordinator.inspectPrepared(handle);
      requireTiming(prepared.backendGeneration===evidence.backendGeneration,'BACKEND_GENERATION_CHANGED');
      const receipt = await coordinator.commitPrepared(handle,commitEffect);
      requireTiming(receipt.backendGeneration===evidence.backendGeneration,'BACKEND_GENERATION_CHANGED');
      assert.equal(receipt.status,'APPLIED');
      assert.equal(receipt.result.globalRevision,String(n+1));
      assert.equal(receipt.result.head.roundId,roundId);
      expectedHead=receipt.result.head;
      const current = await coordinator.readCurrentHome();
      requireTiming(current.backendGeneration===evidence.backendGeneration,'BACKEND_GENERATION_CHANGED');
      requireTiming(floor(current.result.checkedAt)===cutoff,'SLOT_CHANGED_BEFORE_READ');
      assert.equal(current.result.state,'FRESH');
      assert.equal(current.result.snapshotId,roundId);
      assert.equal(current.result.sourceCutoff,rankingCutoff);
      assert.deepEqual(Object.values(current.result.lanes).flat().map(row=>row.issueId).sort(),['issue-0','issue-1']);
      requireTiming(floor(await clock())===cutoff,'SLOT_CHANGED_BEFORE_EVIDENCE');
      const slot = {slot:n+1,rankingCutoff,observedAt,readCheckedAt:current.result.checkedAt,
        captureEffect,commitEffect,roundId,head:expectedHead,snapshotId:current.result.snapshotId,
        marketBasis:current.result.marketBasis};
      await write('slot-'+String(n+1).padStart(2,'0')+'.json',slot);
      evidence.slots.push(slot);
      console.log(JSON.stringify(slot));
    }
    evidence.status='PASS';
  } catch (error) {
    const code = error.code ?? error.message;
    const hold = error instanceof CadenceHold || code==='CUTOFF_NOT_CURRENT';
    evidence.status=hold?'HOLD':'FAIL';
    evidence.reason=typeof code==='string' && /^[A-Z0-9_:.-]{1,100}$/.test(code) ? code : 'CADENCE_FAILURE';
  } finally {
    try {
      await db.close();
      evidence.cleanup='PASS';
    } catch {
      evidence.cleanup='FAIL';
      evidence.status='FAIL';
    }
    const first=evidence.slots[0],last=evidence.slots.at(-1);
    evidence.observedCutoffSpanMinutes=first?(Date.parse(last.rankingCutoff)-Date.parse(first.rankingCutoff))/60_000:0;
    await write('cadence-result.json',evidence);
    console.log(JSON.stringify({stage:'HOME_REALTIME_CADENCE',status:evidence.status,reason:evidence.reason,
      observedSlots:evidence.slots.length,cleanup:evidence.cleanup,output}));
  }
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const option = process.argv[2];
  assert.ok(process.argv.length<=3 && (option===undefined || option==='--smoke'));
  const result = await runHomeDatabaseCadence({smoke:option==='--smoke'});
  if (result.status!=='PASS') process.exitCode=1;
}
