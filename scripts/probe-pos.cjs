const { WuuxiangClient } = require('../apps/api/dist/wuuxiang.client');

async function main() {
  const client = new WuuxiangClient(process.env.POS_APP_ID, process.env.POS_ACCESS_ID, process.env.POS_CENTER_ID);
  const shops = await client.shops();
  if (process.env.POS_PROBE_COMPACT !== 'true') console.log(JSON.stringify({ shopCount: shops.length, shops: shops.map((s) => ({ id: s.shop_id, code: s.shop_code, name: s.shop_name, brand: s.brand_name, region: s.region_name })) }, null, 2));
  if (process.env.POS_PROBE_SHOP_ID && process.env.POS_PROBE_DATE) {
    const bills = await client.bills(process.env.POS_PROBE_SHOP_ID, process.env.POS_PROBE_DATE);
    const situation = await client.businessSituation(process.env.POS_PROBE_SHOP_ID, process.env.POS_PROBE_DATE);
    console.log(JSON.stringify({ businessSituation: situation.List && {
      businessData: situation.List.businessData,
      operateData: situation.List.operateData,
      saleTypeData: situation.List.saleTypeData,
      shiftData: situation.List.shiftData,
    } }, null, 2));
    if (process.env.POS_PROBE_COMPACT !== 'true') console.log(JSON.stringify({ billCount: bills.length, firstBillKeys: Object.keys(bills[0] || {}), firstItemKeys: Object.keys(bills[0]?.item?.[0] || {}), firstSettleKeys: Object.keys(bills[0]?.settleDetail?.[0] || {}) }, null, 2));
    const byType = {};
    const byState = {};
    const byPayway = {};
    const byCategory = {};
    const byProduct = {};
    for (const b of bills) {
      const type = b.sale_type_name || '(blank)';
      const state = `${b.state}/${b.settle_state}/${b.delflg}`;
      byState[state] = (byState[state] || 0) + 1;
      const t = byType[type] || (byType[type] = { bills: 0, people: 0, lastTotal: 0, incomeTotal: 0 });
      t.bills++;
      t.people += Number(b.people_qty || 0);
      t.lastTotal += Number(b.last_total || 0);
      t.incomeTotal += Number(b.income_total || 0);
      for (const p of b.settleDetail || []) {
        const key = p.payway_name || '(blank)';
        const v = byPayway[key] || (byPayway[key] = { count: 0, amount: 0 });
        v.count++;
        v.amount += Number(p.income_money || 0);
      }
      for (const p of b.item || []) {
        const key = p.big_class_name || '(blank)';
        byCategory[key] = (byCategory[key] || 0) + Number(p.last_qty || 0);
        const id = String(p.item_id);
        const v = byProduct[id] || (byProduct[id] = { name: p.item_name, qty: 0, category: key });
        v.qty += Number(p.last_qty || 0);
      }
    }
    for (const value of Object.values(byType)) { value.lastTotal = Number(value.lastTotal.toFixed(2)); value.incomeTotal = Number(value.incomeTotal.toFixed(2)); }
    for (const value of Object.values(byPayway)) value.amount = Number(value.amount.toFixed(2));
    if (process.env.POS_PROBE_COMPACT !== 'true') console.log(JSON.stringify({ byType, byState, byPayway, byCategory, topProducts: Object.entries(byProduct).sort((a,b)=>b[1].qty-a[1].qty).slice(0,20).map(([id,p])=>({id,...p})) }, null, 2));
    else console.log(JSON.stringify({ billCount: bills.length, byType, byState, itemIdType: typeof bills[0]?.item?.[0]?.item_id, firstItemId: bills[0]?.item?.[0]?.item_id }, null, 2));
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
