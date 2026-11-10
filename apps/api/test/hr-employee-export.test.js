const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const { HrEmployeeExportService } = require('../dist/hr/hr-employee-export.service');
const { HrSensitiveCrypto } = require('../dist/hr/hr-sensitive-crypto');

const key = Buffer.alloc(32, 17).toString('base64');
const permissions = ['HR_EMPLOYEE_LIST_READ', 'HR_EMPLOYEE_EXPORT',
  'HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ'];

function encryptedProfile(employeeId) {
  const crypto = new HrSensitiveCrypto({ activeKeyId: 'test', keys: { test: key }, lookupKey: key });
  return {
    identity: crypto.seal(employeeId, 'IDENTITY', { name: '李四', phone: '13600001111',
      idNumber: '140101199001011234', sex: '男', ethnicity: '汉族', birthDate: '1990-01-01', address: '太原市小店区' }),
    bank: crypto.seal(employeeId, 'BANK', { accountName: '李四', bankName: '民生银行',
      branchName: '太原支行', cardNumber: '6222000012345678' }),
  };
}

test('employee archive export is store-scoped, decrypts current profile fields, and records a non-PII audit entry', async () => {
  const employeeId = 10n;
  const sealed = encryptedProfile(employeeId);
  const now = new Date('2026-11-10T02:00:00.000Z');
  let employeeQuery, audit;
  const db = {
    hrEmployee: { findMany: async (input) => {
      employeeQuery = input;
      return [{ id: employeeId, displayName: '李四', status: 'ACTIVE', userId: 22n,
        initialStoreId: 1n, initialStore: { storeName: '高新店' },
        trialStartedAt: null, trialEndedAt: null, createdAt: now, updatedAt: now,
        jobPosition: { name: '服务员', scheduleOnly: false },
        user: { id: 22n, name: '李四账号', mobile: '13600001111', status: true },
        primaryAppointments: [{ effectiveFrom: now, effectiveToExclusive: null,
          store: { storeName: '高新店' } }],
        onboardingRequests: [{ id: 20n, status: 'EFFECTIVE', failureCode: null, effectiveDate: now,
          store: { id: 1n, storeName: '高新店' }, accountHrRole: { name: '员工' },
          jobPosition: { name: '服务员' }, salaryRate: { hourlyRate: { toFixed: () => '17.00' } } }],
      }];
    } },
    hrSensitiveDraftRevision: { findMany: async () => [{ id: 1n, employeeId,
      sealedPayload: sealed.identity }] },
    hrBankAccountVersion: { findMany: async () => [{ id: 2n, employeeId,
      sourceRevision: { id: 3n, sealedPayload: sealed.bank } }] },
    hrApprovalInstance: { findMany: async () => [{ subjectId: 20n, status: 'APPROVED' }] },
    auditLog: { create: async (input) => { audit = input.data; } },
  };
  const access = { currentAccess: async () => ({ stores: [{ id: 1, storeName: '高新店', permissionCodes: permissions }] }) };
  const service = new HrEmployeeExportService(db, access);
  const oldEnv = { active: process.env.HR_DATA_ACTIVE_KEY_ID, keys: process.env.HR_DATA_KEYS_JSON,
    lookup: process.env.HR_DATA_LOOKUP_KEY };
  process.env.HR_DATA_ACTIVE_KEY_ID = 'test';
  process.env.HR_DATA_KEYS_JSON = JSON.stringify({ test: key });
  process.env.HR_DATA_LOOKUP_KEY = key;
  try {
    const file = await service.generate({ id: 7 }, { storeId: '1', status: 'ACTIVE', q: '李四' });
    assert.match(file.fileName, /^employee-roster-1-\d{8}\.xlsx$/);
    assert.deepEqual(employeeQuery.where.status, 'ACTIVE');
    assert.deepEqual(employeeQuery.where.displayName, { contains: '李四' });
    assert.equal(employeeQuery.where.OR[1].primaryAppointments.some.storeId.in[0], 1n);

    const workbook = new Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.getWorksheet('员工完整档案');
    assert.ok(sheet);
    assert.equal(sheet.getRow(2).getCell(3).value, '在职');
    assert.equal(sheet.getRow(2).getCell(6).value, '140101199001011234');
    assert.equal(sheet.getRow(2).getCell(14).value, '6222000012345678');
    assert.equal(sheet.getRow(2).getCell(18).value, '高新店：2026-11-10 至今');
    assert.equal(sheet.getRow(2).getCell(26).value, '已通过');
    assert.equal(workbook.getWorksheet('导出说明').getRow(4).getCell(2).value, 1);
    assert.equal(audit.entityType, 'HR_EMPLOYEE_EXPORT');
    assert.equal(audit.action, 'EXPORT');
    assert.equal(audit.afterData.includesSensitiveData, true);
    assert.equal(audit.afterData.recordCount, 1);
    assert.equal(JSON.stringify(audit.afterData).includes('140101199001011234'), false);
    assert.equal(JSON.stringify(audit.afterData).includes('6222000012345678'), false);
  } finally {
    if (oldEnv.active === undefined) delete process.env.HR_DATA_ACTIVE_KEY_ID;
    else process.env.HR_DATA_ACTIVE_KEY_ID = oldEnv.active;
    if (oldEnv.keys === undefined) delete process.env.HR_DATA_KEYS_JSON;
    else process.env.HR_DATA_KEYS_JSON = oldEnv.keys;
    if (oldEnv.lookup === undefined) delete process.env.HR_DATA_LOOKUP_KEY;
    else process.env.HR_DATA_LOOKUP_KEY = oldEnv.lookup;
  }
});

test('full employee export rejects list-only access and requires every selected store to have all export permissions', async () => {
  let employeeReads = 0;
  const db = { hrEmployee: { findMany: async () => { employeeReads += 1; return []; } } };
  const user = { id: 7 };
  const listOnly = new HrEmployeeExportService(db, { currentAccess: async () => ({
    stores: [{ id: 1, storeName: '高新店', permissionCodes: ['HR_EMPLOYEE_LIST_READ'] }],
  }) });
  await assert.rejects(listOnly.generate(user, { storeId: '1' }), /员工导出|敏感资料查看权限/);
  assert.equal(employeeReads, 0);

  const mixedStoreScope = new HrEmployeeExportService(db, { currentAccess: async () => ({ stores: [
    { id: 1, storeName: '高新店', permissionCodes: permissions },
    { id: 2, storeName: '大学城店', permissionCodes: ['HR_EMPLOYEE_LIST_READ'] },
  ] }) });
  await assert.rejects(mixedStoreScope.generate(user, {}), /全部|敏感资料查看权限/);
  assert.equal(employeeReads, 0);
});
