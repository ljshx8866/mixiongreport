export type TimedBreak = { startEpochMinutes: number; endEpochMinutes: number };
export type SplitWorkInterval = {
  startEpochMinutes: number;
  endEpochMinutes: number;
  breaks: readonly TimedBreak[];
};
export type NaturalDayWorkSegment = {
  businessDate: string;
  elapsedMinutes: number;
  breakMinutes: number;
  rawMinutes: number;
};

// Asia/Shanghai has UTC+08:00 for the current operating period. Historical
// DST-era records must be handled by a timezone-aware migration, not this path.
const SHANGHAI_OFFSET_MINUTES = 8 * 60;
const MINUTES_PER_DAY = 24 * 60;

function checkedMinute(value: number) {
  if (!Number.isSafeInteger(value)) throw new RangeError('Work times must be integer epoch minutes');
}

function dateAtShanghaiMinute(epochMinutes: number): string {
  return new Date((epochMinutes + SHANGHAI_OFFSET_MINUTES) * 60000).toISOString().slice(0, 10);
}

export function splitWorkIntervalByShanghaiDay(input: SplitWorkInterval): NaturalDayWorkSegment[] {
  const { startEpochMinutes, endEpochMinutes } = input;
  checkedMinute(startEpochMinutes); checkedMinute(endEpochMinutes);
  if (endEpochMinutes <= startEpochMinutes || endEpochMinutes - startEpochMinutes > MINUTES_PER_DAY * 2)
    throw new RangeError('Work interval must be positive and at most 48 hours');
  const breaks = [...input.breaks].sort((a, b) => a.startEpochMinutes - b.startEpochMinutes);
  for (const [index, item] of breaks.entries()) {
    checkedMinute(item.startEpochMinutes); checkedMinute(item.endEpochMinutes);
    if (item.startEpochMinutes < startEpochMinutes || item.endEpochMinutes > endEpochMinutes ||
      item.endEpochMinutes <= item.startEpochMinutes ||
      (index > 0 && item.startEpochMinutes < breaks[index - 1].endEpochMinutes))
      throw new RangeError('Break intervals must be non-overlapping and inside work time');
  }

  const result: NaturalDayWorkSegment[] = [];
  for (let cursor = startEpochMinutes; cursor < endEpochMinutes;) {
    const nextLocalMidnight = (Math.floor((cursor + SHANGHAI_OFFSET_MINUTES) / MINUTES_PER_DAY) + 1)
      * MINUTES_PER_DAY - SHANGHAI_OFFSET_MINUTES;
    const partEnd = Math.min(endEpochMinutes, nextLocalMidnight);
    const breakMinutes = breaks.reduce((total, item) =>
      total + Math.max(0, Math.min(partEnd, item.endEpochMinutes) - Math.max(cursor, item.startEpochMinutes)), 0);
    const elapsedMinutes = partEnd - cursor;
    result.push({ businessDate: dateAtShanghaiMinute(cursor), elapsedMinutes,
      breakMinutes, rawMinutes: elapsedMinutes - breakMinutes });
    cursor = partEnd;
  }
  return result;
}
