const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SyncService } = require('../dist/sync.service');

test('sync payload retention is bounded and never runs outside database mode', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  const previousAdapter = process.env.POS_ADAPTER;
  const originalInfo = console.info;
  let callCount = 0;
  let query;
  let parameters;
  try {
    process.env.POS_ADAPTER = 'mock';
    process.env.REPORT_SOURCE = 'mock';
    const disabled = new SyncService({
      $executeRaw: async () => { callCount += 1; return 0; },
    });
    await disabled.cleanupExpiredSyncPayloads();
    assert.equal(callCount, 0);

    process.env.REPORT_SOURCE = 'database';
    console.info = () => {};
    const enabled = new SyncService({
      $executeRaw: async (parts, ...values) => {
        callCount += 1;
        query = parts.join('?');
        parameters = values;
        return 1;
      },
    });
    await enabled.cleanupExpiredSyncPayloads();

    assert.equal(callCount, 1);
    assert.match(query, /started_at < \?/);
    assert.match(query, /OCTET_LENGTH\(response_payload\) > 65536/);
    assert.match(query, /LIMIT 50/);
    assert.equal(parameters.length, 1);
    assert.ok(parameters[0] instanceof Date);
    assert.ok(Date.now() - parameters[0].getTime() >= 3 * 24 * 60 * 60 * 1000);
  } finally {
    console.info = originalInfo;
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
    if (previousAdapter === undefined) delete process.env.POS_ADAPTER;
    else process.env.POS_ADAPTER = previousAdapter;
  }
});
