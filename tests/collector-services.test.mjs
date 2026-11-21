import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCollectorServices } from '../scripts/providers/html-worker.mjs';

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
