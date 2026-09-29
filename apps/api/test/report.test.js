const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

test('GET /api/reports/daily returns the full Shanda report', async () => {
  process.env.REPORT_SOURCE = 'mock';
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  try {
    const response = await request(app.getHttpServer()).get('/api/reports/daily?storeId=1&date=2026-09-27');
    assert.equal(response.status, 200);
    const report = response.body;
    assert.equal(report.title, '米熊（山大店）2026年9月27日经营日报');
    assert.equal(report.sales.total.amount, 5644.74);
    assert.equal(report.sales.total.customers, 389);
    assert.equal(report.groupBuy.total.avgOrderValue, 20.37);
    assert.equal(report.energy.powerEfficiency, 20.42);
    assert.equal(report.operations.addonPerThousand, 152.63);
    assert.equal(report.categorySales.find((x) => x.categoryName === '盖饭').quantity, 319);
    assert.equal(report.categorySales.find((x) => x.categoryName === '锅贴').quantity, 178);
    assert.equal(report.productSales.find((x) => x.categoryName === '盖饭').items[0].quantity, 80);
    assert.equal(report.status.complete, true);
    assert.equal((await request(app.getHttpServer()).get('/api/reports/daily?storeId=1&date=bad')).status, 400);
    assert.equal((await request(app.getHttpServer()).get('/api/reports/daily?storeId=1&date=2026-02-30')).status, 400);
  } finally { await app.close(); }
});
