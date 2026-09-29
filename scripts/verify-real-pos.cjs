const { WuuxiangClient } = require('../apps/api/dist/wuuxiang.client');
const { WuuxiangPosAdapter } = require('../apps/api/dist/pos-adapter');

async function main() {
  const client = new WuuxiangClient(process.env.POS_APP_ID, process.env.POS_ACCESS_ID, process.env.POS_CENTER_ID);
  const adapter = new WuuxiangPosAdapter(
    client,
    process.env.POS_BOWL_REVENUE_TYPE_ID,
    (process.env.POS_EXCLUDED_CUSTOMER_PAYWAYS ?? '员工餐').split(','),
  );
  const data = await adapter.fetchDaily(process.env.POS_PROBE_SHOP_ID, process.env.POS_PROBE_DATE, [
    { code: 'LUNCH', name: '午餐', startTime: '00:00', endTime: '16:59', externalShiftId: process.env.POS_LUNCH_SHIFT_ID },
    { code: 'DINNER', name: '晚餐', startTime: '17:00', endTime: '23:59', externalShiftId: process.env.POS_DINNER_SHIFT_ID },
  ]);
  const { rawResponse, ...summary } = data;
  console.log(JSON.stringify({ sales: summary.sales, periods: summary.periods, platforms: summary.platforms, productCount: summary.products.length }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
