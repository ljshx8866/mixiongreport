import { BadRequestException, ConflictException, Controller, Get, Injectable, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { UserRole, UserSource } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { mockReportSource } from './mock-data';
import { toDate } from './report.service';
import { PosAdapter, PeriodConfig, WuuxiangPosAdapter } from './pos-adapter';
import { WuuxiangClient, type WuuxiangCategory, type WuuxiangProduct } from './wuuxiang.client';
import { authUser, Roles, type RequestWithUser } from './auth';
import { mapWuuxiangUsers, resolvePosUserSyncMatch } from './user-sync';
import { alertFingerprint, cleanAlertMessage, diagnoseAlert } from './system-alert-diagnostics';

function posFlag(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return defaultValue;
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
  private readonly syncTails = new Map<string, Promise<unknown>>();
  private retryingSubmittedInputs = false;
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
    const shops = (await this.posClient.shops()).filter((shop) => String(shop.shop_id) !== process.env.POS_CENTER_ID);
    if (!shops.length) throw new Error('POS returned no stores; existing master data was left unchanged');

    // Fetch every shop first. A failed/empty POS response must never partially
    // replace the local catalog or deactivate records from an incomplete snapshot.
    const categorySnapshot = new Map<string, { categoryName: string; sortOrder: number; status: boolean }>();
    const productSnapshot = new Map<string, { product: WuuxiangProduct; categoryCode: string; status: boolean }>();
    const storeSnapshot = new Map<string, typeof shops[number]>();
    for (const shop of shops) {
      const storeCode = String(shop.shop_code ?? '').trim();
      if (!storeCode) throw new Error(`POS store ${shop.shop_id} is missing shop_code; existing master data was left unchanged`);
      storeSnapshot.set(storeCode, shop);
      const categories = await this.posClient.categories(String(shop.shop_id));
      const categoryIds = new Map<string, WuuxiangCategory>();
      for (const category of categories) {
        const code = String(category.class_id ?? '').trim();
        if (!code) throw new Error(`POS store ${shop.shop_id} returned a category without class_id`);
        categoryIds.set(code, category);
        const active = Number(category.delflg) === 0;
        const previous = categorySnapshot.get(code);
        // When branches return the same POS code, an active row wins over a
        // deleted copy; among rows with the same state, the newest is used.
        if (!previous || (active && !previous.status) || active === previous.status) {
          categorySnapshot.set(code, { categoryName: category.class_name, sortOrder: Number.isFinite(Number(category.level)) ? Number(category.level) : 0, status: active || previous?.status === true });
        }
      }

      const products = await this.posClient.products(String(shop.shop_id));
      for (const product of products) {
        const code = String(product.item_id ?? '').trim();
        if (!code) throw new Error(`POS store ${shop.shop_id} returned a product without item_id`);
        const categoryCode = [product.small_class_id, product.big_class_id]
          .map((value) => String(value ?? '').trim())
          .find((value) => value && categoryIds.has(value));
        if (!categoryCode) throw new Error(`POS product ${code} has no category in the complete POS snapshot`);
        const active = Number(product.delflg) === 0 && posFlag(product.is_enable);
        const previous = productSnapshot.get(code);
        if (!previous || (active && !previous.status) || active === previous.status) {
          productSnapshot.set(code, { product, categoryCode, status: active || previous?.status === true });
        }
      }
    }
    if (!categorySnapshot.size || !productSnapshot.size)
      throw new Error('POS returned an empty category or product catalog; existing master data was left unchanged');

    const brandName = process.env.POS_BRAND_NAME || '米熊';
    const result = await this.db.$transaction(async (tx) => {
      for (const shop of storeSnapshot.values()) {
        const match = shop.shop_name.match(/^米熊[（(](.+)[）)]$/);
        const regionName = shop.region_name?.trim();
        let regionId: bigint | null = null;
        if (regionName) {
          const existingRegion = await tx.region.findFirst({ where: { name: regionName } });
          regionId = existingRegion?.id ?? (await tx.region.create({ data: { name: regionName } })).id;
        }
        await tx.store.upsert({ where: { storeCode: shop.shop_code }, create: {
          storeCode: shop.shop_code, storeName: match?.[1] ?? shop.shop_name, brandName,
          externalStoreCode: String(shop.shop_id), regionId,
        }, update: { storeName: match?.[1] ?? shop.shop_name, brandName, externalStoreCode: String(shop.shop_id), regionId } });
      }

      const categoryIds = new Map<string, bigint>();
      for (const [code, category] of categorySnapshot) {
        const saved = await tx.productCategory.upsert({ where: { brandCode_categoryCode: { brandCode: 'POS', categoryCode: code } },
          create: { brandCode: 'POS', categoryCode: code, categoryName: category.categoryName, sortOrder: category.sortOrder, status: category.status },
          update: { categoryName: category.categoryName, sortOrder: category.sortOrder, status: category.status } });
        categoryIds.set(code, saved.id);
      }

      for (const [code, entry] of productSnapshot) {
        const categoryId = categoryIds.get(entry.categoryCode);
        if (!categoryId) throw new Error(`POS product ${code} has no persisted category`);
        const product = entry.product;
        const salePrice = Number(product.std_price);
        const theoreticalCost = Number(product.cost_price);
        await tx.product.upsert({ where: { externalProductCode: code }, create: {
          externalProductCode: code, productName: product.item_name, categoryId,
          salePrice: Number.isFinite(salePrice) ? salePrice : null,
          theoreticalCost: Number.isFinite(theoreticalCost) ? theoreticalCost : null,
          status: entry.status, isPackage: posFlag(product.is_package, false),
        }, update: {
          productName: product.item_name, categoryId, salePrice: Number.isFinite(salePrice) ? salePrice : null,
          theoreticalCost: Number.isFinite(theoreticalCost) ? theoreticalCost : null,
          status: entry.status, isPackage: posFlag(product.is_package, false),
        } });
      }

      const staleCategories = await tx.productCategory.updateMany({ where: {
        brandCode: 'POS', status: true, categoryCode: { notIn: [...categorySnapshot.keys()] },
      }, data: { status: false } });
      const staleProducts = await tx.product.updateMany({ where: {
        category: { is: { brandCode: 'POS' } }, status: true,
        externalProductCode: { notIn: [...productSnapshot.keys()] },
      }, data: { status: false } });
      if ((await tx.businessPeriod.count()) === 0) {
        await tx.businessPeriod.createMany({ data: [
          { periodCode: 'LUNCH', periodName: '午餐', startTime: '00:00', endTime: '16:59', sortOrder: 1, externalShiftId: process.env.POS_LUNCH_SHIFT_ID || null },
          { periodCode: 'DINNER', periodName: '晚餐', startTime: '17:00', endTime: '23:59', sortOrder: 2, externalShiftId: process.env.POS_DINNER_SHIFT_ID || null },
        ] });
      }
      return { categoriesDeactivated: staleCategories.count, productsDeactivated: staleProducts.count };
    });
    return { stores: storeSnapshot.size, categoriesProcessed: categorySnapshot.size, productsProcessed: productSnapshot.size, ...result };
  }

  /**
   * A POS item can be added after the daily catalog snapshot has run. Before
   * failing a daily sync for an unknown item code, refresh just the current
   * store's matching POS products and their categories so new items can be
   * linked to the local catalog immediately.
   */
  private async refreshMissingProducts(externalStoreCode: string, missingCodes: string[]) {
    if (!this.posClient || missingCodes.length === 0) return;
    const missing = new Set(missingCodes.map((code) => String(code).trim()));
    const [categories, products] = await Promise.all([
      this.posClient.categories(externalStoreCode),
      this.posClient.products(externalStoreCode),
    ]);
    const categoryByCode = new Map(categories.map((category) => [String(category.class_id ?? '').trim(), category]));
    const matchingProducts = products.filter((product) => missing.has(String(product.item_id ?? '').trim()));
    if (!matchingProducts.length) return;

    const resolved = matchingProducts.map((product) => {
      const productCode = String(product.item_id ?? '').trim();
      const categoryCode = [product.small_class_id, product.big_class_id]
        .map((value) => String(value ?? '').trim())
        .find((value) => value && categoryByCode.has(value));
      if (!productCode || !product.item_name?.trim() || !categoryCode)
        throw new Error(`POS 新菜品 ${productCode || '(无编码)'} 缺少名称或有效分类，无法关联到本地菜品目录`);
      const category = categoryByCode.get(categoryCode)!;
      const salePrice = Number(product.std_price);
      const theoreticalCost = Number(product.cost_price);
      return {
        code: productCode,
        product,
        categoryCode,
        categoryName: category.class_name,
        sortOrder: Number.isFinite(Number(category.level)) ? Number(category.level) : 0,
        categoryStatus: Number(category.delflg) === 0,
        status: Number(product.delflg) === 0 && posFlag(product.is_enable),
        salePrice: Number.isFinite(salePrice) ? salePrice : null,
        theoreticalCost: Number.isFinite(theoreticalCost) ? theoreticalCost : null,
      };
    });

    await this.db.$transaction(async (tx) => {
      const categoryIds = new Map<string, bigint>();
      for (const entry of resolved) {
        const category = await tx.productCategory.upsert({
          where: { brandCode_categoryCode: { brandCode: 'POS', categoryCode: entry.categoryCode } },
          create: { brandCode: 'POS', categoryCode: entry.categoryCode, categoryName: entry.categoryName,
            sortOrder: entry.sortOrder, status: entry.categoryStatus },
          update: { categoryName: entry.categoryName, sortOrder: entry.sortOrder, status: entry.categoryStatus },
        });
        categoryIds.set(entry.categoryCode, category.id);
      }
      for (const entry of resolved) {
        const categoryId = categoryIds.get(entry.categoryCode)!;
        await tx.product.upsert({
          where: { externalProductCode: entry.code },
          create: { externalProductCode: entry.code, productName: entry.product.item_name, categoryId,
            salePrice: entry.salePrice, theoreticalCost: entry.theoreticalCost,
            status: entry.status, isPackage: posFlag(entry.product.is_package, false) },
          update: { productName: entry.product.item_name, categoryId,
            salePrice: entry.salePrice, theoreticalCost: entry.theoreticalCost,
            status: entry.status, isPackage: posFlag(entry.product.is_package, false) },
        });
      }
    });
  }

  async syncUsers(actorUserId: number | null = null) {
    if (process.env.REPORT_SOURCE !== 'database' || !this.posClient)
      throw new BadRequestException('Real POS and database mode are required');
    const [employees, accessUsers, stores] = await Promise.all([
      this.posClient.employees(),
      this.posClient.employeeAccessShops(),
      this.db.store.findMany({ select: { id: true, externalStoreCode: true, status: true } }),
    ]);
    const records = mapWuuxiangUsers(employees, accessUsers, stores);
    const activeRecords = records.filter((record) => record.status);
    const disabledRecords = records.filter((record) => !record.status);
    const snapshotIds = records.map((record) => record.externalUserId);
    const syncedAt = new Date();
    const actorId = actorUserId == null ? null : BigInt(actorUserId);
    let created = 0, updated = 0, deactivated = 0;
    const warnings: string[] = [];

    await this.db.$transaction(async (tx) => {
      for (const record of activeRecords) {
        const matches = await tx.user.findMany({
          where: { OR: [
            { externalUserId: record.externalUserId },
            { externalUserCode: record.externalUserCode },
            ...(record.mobile ? [{ mobile: record.mobile }] : []),
          ] },
          include: { stores: true },
        });
        let existing;
        let preserveExistingMobile = false;
        try {
          const match = resolvePosUserSyncMatch(record, matches);
          existing = match.existing;
          preserveExistingMobile = match.preserveExistingMobile;
        }
        catch (error) {
          if (error instanceof Error) throw new ConflictException(error.message);
          throw error;
        }
        if (preserveExistingMobile) {
          warnings.push(`POS 员工编号 ${record.externalUserCode} 的手机号已被另一账号使用；已按 POS 员工编号同步，保留原账号手机号。`);
        }
        const syncedMobile = preserveExistingMobile ? existing!.mobile : record.mobile;
        const before = existing ? {
          name: existing.name,
          mobile: existing.mobile,
          role: existing.role,
          status: existing.status,
          source: existing.source,
          externalUserId: existing.externalUserId,
          externalUserCode: existing.externalUserCode,
          localRoleOverride: existing.localRoleOverride,
          storeIds: existing.stores.map((item) => Number(item.storeId)),
        } : null;
        const saved = existing
          ? await tx.user.update({ where: { id: existing.id }, data: {
              name: record.name,
              mobile: syncedMobile,
              ...(existing.localRoleOverride ? {} : { role: record.role }),
              status: true,
              source: UserSource.POS,
              externalUserId: record.externalUserId,
              externalUserCode: record.externalUserCode,
              externalDutyName: record.dutyName,
              lastSyncedAt: syncedAt,
            } })
          : await tx.user.create({ data: {
              name: record.name,
              mobile: syncedMobile,
              role: record.role,
              status: true,
              source: UserSource.POS,
              externalUserId: record.externalUserId,
              externalUserCode: record.externalUserCode,
              externalDutyName: record.dutyName,
              lastSyncedAt: syncedAt,
            } });
        // POS may refresh identity and enabled state, but a locally managed
        // account keeps its single authoritative role/store scope in UserStore.
        if (!saved.localRoleOverride) {
          await tx.userStore.deleteMany({ where: { userId: saved.id } });
          if (record.storeIds.length) {
            await tx.userStore.createMany({ data: record.storeIds.map((storeId) => ({ userId: saved.id, storeId })) });
          }
        }
        const effectiveStoreIds = saved.localRoleOverride
          ? (existing?.stores.map((item) => item.storeId) ?? [])
          : record.storeIds;
        await tx.auditLog.create({ data: {
          userId: actorId,
          entityType: 'USER',
          entityId: saved.id,
          action: existing ? 'SYNC_FROM_POS' : 'CREATE_FROM_POS',
          ...(before && { beforeData: before }),
          afterData: {
            name: record.name,
            mobile: saved.mobile,
            role: saved.role,
            localRoleOverride: saved.localRoleOverride,
            status: true,
            source: UserSource.POS,
            externalUserId: record.externalUserId,
            externalUserCode: record.externalUserCode,
            storeIds: effectiveStoreIds.map(Number),
          },
        } });
        existing ? updated++ : created++;
      }

      const disabled = disabledRecords.length ? await tx.user.findMany({
        where: {
          source: UserSource.POS,
          status: true,
          OR: [
            { externalUserId: { in: disabledRecords.map((record) => record.externalUserId) } },
            { externalUserCode: { in: disabledRecords.map((record) => record.externalUserCode) } },
          ],
        },
        include: { stores: true },
      }) : [];
      for (const user of disabled) {
        await tx.user.update({ where: { id: user.id }, data: { status: false, lastSyncedAt: syncedAt } });
        await tx.userStore.deleteMany({ where: { userId: user.id } });
        await tx.auditLog.create({ data: {
          userId: actorId,
          entityType: 'USER',
          entityId: user.id,
          action: 'DEACTIVATE_DISABLED_IN_POS',
          beforeData: { status: user.status, storeIds: user.stores.map((item) => Number(item.storeId)) },
          afterData: { status: false, storeIds: [] },
          reason: 'User is disabled in the POS employee access snapshot',
        } });
      }
      const removed = await tx.user.findMany({
        where: { source: UserSource.POS, status: true, externalUserId: { notIn: snapshotIds } },
        include: { stores: true },
      });
      for (const user of removed) {
        await tx.user.update({ where: { id: user.id }, data: { status: false, lastSyncedAt: syncedAt } });
        await tx.userStore.deleteMany({ where: { userId: user.id } });
        await tx.auditLog.create({ data: {
          userId: actorId,
          entityType: 'USER',
          entityId: user.id,
          action: 'DEACTIVATE_MISSING_FROM_POS',
          beforeData: { status: user.status, storeIds: user.stores.map((item) => Number(item.storeId)) },
          afterData: { status: false, storeIds: [] },
          reason: 'User was absent from a complete POS employee access snapshot',
        } });
      }
      deactivated = disabled.length + removed.length;
    }, { timeout: 60_000 });

    return {
      status: 'SUCCESS',
      received: records.length,
      created,
      updated,
      deactivated,
      active: activeRecords.length,
      syncedAt,
      warnings: [...new Set(warnings)],
    };
  }

  async sync(storeId: number, date: string, finalized = false) {
    const key = `${storeId}:${date}`;
    const previous = this.syncTails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.syncNow(storeId, date, finalized));
    this.syncTails.set(key, current);
    try { return await current; }
    finally { if (this.syncTails.get(key) === current) this.syncTails.delete(key); }
  }

  private async syncNow(storeId: number, date: string, finalized: boolean) {
    if (process.env.REPORT_SOURCE !== 'database') throw new BadRequestException('Sync requires REPORT_SOURCE=database');
    const businessDate = toDate(date);
    const storeKey = BigInt(storeId);
    const log = await this.db.apiSyncLog.create({ data: {
      storeId: storeKey, businessDate, apiType: 'PRODUCTS', status: 'RUNNING',
      requestPayload: JSON.stringify({ storeId, date }),
    } });
    try {
      const store = await this.db.store.findUnique({ where: { id: storeKey } });
      if (!store) throw new BadRequestException('Store does not exist');
      if (!store.externalStoreCode) throw new BadRequestException('Store has no POS code mapping');
      await this.db.apiSyncLog.update({ where: { id: log.id }, data: {
        requestPayload: JSON.stringify({ storeCode: store.externalStoreCode, date }),
      } });
      const state = await this.db.dailyReportState.findUnique({ where: { storeId_businessDate: { storeId: store.id, businessDate } } });
      if (state?.status === 'LOCKED') throw new BadRequestException('Report is locked');
      const configuredPeriods = await this.db.businessPeriod.findMany({ where: { status: true }, orderBy: { sortOrder: 'asc' } });
      const data = await this.adapter.fetchDaily(store.externalStoreCode, date, configuredPeriods.map((p) => ({
        code: p.periodCode, name: p.periodName, startTime: p.startTime, endTime: p.endTime, externalShiftId: p.externalShiftId,
      })));
      if (!data.sales) throw new Error('POS sales data missing');
      const missingCodes: string[] = [];
      let resolved = await Promise.all(data.products.map(async (item) => {
        const code = item.externalProductCode;
        const product = await this.db.product.findUnique({ where: { externalProductCode: code } });
        if (!product) missingCodes.push(code);
        return { item, product };
      }));
      if (missingCodes.length && this.posClient) {
        await this.refreshMissingProducts(store.externalStoreCode, missingCodes);
        const remainingMissing: string[] = [];
        resolved = await Promise.all(data.products.map(async (item) => {
          const product = await this.db.product.findUnique({ where: { externalProductCode: item.externalProductCode } });
          if (!product) remainingMissing.push(item.externalProductCode);
          return { item, product };
        }));
        if (remainingMissing.length)
          throw new Error(`POS 销售菜品尚未同步到本地目录：${remainingMissing.join('、')}。请检查该菜品在 POS 的编码和分类后重试`);
      } else if (missingCodes.length) {
        throw new Error(`POS 销售菜品未关联到本地目录：${missingCodes.join('、')}`);
      }
      const syncedAt = new Date();
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
          status: 'SUCCESS',
          // Keep operational metadata only. The full POS response is already
          // normalized into report tables and is not consumed by the log UI.
          responsePayload: JSON.stringify({ productCount: data.products.length,
            periodCount: data.periods.length, platformCount: data.platforms.length }),
          finishedAt: syncedAt,
        } });
      });
      return { status: 'SUCCESS', finalized, productCount: data.products.length, syncedAt: syncedAt.toISOString() };
    } catch (error) {
      await this.db.apiSyncLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
      throw error;
    }
  }

  @Cron('*/5 * * * *', { timeZone: 'Asia/Shanghai' })
  async retrySubmittedInputs() {
    if (this.retryingSubmittedInputs || process.env.SYNC_ENABLED !== 'true' ||
      process.env.REPORT_SOURCE !== 'database') return;
    this.retryingSubmittedInputs = true;
    try {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const pending = await this.db.storeDailyInput.findMany({ where: {
        status: 'SUBMITTED',
        businessDate: { gte: new Date(cutoff.toISOString().slice(0, 10) + 'T00:00:00.000Z') },
        submittedAt: { not: null },
      }, orderBy: { submittedAt: 'asc' }, take: 100, select: {
        storeId: true, businessDate: true, submittedAt: true,
      } });
      for (const input of pending) {
        const logs = await this.db.apiSyncLog.findMany({ where: {
          storeId: input.storeId, businessDate: input.businessDate, apiType: 'PRODUCTS',
          startedAt: { gte: input.submittedAt! },
        }, orderBy: { startedAt: 'desc' }, take: 6, select: { status: true, startedAt: true } });
        const latest = logs[0];
        if (latest?.status === 'SUCCESS' || logs.length >= 6) continue;
        const ageMs = latest ? Date.now() - latest.startedAt.getTime() : Number.POSITIVE_INFINITY;
        if (latest?.status === 'RUNNING' && ageMs < 10 * 60_000) continue;
        if (latest?.status === 'FAILED' && ageMs < 5 * 60_000) continue;
        try {
          await this.sync(Number(input.storeId), input.businessDate.toISOString().slice(0, 10));
        } catch (error) {
          console.warn('Submitted report POS sync retry failed', Number(input.storeId),
            input.businessDate.toISOString().slice(0, 10), error instanceof Error ? error.message : String(error));
        }
      }
    } finally { this.retryingSubmittedInputs = false; }
  }

  @Cron('0 15 3 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanupExpiredSyncPayloads() {
    if (process.env.REPORT_SOURCE !== 'database') return;
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const cleared = await this.db.$executeRaw`
      UPDATE api_sync_logs
      SET response_payload = NULL
      WHERE started_at < ${cutoff}
        AND response_payload IS NOT NULL
        AND OCTET_LENGTH(response_payload) > 65536
      ORDER BY id ASC
      LIMIT 50
    `;
    if (cleared > 0)
      console.info(`Cleared ${cleared} oversized expired POS sync payload(s); retained sync status and error metadata.`);
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
    try {
      await this.syncMasterData();
      await this.syncUsers();
    } catch (error) {
      console.error('Daily master data sync failed', error);
      try { await this.recordBackgroundFailure('POS_MASTER_SYNC', '/daily-master-data', error); }
      catch (writeError) { console.error('Could not save POS master sync alert', writeError); }
    }
  }

  private async recordBackgroundFailure(source: string, route: string, error: unknown) {
    const message = cleanAlertMessage(error instanceof Error ? error.message : error);
    const diagnosis = diagnoseAlert(message);
    const fingerprint = alertFingerprint(source, route, message);
    await this.db.systemAlert.upsert({
      where: { fingerprint },
      create: { fingerprint, source, severity: 'ERROR', status: 'OPEN', title: diagnosis.title,
        message, route, suggestion: diagnosis.suggestion },
      update: { lastSeenAt: new Date(), occurrenceCount: { increment: 1 }, status: 'OPEN', suggestion: diagnosis.suggestion },
    });
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
  @Post('users') users(@Req() request: RequestWithUser) {
    return this.syncService.syncUsers(authUser(request)?.id ?? null);
  }
  @Post(':storeId/:date') run(@Param('storeId', ParseIntPipe) storeId: number, @Param('date') date: string) {
    return this.syncService.sync(storeId, date);
  }
  @Get('logs') async logs(@Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    return (await this.db.apiSyncLog.findMany({ where: { storeId: BigInt(storeId), businessDate: toDate(date) }, orderBy: { startedAt: 'desc' } })).map((x) => ({
      id: Number(x.id), apiType: x.apiType, status: x.status, errorMessage: x.errorMessage, startedAt: x.startedAt, finishedAt: x.finishedAt,
    }));
  }
}
