/** Approved business formula. The caller must supply one employee's resolved
 * daily 30-minute statistical total and the hourly rate effective that day.
 * This result excludes overtime, statutory pay, allowances and deductions.
 */
export function calculateDailyHourlyPay(statisticalMinutes: number, hourlyRate: string) {
  if (!Number.isSafeInteger(statisticalMinutes) || statisticalMinutes < 0 || statisticalMinutes % 30 !== 0)
    throw new RangeError('Statistical minutes must be a nonnegative multiple of 30');
  if (!/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(hourlyRate))
    throw new RangeError('Hourly rate must have at most two decimal places');
  const [whole, fraction = ''] = hourlyRate.split('.');
  const hourlyCents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hourlyCents <= 0n) throw new RangeError('Hourly rate must be positive');
  const numerator = hourlyCents * BigInt(statisticalMinutes);
  const dailyCents = (numerator + 30n) / 60n;
  return { hourlyRate, statisticalMinutes,
    amount: `${dailyCents / 100n}.${String(dailyCents % 100n).padStart(2, '0')}` };
}

export function sumDailyHourlyPay(amounts: readonly string[]): string {
  const cents = amounts.reduce((sum, amount) => {
    if (!/^(0|[1-9]\d*)(?:\.\d{2})$/.test(amount)) throw new RangeError('Invalid daily amount');
    const [whole, fraction] = amount.split('.');
    return sum + BigInt(whole) * 100n + BigInt(fraction);
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
