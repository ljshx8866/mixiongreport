const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReportController } = require('../dist/report.controller');

test('daily and historical report routes require separate store-scoped permissions', async () => {
  const previous = process.env.REPORT_SOURCE;
  process.env.REPORT_SOURCE = 'database';
  const checks = [];
  const reports = { getDailyReport: async (storeId, date) => ({ storeId, date }) };
  const access = { assertStorePermission: async (user, permission, storeId) => checks.push([user.id, permission, storeId]) };
  const controller = new ReportController(reports, access);
  const request = { user: { id: 17, role: 'STORE_MANAGER', storeIds: [4] } };
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    await controller.daily(request, 4, today);
    await controller.daily(request, 4, '2020-01-01');
    assert.deepEqual(checks, [
      [17, 'HR_DAILY_REPORT_READ', 4n],
      [17, 'HR_HISTORY_REPORT_READ', 4n],
    ]);
  } finally {
    if (previous === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previous;
  }
});

test('poster route requires both the date-appropriate report permission and poster permission', async () => {
  const previous = process.env.REPORT_SOURCE;
  process.env.REPORT_SOURCE = 'database';
  const checks = [];
  const reports = { getDailyReport: async (storeId, date) => ({ storeId, date }) };
  const access = { assertStorePermission: async (user, permission, storeId) => checks.push([permission, storeId]) };
  const controller = new ReportController(reports, access);
  const request = { user: { id: 17, role: 'STORE_MANAGER', storeIds: [4] } };
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    await controller.dailyPoster(request, 4, today);
    await controller.dailyPoster(request, 4, '2020-01-01');
    assert.deepEqual(checks, [
      ['HR_DAILY_REPORT_READ', 4n], ['HR_DAILY_REPORT_POSTER', 4n],
      ['HR_HISTORY_REPORT_READ', 4n], ['HR_DAILY_REPORT_POSTER', 4n],
    ]);
  } finally {
    if (previous === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previous;
  }
});

test('workbench sales route checks its dedicated permission and returns only home-card fields', async () => {
  const previous = process.env.REPORT_SOURCE;
  process.env.REPORT_SOURCE = 'database';
  const checks = [];
  const fullReport = {
    store: { id: 4, name: '高新店' },
    sales: { total: { amount: 123, customers: 10, avgOrderValue: 12.3 }, dineIn: { amount: 100 } },
    status: { manualInputReady: true },
    productSales: [{ categoryName: '不可从首页权限读取' }],
  };
  const controller = new ReportController(
    { getDailyReport: async () => fullReport },
    { assertStorePermission: async (user, permission, storeId) => checks.push([permission, storeId]) },
  );
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const result = await controller.homeSales(
      { user: { id: 17, role: 'STORE_MANAGER', storeIds: [4] } }, 4, date,
    );
    assert.deepEqual(checks, [['HR_HOME_SALES_READ', 4n]]);
    assert.deepEqual(result, {
      store: fullReport.store,
      sales: { total: fullReport.sales.total },
      status: { manualInputReady: true },
    });
  } finally {
    if (previous === undefined) delete process.env.REPORT_SOURCE;
    else process.env.REPORT_SOURCE = previous;
  }
});
