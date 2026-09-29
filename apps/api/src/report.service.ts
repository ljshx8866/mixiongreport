import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { calculateDailyReport, ReportSource } from '@restaurant/report-engine';
import { mockReportSource } from './mock-data';

export const toDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error('Invalid date; expected YYYY-MM-DD');
  return parsed;
};
const num = (value: { toNumber(): number } | number | null | undefined) => value == null ? null : typeof value === 'number' ? value : value.toNumber();

@Injectable()
export class DailyReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyReport(storeId: number, date: string) {
    const source = process.env.REPORT_SOURCE === 'database'
      ? await this.databaseSource(storeId, date)
      : this.mockSource(storeId, date);
    return calculateDailyReport(source);
  }

  private mockSource(storeId: number, date: string): ReportSource {
    if (storeId !== 1 || date !== '2026-09-27') throw new NotFoundException('Mock data exists only for store 1 on 2026-09-27');
    return mockReportSource;
  }

  private async databaseSource(storeId: number, date: string): Promise<ReportSource> {
    const businessDate = toDate(date);
    const [store, sales, periods, periodConfigs, platforms, products, manual, state, powerConfig, productSync] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: BigInt(storeId) } }),
      this.prisma.dailySale.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } }),
      this.prisma.salesPeriod.findMany({ where: { storeId: BigInt(storeId), businessDate } }),
      this.prisma.businessPeriod.findMany({ where: { status: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.groupBuySale.findMany({ where: { storeId: BigInt(storeId), businessDate }, orderBy: { platformCode: 'asc' } }),
      this.prisma.productDailySale.findMany({ where: { storeId: BigInt(storeId), businessDate }, include: { product: true, category: true } }),
      this.prisma.storeDailyInput.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } }),
      this.prisma.dailyReportState.findUnique({ where: { storeId_businessDate: { storeId: BigInt(storeId), businessDate } } }),
      this.prisma.powerCalculationConfig.findFirst({ where: { OR: [{ storeId: BigInt(storeId) }, { storeId: null }] }, orderBy: { storeId: 'desc' } }),
      this.prisma.apiSyncLog.findFirst({ where: { storeId: BigInt(storeId), businessDate, apiType: 'PRODUCTS', status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' } }),
    ]);
    if (!store) throw new NotFoundException('Store not found');
    return {
      store: { id: Number(store.id), name: store.storeName, brandName: store.brandName }, date,
      sales: sales && {
        total: { amount: num(sales.totalSales)!, customers: sales.totalCustomerCount },
        dineIn: { amount: num(sales.dineInSales)!, customers: sales.dineInCustomerCount },
        delivery: { amount: num(sales.deliverySales)!, customers: sales.deliveryOrderCount },
      },
      periods: periods.sort((a, b) => {
        const order = (code: string) => periodConfigs.findIndex((config) => config.periodCode === code);
        const aOrder = order(a.periodCode);
        const bOrder = order(b.periodCode);
        return (aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder) - (bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder);
      }).map((p) => ({ code: p.periodCode, name: p.periodName, amount: num(p.salesAmount)!, customers: p.customerCount })),
      platforms: platforms.map((p) => ({ code: p.platformCode, name: p.platformName, amount: num(p.salesAmount)!, customers: p.customerCount })),
      products: products.map((p) => ({ productId: Number(p.productId), productName: p.product.productName, categoryId: Number(p.categoryId), categoryName: p.category.categoryName, categoryOrder: p.category.sortOrder, quantity: num(p.quantity)!, salesAmount: num(p.salesAmount)! })),
      manual: manual && {
        kitchenPower: num(manual.kitchenPower), diningPower: num(manual.diningPower), fullDayPower: num(manual.fullDayPower),
        airConditionPower: num(manual.airConditionPower), totalPower: num(manual.totalPower), waterUsage: num(manual.waterUsage),
        laborHours: num(manual.laborHours), addonCustomers: manual.addonCustomerCount, comboCustomers: manual.comboCustomerCount,
        status: manual.status,
      },
      powerMode: powerConfig?.mode ?? 'SUM_COMPONENTS', reportStatus: state?.status ?? 'OPEN',
      apiDataReady: !!sales, productDataReady: !!productSync,
    };
  }
}
