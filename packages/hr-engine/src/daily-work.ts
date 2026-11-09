export const SHIFT_30_MIN_FLOOR_RULE = 'SHIFT_30_MIN_FLOOR_V2' as const;
export const DAILY_30_MIN_FLOOR_RULE = SHIFT_30_MIN_FLOOR_RULE;

export type ConfirmedWorkSegment = { rawMinutes: number };

export type DailyWorkTimeSummary = {
  ruleCode: typeof SHIFT_30_MIN_FLOOR_RULE;
  rawMinutes: number;
  statisticalMinutes: number;
  discardedMinutes: number;
  statisticalHours: number;
};

export function calculateDailyWorkTime(segments: readonly ConfirmedWorkSegment[]): DailyWorkTimeSummary {
  let rawMinutes = 0;
  let statisticalMinutes = 0;
  for (const segment of segments) {
    if (!Number.isSafeInteger(segment.rawMinutes) || segment.rawMinutes < 0)
      throw new RangeError('Confirmed raw minutes must be non-negative safe integers');
    rawMinutes += segment.rawMinutes;
    if (!Number.isSafeInteger(rawMinutes)) throw new RangeError('Daily raw minutes exceed safe integer range');
    statisticalMinutes += Math.floor(segment.rawMinutes / 30) * 30;
    if (!Number.isSafeInteger(statisticalMinutes)) throw new RangeError('Daily statistical minutes exceed safe integer range');
  }
  return {
    ruleCode: SHIFT_30_MIN_FLOOR_RULE,
    rawMinutes,
    statisticalMinutes,
    discardedMinutes: rawMinutes - statisticalMinutes,
    statisticalHours: statisticalMinutes / 60,
  };
}
