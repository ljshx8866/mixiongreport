/** Account capability grants; store membership is checked separately via UserStore. */
export type HrRoleGrantSnapshot = {
  active: boolean;
  roleEnabled: boolean;
  permissionCodes: readonly string[];
};

export function hasHrPermission(
  userActive: boolean,
  grants: readonly HrRoleGrantSnapshot[],
  permissionCode: string,
): boolean {
  return userActive && !!permissionCode && grants.some((grant) => grant.active && grant.roleEnabled &&
    grant.permissionCodes.includes(permissionCode));
}
