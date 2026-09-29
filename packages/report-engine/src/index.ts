export type MaybeNumber = number | null;
export type SaleLine = { amount: number; customers: number };
export type RawPeriod = SaleLine & { code: string; name: string };
export type RawPlatform = SaleLine & { code: string; name: string };
export type RawProduct = {
  productId: number;
  productName: string;
  categoryId: number;
  categoryName: string;
  categoryOrder: number;
  quantity: number;
  salesAmount: number;
};
export type ManualInput = {
  kitchenPower: MaybeNumber;
  diningPower: MaybeNumber;
  fullDayPower: MaybeNumber;
  airConditionPower: MaybeNumber;
  totalPower: MaybeNumber;
  waterUsage: MaybeNumber;
  laborHours: MaybeNumber;
  addonCustomers: MaybeNumber;
  comboCustomers: MaybeNumber;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
};
export type ReportSource = {
  store: { id: number; name: string; brandName: string };
  date: string;
  sales: { total: SaleLine; dineIn: SaleLine; delivery: SaleLine } | null;
  periods: RawPeriod[];
  platforms: RawPlatform[];
  products: RawProduct[];
  manual: ManualInput | null;
  powerMode: 'SUM_COMPONENTS' | 'MANUAL_TOTAL';
  reportStatus: 'OPEN' | 'SUBMITTED' | 'VERIFIED' | 'LOCKED';
  apiDataReady: boolean;
  productDataReady: boolean;
};

export const round = (value: number, digits = 2): number =>
  Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;

export const safeDivide = (numerator: MaybeNumber, denominator: MaybeNumber, digits = 2): MaybeNumber =>
  numerator === null || denominator === null || denominator === 0 ? null : round(numerator / denominator, digits);

const moneyCents = (value: number): number => Math.round(value * 100);
const sumMoney = (values: number[]): number => values.reduce((sum, n) => sum + moneyCents(n), 0) / 100;
const sumNumbers = (values: number[]): number => round(values.reduce((sum, n) => sum + n, 0));
const line = (value: SaleLine, total: number) => ({
  amount: value.amount,
  customers: value.customers,
  avgOrderValue: safeDivide(value.amount, value.customers),
  ratio: safeDivide(value.amount, total, 4),
});

export function calculateDailyReport(source: ReportSource) {
  const sales = source.sales;
  const total = sales?.total.amount ?? null;
  const manual = source.manual;
  const powerFields = manual && [manual.kitchenPower, manual.diningPower, manual.fullDayPower, manual.airConditionPower];
  const totalPower = source.powerMode === 'MANUAL_TOTAL'
    ? manual?.totalPower ?? null
    : powerFields?.every((n) => n !== null)
      ? sumNumbers(powerFields as number[])
      : null;
  const groupAmount = sumMoney(source.platforms.map((p) => p.amount));
  const groupCustomers = source.platforms.reduce((sum, p) => sum + p.customers, 0);
  const grouped = new Map<number, { categoryId: number; categoryName: string; order: number; items: RawProduct[] }>();
  for (const product of source.products) {
    if (!grouped.has(product.categoryId)) grouped.set(product.categoryId, {
      categoryId: product.categoryId, categoryName: product.categoryName, order: product.categoryOrder, items: [],
    });
    grouped.get(product.categoryId)!.items.push(product);
  }
  const categories = [...grouped.values()].sort((a, b) => a.order - b.order || a.categoryId - b.categoryId);
  const warnings: string[] = [];
  if (sales && Math.abs(moneyCents(sales.total.amount) - moneyCents(sumMoney([sales.dineIn.amount, sales.delivery.amount]))) > 1)
    warnings.push('SALES_CHANNEL_MISMATCH');
  if (sales && source.periods.length && Math.abs(moneyCents(sales.total.amount) - moneyCents(sumMoney(source.periods.map((p) => p.amount)))) > 1)
    warnings.push('PERIOD_SALES_MISMATCH');
  if (sales && sales.total.customers !== sales.dineIn.customers + sales.delivery.customers)
    warnings.push('CUSTOMER_COUNT_MISMATCH');
  const manualInputReady = manual?.status === 'SUBMITTED' || manual?.status === 'LOCKED';
  const status = {
    apiDataReady: source.apiDataReady && !!sales,
    manualInputReady,
    productDataReady: source.productDataReady,
    complete: !!(source.apiDataReady && sales && manualInputReady && source.productDataReady && warnings.length === 0),
    workflow: source.reportStatus,
    warnings,
  };
  return {
    store: source.store,
    date: source.date,
    title: `${source.store.brandName}（${source.store.name}）${source.date.slice(0, 4)}年${Number(source.date.slice(5, 7))}月${Number(source.date.slice(8, 10))}日经营日报`,
    status,
    sales: sales && {
      total: line(sales.total, sales.total.amount),
      dineIn: line(sales.dineIn, sales.total.amount),
      delivery: line(sales.delivery, sales.total.amount),
    },
    periods: source.periods.map((p) => ({ code: p.code, name: p.name, ...line(p, total ?? 0) })),
    groupBuy: {
      total: { ...line({ amount: groupAmount, customers: groupCustomers }, total ?? 0) },
      platforms: source.platforms.map((p) => ({ code: p.code, name: p.name, ...line(p, total ?? 0) })),
    },
    grossMargin: { theoreticalRate: null, totalRate: null, dineInRate: null, deliveryRate: null },
    energy: {
      totalPower,
      kitchenPower: manual?.kitchenPower ?? null,
      diningPower: manual?.diningPower ?? null,
      fullDayPower: manual?.fullDayPower ?? null,
      airConditionPower: manual?.airConditionPower ?? null,
      powerEfficiency: safeDivide(total, totalPower),
      waterUsage: manual?.waterUsage ?? null,
      waterEfficiency: safeDivide(total, manual?.waterUsage ?? null),
    },
    labor: { hours: manual?.laborHours ?? null, salesPerHour: safeDivide(total, manual?.laborHours ?? null) },
    operations: {
      addonCustomers: manual?.addonCustomers ?? null,
      addonPerThousand: safeDivide(manual?.addonCustomers === null || !manual ? null : manual.addonCustomers * 1000, sales?.dineIn.customers ?? null),
      comboCustomers: manual?.comboCustomers ?? null,
      comboPerThousand: safeDivide(manual?.comboCustomers === null || !manual ? null : manual.comboCustomers * 1000, sales?.dineIn.customers ?? null),
    },
    categorySales: categories.map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, quantity: sumNumbers(c.items.map((p) => p.quantity)) })),
    productSales: categories.map((c) => ({
      categoryId: c.categoryId, categoryName: c.categoryName,
      items: [...c.items].sort((a, b) => b.quantity - a.quantity || a.productId - b.productId)
        .map((p, i) => ({ rank: i + 1, productId: p.productId, productName: p.productName, quantity: p.quantity })),
    })),
  };
}
