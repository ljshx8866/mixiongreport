import { BadRequestException, Controller, Get, Injectable, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { mockReportSource } from './mock-data';
import { toDate } from './report.service';
import { PosAdapter, PeriodConfig, WuuxiangPosAdapter } from './pos-adapter';
import { WuuxiangClient } from './wuuxiang.client';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Roles } from './auth';

function encryptRaw(payload: string): string {
  const key = Buffer.from(process.env.POS_LOG_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('POS_LOG_KEY must be a base64 encoded 32-byte key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return `aes-256-gcm:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

@Injectable()
export class MockPosAdapter implements PosAdapter {
  async fetchDaily(storeCode: string, date: string, _periods: PeriodConfig[]) {
    if (storeCode !== 'SD001' || date !== '2026-09-27') throw new Error('No mock POS data for requested store and date');
    const { sales, periods, platforms, products } = mockReportSource;
    return { sales: sales!, periods, platforms, products: products.map((p) => ({
      externalProductCode: String(p.productId), quantity: p.quantity, salesAmount: p.salesAmount,
    })) };
  }
}

@Injectable()
export class SyncService {
  private readonly adapter: PosAdapter;
  private readonly posClient: WuuxiangClient | null;
  constructor(private readonly db: PrismaService) {
    if (process.env.POS_ADAPTER === 'wuuxiang') {
      if (!process.env.POS_APP_ID || !process.env.POS_ACCESS_ID || !process.env.POS_CENTER_ID)
        throw new Error('POS_APP_ID, POS_ACCESS_ID and POS_CENTER_ID are required');
      if (!process.env.POS_BOWL_REVENUE_TYPE_ID)
        throw new Error('POS_BOWL_REVENUE_TYPE_ID is required for customer counts');
      this.posClient = new WuuxiangClient(process.env.POS_APP_ID, process.env.POS_ACCESS_ID, process.env.POS_CENTER_ID);
      const excludedCustomerPayways = (process.env.POS_EXCLUDED_CUSTOMER_PAYWAYS ?? '员工餐').split(',');
      this.adapter = new WuuxiangPosAdapter(this.posClient, process.env.POS_BOWL_REVENUE_TYPE_ID, excludedCustomerPayways);
    } else {
      this.posClient = null;
      this.adapter = new MockPosAdapter();
    }
  }

  async syncMasterData() {
    if (process.env.REPORT_SOURCE !== 'database' || !this.posClient) throw new BadRequestException('Real POS and database mode are required');
    const shops = await this.posClient.shops();
    let storeCount = 0, categoryCount = 0, productCount = 0;
    const brandName = process.env.POS_BRAND_NAME || '米熊';
    for (const shop of shops) {
      if (String(shop.shop_id) === process.env.POS_CENTER_ID) continue;
      const match = shop.shop_name.match(/^米熊[（(](.+)[）)]$/);
      const regionName = shop.region_name?.trim();
      let regionId: bigint | null = null;
      if (regionName) {
        const existingRegion = await this.db.region.findFirst({ where: { name: regionName } });
        regionId = existingRegion?.id ?? (await this.db.region.create({ data: { name: regionName } })).id;
      }
      await this.db.store.upsert({ where: { storeCode: shop.shop_code }, create: {
        storeCode: shop.shop_code, storeName: match?.[1] ?? shop.shop_name, brandName,
        externalStoreCode: String(shop.shop_id), regionId,
      }, update: { storeName: match?.[1] ?? shop.shop_name, brandName, externalStoreCode: String(shop.shop_id), regionId } });
      storeCount++;
      const categories = await this.posClient.categories(String(shop.shop_id));
      const categoryIds = new Map<string, bigint>();
      for (const category of categories.filter((c) => Number(c.delflg) === 0)) {
        const code = String(category.class_id);
        const saved = await this.db.productCategory.upsert({ where: { brandCode_categoryCode: { brandCode: 'POS', categoryCode: code } },
          create: { brandCode: 'POS', categoryCode: code, categoryName: category.class_name, sortOrder: Number(category.level) },
          update: { categoryName: category.class_name, sortOrder: Number(category.level), status: true } });
        categoryIds.set(code, saved.id);
        categoryCount++;
      }
      const products = await this.posClient.products(String(shop.shop_id));
      for (const product of products) {
        const categoryId = categoryIds.get(String(product.small_class_id)) ?? categoryIds.get(String(product.big_class_id));
        if (!categoryId) throw new Error(`POS product ${product.item_id} has no mapped category`);
        const salePrice = Number(product.std_price);
        const theoreticalCost = Number(product.cost_price);
        await this.db.product.upsert({ where: { externalProductCode: String(product.item_id) }, create: {
          externalProductCode: String(product.item_id), productName: product.item_name, categoryId,
          salePrice: Number.isFinite(salePrice) ? salePrice : null,
          theoreticalCost: Number.isFinite(theoreticalCost) ? theoreticalCost : null,
          status: Number(product.delflg) === 0,
        }, update: {
          productName: product.item_name, categoryId, salePrice: Number.isFinite(salePrice) ? salePrice : null,
          theoreticalCost: Number.isFinite(theoreticalCost) ? theoreticalCost : null,
          status: Number(product.delflg) === 0,
        } });
        productCount++;
      }
    }
    if ((await this.db.businessPeriod.count()) === 0) {
      await this.db.businessPeriod.createMany({ data: [
        { periodCode: 'LUNCH', periodName: '午餐', startTime: '00:00', endTime: '16:59', sortOrder: 1, externalShiftId: process.env.POS_LUNCH_SHIFT_ID || null },
        { periodCode: 'DINNER', periodName: '晚餐', startTime: '17:00', endTime: '23:59', sortOrder: 2, externalShiftId: process.env.POS_DINNER_SHIFT_ID || null },
      ] });
    }
    return { stores: storeCount, categoriesProcessed: categoryCount, productsProcessed: productCount };
  }

  async sync(storeId: number, date: string, finalized = false) {
    if (process.env.REPORT_SOURCE !== 'database') throw new BadRequestException('Sync requires REPORT_SOURCE=database');
    const businessDate = toDate(date);
    const store = await this.db.store.findUniqueOrThrow({ where: { id: BigInt(storeId) } });
    if (!store.externalStoreCode) throw new BadRequestException('Store has no POS code mapping');
    const state = await this.db.dailyReportState.findUnique({ where: { storeId_businessDate: { storeId: store.id, businessDate } } });
    if (state?.status === 'LOCKED') throw new BadRequestException('Report is locked');
    const log = await this.db.apiSyncLog.create({ data: {
      storeId: store.id, businessDate, apiType: 'PRODUCTS', status: 'RUNNING',
      requestPayload: JSON.stringify({ storeCode: store.externalStoreCode, date }),
    } });
    try {
      const configuredPeriods = await this.db.businessPeriod.findMany({ where: { status: true }, orderBy: { sortOrder: 'asc' } });
      const data = await this.adapter.fetchDaily(store.externalStoreCode, date, configuredPeriods.map((p) => ({
        code: p.periodCode, name: p.periodName, startTime: p.startTime, endTime: p.endTime, externalShiftId: p.externalShiftId,
      })));
      if (!data.sales) throw new Error('POS sales data missing');
      const missingCodes: string[] = [];
      const resolved = await Promise.all(data.products.map(async (item) => {
        const code = item.externalProductCode;
        const product = await this.db.product.findUnique({ where: { externalProductCode: code } });
        if (!product) missingCodes.push(code);
        return { item, product };
      }));
      if (missingCodes.length) throw new Error(`Unmapped POS products: ${missingCodes.join(', ')}`);
      await this.db.$transaction(async (tx) => {
        await tx.dailySale.upsert({ where: { storeId_businessDate: { storeId: store.id, businessDate } }, create: {
          storeId: store.id, businessDate, totalSales: data.sales!.total.amount, totalCustomerCount: data.sales!.total.customers,
          dineInSales: data.sales!.dineIn.amount, dineInCustomerCount: data.sales!.dineIn.customers,
          deliverySales: data.sales!.delivery.amount, deliveryOrderCount: data.sales!.delivery.customers, finalized,
        }, update: {
          totalSales: data.sales!.total.amount, totalCustomerCount: data.sales!.total.customers,
          dineInSales: data.sales!.dineIn.amount, dineInCustomerCount: data.sales!.dineIn.customers,
          deliverySales: data.sales!.delivery.amount, deliveryOrderCount: data.sales!.delivery.customers, finalized,
        } });
        await tx.salesPeriod.deleteMany({ where: { storeId: store.id, businessDate } });
        await tx.salesPeriod.createMany({ data: data.periods.map((p) => ({ storeId: store.id, businessDate, periodCode: p.code, periodName: p.name, salesAmount: p.amount, customerCount: p.customers })) });
        await tx.groupBuySale.deleteMany({ where: { storeId: store.id, businessDate } });
        await tx.groupBuySale.createMany({ data: data.platforms.map((p) => ({ storeId: store.id, businessDate, platformCode: p.code, platformName: p.name, salesAmount: p.amount, customerCount: p.customers })) });
        await tx.productDailySale.deleteMany({ where: { storeId: store.id, businessDate } });
        await tx.productDailySale.createMany({ data: resolved.map(({ item, product }) => ({
          storeId: store.id, businessDate, productId: product!.id, categoryId: product!.categoryId,
          quantity: item.quantity, salesAmount: item.salesAmount,
        })) });
        await tx.apiSyncLog.update({ where: { id: log.id }, data: {
          status: 'SUCCESS', responsePayload: data.rawResponse ? encryptRaw(data.rawResponse) : JSON.stringify(data), finishedAt: new Date(),
        } });
      });
      return { status: 'SUCCESS', finalized, productCount: data.products.length };
    } catch (error) {
      await this.db.apiSyncLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
      throw error;
    }
  }

  @Cron('0 9-23 * * *')
  async hourly() {
    if (process.env.SYNC_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const now = new Date();
    if (now.getHours() === 2) return;
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const store of await this.db.store.findMany({ where: { status: true, externalStoreCode: { not: null } } })) {
      try { await this.sync(Number(store.id), date); } catch (error) { console.error('Hourly sync failed', store.storeCode, error); }
    }
  }

  @Cron('30 8 * * *')
  async dailyMasterData() {
    if (process.env.SYNC_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database' || !this.posClient) return;
    try { await this.syncMasterData(); } catch (error) { console.error('Daily master data sync failed', error); }
  }

  @Cron('0 2 * * *')
  async finalSync() {
    if (process.env.SYNC_ENABLED !== 'true' || process.env.REPORT_SOURCE !== 'database') return;
    const yesterday = new Date(Date.now() - 86400000);
    const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    for (const store of await this.db.store.findMany({ where: { status: true, externalStoreCode: { not: null } } })) {
      try { await this.sync(Number(store.id), date, true); } catch (error) { console.error('Final sync failed', store.storeCode, error); }
    }
  }
}

@Controller('api/sync')
@Roles(UserRole.ADMIN)
export class SyncController {
  constructor(private readonly syncService: SyncService, private readonly db: PrismaService) {}
  @Post('master') master() { return this.syncService.syncMasterData(); }
  @Post(':storeId/:date') run(@Param('storeId', ParseIntPipe) storeId: number, @Param('date') date: string) {
    return this.syncService.sync(storeId, date);
  }
  @Get('logs') async logs(@Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    return (await this.db.apiSyncLog.findMany({ where: { storeId: BigInt(storeId), businessDate: toDate(date) }, orderBy: { startedAt: 'desc' } })).map((x) => ({
      id: Number(x.id), apiType: x.apiType, status: x.status, errorMessage: x.errorMessage, startedAt: x.startedAt, finishedAt: x.finishedAt,
    }));
  }
}
