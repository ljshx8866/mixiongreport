const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SyncService } = require('../dist/sync.service');

class CatalogDatabase {
  constructor() {
    this.nextId = 1n;
    this.categories = new Map([['POS:OLD', { id: 900n, brandCode: 'POS', categoryCode: 'OLD', status: true }]]);
    this.products = new Map([['stale-product', { id: 901n, externalProductCode: 'stale-product', categoryId: 900n, status: true }]]);
    this.regions = new Map();
    this.stores = new Map();
    this.periods = 0;
    this.region = {
      findFirst: async ({ where }) => this.regions.get(where.name) ?? null,
      create: async ({ data }) => { const row = { id: this.nextId++, ...data }; this.regions.set(data.name, row); return row; },
    };
    this.store = { upsert: async ({ where, create, update }) => {
      const current = this.stores.get(where.storeCode);
      const row = current ? { ...current, ...update } : { id: this.nextId++, ...create };
      this.stores.set(where.storeCode, row); return row;
    } };
    this.productCategory = {
      upsert: async ({ where, create, update }) => {
        const key = `${where.brandCode_categoryCode.brandCode}:${where.brandCode_categoryCode.categoryCode}`;
        const current = this.categories.get(key);
        const row = current ? { ...current, ...update } : { id: this.nextId++, ...create };
        this.categories.set(key, row); return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of this.categories.values()) {
          if (row.brandCode !== where.brandCode || row.status !== where.status || where.categoryCode.notIn.includes(row.categoryCode)) continue;
          Object.assign(row, data); count++;
        }
        return { count };
      },
    };
    this.product = {
      upsert: async ({ where, create, update }) => {
        const current = this.products.get(where.externalProductCode);
        const row = current ? { ...current, ...update } : { id: this.nextId++, ...create };
        this.products.set(where.externalProductCode, row); return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of this.products.values()) {
          const category = [...this.categories.values()].find((entry) => entry.id === row.categoryId);
          if (row.status === where.status && category?.brandCode === where.category.is.brandCode &&
              !where.externalProductCode.notIn.includes(row.externalProductCode)) {
            Object.assign(row, data); count++;
          }
        }
        return { count };
      },
    };
    this.businessPeriod = { count: async () => this.periods, createMany: async ({ data }) => { this.periods += data.length; } };
  }
  async $transaction(callback) { return callback(this); }
}

function syncService(db, posClient) {
  const service = Object.create(SyncService.prototype);
  service.db = db;
  service.posClient = posClient;
  return service;
}

test('catalog sync stores the POS snapshot and deactivates missing or disabled POS records', async () => {
  const previous = { source: process.env.REPORT_SOURCE, center: process.env.POS_CENTER_ID };
  process.env.REPORT_SOURCE = 'database'; process.env.POS_CENTER_ID = 'CENTER';
  try {
    const db = new CatalogDatabase();
    const pos = {
      shops: async () => [
        { shop_id: 'CENTER', shop_code: 'CENTER', shop_name: '米熊（总部）' },
        { shop_id: 'S1', shop_code: 'S1', shop_name: '米熊（山大店）', region_name: '济南' },
        { shop_id: 'S2', shop_code: 'S2', shop_name: '米熊（万象城店）', region_name: '济南' },
      ],
      categories: async (shopId) => shopId === 'S1' ? [
        { class_id: 'A', class_code: 'A', class_name: '旧分类名', level: 1, parent_id: '0', delflg: 0 },
        { class_id: 'B', class_code: 'B', class_name: '已删分类', level: 2, parent_id: '0', delflg: 1 },
      ] : [
        { class_id: 'A', class_code: 'A', class_name: '新分类名', level: 2, parent_id: '0', delflg: 0 },
        { class_id: 'C', class_code: 'C', class_name: '新分类', level: 3, parent_id: '0', delflg: 0 },
      ],
      products: async (shopId) => shopId === 'S1' ? [
        { item_id: '11', item_code: '11', item_name: '门店旧名称', small_class_id: 'A', big_class_id: 'A', std_price: 18, cost_price: 8, delflg: 0 },
        { item_id: '22', item_code: '22', item_name: '停用商品', small_class_id: 'B', big_class_id: 'A', delflg: 0, is_enable: 0 },
        { item_id: '33', item_code: '33', item_name: '删除商品', small_class_id: 'A', big_class_id: 'A', delflg: 1 },
      ] : [
        { item_id: '11', item_code: '11', item_name: 'POS新名称', small_class_id: 'C', big_class_id: 'A', std_price: 20, cost_price: 9, delflg: 0, is_enable: 1 },
        { item_id: '44', item_code: '44', item_name: '套餐', small_class_id: 'A', big_class_id: 'A', std_price: 30, cost_price: 12, delflg: 0, is_package: 1 },
      ],
    };
    const result = await syncService(db, pos).syncMasterData();
    assert.deepEqual(result, { stores: 2, categoriesProcessed: 3, productsProcessed: 4, categoriesDeactivated: 1, productsDeactivated: 1 });
    assert.equal(db.categories.get('POS:A').categoryName, '新分类名');
    assert.equal(db.categories.get('POS:B').status, false);
    assert.equal(db.categories.get('POS:OLD').status, false);
    assert.equal(db.products.get('11').productName, 'POS新名称');
    assert.equal(db.products.get('11').status, true);
    assert.equal(db.products.get('22').status, false);
    assert.equal(db.products.get('33').status, false);
    assert.equal(db.products.get('44').isPackage, true);
    assert.equal(db.products.get('stale-product').status, false);
    assert.equal(db.stores.size, 2);
  } finally {
    if (previous.source === undefined) delete process.env.REPORT_SOURCE; else process.env.REPORT_SOURCE = previous.source;
    if (previous.center === undefined) delete process.env.POS_CENTER_ID; else process.env.POS_CENTER_ID = previous.center;
  }
});

test('empty POS master-data response leaves the local catalog untouched', async () => {
  const previous = { source: process.env.REPORT_SOURCE, center: process.env.POS_CENTER_ID };
  process.env.REPORT_SOURCE = 'database'; process.env.POS_CENTER_ID = 'CENTER';
  try {
    const db = new CatalogDatabase();
    await assert.rejects(syncService(db, { shops: async () => [] }).syncMasterData(), /no stores/);
    assert.equal(db.categories.get('POS:OLD').status, true);
    assert.equal(db.products.get('stale-product').status, true);
  } finally {
    if (previous.source === undefined) delete process.env.REPORT_SOURCE; else process.env.REPORT_SOURCE = previous.source;
    if (previous.center === undefined) delete process.env.POS_CENTER_ID; else process.env.POS_CENTER_ID = previous.center;
  }
});

test('a new POS item is imported with its category before daily sales are linked', async () => {
  const db = new CatalogDatabase();
  const service = syncService(db, {
    categories: async () => [
      { class_id: 'NEW-CAT', class_code: 'NEW-CAT', class_name: '新分类', level: 4, parent_id: '0', delflg: 0 },
    ],
    products: async () => [
      { item_id: 'NEW-ITEM', item_code: 'NEW-ITEM', item_name: '新菜品', small_class_id: 'NEW-CAT',
        big_class_id: 'NEW-CAT', std_price: 28, cost_price: 10, delflg: 0, is_enable: 1 },
    ],
  });
  await service.refreshMissingProducts('POS-STORE-1', ['NEW-ITEM']);
  assert.equal(db.categories.get('POS:NEW-CAT').categoryName, '新分类');
  assert.equal(db.products.get('NEW-ITEM').productName, '新菜品');
  assert.equal(db.products.get('NEW-ITEM').status, true);
  assert.equal(db.products.get('NEW-ITEM').categoryId, db.categories.get('POS:NEW-CAT').id);
});
