const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SyncService } = require('../dist/sync.service');

test('console-only POS master sync failures also become de-duplicated alerts', async () => {
  const alerts = new Map();
  const service = Object.create(SyncService.prototype);
  service.db = { systemAlert: { upsert: async ({ where, create, update }) => {
    const current = alerts.get(where.fingerprint);
    if (current) {
      current.occurrenceCount += update.occurrenceCount.increment;
      current.lastSeenAt = update.lastSeenAt;
      return current;
    }
    const created = { occurrenceCount: 1, ...create };
    alerts.set(where.fingerprint, created);
    return created;
  } } };
  await service.recordBackgroundFailure('POS_MASTER_SYNC', '/daily-master-data', new Error('POS network timeout for 13812345678'));
  await service.recordBackgroundFailure('POS_MASTER_SYNC', '/daily-master-data', new Error('POS network timeout for 13812345678'));
  assert.equal(alerts.size, 1);
  assert.equal([...alerts.values()][0].occurrenceCount, 2);
  assert.match([...alerts.values()][0].message, /\[手机号已隐藏\]/);
});
