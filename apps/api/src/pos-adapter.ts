import { RawPeriod, RawPlatform, SaleLine } from '@restaurant/report-engine';
import { WuuxiangBill, WuuxiangClient, WuuxiangTicket } from './wuuxiang.client';

export type PeriodConfig = { code: string; name: string; startTime: string; endTime: string; externalShiftId: string | null };
export type PosProductSale = { externalProductCode: string; quantity: number; salesAmount: number };
export type PosDailyPayload = {
  sales: { total: SaleLine; dineIn: SaleLine; delivery: SaleLine };
  periods: RawPeriod[];
  platforms: RawPlatform[];
  products: PosProductSale[];
  rawResponse?: string;
};

export interface PosAdapter {
  fetchDaily(storeCode: string, date: string, periods: PeriodConfig[]): Promise<PosDailyPayload>;
}

const cents = (n: unknown) => Math.round(Number(n || 0) * 100);
const amount = (n: number) => n / 100;
const timeMatches = (time: string, p: PeriodConfig) => p.startTime <= p.endTime
  ? time >= p.startTime && time <= p.endTime
  : time >= p.startTime || time <= p.endTime;

// Round once at the day level, then assign any fractional remainder to the
// largest fractional parts so channel and period counts still sum to the day.
function roundedParts(values: number[]): number[] {
  const parts = values.map((value) => Math.floor(value));
  let remainder = Math.round(values.reduce((sum, value) => sum + value, 0)) - parts.reduce((sum, value) => sum + value, 0);
  const order = values.map((value, index) => ({ index, fraction: value - parts[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index]++;
    remainder--;
  }
  return parts;
}

export function mapWuuxiangDaily(
  bills: WuuxiangBill[], tickets: WuuxiangTicket[], date: string, periodConfigs: PeriodConfig[], bowlRevenueTypeId: string,
  excludedCustomerPayways: readonly string[] = ['员工餐'],
): PosDailyPayload {
  if (!periodConfigs.length) throw new Error('No business periods configured');
  if (!bowlRevenueTypeId) throw new Error('Bowl revenue type is not configured');
  const excludedPayways = new Set(excludedCustomerPayways.map((name) => name.trim()).filter(Boolean));
  const valid = bills.filter((b) => String(b.state) === '1' && Number(b.delflg) === 0);
  const saleCents = { dineIn: 0, delivery: 0 };
  const rawCounts = { dineIn: 0, delivery: 0 };
  const periodMap = new Map(periodConfigs.map((p) => [p.code, { config: p, cents: 0, rawCustomers: 0 }]));
  const productMap = new Map<string, { quantity: number; cents: number }>();
  for (const bill of valid) {
    const saleType = String(bill.sale_type_name || '');
    const channel = saleType === '堂食' || saleType === '外带' ? 'dineIn'
      : saleType === '外卖' || saleType === '自提' ? 'delivery' : null;
    if (!channel) throw new Error(`Unmapped POS sale type: ${saleType}`);
    const excludeFromCustomerCount = (bill.settleDetail ?? []).some((detail) =>
      Number(detail.delflg ?? 0) === 0 && excludedPayways.has(String(detail.payway_name).trim()),
    );
    const billCents = cents(bill.income_total);
    saleCents[channel] += billCents;
    const shiftId = String(bill.settle_shift_id ?? '');
    const hasShiftMapping = periodConfigs.some((p) => p.externalShiftId);
    const period = hasShiftMapping
      ? periodConfigs.find((p) => p.externalShiftId === shiftId)
      : periodConfigs.find((p) => timeMatches(String(bill.settle_time).slice(11, 16), p));
    if (!period) throw new Error(`No business period for POS shift ${shiftId}`);
    const aggregate = periodMap.get(period.code)!;
    aggregate.cents += billCents;
    for (const item of bill.item ?? []) {
      if (Number(item.delflg) !== 0 || item.pkg_flg_name === '套餐') continue;
      const code = String(item.item_id);
      if (!code) throw new Error('POS item is missing item_id');
      if (item.sales_revenue_type_id == null) throw new Error(`POS item ${code} is missing sales_revenue_type_id`);
      if (!excludeFromCustomerCount && String(item.sales_revenue_type_id) === bowlRevenueTypeId) {
        const quantity = Number(item.last_qty || 0);
        if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid bowl quantity for POS item ${code}`);
        const bowls = item.item_name.includes('半份') ? quantity * 0.5 : quantity;
        rawCounts[channel] += bowls;
        aggregate.rawCustomers += bowls;
      }
      const product = productMap.get(code) ?? { quantity: 0, cents: 0 };
      product.quantity += Number(item.last_qty || 0);
      product.cents += cents(item.last_total);
      productMap.set(code, product);
    }
  }
  const platformMap = new Map<string, { name: string; cents: number; customers: number }>();
  const seenTickets = new Set<string>();
  for (const ticket of tickets) {
    if (ticket.settleBizDate !== date || ticket.ticketState !== '已核销' || ticket.billState !== '已结算') continue;
    const uniqueKey = `${ticket.pwDetailId ?? ticket.pwDetailld ?? ''}:${ticket.ticketCode ?? ''}`;
    if (seenTickets.has(uniqueKey)) continue;
    seenTickets.add(uniqueKey);
    const platformCode = String(ticket.bizType) === '3' ? 'DOUYIN'
      : String(ticket.bizType) === '1' ? 'MEITUAN'
        : String(ticket.bizType) === '9' ? 'AMAP' : 'OTHER';
    const name = platformCode === 'DOUYIN' ? '抖音' : platformCode === 'MEITUAN' ? '美团点评'
      : platformCode === 'AMAP' ? '高德团购' : '其他';
    const platform = platformMap.get(platformCode) ?? { name, cents: 0, customers: 0 };
    platform.cents += cents(ticket.incomeMoney);
    platform.customers += Number(ticket.ticketCount || 0);
    platformMap.set(platformCode, platform);
  }
  const [dineInCustomers, deliveryCustomers] = roundedParts([rawCounts.dineIn, rawCounts.delivery]);
  const periodValues = [...periodMap.values()];
  const periodCustomers = roundedParts(periodValues.map((value) => value.rawCustomers));
  const periods = periodValues.map(({ config, cents: value }, index) => ({ code: config.code, name: config.name, amount: amount(value), customers: periodCustomers[index] }));
  const platforms = [...platformMap.entries()].map(([code, value]) => ({ code, name: value.name, amount: amount(value.cents), customers: value.customers }));
  const products = [...productMap.entries()].map(([externalProductCode, p]) => ({ externalProductCode, quantity: p.quantity, salesAmount: amount(p.cents) }));
  return {
    sales: {
      total: { amount: amount(saleCents.dineIn + saleCents.delivery), customers: dineInCustomers + deliveryCustomers },
      dineIn: { amount: amount(saleCents.dineIn), customers: dineInCustomers },
      delivery: { amount: amount(saleCents.delivery), customers: deliveryCustomers },
    }, periods, platforms, products,
  };
}

export class WuuxiangPosAdapter implements PosAdapter {
  constructor(
    private readonly client: WuuxiangClient,
    private readonly bowlRevenueTypeId: string,
    private readonly excludedCustomerPayways: readonly string[],
  ) {}

  async fetchDaily(storeCode: string, date: string, periods: PeriodConfig[]): Promise<PosDailyPayload> {
    const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    const [bills, tickets] = await Promise.all([
      this.client.bills(storeCode, date, true),
      this.client.tickets(storeCode, `${date} 00:00:00`, `${next} 23:59:59`),
    ]);
    const mapped = mapWuuxiangDaily(bills, tickets, date, periods, this.bowlRevenueTypeId, this.excludedCustomerPayways);
    return { ...mapped, rawResponse: JSON.stringify({ bills, tickets }) };
  }
}
