const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrTimeService } = require('../dist/hr/hr-time.service');

const shanghaiStamp = (epochMinute) => `${new Date(epochMinute * 60000 + 8 * 3600000)
  .toISOString().slice(0, 16)}:00+08:00`;
const shanghaiDate = (epochMinute) => shanghaiStamp(epochMinute).slice(0, 10);
function todayShift() {
  const date = shanghaiDate(Math.floor(Date.now() / 60000));
  const dayStartMinute = Date.parse(`${date}T00:00:00+08:00`) / 60000;
  const startMinute = dayStartMinute + 60;
  const endMinute = dayStartMinute + 180;
  return { schedule: { id: 4n, employeeId: 3n, storeId: 2n, status: 'PUBLISHED',
    businessDate: new Date(`${date}T00:00:00Z`), currentVersion: 1,
    versions: [{ version: 1, plannedStart: new Date(startMinute * 60000),
      plannedEnd: new Date(endMinute * 60000), breakMinutes: 0 }] },
  actualStart: shanghaiStamp(startMinute), actualEnd: shanghaiStamp(endMinute) };
}

test('an authorized person can confirm a shift on its business date', async () => {
  const { schedule, actualStart, actualEnd } = todayShift();
  let created;
  const tx = {
    $queryRaw: async () => [],
    hrSchedule: { findUnique: async () => schedule },
    hrWorkRecord: { findUnique: async () => null,
      create: async ({ data }) => { created = data; return { id: 9n }; } },
    auditLog: { create: async () => {} },
  };
  const service = new HrTimeService({
    hrSchedule: { findUnique: async () => schedule }, $transaction: async (run) => run(tx),
  }, { assertStorePermission: async () => {} });
  const result = await service.confirm({ id: 5 }, 4, { actualStart, actualEnd, breaks: [] });
  assert.equal(result.rawMinutes, 120);
  assert.deepEqual(result.daySegments.map((part) => [part.businessDate, part.rawMinutes]),
    [[shanghaiDate(Math.floor(Date.now() / 60000)), 120]]);
  assert.deepEqual(created.versions.create.daySegments.create.map((part) => part.rawMinutes), [120]);
});

test('schedule-only positions remain scheduled but cannot enter work-time confirmation', async () => {
  const { schedule, actualStart, actualEnd } = todayShift();
  schedule.employee = { jobPosition: { scheduleOnly: true } };
  let transactionStarted = false;
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule },
    $transaction: async () => { transactionStarted = true; } },
  { assertStorePermission: async () => {} });
  await assert.rejects(service.confirm({ id: 5 }, 4, { actualStart, actualEnd, breaks: [] }), /仅用于排班/);
  assert.equal(transactionStarted, false);
});

test('a confirmed shift cannot be confirmed again and must use correction workflow', async () => {
  const { schedule, actualStart, actualEnd } = todayShift();
  const tx = { $queryRaw: async () => [], hrSchedule: { findUnique: async () => schedule },
    hrWorkRecord: { findUnique: async () => ({ id: 8n }) } };
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  await assert.rejects(service.confirm({ id: 5 }, 4, { actualStart, actualEnd, breaks: [] }), /already confirmed/);
});

test('a past-day shift cannot be confirmed from the daily confirmation page', async () => {
  const { schedule, actualStart, actualEnd } = todayShift();
  schedule.businessDate = new Date(Date.now() - 2 * 86400000);
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule } },
    { assertStorePermission: async () => {} });
  await assert.rejects(service.confirm({ id: 5 }, 4, { actualStart, actualEnd, breaks: [] }), /today's shifts/);
});

test('confirmation rejects actual work timestamps from another business date', async () => {
  const { schedule } = todayShift();
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule } },
    { assertStorePermission: async () => {} });
  const previousDate = shanghaiDate(Math.floor(Date.now() / 60000) - 24 * 60);
  const actualStart = `${previousDate}T23:00:00+08:00`;
  const actualEnd = `${previousDate}T23:30:00+08:00`;
  await assert.rejects(service.confirm({ id: 5 }, 4, { actualStart, actualEnd, breaks: [] }), /shift date/);
});

test('one day confirmation records every published shift for an employee atomically', async () => {
  const date = shanghaiDate(Math.floor(Date.now() / 60000));
  const dayStartMinute = Date.parse(`${date}T00:00:00+08:00`) / 60000;
  const makeSchedule = (id, start, end) => ({ id: BigInt(id), employeeId: 3n, storeId: 2n,
    status: 'PUBLISHED', businessDate: new Date(`${date}T00:00:00Z`), currentVersion: 1,
    versions: [{ version: 1, plannedStart: new Date(start * 60000), plannedEnd: new Date(end * 60000),
      breakMinutes: 0 }] });
  const schedules = [makeSchedule(4, dayStartMinute + 8 * 60, dayStartMinute + 10 * 60),
    makeSchedule(5, dayStartMinute + 11 * 60, dayStartMinute + 13 * 60)];
  const created = [];
  let nextId = 20n;
  const findSchedule = ({ where }) => schedules.find((item) => item.id === where.id) ?? null;
  const tx = { $queryRaw: async () => [], hrSchedule: { findUnique: async (query) => findSchedule(query) },
    hrWorkRecord: { findUnique: async () => null, create: async ({ data }) => {
      created.push(data); return { id: nextId++ };
    } }, auditLog: { create: async () => {} } };
  const service = new HrTimeService({ hrSchedule: { findUnique: async (query) => findSchedule(query) },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  const result = await service.confirmDay({ id: 5 }, { employeeId: 3, storeId: 2, date,
    shifts: [
      { scheduleId: 4, actualStart: shanghaiStamp(dayStartMinute + 8 * 60), actualEnd: shanghaiStamp(dayStartMinute + 10 * 60), breaks: [] },
      { scheduleId: 5, actualStart: shanghaiStamp(dayStartMinute + 11 * 60), actualEnd: shanghaiStamp(dayStartMinute + 13 * 60), breaks: [] },
    ] });
  assert.equal(result.confirmed.length, 2);
  assert.deepEqual(result.confirmed.map((item) => item.scheduleId), [4, 5]);
  assert.deepEqual(created.map((item) => item.scheduleId), [4n, 5n]);
});

test('store day confirmation records current shifts for multiple employees atomically', async () => {
  const date = shanghaiDate(Math.floor(Date.now() / 60000));
  const dayStartMinute = Date.parse(`${date}T00:00:00+08:00`) / 60000;
  const makeSchedule = (id, employeeId, start) => ({ id: BigInt(id), employeeId: BigInt(employeeId), storeId: 2n,
    status: 'PUBLISHED', businessDate: new Date(`${date}T00:00:00Z`), currentVersion: 1,
    versions: [{ version: 1, plannedStart: new Date(start * 60000), plannedEnd: new Date((start + 120) * 60000),
      breakMinutes: 0 }] });
  const schedules = [makeSchedule(4, 3, dayStartMinute + 8 * 60), makeSchedule(5, 4, dayStartMinute + 9 * 60)];
  const created = [];
  const audits = [];
  let nextId = 20n;
  const findSchedule = ({ where }) => schedules.find((item) => item.id === where.id) ?? null;
  const tx = { $queryRaw: async () => [], hrSchedule: { findUnique: async (query) => findSchedule(query) },
    hrWorkRecord: { findUnique: async () => null, create: async ({ data }) => {
      created.push(data); return { id: nextId++ };
    } }, auditLog: { create: async ({ data }) => audits.push(data) } };
  const service = new HrTimeService({ hrSchedule: { findUnique: async (query) => findSchedule(query) },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  const result = await service.confirmStoreDay({ id: 5 }, { storeId: 2, date,
    shifts: [
      { scheduleId: 4, actualStart: shanghaiStamp(dayStartMinute + 8 * 60),
        actualEnd: shanghaiStamp(dayStartMinute + 10 * 60), breaks: [] },
      { scheduleId: 5, actualStart: shanghaiStamp(dayStartMinute + 9 * 60),
        actualEnd: shanghaiStamp(dayStartMinute + 11 * 60), breaks: [] },
    ] });
  assert.equal(result.confirmed.length, 2);
  assert.deepEqual(result.confirmed.map((item) => item.scheduleId), [4, 5]);
  assert.deepEqual(created.map((item) => item.employeeId), [3n, 4n]);
  assert.equal(audits.length, 2);
});

test('trial shifts contribute to work-time statistics but never to wage totals', async () => {
  const day = '2026-10-20';
  for (const status of ['TRIAL', 'TRIAL_ENDED']) {
    const service = new HrTimeService({
      hrSchedule: { findMany: async () => [{ employeeId: 3n, businessDate: new Date(`${day}T00:00:00Z`),
        currentVersion: 1, employee: { displayName: '试岗员工', status,
          jobPosition: { scheduleOnly: false } },
        versions: [{ version: 1, plannedStart: new Date(`${day}T01:00:00Z`),
          plannedEnd: new Date(`${day}T05:00:00Z`), breakMinutes: 30 }] }] },
      hrWorkRecord: { findMany: async () => [{ employeeId: 3n, currentVersion: 1,
        employee: { displayName: '试岗员工', status, jobPosition: { scheduleOnly: false } },
        versions: [{ version: 1, daySegments: [{ businessDate: new Date(`${day}T00:00:00Z`), rawMinutes: 180 }] }] }] },
      hrSalaryRate: { findMany: async () => [] },
    }, { assertStorePermission: async () => {} });
    const result = await service.statistics({ id: 5 }, 2, day, day);
    assert.equal(result.rows[0].statisticalMinutes, 180);
    assert.equal(result.rows[0].basePayAmount, null);
    assert.equal(result.rows[0].payStatus, 'TRIAL_NOT_PAYABLE');
    assert.equal(result.totals.statisticalMinutes, 180);
    assert.equal(result.totals.totalBasePayAmount, null);
    assert.equal(result.totals.payStatus, 'TRIAL_NOT_PAYABLE');
  }
});

test('after onboarding, salary rate backdated to trial date pays the retained confirmed hours', async () => {
  const day = '2026-10-20';
  const service = new HrTimeService({
    hrSchedule: { findMany: async () => [{ employeeId: 3n, businessDate: new Date(`${day}T00:00:00Z`),
      currentVersion: 1, employee: { displayName: '正式员工', status: 'ACTIVE',
        jobPosition: { scheduleOnly: false } },
      versions: [{ version: 1, plannedStart: new Date(`${day}T01:00:00Z`),
        plannedEnd: new Date(`${day}T05:00:00Z`), breakMinutes: 30 }] }] },
    hrWorkRecord: { findMany: async () => [{ employeeId: 3n, currentVersion: 1,
      employee: { displayName: '正式员工', status: 'ACTIVE', jobPosition: { scheduleOnly: false } },
      versions: [{ version: 1, daySegments: [{ businessDate: new Date(`${day}T00:00:00Z`), rawMinutes: 180 }] }] }] },
    hrSalaryRate: { findMany: async () => [{ employeeId: 3n,
      effectiveFrom: new Date('2026-10-01T00:00:00Z'), effectiveToExclusive: null,
      hourlyRate: { toFixed: () => '17.00' } }] },
  }, { assertStorePermission: async () => {} });
  const result = await service.statistics({ id: 5 }, 2, day, day);
  assert.equal(result.rows[0].statisticalMinutes, 180);
  assert.equal(result.rows[0].basePayAmount, '51.00');
  assert.equal(result.rows[0].payStatus, 'CALCULATED');
  assert.equal(result.totals.totalBasePayAmount, '51.00');
});

test('one-click store confirmation deducts the scheduled rest duration', async () => {
  const { schedule, actualStart, actualEnd } = todayShift();
  schedule.versions[0].breakMinutes = 30;
  let created;
  const tx = { $queryRaw: async () => [],
    hrSchedule: { findUnique: async () => schedule },
    hrWorkRecord: { findUnique: async () => null,
      create: async ({ data }) => { created = data; return { id: 12n }; } },
    auditLog: { create: async () => {} },
  };
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  const result = await service.confirmStoreDay({ id: 5 }, { storeId: 2,
    date: shanghaiDate(Math.floor(Date.now() / 60000)), shifts: [{ scheduleId: 4,
      actualStart, actualEnd, breaks: [] }] });
  assert.equal(result.confirmed[0].rawMinutes, 90);
  assert.deepEqual(created.versions.create.daySegments.create.map((part) =>
    [part.elapsedMinutes, part.breakMinutes, part.rawMinutes]), [[120, 30, 90]]);
});

test('daily confirmation includes and identifies the signed-in employee alongside coworkers', async () => {
  const date = shanghaiDate(Math.floor(Date.now() / 60000));
  const dayStartMinute = Date.parse(`${date}T00:00:00+08:00`) / 60000;
  const makeSchedule = (id, employeeId, employeeName, start) => ({
    id: BigInt(id), employeeId: BigInt(employeeId), storeId: 2n,
    employee: { displayName: employeeName },
    businessDate: new Date(`${date}T00:00:00Z`), currentVersion: 1,
    versions: [{ version: 1, plannedStart: new Date(start * 60000),
      plannedEnd: new Date((start + 120) * 60000), breakMinutes: 0 }],
  });
  const schedules = [
    makeSchedule(4, 3, '店长本人', dayStartMinute + 8 * 60),
    makeSchedule(5, 4, '员工甲', dayStartMinute + 9 * 60),
  ];
  const db = {
    hrEmployee: { findUnique: async ({ where }) => where.userId === 5n ? { id: 3n, status: 'ACTIVE' } : null },
    hrWorkRecord: { findMany: async () => [] },
    hrSchedule: { findMany: async () => schedules },
  };
  const service = new HrTimeService(db, { assertAnyStorePermission: async () => {} });

  const result = await service.listDay({ id: 5 }, 2, date);

  assert.deepEqual(result.pending.map(({ employeeId, isSelf }) => [employeeId, isSelf]), [[3, true], [4, false]]);
});

test('confirmation allows the scheduled end time later than now on the same day', async (t) => {
  const { schedule } = todayShift();
  const nowMinute = Math.floor(Date.now() / 60000);
  if (shanghaiDate(nowMinute - 60) !== shanghaiDate(nowMinute + 30)) {
    t.skip('The current time is too close to the Shanghai day boundary for a same-day future end');
    return;
  }
  schedule.versions[0].plannedStart = new Date((nowMinute - 60) * 60000);
  schedule.versions[0].plannedEnd = new Date((nowMinute + 30) * 60000);
  let created;
  const tx = { $queryRaw: async () => [], hrSchedule: { findUnique: async () => schedule },
    hrWorkRecord: { findUnique: async () => null,
      create: async ({ data }) => { created = data; return { id: 9n }; } }, auditLog: { create: async () => {} } };
  const service = new HrTimeService({ hrSchedule: { findUnique: async () => schedule },
    $transaction: async (run) => run(tx) }, { assertStorePermission: async () => {} });
  const result = await service.confirm({ id: 5 }, 4, {
    actualStart: shanghaiStamp(nowMinute - 60), actualEnd: shanghaiStamp(nowMinute + 30), breaks: [],
  });
  assert.equal(result.rawMinutes, 90);
  assert.ok(created.versions.create.actualEnd.getTime() > Date.now());
});

test('time summaries expose only scheduled and statistical minutes', async () => {
  const date = new Date('2026-10-14T00:00:00Z');
  const schedule = { id: 4n, employeeId: 3n, storeId: 2n, status: 'PUBLISHED',
    businessDate: date, currentVersion: 1, versions: [{ version: 1,
      plannedStart: new Date('2026-10-14T01:00:00Z'), plannedEnd: new Date('2026-10-14T09:00:00Z'),
      breakMinutes: 30 }] };
  const record = { id: 9n, scheduleId: 4n, employeeId: 3n, storeId: 2n, currentVersion: 1,
    employee: { displayName: '张三' }, schedule, versions: [{ version: 1,
      actualStart: new Date('2026-10-14T01:00:00Z'), actualEnd: new Date('2026-10-14T09:00:00Z'),
      daySegments: [{ businessDate: date, rawMinutes: 47, breakMinutes: 0 }] }] };
  const db = { hrWorkRecord: { findMany: async () => [record] },
    hrSchedule: { findMany: async ({ where }) => Object.hasOwn(where, 'workRecord') ? [] : [schedule] },
    hrEmployee: { findUnique: async () => ({ initialStoreId: 2n,
      primaryAppointments: [{ storeId: 2n }] }) } };
  const service = new HrTimeService(db, { assertAnyStorePermission: async () => {},
    assertStorePermission: async () => {} });
  const day = await service.listDay({ id: 5 }, 2, '2026-10-14');
  assert.deepEqual(day.confirmed[0], { recordId: 9, scheduleId: 4, employeeId: 3,
    employeeName: '张三', isSelf: false, version: 1, actualStart: '2026-10-14T01:00:00.000Z',
    actualEnd: '2026-10-14T09:00:00.000Z', breaks: [], breakMinutes: 0,
    scheduledMinutes: 450, statisticalMinutes: 30 });
  const summary = await service.dailySummary({ id: 5 }, 3, '2026-10-14');
  assert.deepEqual(summary, { employeeId: 3, date: '2026-10-14',
    scheduledMinutes: 450, statisticalMinutes: 30 });
  assert.equal('rawMinutes' in day.confirmed[0], false);
  assert.equal('discardedMinutes' in summary, false);
});

test('store work statistics filter the date and employee and apply the 30-minute rule per shift', async () => {
  const date = new Date('2026-10-14T00:00:00Z');
  const schedule = { employeeId: 3n, businessDate: date, currentVersion: 1,
    employee: { displayName: 'Employee A' }, versions: [{ version: 1,
      plannedStart: new Date('2026-10-14T01:00:00Z'), plannedEnd: new Date('2026-10-14T04:00:00Z'),
      breakMinutes: 30 }] };
  const records = [
    { employeeId: 3n, employee: { displayName: 'Employee A' }, currentVersion: 2,
      versions: [{ version: 1, daySegments: [{ businessDate: date, rawMinutes: 600 }] },
        { version: 2, daySegments: [{ businessDate: date, rawMinutes: 29 }] }] },
    { employeeId: 3n, employee: { displayName: 'Employee A' }, currentVersion: 1,
      versions: [{ version: 1, daySegments: [{ businessDate: date, rawMinutes: 40 }] }] },
  ];
  const queries = {};
  const db = {
    hrEmployee: { findMany: async (query) => { queries.roster = query; return [
      { id: 3n, displayName: 'Employee A' }, { id: 4n, displayName: 'Employee B' },
    ]; } },
    hrSchedule: { findMany: async (query) => { queries.schedules = query; return [schedule]; } },
    hrWorkRecord: { findMany: async (query) => { queries.records = query; return records; } },
    hrSalaryRate: { findMany: async (query) => { queries.rates = query; return [{ employeeId: 3n,
      effectiveFrom: new Date('2026-10-01T00:00:00Z'), effectiveToExclusive: null,
      hourlyRate: { toFixed: () => '20.00' } }]; } },
  };
  const checkedPermissions = [];
  const service = new HrTimeService(db, { assertStorePermission: async (_user, permission, storeId) => {
    checkedPermissions.push([permission, storeId]);
  } });

  const result = await service.statistics({ id: 5 }, 2, '2026-10-14', '2026-10-14', '3');

  assert.deepEqual(checkedPermissions, [['HR_WORK_STATISTICS_READ', 2n]]);
  assert.equal(queries.roster, undefined);
  assert.equal(queries.schedules.where.employeeId, 3n);
  assert.equal(queries.records.where.employeeId, 3n);
  assert.deepEqual(queries.rates.where.employeeId.in, [3n]);
  assert.equal(queries.schedules.where.businessDate.gte.toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(queries.schedules.where.businessDate.lt.toISOString(), '2026-10-15T00:00:00.000Z');
  assert.equal(result.totals.scheduledMinutes, 150);
  assert.equal(result.totals.statisticalMinutes, 30);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.employees, [{ id: 3, name: 'Employee A' }]);
  const employee = result.rows.find((item) => item.employeeId === 3);
  assert.deepEqual(employee.days, [{ date: '2026-10-14', scheduledMinutes: 150,
    statisticalMinutes: 30, confirmedShifts: 2, basePayAmount: '10.00', payStatus: 'CALCULATED' }]);
  assert.equal(employee.basePayAmount, '10.00');
  assert.equal(result.totals.totalBasePayAmount, '10.00');
  assert.equal(result.totals.payStatus, 'CALCULATED');
  assert.equal('rawMinutes' in employee, false);
  assert.equal('discardedMinutes' in employee, false);

  const scheduleOnlyRoster = [{ id: 3n, displayName: 'Employee A', jobPosition: { scheduleOnly: true } }];
  const scheduleOnlySchedule = { ...schedule,
    employee: { displayName: 'Employee A', jobPosition: { scheduleOnly: true } } };
  const scheduleOnlyRecords = records.map((record) => ({ ...record,
    employee: { displayName: 'Employee A', jobPosition: { scheduleOnly: true } } }));
  const scheduleOnlyService = new HrTimeService({
    hrEmployee: { findMany: async () => scheduleOnlyRoster },
    hrSchedule: { findMany: async () => [scheduleOnlySchedule] },
    hrWorkRecord: { findMany: async () => scheduleOnlyRecords },
    hrSalaryRate: { findMany: async () => [] },
  }, { assertStorePermission: async () => {} });
  const scheduleOnlyResult = await scheduleOnlyService.statistics({ id: 5 }, 2,
    '2026-10-14', '2026-10-14');
  assert.deepEqual(scheduleOnlyResult.employees, []);
  assert.deepEqual(scheduleOnlyResult.rows, []);
  assert.deepEqual(scheduleOnlyResult.totals, { employeeCount: 0, scheduledMinutes: 0, statisticalMinutes: 0,
    totalBasePayAmount: null, payStatus: 'WAITING_FOR_CONFIRMATION' });
});
