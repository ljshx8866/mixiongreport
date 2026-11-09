const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PasswordPolicyService } = require('../dist/password-policy.service');

function createHarness() {
  const rows = new Map();
  const db = { systemSetting: {
    async findUnique({ where }) { return rows.get(where.key) ?? null; },
    async create({ data }) { rows.set(data.key, { ...data }); return data; },
    async upsert({ where, create, update }) {
      const row = rows.get(where.key) ?? create;
      const next = rows.has(where.key) ? { ...row, ...update } : { ...row };
      rows.set(where.key, next);
      return next;
    },
  } };
  return new PasswordPolicyService(db);
}

test('default password is forced to change, and changing the configured default updates the match', async () => {
  const policy = createHarness();
  assert.equal(await policy.requiresChange('66666666'), true);
  assert.equal(await policy.requiresChange('different-password'), false);

  await policy.update(true, '87654321');
  assert.equal(await policy.requiresChange('66666666'), false);
  assert.equal(await policy.requiresChange('87654321'), true);
});

test('disabling the policy stops forcing password changes', async () => {
  const policy = createHarness();
  await policy.update(false);
  assert.equal(await policy.requiresChange('66666666'), false);
});
