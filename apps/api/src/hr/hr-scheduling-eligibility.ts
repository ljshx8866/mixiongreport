export type SchedulingRoleGrant = { role: { participatesInScheduling: boolean; enabled?: boolean } };

export function roleAllowsScheduling(grants: readonly SchedulingRoleGrant[] | null | undefined): boolean {
  return !grants?.length || grants.some((grant) => grant.role.enabled !== false && grant.role.participatesInScheduling);
}
