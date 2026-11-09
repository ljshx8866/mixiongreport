const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrEmployeeController } = require('../dist/hr/hr-employee.controller');

test('employee roster scopes active employees to the currently effective store appointment', async () => {
  let query;
  const controller = new HrEmployeeController({
    hrEmployee: { findMany: async (input) => { query = input; return []; } },
  }, { currentAccess: async () => ({ stores: [{ id: 1, permissionCodes: ['HR_EMPLOYEE_LIST_READ'] }] }) });

  assert.deepEqual(await controller.list({ user: { id: 7 } }, '1', 'ALL'), []);

  const activeBranch = query.where.OR.find((branch) => branch.status === 'ACTIVE');
  assert.ok(activeBranch);
  assert.equal(activeBranch.primaryAppointments.some.storeId.in[0], 1n);
  assert.ok(activeBranch.primaryAppointments.some.effectiveFrom.lte instanceof Date);
  assert.deepEqual(activeBranch.primaryAppointments.some.OR, [
    { effectiveToExclusive: null },
    { effectiveToExclusive: { gt: activeBranch.primaryAppointments.some.effectiveFrom.lte } },
  ]);
  assert.ok(query.where.OR.some((branch) => branch.status === 'TERMINATED' &&
    branch.primaryAppointments.some.storeId.in[0] === 1n));
});

test('schedule and transfer candidates expose only active employee names in scope', async () => {
  const checks = [];
  let query;
  const controller = new HrEmployeeController({ hrEmployee: {
    findMany: async (input) => { query = input; return [{ id: 5n, displayName: '张三' }]; },
  } }, { assertAnyStorePermission: async (...args) => checks.push(args) });
  const result = await controller.candidates({ user: { id: 3 } }, 2);
  assert.deepEqual(result, [{ id: 5, displayName: '张三' }]);
  assert.deepEqual(checks[0][1], ['HR_SCHEDULE_DRAFT_EDIT', 'HR_TRANSFER_REQUEST']);
  assert.equal(checks[0][2], 2n);
  const activeBranch = query.where.OR.find((branch) => branch.status === 'ACTIVE');
  const trialBranch = query.where.OR.find((branch) => branch.status === 'TRIAL');
  assert.ok(activeBranch);
  assert.ok(trialBranch);
  assert.equal(activeBranch.primaryAppointments.some.storeId, 2n);
  assert.equal(trialBranch.initialStoreId, 2n);
  assert.ok(trialBranch.trialStartedAt.lte instanceof Date);
  assert.deepEqual(query.select, { id: true, displayName: true, status: true, trialStartedAt: true,
    user: { select: { hrRoleGrants: {
    where: { active: true }, select: { role: { select: { enabled: true, participatesInScheduling: true } } },
  } } } });
});

test('schedule candidates exclude users whose active roles all disable scheduling', async () => {
  const controller = new HrEmployeeController({ hrEmployee: { findMany: async () => [
    { id: 1n, displayName: '员工甲', user: { hrRoleGrants: [{ role: { participatesInScheduling: false } }] } },
    { id: 2n, displayName: '员工乙', user: { hrRoleGrants: [
      { role: { participatesInScheduling: false } }, { role: { participatesInScheduling: true } },
    ] } },
    { id: 3n, displayName: '员工丙', user: { hrRoleGrants: [] } },
    { id: 4n, displayName: '员工丁', user: { hrRoleGrants: [{ role: { enabled: false, participatesInScheduling: true } }] } },
  ] } }, { assertAnyStorePermission: async () => {} });
  assert.deepEqual(await controller.candidates({ user: { id: 3 } }, 2), [
    { id: 2, displayName: '员工乙' }, { id: 3, displayName: '员工丙' },
  ]);
});

test('trial history exposes ongoing, ended, and converted trial records within the store', async () => {
  let query;
  const controller = new HrEmployeeController({ hrEmployee: { findMany: async (input) => {
    query = input;
    return [
      { id: 8n, displayName: '试岗中员工', status: 'TRIAL', trialStartedAt: new Date('2026-10-01T00:00:00Z'), trialEndedAt: null },
      { id: 7n, displayName: '已结束员工', status: 'TRIAL_ENDED', trialStartedAt: new Date('2026-09-01T00:00:00Z'), trialEndedAt: new Date('2026-09-05T10:00:00Z') },
    ];
  } } }, { assertStorePermission: async (_user, permission, storeId) => {
    assert.equal(permission, 'HR_TRIAL_MANAGE'); assert.equal(storeId, 2n);
  } });

  const result = await controller.listTrialHistory({ user: { id: 3 } }, '2');
  assert.equal(query.where.initialStoreId, 2n);
  assert.deepEqual(query.where.status.in, ['TRIAL', 'TRIAL_ENDED', 'ACTIVE', 'TERMINATED']);
  assert.equal(result[1].status, 'TRIAL_ENDED');
  assert.equal(result[1].trialEndedAt, '2026-09-05T10:00:00.000Z');
});

test('ending trial archives the record and preserves employee-linked history', async () => {
  const employee = { id: 5n, status: 'TRIAL', userId: null, initialStoreId: 2n,
    trialStartedAt: new Date('2026-10-01T00:00:00Z') };
  let update, audit;
  const tx = {
    $queryRaw: async () => [],
    hrEmployee: {
      findUnique: async () => employee,
      update: async (input) => { update = input; },
    },
    auditLog: { create: async (input) => { audit = input.data; } },
  };
  const controller = new HrEmployeeController({ $transaction: async (run) => run(tx) },
    { assertStorePermission: async (_user, permission, storeId) => {
      assert.equal(permission, 'HR_TRIAL_MANAGE'); assert.equal(storeId, 2n);
    } });

  const result = await controller.endTrial({ user: { id: 3 } }, 5);
  assert.equal(update.data.status, 'TRIAL_ENDED');
  assert.ok(update.data.trialEndedAt instanceof Date);
  assert.equal(audit.action, 'TRIAL_ENDED');
  assert.equal(audit.afterData.historyRetained, true);
  assert.equal(result.status, 'TRIAL_ENDED');
  assert.equal(result.historyRetained, true);
});

test('employee schedule uses the authenticated linked employee and published versions only', async () => {
  let query;
  const controller = new HrEmployeeController({
    hrEmployee: { findUnique: async ({ where }) => {
      assert.equal(where.userId, 7n); return { id: 9n, status: 'ACTIVE' };
    } },
    hrSchedule: { findMany: async (input) => {
      query = input;
      return [{ id: 11n, businessDate: new Date('2026-10-16T00:00:00Z'),
        currentVersion: 2, store: { storeName: '山大店' }, versions: [
          { version: 1, plannedStart: new Date('2026-10-16T01:00:00Z'), plannedEnd: new Date('2026-10-16T09:00:00Z'), breakMinutes: 30 },
          { version: 2, plannedStart: new Date('2026-10-16T02:00:00Z'), plannedEnd: new Date('2026-10-16T10:00:00Z'), breakMinutes: 60 },
        ] }];
    } },
  }, { currentAccess: async () => ({ stores: [] }) });
  const result = await controller.mySchedules({ user: { id: 7 } });
  assert.equal(query.where.employeeId, 9n);
  assert.equal(query.where.status, 'PUBLISHED');
  assert.equal(result[0].start, '2026-10-16T02:00:00.000Z');
  assert.equal(result[0].breakMinutes, 60);
});

test('unlinked account cannot read another employee schedule', async () => {
  const controller = new HrEmployeeController({
    hrEmployee: { findUnique: async () => null },
    hrSchedule: { findMany: async () => { throw new Error('schedule query must not run'); } },
  }, { currentAccess: async () => ({ stores: [] }) });
  assert.deepEqual(await controller.mySchedules({ user: { id: 7 } }), []);
});

test('employee work summary returns scheduled and statistical hours without raw or discarded minutes', async () => {
  let query, scheduleQuery;
  const segment = (minutes) => ({ businessDate: new Date('2026-10-14T00:00:00Z'), rawMinutes: minutes });
  const controller = new HrEmployeeController({
    hrEmployee: { findUnique: async ({ where }) => {
      assert.equal(where.userId, 7n); return { id: 9n };
    } },
    hrWorkRecord: { findMany: async (input) => {
      query = input;
      return [
        { currentVersion: 2, versions: [
          { version: 1, daySegments: [segment(180)] },
          { version: 2, daySegments: [segment(20)] },
        ] },
        { currentVersion: 1, versions: [{ version: 1, daySegments: [segment(20)] }] },
        { currentVersion: 1, versions: [{ version: 1, daySegments: [segment(70)] }] },
      ];
    } },
    hrSchedule: { findMany: async (input) => {
      scheduleQuery = input;
      return [{ businessDate: new Date('2026-10-14T00:00:00Z'), currentVersion: 1,
        versions: [{ version: 1, plannedStart: new Date('2026-10-14T01:00:00Z'),
          plannedEnd: new Date('2026-10-14T09:00:00Z'), breakMinutes: 60 }] }];
    } },
    hrSalaryRate: { findMany: async ({ where }) => {
      assert.equal(where.employeeId, 9n);
      return [{ effectiveFrom: new Date('2026-10-01T00:00:00Z'), effectiveToExclusive: null,
        hourlyRate: { toFixed: () => '15.00' } }];
    } },
  }, { currentAccess: async () => ({ stores: [] }) });
  const result = await controller.myWork({ user: { id: 7 } }, '2026-10');
  assert.equal(query.where.employeeId, 9n);
  assert.equal(scheduleQuery.where.status, 'PUBLISHED');
  assert.equal(result.totalScheduledMinutes, 420);
  assert.equal(result.totalStatisticalMinutes, 60);
  assert.deepEqual(result.days[0], { date: '2026-10-14', scheduledMinutes: 420, statisticalMinutes: 60,
    confirmedShifts: 3, basePayAmount: '15.00', payStatus: 'CALCULATED' });
  assert.equal(result.totalBasePayAmount, '15.00');
  assert.equal('totalRawMinutes' in result, false);
  assert.equal('totalDiscardedMinutes' in result, false);
  await assert.rejects(controller.myWork({ user: { id: 7 } }, '2026-13'), /Month must be YYYY-MM/);
});
