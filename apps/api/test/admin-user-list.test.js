const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdministrationController } = require('../dist/administration.controller');

test('admin user list does not expose the POS-synced duty title', async () => {
  const controller = new AdministrationController({
    user: { findMany: async () => [{
      id: 8n, name: '员工', mobile: '13800000000', openid: null, role: 'STORE_MANAGER',
      status: true, source: 'POS', externalUserCode: 'POS-8', externalDutyName: '财务监',
      lastSyncedAt: null, stores: [{ storeId: 3n }],
    }] },
  });

  const [user] = await controller.users();
  assert.equal(user.source, 'POS');
  assert.equal(user.externalUserCode, 'POS-8');
  assert.equal(user.wechatBound, false);
  assert.equal(Object.hasOwn(user, 'openid'), false);
  assert.equal(Object.hasOwn(user, 'externalDutyName'), false);
});

test('resetting a miniapp binding clears OpenID and writes an audit record', async () => {
  let currentOpenId = 'wechat-open-id';
  let audit;
  const tx = {
    user: {
      findUniqueOrThrow: async () => ({ id: 9n, name: '员工', openid: currentOpenId }),
      update: async ({ data }) => { currentOpenId = data.openid; },
    },
    auditLog: { create: async ({ data }) => { audit = data; } },
  };
  const db = { $transaction: (callback) => callback(tx) };
  const controller = new AdministrationController(db);

  const result = await controller.resetWechatBinding({ user: { id: 2, role: 'ADMIN', storeIds: [] } }, 9);

  assert.deepEqual(result, { id: 9, reset: true });
  assert.equal(currentOpenId, null);
  assert.equal(audit.action, 'RESET_WECHAT_BINDING');
  assert.deepEqual(audit.beforeData, { name: '员工', wechatBound: true });
  assert.deepEqual(audit.afterData, { name: '员工', wechatBound: false });
});
