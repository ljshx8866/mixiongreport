/**
 * Primary store appointments for one employee. Dates are local business dates,
 * with a half-open interval [effectiveFrom, effectiveToExclusive). A missing
 * end means the appointment remains open. Secondary assignments are outside
 * this invariant.
 */
export type PrimaryAppointmentInterval = {
  storeId: string;
  effectiveFrom: string;
  effectiveToExclusive?: string | null;
};

export type AppointmentOverlap = { firstIndex: number; secondIndex: number };

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Appointment date must be YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new RangeError('Invalid appointment date');
}

export function findPrimaryAppointmentOverlaps(
  appointments: readonly PrimaryAppointmentInterval[],
): AppointmentOverlap[] {
  for (const appointment of appointments) {
    if (!appointment.storeId?.trim()) throw new RangeError('Primary appointment requires a store');
    validateDate(appointment.effectiveFrom);
    if (appointment.effectiveToExclusive != null) {
      validateDate(appointment.effectiveToExclusive);
      if (appointment.effectiveToExclusive <= appointment.effectiveFrom)
        throw new RangeError('Appointment end must follow start');
    }
  }

  const overlaps: AppointmentOverlap[] = [];
  for (let firstIndex = 0; firstIndex < appointments.length; firstIndex++) {
    const first = appointments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < appointments.length; secondIndex++) {
      const second = appointments[secondIndex];
      if (
        (second.effectiveToExclusive == null || first.effectiveFrom < second.effectiveToExclusive) &&
        (first.effectiveToExclusive == null || second.effectiveFrom < first.effectiveToExclusive)
      ) overlaps.push({ firstIndex, secondIndex });
    }
  }
  return overlaps;
}
