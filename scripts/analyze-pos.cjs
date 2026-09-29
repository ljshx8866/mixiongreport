const { WuuxiangClient } = require('../apps/api/dist/wuuxiang.client');

async function main() {
  const client = new WuuxiangClient(process.env.POS_APP_ID, process.env.POS_ACCESS_ID, process.env.POS_CENTER_ID);
  const bills = await client.bills(process.env.POS_PROBE_SHOP_ID, process.env.POS_PROBE_DATE, process.env.POS_PROBE_PKG === 'true');
  const date = process.env.POS_PROBE_DATE;
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const tickets = await client.tickets(process.env.POS_PROBE_SHOP_ID, `${date} 00:00:00`, `${next} 23:59:59`);
  const ticketSummary = {};
  for (const t of tickets) {
    if (t.settleBizDate !== date) continue;
    const key = `${t.deFromName}/${t.ticketState}/${t.billState}`;
    const s = ticketSummary[key] || (ticketSummary[key] = { rows: 0, count: 0, income: 0, firstKeys: Object.keys(t) });
    s.rows++;
    s.count += Number(t.ticketCount || 0);
    s.income += Number(t.incomeMoney || 0);
  }
  for (const t of Object.values(ticketSummary)) t.income = +t.income.toFixed(2);
  const valid = bills.filter((b) => String(b.state) === '1' && Number(b.delflg) === 0);
  const byType = {}, byPeriod = {}, byOpenPeriod = {}, byShift = {}, byGroupBuy = {}, classes = {}, itemKinds = {}, productsByKind = {};
  for (const b of valid) {
    const type = b.sale_type_name || '(blank)';
    const t = byType[type] || (byType[type] = { bills: 0, people: 0, income: 0, last: 0 });
    t.bills++;
    t.people += Number(b.people_qty || 0);
    t.income += Number(b.income_total || 0);
    t.last += Number(b.last_total || 0);
    const period = String(b.settle_time).slice(11,16) < '17:00' ? 'LUNCH' : 'DINNER';
    const p = byPeriod[period] || (byPeriod[period] = { bills: 0, people: 0, income: 0 });
    p.bills++;
    p.people += Number(b.people_qty || 0);
    p.income += Number(b.income_total || 0);
    const openPeriod = String(b.open_time).slice(11,16) < '17:00' ? 'LUNCH' : 'DINNER';
    const op = byOpenPeriod[openPeriod] || (byOpenPeriod[openPeriod] = { bills: 0, income: 0 });
    op.bills++;
    op.income += Number(b.income_total || 0);
    const shift = `${b.open_shift_id ?? '(none)'}/${b.settle_shift_id ?? '(none)'}`;
    const sh = byShift[shift] || (byShift[shift] = { bills: 0, income: 0 });
    sh.bills++;
    sh.income += Number(b.income_total || 0);
    for (const settle of b.settleDetail || []) {
      if (!/抖音券|美团点评团购|高德团购/.test(settle.payway_name)) continue;
      const g = byGroupBuy[settle.payway_name] || (byGroupBuy[settle.payway_name] = { bills: new Set(), entries: 0, income: 0, ticketCount: 0, ticketKeys: [] });
      g.bills.add(String(b.bs_id));
      g.entries++;
      g.income += Number(settle.income_money || 0);
      g.ticketCount += b.ticketDetail?.length || 0;
      g.ticketKeys = Object.keys(b.ticketDetail?.[0] || {});
    }
    for (const item of b.item || []) {
      if (Number(item.delflg) !== 0) continue;
      const c = `${item.big_class_name || '(blank)'} / ${item.small_class_name || '(blank)'}`;
      classes[c] = (classes[c] || 0) + Number(item.last_qty || 0);
      const k = `${item.item_type_name || item.item_type || '(blank)'} / ${item.pkg_flg_name || item.pkg_flg || '(blank)'}`;
      itemKinds[k] = (itemKinds[k] || 0) + 1;
      if (String(item.pkg_flg_name || '') !== '套餐') {
        const p = productsByKind[item.item_name] || (productsByKind[item.item_name] = { quantity: 0, kind: k });
        p.quantity += Number(item.last_qty || 0);
      }
    }
  }
  for (const t of Object.values(byType)) { t.income = +t.income.toFixed(2); t.last = +t.last.toFixed(2); }
  for (const p of Object.values(byPeriod)) p.income = +p.income.toFixed(2);
  for (const p of Object.values(byOpenPeriod)) p.income = +p.income.toFixed(2);
  for (const p of Object.values(byShift)) p.income = +p.income.toFixed(2);
  for (const g of Object.values(byGroupBuy)) { g.bills = g.bills.size; g.income = +g.income.toFixed(2); }
  console.log(JSON.stringify({ validBills: valid.length, byType, byPeriod, byOpenPeriod, byShift, byGroupBuy, ticketRows: tickets.length, ticketSummary, classes, itemKinds, sampleProducts: Object.entries(productsByKind).filter(([name]) => /西红柿鸡蛋盖饭|招牌黑金卤肉饭|宫保鸡丁盖饭|冰花锅贴|红糖豆花/.test(name)).map(([name,p])=>({name,...p})) }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
