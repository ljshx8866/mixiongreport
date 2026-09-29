const { WuuxiangClient } = require('../apps/api/dist/wuuxiang.client');

async function main() {
  const client = new WuuxiangClient(process.env.POS_APP_ID, process.env.POS_ACCESS_ID, process.env.POS_CENTER_ID);
  const shopId = process.env.POS_PROBE_SHOP_ID;
  const categories = await client.categories(shopId);
  const products = await client.products(shopId);
  let unknownItems = [];
  if (process.env.POS_PROBE_DATE) {
    const known = new Set(products.map((p) => String(p.item_id)));
    const bills = await client.bills(shopId, process.env.POS_PROBE_DATE, true);
    unknownItems = [...new Map(bills.flatMap((b) => b.item || []).filter((i) => !known.has(String(i.item_id))).map((i) => [String(i.item_id), i.item_name])).entries()].map(([id,name]) => ({id,name}));
  }
  console.log(JSON.stringify({
    categoryCount: categories.length,
    categories: categories.filter((c) => Number(c.delflg) === 0).map((c) => ({ id: c.class_id, name: c.class_name, level: c.level, parentId: c.parent_id })),
    productCount: products.length,
    sampleProductKeys: Object.keys(products[0] || {}),
    sampleProduct: products[0] && { id: products[0].item_id, name: products[0].item_name, smallClassId: products[0].small_class_id, cost: products[0].cost_price },
    unknownItems,
  }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
