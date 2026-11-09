const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDailyReport, safeDivide } = require('../dist');

test('daily metrics use program formulas', () => {
  const report = calculateDailyReport({
    store: { id: 1, name: '山大店', brandName: '米熊' }, date: '2026-09-27',
    sales: { total: { amount: 5644.74, customers: 389 }, dineIn: { amount: 3308.56, customers: 190 }, delivery: { amount: 2336.18, customers: 199 } },
    periods: [{ code: 'LUNCH', name: '午餐', amount: 4043.21, customers: 276 }, { code: 'DINNER', name: '晚餐', amount: 1601.53, customers: 113 }],
    platforms: [{ code: 'DOUYIN', name: '抖音', amount: 352.10, customers: 17 }, { code: 'MEITUAN', name: '美团点评', amount: 157.20, customers: 8 }],
    products: [],
    manual: { kitchenPower: 207.7, diningPower: 40.41, fullDayPower: 25.98, airConditionPower: 2.31, totalPower: null, waterUsage: 2, laborHours: 55, addonCustomers: 29, comboCustomers: null, status: 'SUBMITTED' },
    powerMode: 'SUM_COMPONENTS', reportStatus: 'SUBMITTED', apiDataReady: true, productDataReady: true,
  });
  assert.equal(report.sales.total.avgOrderValue, 14.51);
  assert.equal(report.groupBuy.total.avgOrderValue, 20.37);
  assert.equal(report.energy.totalPower, 276.4);
  assert.equal(report.energy.powerEfficiency, 20.42);
  assert.equal(report.energy.waterEfficiency, 2822.37);
  assert.equal(report.labor.salesPerHour, 102.63);
  assert.equal(report.operations.addonPerThousand, 152.63);
  assert.equal(report.operations.comboPerThousand, null);
  assert.equal(report.status.complete, true);
  assert.deepEqual(report.status.warnings, []);
});

test('division by zero and incomplete manual data', () => {
  assert.equal(safeDivide(100, 0), null);
  assert.equal(safeDivide(null, 2), null);
  const report = calculateDailyReport({ store: { id: 2, name: '测试店', brandName: '米熊' }, date: '2026-09-27',
    sales: null, periods: [], platforms: [], products: [], manual: null, powerMode: 'SUM_COMPONENTS',
    reportStatus: 'OPEN', apiDataReady: false, productDataReady: false });
  assert.equal(report.status.complete, false);
  assert.equal(report.energy.powerEfficiency, null);
});

test('entered total power takes precedence over legacy component totals', () => {
  const report = calculateDailyReport({
    store: { id: 3, name: '测试店', brandName: '米熊' }, date: '2026-09-27',
    sales: { total: { amount: 1000, customers: 50 }, dineIn: { amount: 600, customers: 30 }, delivery: { amount: 400, customers: 20 } },
    periods: [], platforms: [], products: [],
    manual: { kitchenPower: 20, diningPower: 30, fullDayPower: 40, airConditionPower: 50, totalPower: 120, waterUsage: 2, laborHours: 10, addonCustomers: null, comboCustomers: null, status: 'SUBMITTED' },
    powerMode: 'SUM_COMPONENTS', reportStatus: 'SUBMITTED', apiDataReady: true, productDataReady: true,
  });
  assert.equal(report.energy.totalPower, 120);
  assert.equal(report.energy.powerEfficiency, 8.33);
});

test('hidden product sales rolled into a visible product produce one detail row', () => {
  const report = calculateDailyReport({
    store: { id: 1, name: '山大店', brandName: '米熊' }, date: '2026-10-08',
    sales: null, periods: [], platforms: [], manual: null, powerMode: 'SUM_COMPONENTS',
    reportStatus: 'OPEN', apiDataReady: false, productDataReady: true,
    products: [
      { productId: 10, productName: '目标菜品', categoryId: 2, categoryName: '盖饭', categoryOrder: 1, quantity: 5, salesAmount: 50 },
      { productId: 10, productName: '目标菜品', categoryId: 2, categoryName: '盖饭', categoryOrder: 1, quantity: 2.5, salesAmount: 25 },
    ],
  });
  assert.deepEqual(report.categorySales, [{ categoryId: 2, categoryName: '盖饭', quantity: 7.5 }]);
  assert.equal(report.productSales[0].items.length, 1);
  assert.deepEqual(report.productSales[0].items[0], { rank: 1, productId: 10, productName: '目标菜品', quantity: 7.5 });
});
