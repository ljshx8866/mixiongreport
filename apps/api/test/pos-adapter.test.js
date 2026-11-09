const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapWuuxiangDaily } = require('../dist/pos-adapter');

test('unconfigured POS shift uses settlement time while configured shifts take priority', () => {
  const periods = [
    { code: 'LUNCH', name: '午餐', startTime: '00:00', endTime: '16:59', externalShiftId: 'L1' },
    { code: 'DINNER', name: '晚餐', startTime: '17:00', endTime: '23:59', externalShiftId: 'D1' },
  ];
  const bills = [
    { bs_id: 'early', state: 1, delflg: 0, sale_type_name: '外卖', income_total: 29.62,
      settle_shift_id: 'UNCONFIGURED', settle_time: '2026-10-10 08:40:51', item: [] },
    { bs_id: 'mapped', state: 1, delflg: 0, sale_type_name: '堂食', income_total: 10,
      settle_shift_id: 'D1', settle_time: '2026-10-10 16:07:21', item: [] },
  ];
  const report = mapWuuxiangDaily(bills, [], '2026-10-10', periods, 'BOWL');
  assert.deepEqual(report.periods.map(({ code, amount }) => [code, amount]), [['LUNCH', 29.62], ['DINNER', 10]]);
});

test('maps POS net income, shift IDs, redeemed tickets and exact product IDs', () => {
  const bills = [
    { bs_id: '1', state: 1, delflg: 0, sale_type_name: '堂食', people_qty: 2, income_total: 3308.56, settle_shift_id: 'L1', settle_time: '2026-09-27 17:30:00', item: [
      { item_id: '512993991868949403', item_name: '西红柿鸡蛋盖饭', last_qty: 2, last_total: 30, delflg: 0, pkg_flg_name: '正常品项', sales_revenue_type_id: 'BOWL' },
      { item_id: '999', item_name: '套餐', last_qty: 1, last_total: 20, delflg: 0, pkg_flg_name: '套餐' },
    ] },
    { bs_id: '2', state: 1, delflg: 0, sale_type_name: '外卖', people_qty: 1, income_total: 2336.18, settle_shift_id: 'D1', settle_time: '2026-09-27 12:30:00', item: [
      { item_id: '512993991868949403', item_name: '西红柿鸡蛋盖饭', last_qty: 1, last_total: 15, delflg: 0, pkg_flg_name: '套餐内品项', sales_revenue_type_id: 'BOWL' },
    ] },
    { bs_id: '3', state: 3, delflg: 0, sale_type_name: '外卖', people_qty: 1, income_total: 99, settle_shift_id: 'D1', settle_time: '2026-09-27 12:30:00', item: [] },
  ];
  const tickets = [
    { settleBizDate: '2026-09-27', ticketState: '已核销', billState: '已结算', pwDetailId: '1', ticketCode: 'A', bizType: 3, ticketCount: 17, incomeMoney: 352.10 },
    { settleBizDate: '2026-09-27', ticketState: '已核销', billState: '已结算', pwDetailId: '2', ticketCode: 'B', bizType: 1, ticketCount: 8, incomeMoney: 157.20 },
    { settleBizDate: '2026-09-27', ticketState: '已核销', billState: '已结算', pwDetailId: '2', ticketCode: 'B', bizType: 1, ticketCount: 8, incomeMoney: 157.20 },
  ];
  const periods = [
    { code: 'LUNCH', name: '午餐', startTime: '00:00', endTime: '16:59', externalShiftId: 'L1' },
    { code: 'DINNER', name: '晚餐', startTime: '17:00', endTime: '23:59', externalShiftId: 'D1' },
  ];
  const mapped = mapWuuxiangDaily(bills, tickets, '2026-09-27', periods, 'BOWL');
  assert.equal(mapped.sales.total.amount, 5644.74);
  assert.equal(mapped.sales.dineIn.customers, 2);
  assert.equal(mapped.sales.delivery.customers, 1);
  assert.equal(mapped.periods.find((p) => p.code === 'LUNCH').amount, 3308.56);
  assert.equal(mapped.platforms.find((p) => p.code === 'DOUYIN').customers, 17);
  assert.equal(mapped.platforms.find((p) => p.code === 'MEITUAN').amount, 157.2);
  assert.deepEqual(mapped.products, [{ externalProductCode: '512993991868949403', quantity: 3, salesAmount: 45 }]);
});

test('counts configured bowl items, expands packages and rounds only after aggregation', () => {
  const periods = [
    { code: 'LUNCH', name: '午餐', startTime: '00:00', endTime: '16:59', externalShiftId: 'L1' },
    { code: 'DINNER', name: '晚餐', startTime: '17:00', endTime: '23:59', externalShiftId: 'D1' },
  ];
  const bills = [
    { bs_id: '1', state: 1, delflg: 0, sale_type_name: '堂食', people_qty: 9, income_total: 40, settle_shift_id: 'L1', item: [
      { item_id: 'P', item_name: '套餐', last_qty: 1, last_total: 20, delflg: 0, pkg_flg_name: '套餐' },
      { item_id: 'H', item_name: '半份盖饭', last_qty: 1, last_total: 10, delflg: 0, pkg_flg_name: '套餐内品项', sales_revenue_type_id: 'BOWL' },
      { item_id: 'X', item_name: '饮料', last_qty: 3, last_total: 10, delflg: 0, pkg_flg_name: '套餐内品项', sales_revenue_type_id: '-1' },
    ] },
    { bs_id: '2', state: 1, delflg: 0, sale_type_name: '外卖', people_qty: 8, income_total: 20, settle_shift_id: 'D1', item: [
      { item_id: 'H', item_name: '半份盖饭', last_qty: 1, last_total: 10, delflg: 0, pkg_flg_name: '正常品项', sales_revenue_type_id: 'BOWL' },
    ] },
  ];
  const report = mapWuuxiangDaily(bills, [], '2026-09-27', periods, 'BOWL');
  assert.equal(report.sales.total.customers, 1);
  assert.equal(report.sales.dineIn.customers + report.sales.delivery.customers, 1);
  assert.equal(report.periods.reduce((sum, p) => sum + p.customers, 0), 1);
  assert.equal(report.sales.dineIn.customers, 1);
  assert.equal(report.sales.delivery.customers, 0);
});

test('excludes employee meal settlement orders from customer counts only', () => {
  const periods = [{ code: 'LUNCH', name: '午餐', startTime: '00:00', endTime: '23:59', externalShiftId: 'L1' }];
  const bills = [{
    bs_id: 'staff-1', state: 1, delflg: 0, sale_type_name: '堂食', income_total: 18,
    settle_shift_id: 'L1', item: [{ item_id: 'B', item_name: '盖饭', last_qty: 1, last_total: 18, delflg: 0, pkg_flg_name: '正常品项', sales_revenue_type_id: 'BOWL' }],
    settleDetail: [{ payway_name: '员工餐', income_money: 0, delflg: 0 }],
  }];
  const report = mapWuuxiangDaily(bills, [], '2026-09-27', periods, 'BOWL');
  assert.equal(report.sales.total.amount, 18);
  assert.equal(report.sales.total.customers, 0);
  assert.equal(report.periods[0].customers, 0);
  assert.equal(report.products[0].quantity, 1);
});
