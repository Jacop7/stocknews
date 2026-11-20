import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { collectSecPilot } from '../scripts/collect-sec-pilot.mjs';

const first = '0001045810-26-000075';
const second = '0001045810-26-000076';
const sourceUrl = 'https://data.sec.gov/submissions/CIK0001045810.json';
const contact = 'test@example.invalid';
const interval = 300_000;

function response(accessions = [first], forms = ['10-Q']) {
  return Response.json({cik:'0001045810', filings:{recent:{
    accessionNumber:accessions,
    form:forms,
    filingDate:accessions.map(()=>'2026-08-26'),
    acceptanceDateTime:accessions.map(()=>'2026-08-26T21:00:00.000Z'),
  }}});
}

test('requests just the official endpoint and stores each accession once beyond the cooldown', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    let requests = 0;
    const request = (url, options) => {
      requests++;
      assert.equal(url, sourceUrl);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['User-Agent'], 'Judoju News ' + contact);
      return response();
    };
    assert.equal((await collectSecPilot(db, {contact, request, now:1})).inserted, 1);
    assert.equal((await collectSecPilot(db, {contact, request, now:interval})).status, 'COOLDOWN');
    const replay = await collectSecPilot(db, {contact, request, now:interval+1});
    assert.equal(replay.inserted, 0);
    assert.equal(replay.stored, 1);
    assert.equal(requests, 2);
  } finally { db.close(); }
});

test('a failed response reserves the interval and a conflicting filing rolls back the entire batch', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const unexpected = () => assert.fail('source must remain uncalled');
    await assert.rejects(collectSecPilot(db, {contact:'missing', request:unexpected, now:1}), /CONTACT_REQUIRED/);
    await assert.rejects(collectSecPilot(db, {
      contact, request:()=>new Response(null, {status:429}), now:1,
    }), /RESPONSE_REJECTED_429/);
    assert.equal((await collectSecPilot(db, {contact, request:unexpected, now:2})).status, 'COOLDOWN');
    await collectSecPilot(db, {contact, request:()=>response(), now:interval+1});
    await assert.rejects(collectSecPilot(db, {
      contact, request:()=>response([second, first], ['8-K', '8-K']), now:2*interval+1,
    }), /STORED_ACCESSION_CONFLICT/);
    assert.deepEqual(db.prepare('SELECT accession FROM sec_filings').all().map(row=>row.accession), [first]);
  } finally { db.close(); }
});
