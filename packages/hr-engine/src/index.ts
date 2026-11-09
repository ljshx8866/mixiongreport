/**
 * Business-day work-time summary. Callers must select one employee's confirmed
 * raw segments for one resolved business date before invoking this function.
 * It does not assign cross-midnight work to a date or calculate wages.
 */
export { SHIFT_30_MIN_FLOOR_RULE, DAILY_30_MIN_FLOOR_RULE, calculateDailyWorkTime } from './daily-work';
export type { ConfirmedWorkSegment, DailyWorkTimeSummary } from './daily-work';
export { buildStoreMonthlyWorkSnapshot } from './monthly-work';
export { calculateDailyHourlyPay, sumDailyHourlyPay } from './hourly-pay';
export type { MonthlyWorkPart, MonthlyWorkRow } from './monthly-work';
export { findPrimaryAppointmentOverlaps } from './appointments';
export { splitWorkIntervalByShanghaiDay } from './work-split';
export type { SplitWorkInterval, NaturalDayWorkSegment, TimedBreak } from './work-split';
export type { PrimaryAppointmentInterval, AppointmentOverlap } from './appointments';
export { hasHrPermission } from './authorization';
export type { HrRoleGrantSnapshot } from './authorization';
export { ALL_HR_PERMISSION_CODES, HR_PERMISSIONS, LEGACY_HR_PERMISSIONS,
  addLegacyHrPermissionDisplayAliases, expandLegacyHrPermissionCodes, hrPermissionSurfaceLabel, HR_PERMISSION_SURFACES,
  isConfigurableHrPermissionCode, isHrPermissionCode } from './permissions';
export type { HrPermissionDefinition, HrPermissionSurface } from './permissions';
export type { HrPermissionCode } from './permissions';

/**
 * Elapsed work minutes from absolute minute timestamps. The caller resolves
 * local clock times (including any cross-midnight shift) to epoch minutes.
 * Business-date attribution and wage calculation are deliberately separate.
 */
export type RawWorkInterval = {
  startEpochMinutes: number;
  endEpochMinutes: number;
  breakMinutes: number;
};

export type RawWorkDuration = {
  elapsedMinutes: number;
  breakMinutes: number;
  rawMinutes: number;
};

export function calculateRawWorkDuration(interval: RawWorkInterval): RawWorkDuration {
  const { startEpochMinutes, endEpochMinutes, breakMinutes } = interval;
  for (const value of [startEpochMinutes, endEpochMinutes, breakMinutes]) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Work timestamps and break must be safe integer minutes');
  }
  const elapsedMinutes = endEpochMinutes - startEpochMinutes;
  if (!Number.isSafeInteger(elapsedMinutes) || elapsedMinutes <= 0)
    throw new RangeError('Work end must be after start');
  if (breakMinutes < 0 || breakMinutes > elapsedMinutes)
    throw new RangeError('Break must be between zero and elapsed minutes');
  return { elapsedMinutes, breakMinutes, rawMinutes: elapsedMinutes - breakMinutes };
}

/** New transfers are reviewed by the destination store and then HR. SOURCE_STORE
 * remains a supported legacy step for requests created before this workflow change. */
export const TRANSFER_APPROVAL_ORDER = ['DESTINATION_STORE', 'HR'] as const;
export type TransferApprovalStep = typeof TRANSFER_APPROVAL_ORDER[number] | 'SOURCE_STORE';
export type TransferDecision = 'APPROVE' | 'REJECT';
export type TransferApprovalProgress = {
  status: 'PENDING' | 'APPROVED_AWAITING_EFFECTIVE' | 'REJECTED';
  nextStep: TransferApprovalStep | null;
  decisions: ReadonlyArray<{ step: TransferApprovalStep; decision: TransferDecision }>;
};

export const initialTransferApprovalProgress = (): TransferApprovalProgress => ({
  status: 'PENDING', nextStep: TRANSFER_APPROVAL_ORDER[0], decisions: [],
});

export function applyTransferDecision(
  progress: TransferApprovalProgress,
  step: TransferApprovalStep,
  decision: TransferDecision,
): TransferApprovalProgress {
  if (progress.status !== 'PENDING' || progress.nextStep !== step)
    throw new Error('Transfer approval step is not currently pending');
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new Error('Invalid transfer decision');
  const decisions = [...progress.decisions, { step, decision }];
  if (decision === 'REJECT') return { status: 'REJECTED', nextStep: null, decisions };
  // Legacy requests can still be in SOURCE_STORE -> DESTINATION_STORE -> HR.
  // New requests start at DESTINATION_STORE and skip the source approval.
  const nextStep = step === 'SOURCE_STORE' ? 'DESTINATION_STORE' :
    step === 'DESTINATION_STORE' ? 'HR' : null;
  return { status: nextStep ? 'PENDING' : 'APPROVED_AWAITING_EFFECTIVE', nextStep, decisions };
}
