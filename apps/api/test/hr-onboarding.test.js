const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { HrOnboardingService } = require('../dist/hr/hr-onboarding.service');
const { HrSensitiveCrypto } = require('../dist/hr/hr-sensitive-crypto');

async function withEnabled(run) {
  const old = { HR_ONBOARDING_ENABLED: process.env.HR_ONBOARDING_ENABLED,
    HR_SENSITIVE_INTAKE_ENABLED: process.env.HR_SENSITIVE_INTAKE_ENABLED,
    HR_DATA_ACTIVE_KEY_ID: process.env.HR_DATA_ACTIVE_KEY_ID,
    HR_DATA_KEYS_JSON: process.env.HR_DATA_KEYS_JSON,
    HR_DATA_LOOKUP_KEY: process.env.HR_DATA_LOOKUP_KEY };
  const key = Buffer.alloc(32, 53).toString('base64');
  process.env.HR_ONBOARDING_ENABLED = 'true';
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  try { await run(); }
  finally { for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
}

test('direct onboarding atomically seals full identity and bank data, then starts approval', async () => {
  const old = Object.fromEntries(['HR_ONBOARDING_ENABLED', 'HR_SENSITIVE_INTAKE_ENABLED',
    'HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY'].map((key) => [key, process.env[key]]));
  const key = Buffer.alloc(32, 23).toString('base64');
  process.env.HR_ONBOARDING_ENABLED = 'true';
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  try {
    const saved = { employee: null, revisions: [], request: null, audit: null, permissions: [] };
    const tx = {
      hrEmployee: { create: async ({ data }) => { saved.employee = data; return { id: 51n }; } },
      hrSensitiveDraftRevision: { create: async ({ data }) => {
        const row = { id: BigInt(saved.revisions.length + 81), ...data };
        saved.revisions.push(row); return row;
      } },
      hrIdentityClaim: { create: async ({ data }) => { saved.claim = data; } },
      hrRole: { findFirst: async ({ where }) => ({ id: where.id, code: 'EMPLOYEE', name: '员工' }) },
      hrJobPosition: { findFirst: async ({ where }) => ({ id: where.id, name: '店员',
        stores: where.stores.some.storeId === 2n ? [{ hourlyRate: { toFixed: () => '18.50' } }] : [] }) },
      hrOnboardingRequest: { create: async ({ data }) => {
        saved.request = data; return { id: 91n, status: 'SUBMITTED' };
      } },
      auditLog: { create: async ({ data }) => { saved.audit = data; } },
      hrOnboardingIntakeDraft: { deleteMany: async () => ({ count: 0 }) },
    };
    const access = { assertStorePermission: async (_user, code, storeId) => {
      saved.permissions.push([code, storeId]);
    } };
    const approvals = { createForSubject: async (_tx, kind, subjectId, storeId, actorId) => {
      assert.deepEqual([kind, subjectId, storeId, actorId], ['ONBOARDING', 91n, 2n, 7n]);
    } };
    const db = { $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable'); return callback(tx);
    } };
    const service = new HrOnboardingService(db, access, approvals);
    const result = await service.createAndSubmit({ id: 7 }, {
      initialStoreId: 2, name: '测试员工', phone: '13800138000', idNumber: '11010519491231002X',
      sex: '女', ethnicity: '汉', birthDate: '1949-12-31', address: '测试地址 1 号',
      accountName: '测试员工', cardNumber: '6222021234567890123', bankName: '测试银行',
      effectiveDate: '2026-10-16', confirmedOriginals: true, accountHrRoleId: 17, jobPositionId: 31,
    });
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(saved.employee.displayName, '测试员工');
    assert.deepEqual(saved.permissions.map(([code]) => code), [
      'HR_ONBOARDING_CREATE', 'HR_ONBOARDING_VERIFY',
    ]);
    assert.equal(saved.revisions.length, 2);
    assert.ok(saved.revisions.every((row) => !JSON.stringify(row.sealedPayload).includes('13800138000')));
    assert.ok(!JSON.stringify(saved.audit, (_, value) => typeof value === 'bigint' ? String(value) : value)
      .includes('13800138000'));
    assert.equal(saved.request.identityVersion, 1);
    assert.equal(saved.request.bankVersion, 1);
  } finally {
    for (const [keyName, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[keyName]; else process.env[keyName] = value;
    }
  }
});

test('store verification snapshots both encrypted draft versions and starts configured approval', async () => {
  await withEnabled(async () => {
    const snapshots = [];
    const employee = { status: 'DRAFT', initialStoreId: 2n };
    const tx = {
      $queryRaw: async () => [{ id: 3n }],
      hrEmployee: { findUnique: async () => employee },
      store: { findUnique: async () => ({ status: true }) },
      hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({
        version: where.kind === 'IDENTITY' ? 2 : 4, maskedValue: '****',
      }) },
      hrIdentityClaim: { findUnique: async () => ({ version: 2 }) },
      hrRole: { findFirst: async ({ where }) => ({ id: where.id, code: 'EMPLOYEE', name: '员工' }) },
      hrJobPosition: { findFirst: async ({ where }) => ({ id: where.id, name: '店员',
        stores: where.stores.some.storeId === 2n ? [{ hourlyRate: { toFixed: () => '18.50' } }] : [] }) },
      hrOnboardingRequest: {
        findFirst: async () => null,
        create: async ({ data }) => { snapshots.push(data); return { id: 10n, status: 'SUBMITTED', revision: data.revision }; },
      },
      auditLog: { create: async () => {} },
    };
    const service = new HrOnboardingService({ hrEmployee: { findUnique: async () => employee },
      $transaction: async (callback) => callback(tx) },
    { assertStorePermission: async (_user, code, storeId) => {
      assert.ok(['HR_ONBOARDING_CREATE', 'HR_ONBOARDING_VERIFY'].includes(code));
      assert.equal(storeId, 2n);
    } }, { createForSubject: async (_tx, kind, subjectId) => {
      assert.equal(kind, 'ONBOARDING'); assert.equal(subjectId, 10n);
    } });
    await assert.rejects(service.submit({ id: 5 }, 3, { effectiveDate: '2026-10-14' }), /confirm/);
    const result = await service.submit({ id: 5 }, 3,
      { effectiveDate: '2026-10-14', confirmedOriginals: true, accountHrRoleId: 17, jobPositionId: 31 });
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(snapshots[0].identityVersion, 2);
    assert.equal(snapshots[0].bankVersion, 4);
  });
});

test('approved onboarding creates and links a phone-login account without report-store access', async (t) => {
  const env = Object.fromEntries(['HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY']
    .map((key) => [key, process.env[key]]));
  const key = Buffer.alloc(32, 29).toString('base64');
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  t.after(() => { for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  const crypto = new HrSensitiveCrypto({ activeKeyId: 'test', keys: { test: key }, lookupKey: key });
  const request = { id: 10n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED', accountHrRoleId: 17n,
    jobPositionId: 31n, hourlyRateSnapshot: { toFixed: () => '18.50' },
    effectiveDate: new Date('2020-01-01T00:00:00.000Z'), identityVersion: 2, bankVersion: 4,
  };
  const employee = { status: 'DRAFT', initialStoreId: 2n, displayName: '测试员工' };
  const appointments = [];
  const bankVersions = [];
  const salaryRates = [];
  const tx = {
    $queryRaw: async () => [{ id: 10n }],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => employee, update: async ({ data }) => Object.assign(employee, data) },
    store: { findUnique: async () => ({ status: true }) },
    hrIdentityClaim: { findUnique: async () => ({ version: 2 }) },
    hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({
      id: where.kind === 'BANK' ? 44n : 22n,
      version: where.kind === 'IDENTITY' ? 2 : 4,
      ...(where.kind === 'IDENTITY' ? { sealedPayload: crypto.seal(3n, 'IDENTITY', {
        name: '测试员工', idNumber: '11010519491231002X', phone: '13800138000',
      }) } : {}),
    }) },
    user: { findMany: async () => [], create: async ({ data, select }) => {
      assert.equal(data.mobile, '13800138000'); assert.equal(data.role, 'STORE_MANAGER');
      assert.equal(data.localRoleOverride, undefined);
      assert.equal(data.status, true); assert.equal(data.source, 'LOCAL');
      assert.equal(select.id, true); return { id: 72n };
    } },
    hrRoleGrant: { findMany: async () => [], updateMany: async () => ({ count: 0 }),
      upsert: async ({ create }) => { assert.deepEqual(create, {
        userId: 72n, roleId: 17n,
      }); } },
    hrRole: { findFirst: async () => ({ id: 17n }),
      findUnique: async () => ({ code: 'EMPLOYEE_SELF_SERVICE', name: '员工自助' }) },
    hrSalaryRate: { findFirst: async () => null, create: async ({ data }) => salaryRates.push(data) },
    hrPrimaryAppointment: { findFirst: async () => appointments[0] ?? null,
      create: async ({ data }) => appointments.push(data) },
    hrBankAccountVersion: { create: async ({ data }) => bankVersions.push(data) },
    auditLog: { create: async () => {} },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(10n)).status, 'EFFECTIVE');
  assert.equal((await service.finalize(10n)).status, 'EFFECTIVE');
  assert.equal(appointments.length, 1);
  assert.equal(bankVersions.length, 1);
  assert.equal(salaryRates.length, 1);
  assert.deepEqual(salaryRates[0], { employeeId: 3n, hourlyRate: request.hourlyRateSnapshot,
    effectiveFrom: request.effectiveDate, sourceOnboardingRequestId: 10n });
  assert.deepEqual(bankVersions[0], { employeeId: 3n, sourceRevisionId: 44n,
    onboardingRequestId: 10n, effectiveFrom: request.effectiveDate });
  assert.equal(appointments[0].effectiveFrom.toISOString().slice(0, 10), '2020-01-01');
  assert.equal(employee.status, 'ACTIVE');
  assert.equal(employee.userId, 72n);
});

test('approved onboarding waits if its selected HR role is no longer assignable at effective time', async () => {
  const request = { id: 15n, employeeId: 5n, storeId: 2n, status: 'APPROVED_AWAITING_EFFECTIVE',
    accountHrRoleId: 17n, effectiveDate: new Date('2020-01-01T00:00:00.000Z') };
  let accountCreated = false;
  const tx = {
    $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrRole: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { id: 17n, enabled: true, onboardingAssignable: true });
      return null;
    } },
    user: { create: async () => { accountCreated = true; throw new Error('role must be re-enabled first'); } },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  const result = await service.finalize(15n);
  assert.equal(result.status, 'APPROVED_AWAITING_EFFECTIVE');
  assert.equal(request.failureCode, 'ACCOUNT_ROLE_UNAVAILABLE');
  assert.equal(accountCreated, false);
});

test('approved onboarding reuses a matching phone account and synchronizes the employee name', async (t) => {
  const env = Object.fromEntries(['HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY']
    .map((key) => [key, process.env[key]]));
  const key = Buffer.alloc(32, 30).toString('base64');
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  t.after(() => { for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  const crypto = new HrSensitiveCrypto({ activeKeyId: 'test', keys: { test: key }, lookupKey: key });
  const request = { id: 12n, employeeId: 4n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2026-10-17T00:00:00.000Z'), identityVersion: 1, bankVersion: 1,
    accountHrRoleId: 17n };
  const employee = { status: 'DRAFT', initialStoreId: 2n, displayName: '王小明' };
  const existingAccount = { id: 72n, name: 'POS账号旧名称', mobile: '+86 13800138000', status: true, hrEmployee: null };
  let accountUpdate;
  let grantUpdate;
  let grantUpsert;
  const tx = {
    $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request, update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => employee, update: async ({ data }) => Object.assign(employee, data) },
    store: { findUnique: async () => ({ status: true }) },
    hrIdentityClaim: { findUnique: async () => ({ version: 1 }) },
    hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({ id: where.kind === 'BANK' ? 42n : 41n,
      version: 1, ...(where.kind === 'IDENTITY' ? { sealedPayload: crypto.seal(4n, 'IDENTITY', {
        name: '王小明', idNumber: '11010519491231002X', phone: '13800138000',
      }) } : {}) }) },
    user: { findMany: async ({ where }) => {
      assert.equal(where.mobile.endsWith, '13800138000'); return [existingAccount];
    }, update: async ({ where, data }) => {
      accountUpdate = { where, data }; return { id: existingAccount.id };
    }, create: async () => { throw new Error('matching account must be reused'); } },
    hrRoleGrant: { findMany: async () => [{ roleId: 8n }],
      updateMany: async (input) => { grantUpdate = input; return { count: 1 }; },
      upsert: async (input) => { grantUpsert = input; } },
    hrRole: { findFirst: async () => ({ id: 17n }),
      findUnique: async () => ({ code: 'DEPUTY_MANAGER', name: '副经理' }) },
    hrPrimaryAppointment: { findFirst: async () => null, create: async () => {} },
    hrBankAccountVersion: { create: async () => {} },
    auditLog: { create: async () => {} },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(12n)).status, 'EFFECTIVE');
  assert.deepEqual(accountUpdate, { where: { id: 72n }, data: { name: '王小明' } });
  assert.deepEqual(grantUpdate, { where: { userId: 72n, active: true }, data: { active: false } });
  assert.deepEqual(grantUpsert.create, { userId: 72n, roleId: 17n });
  assert.deepEqual(grantUpsert.update, { active: true });
  assert.equal(employee.userId, 72n);
});

test('rejected onboarding never activates the employee', async () => {
  const request = { id: 10n, employeeId: 3n, status: 'SUBMITTED' };
  const tx = { $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'REJECTED' }) },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(10n)).status, 'REJECTED');
});

test('approved future onboarding waits for its requested date', async () => {
  const request = { id: 10n, employeeId: 3n, status: 'SUBMITTED',
    effectiveDate: new Date('2099-01-01T00:00:00.000Z') };
  const tx = { $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(10n)).status, 'APPROVED_AWAITING_EFFECTIVE');
  assert.equal(request.status, 'APPROVED_AWAITING_EFFECTIVE');
});

test('onboarding role choices include only enabled roles marked assignable during onboarding', async () => {
  await withEnabled(async () => {
    const access = { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_CREATE', 'HR_EMPLOYEE_SENSITIVE_EDIT', 'HR_ONBOARDING_VERIFY', 'HR_JOB_POSITION_READ'] }] }) };
    const db = { user: { findUnique: async () => ({ status: true }) },
      hrRole: { findMany: async (query) => {
        assert.deepEqual(query.where, { enabled: true, onboardingAssignable: true });
        return [{ id: 11n, code: 'EMPLOYEE', name: '员工自助' }];
      } } };
    const roles = await new HrOnboardingService(db, access, {}).accountRoles({ id: 9 }, '2');
    assert.deepEqual(roles, [{ id: 11, code: 'EMPLOYEE', name: '员工自助' }]);
  });
});

test('regional approvers receive the same configured onboarding roles for authorized stores', async () => {
  await withEnabled(async () => {
    const access = { currentAccess: async () => ({ stores: [
      { id: 2, permissionCodes: ['HR_ONBOARDING_CREATE', 'HR_EMPLOYEE_SENSITIVE_EDIT', 'HR_ONBOARDING_VERIFY', 'HR_JOB_POSITION_READ'] },
      { id: 3, permissionCodes: ['HR_ONBOARDING_CREATE', 'HR_EMPLOYEE_SENSITIVE_EDIT', 'HR_ONBOARDING_VERIFY', 'HR_JOB_POSITION_READ'] },
    ] }) };
    const db = { user: { findUnique: async () => ({ status: true }) },
      hrRole: { findMany: async () => [{ id: 12n, code: 'STORE_HR', name: '门店人事' }] } };
    const roles = await new HrOnboardingService(db, access, {}).accountRoles({ id: 9 }, '2');
    assert.deepEqual(roles, [{ id: 12, code: 'STORE_HR', name: '门店人事' }]);
  });
});

test('onboarding intake roles require the store intake permission set', async () => {
  await withEnabled(async () => {
    const access = { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_CREATE', 'HR_ONBOARDING_VERIFY'] }] }) };
    const db = { user: { findUnique: async () => ({ status: true }) },
      hrRole: { findMany: async () => [{ id: 13n, code: 'APPROVER', name: '审批人' }] } };
    const roles = await new HrOnboardingService(db, access, {}).accountRoles({ id: 9 }, '2');
    assert.deepEqual(roles.map(({ code }) => code), ['APPROVER']);
    const denied = new HrOnboardingService(db, { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_APPROVE'] }] }) }, {});
    await assert.rejects(denied.accountRoles({ id: 9 }, '2'), /intake access denied/);
  });
});

test('onboarding intake role choices do not require general sensitive-edit or job-read grants', async () => {
  await withEnabled(async () => {
    const access = { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_CREATE'] }] }) };
    const db = { user: { findUnique: async () => ({ status: true }) },
      hrRole: { findMany: async () => [{ id: 13n, code: 'EMPLOYEE', name: '员工' }] } };
    const roles = await new HrOnboardingService(db, access, {}).accountRoles({ id: 9 }, '2');
    assert.deepEqual(roles.map(({ code }) => code), ['EMPLOYEE']);
  });
});

test('onboarding approvers cannot replace the role or job selected at intake', async () => {
  await withEnabled(async () => {
    const request = { id: 18n, storeId: 2n, status: 'SUBMITTED', accountHrRoleId: 17n,
      jobPositionId: 31n, hourlyRateSnapshot: { toFixed: () => '18.50' } };
    const db = {
      hrOnboardingRequest: { findUnique: async () => request },
      hrApprovalInstance: { findUnique: async () => ({ id: 29n, currentPosition: 1, steps: [{ position: 1 }] }) },
    };
    const access = { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_APPROVE'] }] }) };
    const approvals = { decide: async (_user, instanceId, decision, reason) => {
      assert.deepEqual([instanceId, decision, reason], [29n, 'APPROVE', '']);
      return { status: 'APPROVED' };
    } };
    const service = new HrOnboardingService(db, access, approvals);
    service.finalize = async () => ({ status: 'EFFECTIVE' });
    assert.deepEqual(await service.decide({ id: 9 }, 18, { decision: 'APPROVE', accountHrRoleId: 17, jobPositionId: 31 }),
      { status: 'EFFECTIVE' });
    assert.equal(request.accountHrRoleId, 17n);
    assert.equal(request.jobPositionId, 31n);
    assert.equal(request.hourlyRateSnapshot.toFixed(), '18.50');
  });
});

test('onboarding refuses to activate if a source draft version changed', async () => {
  const request = { id: 10n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2020-01-01T00:00:00.000Z'), identityVersion: 2, bankVersion: 4 };
  const tx = { $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => ({ status: 'DRAFT', initialStoreId: 2n }) },
    store: { findUnique: async () => ({ status: true }) },
    hrIdentityClaim: { findUnique: async () => ({ version: 3 }) },
    hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({
      version: where.kind === 'IDENTITY' ? 3 : 4,
    }) },
    hrPrimaryAppointment: { findFirst: async () => null,
      create: async () => { throw new Error('must not create appointment'); } },
    hrBankAccountVersion: { create: async () => { throw new Error('must not activate bank'); } },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(10n)).status, 'EFFECTIVE_FAILED');
  assert.equal(request.failureCode, 'SOURCE_CHANGED');
});

test('onboarding never approves a replacement bank draft after the store verified an older version', async () => {
  const request = { id: 12n, employeeId: 3n, storeId: 2n, status: 'SUBMITTED',
    effectiveDate: new Date('2020-01-01T00:00:00.000Z'), identityVersion: 2, bankVersion: 4 };
  const tx = { $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request,
      update: async ({ data }) => Object.assign(request, data) },
    hrApprovalInstance: { findUnique: async () => ({ status: 'APPROVED' }) },
    hrEmployee: { findUnique: async () => ({ status: 'DRAFT', initialStoreId: 2n }) },
    store: { findUnique: async () => ({ status: true }) },
    hrIdentityClaim: { findUnique: async () => ({ version: 2 }) },
    hrSensitiveDraftRevision: { findFirst: async ({ where }) => ({
      id: where.kind === 'BANK' ? 45n : 22n,
      version: where.kind === 'BANK' ? 5 : 2,
    }) },
    hrPrimaryAppointment: { findFirst: async () => null,
      create: async () => { throw new Error('must not appoint employee'); } },
    hrBankAccountVersion: { create: async () => { throw new Error('must not approve bank'); } },
  };
  const service = new HrOnboardingService({ $transaction: async (callback) => callback(tx) }, {}, {});
  assert.equal((await service.finalize(12n)).status, 'EFFECTIVE_FAILED');
  assert.equal(request.failureCode, 'SOURCE_CHANGED');
});

test('phone correction updates the same onboarding request and reopens its approval round', async (t) => {
  const env = Object.fromEntries(['HR_ONBOARDING_ENABLED', 'HR_SENSITIVE_INTAKE_ENABLED',
    'HR_DATA_ACTIVE_KEY_ID', 'HR_DATA_KEYS_JSON', 'HR_DATA_LOOKUP_KEY'].map((key) => [key, process.env[key]]));
  const key = Buffer.alloc(32, 41).toString('base64');
  process.env.HR_ONBOARDING_ENABLED = 'true'; process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test'; process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  t.after(() => { for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  const crypto = new HrSensitiveCrypto({ activeKeyId: 'test', keys: { test: key }, lookupKey: key });
  const request = { id: 91n, employeeId: 51n, storeId: 2n, revision: 1,
    effectiveDate: new Date('2026-10-17T00:00:00.000Z'), identityVersion: 1, bankVersion: 1,
    status: 'EFFECTIVE_FAILED', failureCode: 'PHONE_REQUIRED', accountHrRoleId: 17n, jobPositionId: 31n };
  const audit = [];
  let updated;
  let restarted;
  const tx = {
    $queryRaw: async () => [],
    hrOnboardingRequest: { findUnique: async () => request, update: async ({ data }) => {
      updated = data; Object.assign(request, data); return request;
    } },
    hrEmployee: { findUnique: async () => ({ status: 'DRAFT', initialStoreId: 2n, displayName: '测试员工' }) },
    hrSensitiveDraftRevision: {
      findFirst: async ({ where }) => where.kind === 'IDENTITY'
        ? { version: 1, sealedPayload: crypto.seal(51n, 'IDENTITY', {
          name: '测试员工', idNumber: '11010519491231002X', phone: '',
        }) } : { version: 1 },
      create: async ({ data }) => ({ ...data, version: data.version, maskedValue: '**************002X' }),
    },
    hrRole: { findFirst: async ({ where }) => ({ id: where.id }) },
    hrJobPosition: { findFirst: async ({ where }) => ({ id: where.id, name: '店员',
      stores: [{ hourlyRate: { toFixed: () => '18.50' } }] }) },
    hrIdentityClaim: { update: async () => {} },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  const db = { hrOnboardingRequest: { findUnique: async () => request },
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable'); return callback(tx);
    } };
  const access = { assertStorePermission: async () => {} };
  const approvals = { restartForSubject: async (...args) => { restarted = args.slice(1); } };
  const service = new HrOnboardingService(db, access, approvals);
  const result = await service.correctPhoneAndResubmit({ id: 7 }, 91, { phone: '13800138000' });
  assert.equal(result.id, 91);
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.revision, 2);
  assert.equal(updated.revision, 2);
  assert.equal(updated.identityVersion, 2);
  assert.equal(updated.failureCode, null);
  assert.equal(restarted[0], 'ONBOARDING');
  assert.equal(restarted[1], 91n);
  assert.equal(restarted[3], 2);
  assert.equal(audit.at(-1).entityId, 91n);
  assert.equal(audit.at(-1).action, 'PHONE_CORRECTION_RESUBMIT');
});

test('onboarding history returns all revision and approval audit events in time order', async () => {
  await withEnabled(async () => {
    const requests = [{ id: 91n, revision: 1, status: 'EFFECTIVE_FAILED', failureCode: 'PHONE_REQUIRED',
      createdAt: new Date('2026-10-15T00:00:00Z'), updatedAt: new Date('2026-10-15T00:00:00Z') },
      { id: 92n, revision: 2, status: 'EFFECTIVE', failureCode: null,
        createdAt: new Date('2026-10-16T00:00:00Z'), updatedAt: new Date('2026-10-16T00:00:00Z') }];
    const audit = [{ id: 7n, entityType: 'HR_ONBOARDING', action: 'PHONE_CORRECTION_RESUBMIT',
      createdAt: new Date('2026-10-16T00:00:00Z'), user: { name: '人事' },
      beforeData: { revision: 1 }, afterData: { revision: 2 }, reason: null }];
    const db = {
      hrOnboardingRequest: { findUnique: async () => ({ id: 92n, employeeId: 51n, storeId: 2n,
        revision: 2, status: 'EFFECTIVE' }), findMany: async () => requests },
      hrApprovalInstance: { findMany: async () => [{ id: 5n, subjectId: 91n }, { id: 6n, subjectId: 92n }] },
      auditLog: { findMany: async ({ where }) => {
        assert.equal(where.OR.length, 2); return audit;
      } },
    };
    const access = { currentAccess: async () => ({ stores: [{ id: 2,
      permissionCodes: ['HR_ONBOARDING_DETAIL_READ'] }] }) };
    const result = await new HrOnboardingService(db, access, {}).history({ id: 7 }, 92);
    assert.equal(result.request.id, 92);
    assert.deepEqual(result.revisions.map((item) => item.revision), [1, 2]);
    assert.equal(result.events[0].action, 'PHONE_CORRECTION_RESUBMIT');
    assert.equal(result.events[0].actorName, '人事');
  });
});

test('onboarding list returns full identity and bank details and records the viewer', async () => {
  await withEnabled(async () => {
    const audits = [];
    let canApprove = true;
    const crypto = new HrSensitiveCrypto({ activeKeyId: 'test',
      keys: { test: process.env.HR_DATA_KEYS_JSON ? JSON.parse(process.env.HR_DATA_KEYS_JSON).test : '' },
      lookupKey: process.env.HR_DATA_LOOKUP_KEY });
    const db = {
      hrOnboardingRequest: { findMany: async () => [{
        id: 10n, employeeId: 3n, employee: { displayName: 'Test Person' },
        status: 'SUBMITTED', revision: 1, effectiveDate: new Date('2026-10-20T00:00:00.000Z'),
        identityVersion: 2, bankVersion: 4, failureCode: null, storeId: 2n,
        store: { storeName: '清控店' },
      }] },
      hrApprovalInstance: { findUnique: async () => ({ status: 'PENDING', currentPosition: 1,
        requestedBy: 5n, steps: [{ position: 1, roleId: 8n, role: { name: '人事总监' } }] }) },
      hrSensitiveDraftRevision: { findMany: async () => [
        { kind: 'IDENTITY', maskedValue: '**************002X', sealedPayload: crypto.seal(3n, 'IDENTITY', {
          name: 'Test Person', phone: '13800138000', idNumber: '11010519491231002X',
        }) },
        { kind: 'BANK', maskedValue: '****0123', sealedPayload: crypto.seal(3n, 'BANK', {
          accountName: 'Test Person', bankName: '测试银行', cardNumber: '6222021234567890123',
        }) },
      ] },
      auditLog: { create: async ({ data }) => audits.push(data) },
    };
    const access = { currentAccess: async () => ({ stores: [{ id: 2, storeName: 'Test Store',
      permissionCodes: ['HR_ONBOARDING_APPROVE', 'HR_ONBOARDING_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ'] }] }),
      assertWorkflowRolePermission: async (_user, code, storeId, roleId) => {
        assert.deepEqual([code, storeId, roleId], ['HR_ONBOARDING_APPROVE', 2n, 8n]);
        if (!canApprove) throw new ForbiddenException('HR access denied');
      } };
    const service = new HrOnboardingService(db, access, {});
    const result = await service.list({ id: 7 }, 2);
    assert.equal(result[0].identityDetails.idNumber, '11010519491231002X');
    assert.equal(result[0].bankDetails.cardNumber, '6222021234567890123');
    assert.equal(result[0].storeName, '清控店');
    assert.equal(result[0].bankMask, '****0123');
    assert.deepEqual(result[0].approval, { status: 'PENDING', position: 1, totalSteps: 1,
      roleName: '人事总监', canDecide: true, blockedReason: null });
    assert.equal(result[0].failureCode, null);
    assert.deepEqual(audits[0].afterData, { requestIds: ['10'], count: 1 });
    assert.equal(audits[0].userId, 7n);
    assert.equal(audits[0].action, 'VIEW_FULL_ONBOARDING_LIST');
    assert.ok(!JSON.stringify(audits[0], (_, item) => typeof item === 'bigint' ? String(item) : item).includes('0123'));
    canApprove = false;
    const blocked = await service.list({ id: 7 }, 2);
    assert.equal(blocked[0].approval.canDecide, false);
    assert.match(blocked[0].approval.blockedReason, /人事总监/);
  });
});
