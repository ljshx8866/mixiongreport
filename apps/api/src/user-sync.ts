import { UserRole } from '@prisma/client';
import { WuuxiangEmployee, WuuxiangEmployeeAccess } from './wuuxiang.client';

export type PosUserSyncRecord = {
  externalUserId: string;
  externalUserCode: string;
  name: string;
  mobile: string | null;
  dutyName: string | null;
  role: UserRole;
  status: boolean;
  storeIds: bigint[];
};

export type ExistingUserSyncCandidate = {
  id: bigint | number;
  externalUserId: string | null;
  externalUserCode: string | null;
  mobile: string | null;
};

/** Prefer stable POS identity keys; a phone collision must never merge accounts. */
export function resolvePosUserSyncMatch<T extends ExistingUserSyncCandidate>(
  record: Pick<PosUserSyncRecord, 'externalUserId' | 'externalUserCode' | 'mobile'>,
  candidates: readonly T[],
) {
  const strongMatches = candidates.filter((candidate) =>
    candidate.externalUserId === record.externalUserId || candidate.externalUserCode === record.externalUserCode);
  if (strongMatches.length > 1)
    throw new Error(`POS 员工编号 ${record.externalUserCode} 的员工身份信息关联到多个本地账号，请先到“用户与权限”核对员工编号和账号关联。`);

  const existing = strongMatches[0] ?? candidates.find((candidate) =>
    record.mobile != null && candidate.mobile === record.mobile) ?? null;
  const mobileOwner = record.mobile == null ? null : candidates.find((candidate) =>
    candidate.mobile === record.mobile && (!existing || String(candidate.id) !== String(existing.id))) ?? null;
  return { existing, preserveExistingMobile: !!existing && !!mobileOwner };
}

type StoreReference = { id: bigint; externalStoreCode: string | null; status: boolean };

export function mapWuuxiangUsers(
  employees: WuuxiangEmployee[],
  accessUsers: WuuxiangEmployeeAccess[],
  stores: StoreReference[],
): PosUserSyncRecord[] {
  const employeesByCode = new Map<string, WuuxiangEmployee[]>();
  for (const employee of employees) {
    const code = String(employee.code ?? '').trim();
    if (!code) continue;
    employeesByCode.set(code, [...(employeesByCode.get(code) ?? []), employee]);
  }
  const storesByExternalId = new Map(
    stores.filter((store) => store.externalStoreCode).map((store) => [String(store.externalStoreCode), store]),
  );
  const allActiveStoreIds = stores.filter((store) => store.status && store.externalStoreCode).map((store) => store.id);
  const seenExternalIds = new Set<string>();
  const seenCodes = new Set<string>();
  const seenMobiles = new Set<string>();

  return accessUsers.map((access) => {
    const externalUserId = String(access.id ?? '').trim();
    const externalUserCode = String(access.code ?? '').trim();
    const name = String(access.name ?? '').trim();
    if (!externalUserId || !externalUserCode || !name) throw new Error('POS employee access record is missing id, code or name');
    if (seenExternalIds.has(externalUserId)) throw new Error(`Duplicate POS employee access id: ${externalUserId}`);
    if (seenCodes.has(externalUserCode)) throw new Error(`Duplicate POS employee code: ${externalUserCode}`);
    seenExternalIds.add(externalUserId);
    seenCodes.add(externalUserCode);

    const matches = employeesByCode.get(externalUserCode) ?? [];
    if (matches.length !== 1) throw new Error(`POS employee code ${externalUserCode} matched ${matches.length} employee archives`);
    const archive = matches[0];
    const mobile = String(archive.cellphone ?? '').trim() || null;
    if (mobile && seenMobiles.has(mobile)) throw new Error(`Duplicate POS employee mobile for code ${externalUserCode}`);
    if (mobile) seenMobiles.add(mobile);

    const requestedStoreIds = access.isAdmin
      ? allActiveStoreIds
      : (access.authAccessShopList ?? []).map((shop) => {
          const externalStoreId = String(shop.id ?? '').trim();
          const store = storesByExternalId.get(externalStoreId);
          if (!store) throw new Error(`POS employee ${externalUserCode} references unknown store ${externalStoreId}`);
          return store.id;
        });
    const storeIds = access.isEnable ? [...new Set(requestedStoreIds)] : [];
    const role = access.isAdmin
      ? UserRole.ADMIN
      : storeIds.length > 1 ? UserRole.REGION_MANAGER : UserRole.STORE_MANAGER;
    return {
      externalUserId,
      externalUserCode,
      name,
      mobile,
      dutyName: String(archive.dutyName ?? '').trim() || null,
      role,
      status: Boolean(access.isEnable),
      storeIds,
    };
  });
}
