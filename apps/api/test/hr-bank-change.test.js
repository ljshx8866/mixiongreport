const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { HrBankChangeService } = require('../dist/hr/hr-bank-change.service');
const { loadHrSensitiveCryptoFromEnv } = require('../dist/hr/hr-sensitive-crypto');

async function withSettings(run) {
  const keys = ['HR_FEATURES_ENABLED', 'HR_BANK_CHANGE_ENABLED', 'HR_SENSITIVE_INTAKE_ENABLED',
    'REPORT_SOURCE', 'HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HR_FEATURES_ENABLED = 'true';
  process.env.HR_BANK_CHANGE_ENABLED = 'true';
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.REPORT_SOURCE = 'database';
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: randomBytes(32).toString('base64') });
  process.env.HR_DATA_LOOKUP_KEY = randomBytes(32).toString('base64');
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
const actor = { id: 8 };
const input = { accountName: 'Test Person', cardNumber: '6222021234567890123', bankName: 'Example Bank', confirmedOriginals: true };
const safeStringify = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);

test('bank change stores only encrypted data and submits a configured scoped approval', async () => {
  await withSettings(async () => {
    const writes = {};
    const tx = {
      $queryRaw: async () => [],
      hrEmployee: { findUnique: async () => ({ status: 'ACTIVE', displayName: 'Test Person' }) },
      hrPrimaryAppointment: { findFirst: async () => ({ storeId: 3n }) },
      hrBankChangeRequest: { findFirst: async () => null,
        create: async ({ data }) => { writes.request = data; return { id: 12n, status: 'SUBMITTED', revision: data.revision }; } },
      hrSensitiveDraftRevision: { findFirst: async () => ({ version: 5 }),
        create: async ({ data }) => { writes.revision = data; return { id: 13n, maskedValue: data.maskedValue }; } },
      auditLog: { create: async ({ data }) => { writes.audit = data; } },
    };
    const db = { $transaction: async (callback) => callback(tx) };
    const access = { assertStorePermission: async (_user, permission, storeId) => {
      assert.ok(['HR_BANK_CHANGE_SUBMIT', 'HR_BANK_CHANGE_VERIFY'].includes(permission)); assert.equal(storeId, 3n);
    } };
    const approvals = { createForSubject: async (_tx, kind, subjectId, storeId, requestedBy) => {
      assert.equal(kind, 'BANK_CHANGE'); assert.equal(subjectId, 12n);
      assert.equal(storeId, 3n); assert.equal(requestedBy, 8n);
    } };
    const service = new HrBankChangeService(db, access, approvals);
    await assert.rejects(service.submit(actor, 20, { ...input, confirmedOriginals: false }), /verify.*in person/);
    const result = await service.submit(actor, 20, input);
    assert.equal(result.bankMask.endsWith('0123'), true);
    assert.equal(writes.request.sourceRevisionId, 13n);
    assert.ok(!safeStringify(writes.revision).includes(input.cardNumber));
    assert.ok(!safeStringify(writes.audit).includes(input.cardNumber));
  });
});

test('authorized bank change list exposes the full card number and audits access', async () => {
  await withSettings(async () => {
    const employeeId = 20n;
    const crypto = loadHrSensitiveCryptoFromEnv(process.env);
    const audits = [];
    const db = {
      hrBankChangeRequest: { findMany: async () => [{ id: 12n, employeeId, storeId: 3n, status: 'SUBMITTED', revision: 2,
        createdAt: new Date('2026-10-20T00:00:00.000Z'), appliedAt: null, failureCode: null,
        employee: { displayName: 'Test Person' }, sourceRevision: {
          maskedValue: '************0123', sealedPayload: crypto.seal(employeeId, 'BANK', {
            accountName: 'Test Person', bankName: 'Example Bank', branchName: 'Main Branch',
            cardNumber: input.cardNumber,
          }),
        } }] },
      auditLog: { create: async ({ data }) => audits.push(data) },
    };
    const access = { currentAccess: async () => ({ stores: [{ id: 3,
      permissionCodes: ['HR_BANK_CHANGE_APPROVE', 'HR_BANK_CHANGE_LIST_READ', 'HR_BANK_CHANGE_FULL_READ'] }] }) };
    const rows = await new HrBankChangeService(db, access, {}).list(actor);
    assert.equal(rows[0].cardNumber, input.cardNumber);
    assert.equal(rows[0].bankName, 'Example Bank');
    assert.equal(audits[0].action, 'VIEW_FULL_LIST');
  });
});

test('approved bank change closes prior account and activates a new immutable version once', async () => {
  const request = { id: 12n, employeeId: 20n, storeId: 3n, sourceRevisionId: 13n, status: 'SUBMITTED' };
  const oldVersion = { id: 4n, effectiveFrom: new Date('2020-01-01T00:00:00.000Z') };
  const updates = [];
  const creates = [];
  const tx = {
    $queryRaw: async () => [],
    hrBankChangeRequest: { findUnique: async () => request,
      update: async ({ data }) => { updates.push(data); Object.assign(request, data); return request; } },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => ({ status: 'ACTIVE' }) },
    hrPrimaryAppointment: { findFirst: async () => ({ id: 5n }) },
    hrBankAccountVersion: { findMany: async () => [oldVersion],
      update: async ({ where, data }) => { assert.equal(where.id, 4n); Object.assign(oldVersion, data); },
      create: async ({ data }) => creates.push(data) },
    auditLog: { create: async () => {} },
  };
  const service = new HrBankChangeService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(12n)).status, 'EFFECTIVE');
  assert.equal((await service.finalize(12n)).status, 'EFFECTIVE');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].employeeId, 20n);
  assert.equal(creates[0].sourceRevisionId, 13n);
  assert.equal(creates[0].bankChangeRequestId, 12n);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  assert.equal(creates[0].effectiveFrom.toISOString().slice(0, 10), `${part('year')}-${part('month')}-${part('day')}`);
  assert.equal(oldVersion.effectiveToExclusive, creates[0].effectiveFrom);
  assert.equal(updates.at(-1).status, 'EFFECTIVE');
});

test('rejected bank change cannot alter existing account versions', async () => {
  const request = { id: 12n, employeeId: 20n, storeId: 3n, status: 'SUBMITTED' };
  const tx = { $queryRaw: async () => [],
    hrBankChangeRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'REJECTED' }) },
    hrBankAccountVersion: { create: async () => { throw new Error('rejected change must not activate'); } },
  };
  const service = new HrBankChangeService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(12n)).status, 'REJECTED');
  assert.equal(request.status, 'REJECTED');
});
