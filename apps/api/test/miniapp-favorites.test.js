const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MiniappDecorationController } = require('../dist/miniapp-decoration.controller');

function setup() {
  const users = new Map([[1n, { homeFavoriteModules: null }], [2n, { homeFavoriteModules: null }]]);
  const db = {
    miniappDecoration: {
      upsert: async ({ create }) => ({ ...create, updatedAt: new Date('2026-10-18T00:00:00Z'), homeBannerImage: null }),
    },
    user: {
      findUnique: async ({ where }) => users.has(where.id) ? users.get(where.id) : null,
      update: async ({ where, data }) => {
        const user = { ...users.get(where.id), ...data };
        users.set(where.id, user);
        return user;
      },
    },
  };
  return { controller: new MiniappDecorationController(db), users };
}

test('favorites are account scoped and new accounts inherit configured defaults', async () => {
  const { controller, users } = setup();
  const alice = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  const bob = { user: { id: 2, role: 'STORE_MANAGER', storeIds: [] } };

  assert.deepEqual(await controller.myFavorites(alice), {
    modules: ['input', 'report', 'history', 'reminders'], customized: false,
  });
  await controller.saveMyFavorites(alice, { modules: ['report', 'my-schedule'] });
  assert.deepEqual(await controller.myFavorites(alice), { modules: ['report', 'my-schedule'], customized: true });
  assert.deepEqual(await controller.myFavorites(bob), {
    modules: ['input', 'report', 'history', 'reminders'], customized: false,
  });
  assert.deepEqual(users.get(1n).homeFavoriteModules, ['report', 'my-schedule']);
  assert.equal(users.get(2n).homeFavoriteModules, null);
});

test('favorites can be cleared and unsupported modules are rejected', async () => {
  const { controller } = setup();
  const request = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  await controller.saveMyFavorites(request, { modules: [] });
  assert.deepEqual(await controller.myFavorites(request), { modules: [], customized: true });
  await assert.rejects(controller.saveMyFavorites(request, { modules: ['not-a-module'] }), /常用功能设置无效/);
  await assert.rejects(controller.saveMyFavorites(request, { modules: Array(9).fill('input') }), /常用功能设置无效/);
});

test('all HR home function ids shown by the miniapp can be saved', async () => {
  const { controller } = setup();
  const request = { user: { id: 1, role: 'STORE_MANAGER', storeIds: [] } };
  const modules = ['shift-templates', 'schedule-points', 'salary-change', 'bank-change', 'employees', 'approvals', 'work-statistics'];
  assert.deepEqual(await controller.saveMyFavorites(request, { modules }), { modules, customized: true });
});
