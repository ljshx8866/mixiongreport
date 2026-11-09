import { calculateDailyHourlyPay, sumDailyHourlyPay } from '@restaurant/hr-engine';

export type ConfirmedWorkDay = {
  date: string;
  statisticalMinutes: number;
  confirmedShifts: number;
};

export type EffectiveHourlyRate = {
  effectiveFrom: Date;
  effectiveToExclusive: Date | null;
  hourlyRate: { toFixed(fractionDigits?: number): string };
};

export type PaidWorkDay<T extends ConfirmedWorkDay> = T & {
  basePayAmount: string | null;
  payStatus: 'CALCULATED' | 'WAITING_FOR_CONFIRMATION' | 'MISSING_RATE';
};

export function calculateConfirmedWorkPay<T extends ConfirmedWorkDay>(
  days: readonly T[], rates: readonly EffectiveHourlyRate[],
) {
  const paidDays: PaidWorkDay<T>[] = days.map((day) => {
    if (day.confirmedShifts <= 0) return { ...day, basePayAmount: null,
      payStatus: 'WAITING_FOR_CONFIRMATION' };
    const effectiveRates = rates.filter((rate) => rate.effectiveFrom.toISOString().slice(0, 10) <= day.date &&
      (rate.effectiveToExclusive == null || rate.effectiveToExclusive.toISOString().slice(0, 10) > day.date));
    if (effectiveRates.length !== 1) return { ...day, basePayAmount: null, payStatus: 'MISSING_RATE' };
    const hourlyRate = effectiveRates[0].hourlyRate.toFixed(2);
    return { ...day, basePayAmount: calculateDailyHourlyPay(day.statisticalMinutes, hourlyRate).amount,
      payStatus: 'CALCULATED' };
  });
  const confirmedDays = paidDays.filter((day) => day.confirmedShifts > 0);
  const complete = confirmedDays.length > 0 && confirmedDays.every((day) => day.basePayAmount != null);
  return {
    days: paidDays,
    totalBasePayAmount: complete
      ? sumDailyHourlyPay(confirmedDays.map((day) => day.basePayAmount!)) : null,
    payStatus: confirmedDays.length === 0 ? 'WAITING_FOR_CONFIRMATION' as const
      : complete ? 'CALCULATED' as const : 'MISSING_RATE' as const,
  };
}
