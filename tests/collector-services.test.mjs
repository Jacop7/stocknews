import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCollectorServices, createCollectorScheduler } from '../scripts/providers/html-worker.mjs';

test('web releases its cycle before Telegram can make a request', async () => {
  const webGate = Promise.withResolvers();
  const seen = [];
  const run = runCollectorServices({
    async collectWeb() {
      seen.push('web starts');
      await webGate.promise;
      seen.push('web finishes');
      return { watched: 1 };
    },
    async collectTelegram() {
      seen.push('telegram starts');
      return { links: 2 };
    },
    stopped: () => false,
  });
  assert.deepEqual(seen, ['web starts']);
  webGate.resolve();
  assert.deepEqual(await run, { web: { watched: 1 }, telegram: { links: 2 } });
  assert.deepEqual(seen, ['web starts', 'web finishes', 'telegram starts']);
});

test('Telegram failures do not erase web results or stop subsequent web cycles', async () => {
  assert.deepEqual(await runCollectorServices({ collectWeb: async () => ({ requests: 1 }),
    collectTelegram: async () => { throw new Error('raw message must not leak'); }, stopped: () => false }),
  { web: { requests: 1 }, telegram: { status: 'FAILED', reason: 'TELEGRAM_CYCLE_FAILED', links: 0 } });
});

test('5-second Telegram ticks retain the web cadence from completion and remain serial', async () => {
  let now = 1_000_000, busy = false, web = 0, telegram = 0, maintenance = 0;
  const seen = [];
  const tick = createCollectorScheduler({ now: () => now, stopped: () => false,
    maintainTelegram: () => { maintenance++; },
    collectWeb: async () => { assert(!busy); busy = true; web++; seen.push(now); now += 3000; busy = false; return { requests: 1 }; },
    collectTelegram: async () => { assert(!busy); telegram++; return { links: 1 }; },
  });
  await tick();
  for (let count = 0; count < 11; count++) { now += 5000; assert.equal((await tick()).web, undefined); }
  assert.equal(web, 1); now += 5000; await tick();
  assert.deepEqual(seen, [1_000_000, 1_063_000]);
  assert.equal(web, 2); assert.equal(telegram, 13); assert.equal(maintenance, 2);
});

test('a disabled Telegram worker or shutdown between cycles leaves the web result intact', async () => {
  const collectWeb = async () => ({ watched: 1 });
  const expected = { web: { watched: 1 }, telegram: undefined };
  assert.deepEqual(await runCollectorServices({ collectWeb, stopped: () => false }), expected);
  assert.deepEqual(await runCollectorServices({
    collectWeb,
    collectTelegram: () => assert.fail('Telegram must stay stopped'),
    stopped: () => true,
  }), expected);
});
