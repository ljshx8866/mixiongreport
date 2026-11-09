const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthController } = require('../dist/auth.controller');

test('current account endpoint returns account name and phone for the miniapp profile page', async () => {
  const controller = new AuthController({}, { user: { findUnique: async ({ where, select }) => {
    assert.deepEqual(where, { id: 17n });
    assert.equal(select.name, true);
    assert.equal(select.mobile, true);
    assert.equal(select.source, true);
    return { id: 17n, name: '测试账号', mobile: '13800138000', role: 'STORE_MANAGER', source: 'LOCAL',
      openid: 'openid-value', status: true, stores: [{ storeId: 3n }, { storeId: 8n }] };
  } } });
  const result = await controller.me({ user: { id: 17, role: 'STORE_MANAGER', storeIds: [3] } });
  assert.deepEqual(result, { id: 17, name: '测试账号', mobile: '13800138000', role: 'STORE_MANAGER',
    source: 'LOCAL', storeIds: [3, 8], wechatBound: true });
});

test('current account endpoint does not query the database for system credentials', async () => {
  const controller = new AuthController({}, { user: { findUnique: async () => { throw new Error('unexpected query'); } } });
  const system = { id: null, role: 'ADMIN', storeIds: [], system: true };
  assert.equal(await controller.me({ user: system }), system);
});
