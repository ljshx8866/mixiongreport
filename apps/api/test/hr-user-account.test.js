const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertHrLinkedAccountRemovable, deleteHrLinkedAccount } = require('../dist/hr/hr-user-account');

test('deleting a linked local account clears access links and keeps its account deletion audit', async () => {
  const account = { id: 7n, name: '员工账号', mobile: '13800000000', role: 'STORE_MANAGER', source: 'LOCAL', status: true };
  const calls = [];
  const tx = {
    user: { findUnique: async () => account, delete: async ({ where }) => calls.push(['user.delete', where.id]) },
    userStore: { deleteMany: async () => calls.push(['stores']) },
    fillReminderRecipient: { deleteMany: async () => calls.push(['reminders']) },
    storeDailyInput: { updateMany: async () => calls.push(['inputs']) },
    auditLog: {
      updateMany: async () => calls.push(['audit.unlink']),
      create: async ({ data }) => calls.push(['audit.create', data.action]),
    },
  };

  assert.equal(await deleteHrLinkedAccount(tx, 7n), true);
  assert.deepEqual(calls, [['stores'], ['reminders'], ['inputs'], ['audit.unlink'],
    ['user.delete', 7n], ['audit.create', 'DELETE_HR_LINKED_ACCOUNT']]);
});

test('active POS-managed and last active administrator accounts cannot be removed from HR', async () => {
  const tx = { user: {
    findUnique: async () => ({ id: 7n, name: 'POS账号', mobile: null, role: 'STORE_MANAGER', source: 'POS', status: true }),
    count: async () => 1,
  } };
  await assert.rejects(assertHrLinkedAccountRemovable(tx, 7n), /仍由 POS 启用/);

  tx.user.findUnique = async () => ({ id: 8n, name: '管理员', mobile: null, role: 'ADMIN', source: 'LOCAL', status: true });
  await assert.rejects(assertHrLinkedAccountRemovable(tx, 8n), /最后一个启用中的管理员/);
});
