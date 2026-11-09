const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapWuuxiangUsers, resolvePosUserSyncMatch } = require('../dist/user-sync');

const employees = [
  { id: 'archive-1', code: 'A001', name: '总部账号', cellphone: '13800000001', dutyName: '运营总监' },
  { id: 'archive-2', code: 'A002', name: '区域账号', cellphone: '13800000002', dutyName: '数据查询' },
  { id: 'archive-3', code: 'A003', name: '停用账号', cellphone: '13800000003', dutyName: '门店' },
];
const stores = [
  { id: 1n, externalStoreCode: 'S1', status: true },
  { id: 2n, externalStoreCode: 'S2', status: true },
  { id: 3n, externalStoreCode: 'S3', status: false },
];

test('maps POS users, roles, enabled state and exact store access', () => {
  const result = mapWuuxiangUsers(employees, [
    { id: 'U1', code: 'A001', name: '总部账号', isEnable: true, isAdmin: true, authAccessShopList: [] },
    { id: 'U2', code: 'A002', name: '区域账号', isEnable: true, isAdmin: false, authAccessShopList: [{ id: 'S1' }, { id: 'S2' }] },
    { id: 'U3', code: 'A003', name: '停用账号', isEnable: false, isAdmin: false, authAccessShopList: [{ id: 'S1' }] },
  ], stores);

  assert.deepEqual(result[0].storeIds, [1n, 2n]);
  assert.equal(result[0].role, 'ADMIN');
  assert.deepEqual(result[1].storeIds, [1n, 2n]);
  assert.equal(result[1].role, 'REGION_MANAGER');
  assert.equal(result[2].status, false);
  assert.deepEqual(result[2].storeIds, []);
  assert.equal(result[2].role, 'STORE_MANAGER');
});

test('refuses incomplete snapshots with unknown store references', () => {
  assert.throws(() => mapWuuxiangUsers(employees, [
    { id: 'U2', code: 'A002', name: '区域账号', isEnable: true, isAdmin: false, authAccessShopList: [{ id: 'UNKNOWN' }] },
  ], stores), /unknown store UNKNOWN/);
});

test('POS identity match wins over a phone owned by a different local account', () => {
  const posUser = { id: 13n, externalUserId: 'pos-234063', externalUserCode: '234063', mobile: '13800000000' };
  const localUser = { id: 45n, externalUserId: null, externalUserCode: null, mobile: '13900000000' };
  const resolved = resolvePosUserSyncMatch({ externalUserId: 'pos-234063', externalUserCode: '234063', mobile: '13900000000' },
    [posUser, localUser]);
  assert.equal(resolved.existing, posUser);
  assert.equal(resolved.preserveExistingMobile, true);
});

test('POS employee code and POS identity pointing at different local accounts remains a hard conflict', () => {
  assert.throws(() => resolvePosUserSyncMatch({ externalUserId: 'pos-a', externalUserCode: '234063', mobile: null }, [
    { id: 13n, externalUserId: 'pos-a', externalUserCode: 'old-code', mobile: null },
    { id: 45n, externalUserId: 'pos-b', externalUserCode: '234063', mobile: null },
  ]), /POS 员工编号 234063 的员工身份信息关联到多个本地账号/);
});
