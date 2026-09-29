import { PrismaClient } from '@prisma/client';
import { mockProducts, mockReportSource } from '../../apps/api/src/mock-data';

const db = new PrismaClient();
const date = new Date('2026-09-27T00:00:00.000Z');

async function main() {
  const store = await db.store.upsert({ where: { storeCode: 'SD001' }, create: {
    storeCode: 'SD001', storeName: '山大店', brandName: '米熊', externalStoreCode: 'SD001',
  }, update: { storeName: '山大店', externalStoreCode: 'SD001' } });
  for (const [index, code, name, startTime, endTime, externalShiftId] of [
    [1, 'LUNCH', '午餐', '00:00', '16:59', '26301600000000002'], [2, 'DINNER', '晚餐', '17:00', '23:59', '26301600000000003'],
  ] as [number, string, string, string, string, string][]) {
    await db.businessPeriod.upsert({ where: { periodCode: code }, create: {
      periodCode: code, periodName: name, startTime, endTime, sortOrder: index, externalShiftId,
    }, update: { periodName: name, startTime, endTime, sortOrder: index, externalShiftId } });
  }
  const ids = new Map<number, bigint>();
  for (const item of mockProducts) {
    if (!ids.has(item.categoryId)) {
      const categoryCode = `CAT${String(item.categoryId).padStart(2, '0')}`;
      const category = await db.productCategory.upsert({ where: { brandCode_categoryCode: { brandCode: 'MIXIONG', categoryCode } }, create: {
        brandCode: 'MIXIONG', categoryCode, categoryName: item.categoryName, sortOrder: item.categoryOrder,
      }, update: { categoryName: item.categoryName, sortOrder: item.categoryOrder } });
      ids.set(item.categoryId, category.id);
    }
    const product = await db.product.upsert({ where: { externalProductCode: String(item.productId) }, create: {
      externalProductCode: String(item.productId), productName: item.productName, categoryId: ids.get(item.categoryId)!,
    }, update: { productName: item.productName, categoryId: ids.get(item.categoryId)! } });
    await db.productDailySale.upsert({ where: { storeId_businessDate_productId: { storeId: store.id, businessDate: date, productId: product.id } }, create: {
      storeId: store.id, businessDate: date, productId: product.id, categoryId: ids.get(item.categoryId)!, quantity: item.quantity, salesAmount: item.salesAmount,
    }, update: { categoryId: ids.get(item.categoryId)!, quantity: item.quantity, salesAmount: item.salesAmount } });
  }
  const sales = mockReportSource.sales!;
  await db.dailySale.upsert({ where: { storeId_businessDate: { storeId: store.id, businessDate: date } }, create: {
    storeId: store.id, businessDate: date, totalSales: sales.total.amount, totalCustomerCount: sales.total.customers,
    dineInSales: sales.dineIn.amount, dineInCustomerCount: sales.dineIn.customers,
    deliverySales: sales.delivery.amount, deliveryOrderCount: sales.delivery.customers, finalized: true,
  }, update: { totalSales: sales.total.amount, totalCustomerCount: sales.total.customers, dineInSales: sales.dineIn.amount,
    dineInCustomerCount: sales.dineIn.customers, deliverySales: sales.delivery.amount, deliveryOrderCount: sales.delivery.customers, finalized: true } });
  for (const p of mockReportSource.periods) await db.salesPeriod.upsert({ where: {
    storeId_businessDate_periodCode: { storeId: store.id, businessDate: date, periodCode: p.code },
  }, create: { storeId: store.id, businessDate: date, periodCode: p.code, periodName: p.name, salesAmount: p.amount, customerCount: p.customers },
  update: { periodName: p.name, salesAmount: p.amount, customerCount: p.customers } });
  for (const p of mockReportSource.platforms) await db.groupBuySale.upsert({ where: {
    storeId_businessDate_platformCode: { storeId: store.id, businessDate: date, platformCode: p.code },
  }, create: { storeId: store.id, businessDate: date, platformCode: p.code, platformName: p.name, salesAmount: p.amount, customerCount: p.customers },
  update: { platformName: p.name, salesAmount: p.amount, customerCount: p.customers } });
  const manual = mockReportSource.manual!;
  await db.storeDailyInput.upsert({ where: { storeId_businessDate: { storeId: store.id, businessDate: date } }, create: {
    storeId: store.id, businessDate: date, kitchenPower: manual.kitchenPower, diningPower: manual.diningPower,
    fullDayPower: manual.fullDayPower, airConditionPower: manual.airConditionPower, waterUsage: manual.waterUsage,
    laborHours: manual.laborHours, addonCustomerCount: manual.addonCustomers, comboCustomerCount: manual.comboCustomers,
    status: 'SUBMITTED', submittedAt: new Date(),
  }, update: { kitchenPower: manual.kitchenPower, diningPower: manual.diningPower, fullDayPower: manual.fullDayPower,
    airConditionPower: manual.airConditionPower, waterUsage: manual.waterUsage, laborHours: manual.laborHours,
    addonCustomerCount: manual.addonCustomers, comboCustomerCount: manual.comboCustomers, status: 'SUBMITTED' } });
  await db.dailyReportState.upsert({ where: { storeId_businessDate: { storeId: store.id, businessDate: date } },
    create: { storeId: store.id, businessDate: date, status: 'SUBMITTED' }, update: { status: 'SUBMITTED' } });
  await db.apiSyncLog.create({ data: { storeId: store.id, businessDate: date, apiType: 'PRODUCTS', status: 'SUCCESS',
    requestPayload: JSON.stringify({ storeCode: 'SD001', date: '2026-09-27' }), responsePayload: JSON.stringify(mockReportSource.products), finishedAt: new Date() } });
  console.log(`Seeded ${store.storeName} on 2026-09-27`);
}

main().finally(() => db.$disconnect());
