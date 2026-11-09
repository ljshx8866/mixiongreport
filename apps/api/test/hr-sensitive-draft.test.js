const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { HrSensitiveDraftService, normalizeEmployeePhone } = require('../dist/hr/hr-sensitive-draft.service');

test('employee phone normalization accepts common separators and +86 prefix', () => {
  assert.equal(normalizeEmployeePhone(' +86 136-2346-9725 '), '13623469725');
  assert.equal(normalizeEmployeePhone('(136) 2346 9725'), '13623469725');
});

test('employee phone normalization rejects malformed numbers', () => {
  assert.throws(() => normalizeEmployeePhone('1362346972'), /phone is invalid/);
  assert.equal(normalizeEmployeePhone('8613623469725'), '13623469725');
  assert.throws(() => normalizeEmployeePhone('13623abc725'), /phone is invalid/);
});

const employee = { status: 'DRAFT', initialStoreId: 2n, displayName: 'Test Person' };
const actor = { id: 7 };
const safeStringify = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);

async function withKeys(run) {
  const old = {
    HR_SENSITIVE_INTAKE_ENABLED: process.env.HR_SENSITIVE_INTAKE_ENABLED,
    HR_DATA_ACTIVE_KEY_ID: process.env.HR_DATA_ACTIVE_KEY_ID,
    HR_DATA_KEYS_JSON: process.env.HR_DATA_KEYS_JSON,
    HR_DATA_LOOKUP_KEY: process.env.HR_DATA_LOOKUP_KEY,
  };
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: randomBytes(32).toString('base64') });
  process.env.HR_DATA_LOOKUP_KEY = randomBytes(32).toString('base64');
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function fakeDb() {
  const writes = {};
  const tx = {
    $queryRaw: async () => [{ id: 3n }],
    hrEmployee: { findUnique: async () => employee },
    hrOnboardingRequest: { findFirst: async () => null },
    hrSensitiveDraftRevision: {
      findFirst: async () => null,
      create: async ({ data }) => { writes.revision = data; return { id: 9n, maskedValue: data.maskedValue }; },
    },
    hrIdentityClaim: { upsert: async (query) => { writes.claim = query; } },
    auditLog: { create: async ({ data }) => { writes.audit = data; } },
  };
  return {
    writes,
    db: { hrEmployee: { findUnique: async () => employee }, $transaction: async (callback) => callback(tx) },
    access: { assertStorePermission: async (_, code, storeId) => {
      assert.ok(['HR_ONBOARDING_CREATE', 'HR_EMPLOYEE_SENSITIVE_EDIT'].includes(code)); assert.equal(storeId, 2n);
    } },
  };
}

test('identity draft is encrypted, uniquely claimed and audit contains no identity number', async () => {
  await withKeys(async () => {
    const { db, access, writes } = fakeDb();
    const result = await new HrSensitiveDraftService(db, access).saveIdentity(3n, actor,
      { name: 'Test Person', idNumber: '11010519491231002X' });
    assert.deepEqual(result, { kind: 'IDENTITY', version: 1, maskedValue: '**************002X' });
    assert.equal(writes.claim.create.employeeId, 3n);
    assert.match(writes.claim.create.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(!safeStringify(writes.revision).includes('11010519491231002X'));
    assert.ok(!safeStringify(writes.audit).includes('11010519491231002X'));
  });
});

test('bank draft saves a masked version and rejects a different account holder', async () => {
  await withKeys(async () => {
    const { db, access, writes } = fakeDb();
    const service = new HrSensitiveDraftService(db, access);
    await assert.rejects(service.saveBank(3n, actor,
      { accountName: 'Someone Else', cardNumber: '6222021234567890123', bankName: 'Example Bank' }), /must match/);
    const result = await service.saveBank(3n, actor,
      { accountName: 'Test Person', cardNumber: '6222021234567890123', bankName: 'Example Bank' });
    assert.equal(result.kind, 'BANK');
    assert.ok(result.maskedValue.endsWith('0123'));
    assert.ok(!safeStringify(writes.revision).includes('6222021234567890123'));
  });
});

test('sensitive intake stays unavailable without its independent gate', async () => {
  const prior = process.env.HR_SENSITIVE_INTAKE_ENABLED;
  delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
  try {
    const { db, access } = fakeDb();
    await assert.rejects(new HrSensitiveDraftService(db, access).saveIdentity(3n, actor, {}), /not enabled/);
  } finally {
    if (prior === undefined) delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
    else process.env.HR_SENSITIVE_INTAKE_ENABLED = prior;
  }
});

test('masked draft read records who accessed version metadata without exposing sensitive values', async () => {
  await withKeys(async () => {
    const audits = [];
    const db = {
      hrEmployee: { findUnique: async () => employee },
      hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({
        kind: where.kind, version: 2, maskedValue: '****0123', createdAt: new Date('2026-10-15'),
      }) },
      auditLog: { create: async ({ data }) => audits.push(data) },
    };
    const access = { assertStorePermission: async () => {} };
    const result = await new HrSensitiveDraftService(db, access).masked(3n, actor);
    assert.equal(result.length, 2);
    assert.equal(audits[0].userId, 7n);
    assert.equal(audits[0].entityId, 3n);
    assert.equal(audits[0].action, 'VIEW_MASKED');
    assert.ok(!safeStringify(audits[0]).includes('0123'));
  });
});
