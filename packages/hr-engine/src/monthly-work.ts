export type MonthlyWorkPart = {
  employeeId: number;
  storeId: number;
  businessDate: string;
  rawMinutes: number;
  recordId: number;
  recordVersion: number;
};

export type MonthlyWorkRow = {
  employeeId: number;
  businessDate: string;
  storeRawMinutes: number;
  organizationRawMinutes: number;
  statisticalMinutes: number | null;
  discardedMinutes: number | null;
  recordRefs: { recordId: number; version: number }[];
};

export function buildStoreMonthlyWorkSnapshot(storeId: number, month: string,
  parts: readonly MonthlyWorkPart[]) {
  if (!Number.isSafeInteger(storeId) || storeId <= 0 || !/^\d{4}-\d{2}$/.test(month))
    throw new RangeError('Invalid store or month');
  const grouped = new Map<string, MonthlyWorkPart[]>();
  for (const part of parts) {
    if (!Number.isSafeInteger(part.employeeId) || part.employeeId <= 0 ||
      !Number.isSafeInteger(part.storeId) || part.storeId <= 0 ||
      !Number.isSafeInteger(part.rawMinutes) || part.rawMinutes < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(part.businessDate) ||
      !Number.isSafeInteger(part.recordId) || part.recordId <= 0 ||
      !Number.isSafeInteger(part.recordVersion) || part.recordVersion <= 0)
      throw new RangeError('Invalid monthly work source');
    if (!part.businessDate.startsWith(`${month}-`)) continue;
    const key = `${part.employeeId}:${part.businessDate}`;
    grouped.set(key, [...grouped.get(key) ?? [], part]);
  }
  const rows: MonthlyWorkRow[] = [];
  const unresolvedCrossStoreDays: { employeeId: number; businessDate: string }[] = [];
  for (const entries of grouped.values()) {
    const own = entries.filter((entry) => entry.storeId === storeId);
    if (!own.length) continue;
    const summary = calculateDailyWorkTime(entries);
    const crossStore = new Set(entries.map((entry) => entry.storeId)).size > 1;
    if (crossStore) unresolvedCrossStoreDays.push({ employeeId: entries[0].employeeId,
      businessDate: entries[0].businessDate });
    rows.push({ employeeId: entries[0].employeeId, businessDate: entries[0].businessDate,
      storeRawMinutes: own.reduce((sum, entry) => sum + entry.rawMinutes, 0),
      organizationRawMinutes: summary.rawMinutes,
      statisticalMinutes: crossStore ? null : summary.statisticalMinutes,
      discardedMinutes: crossStore ? null : summary.discardedMinutes,
      recordRefs: own.map((entry) => ({ recordId: entry.recordId, version: entry.recordVersion })),
    });
  }
  rows.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.employeeId - b.employeeId);
  return { storeId, month, ruleCode: 'SHIFT_30_MIN_FLOOR_V2' as const, rows,
    unresolvedCrossStoreDays,
    totalRawMinutes: rows.reduce((sum, row) => sum + row.storeRawMinutes, 0),
    totalStatisticalMinutes: unresolvedCrossStoreDays.length ? null :
      rows.reduce((sum, row) => sum + (row.statisticalMinutes ?? 0), 0) };
}
import { calculateDailyWorkTime } from './daily-work';

