const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SystemAlertService } = require('../dist/system-alert.service');

test('failed POS sync logs with the same store, endpoint and cause merge into one alert', async () => {
  const previousSource = process.env.REPORT_SOURCE;
  process.env.REPORT_SOURCE = 'database';
  const alerts = new Map();
  const marked = [];
  const logs = [1n, 2n].map((id) => ({ id, storeId: 9n, apiType: 'PRODUCTS',
    errorMessage: '菜品未关联，请同步分类资料', startedAt: new Date(Number(id) * 1000), store: { storeName: '高新店' } }));
  const tx = {
    systemAlert: { upsert: async ({ where, create, update }) => {
      const current = alerts.get(where.fingerprint);
      if (current) {
        Object.assign(current, { status: update.status, lastSeenAt: update.lastSeenAt,
          occurrenceCount: current.occurrenceCount + update.occurrenceCount.increment });
        return current;
      }
      alerts.set(where.fingerprint, { occurrenceCount: 1, ...create });
      return alerts.get(where.fingerprint);
    } },
    apiSyncLog: { update: async ({ where, data }) => { marked.push({ id: where.id, ...data }); } },
  };
  const db = { apiSyncLog: { findMany: async () => logs }, $transaction: async (run) => run(tx) };
  try {
    const monitor = new SystemAlertService(db);
    await monitor.collectFailedPosSyncLogs();
    assert.equal(alerts.size, 1);
    assert.equal([...alerts.values()][0].occurrenceCount, 2);
    assert.equal(marked.length, 2);
  } finally {
    if (previousSource === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previousSource;
  }
});
