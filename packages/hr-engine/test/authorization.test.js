const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addLegacyHrPermissionDisplayAliases, expandLegacyHrPermissionCodes, hasHrPermission, HR_PERMISSIONS } = require('../dist');
const grant = () => ({ active: true, roleEnabled: true, permissionCodes: ['HR_EMPLOYEE_READ'] });

test('HR roles grant capabilities to an account without defining store scope', () => {
  assert.equal(hasHrPermission(true, [grant()], 'HR_EMPLOYEE_READ'), true);
  assert.equal(hasHrPermission(true, [grant()], 'HR_EMPLOYEE_WRITE'), false);
});

test('disabled users, grants, roles and missing permissions fail closed', () => {
  assert.equal(hasHrPermission(false, [grant()], 'HR_EMPLOYEE_READ'), false);
  assert.equal(hasHrPermission(true, [{ ...grant(), active: false }], 'HR_EMPLOYEE_READ'), false);
  assert.equal(hasHrPermission(true, [{ ...grant(), roleEnabled: false }], 'HR_EMPLOYEE_READ'), false);
  assert.equal(hasHrPermission(true, [grant()], ''), false);
});

test('legacy permission expansion retains the original grant and adds equivalent action leaves', () => {
  const expanded = expandLegacyHrPermissionCodes([
    'HR_EMPLOYEE_READ', 'HR_SCHEDULE_READ', 'HR_BANK_CHANGE_STORE_VERIFY', 'HR_OFFBOARDING_REQUEST', 'FUTURE_MODULE_ACTION',
  ]);
  for (const code of [
    'HR_EMPLOYEE_READ', 'HR_EMPLOYEE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_EMPLOYEE_SENSITIVE_READ',
    'HR_SCHEDULE_READ', 'HR_SCHEDULE_LIST_READ', 'HR_SHIFT_TEMPLATE_READ', 'HR_SCHEDULE_POINT_READ',
    'HR_BANK_CHANGE_STORE_VERIFY', 'HR_BANK_CHANGE_VERIFY', 'HR_BANK_CHANGE_SUBMIT',
    'HR_BANK_CHANGE_LIST_READ', 'HR_OFFBOARDING_REQUEST', 'HR_OFFBOARDING_LIST_READ',
    'HR_EMPLOYEE_LIST_READ', 'FUTURE_MODULE_ACTION',
  ]) assert.ok(expanded.includes(code), `missing compatibility grant ${code}`);
  assert.equal(new Set(HR_PERMISSIONS.map(({ code }) => code)).size, HR_PERMISSIONS.length);
});

test('fine-grained grants expose legacy miniapp entry aliases without changing the fine-grained set', () => {
  const codes = ['HR_SCHEDULE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_TIME_CORRECTION_EDIT'];
  const compatible = addLegacyHrPermissionDisplayAliases(codes);
  assert.deepEqual(compatible, [
    ...codes, 'HR_TIME_CORRECTION_APPROVE', 'HR_SCHEDULE_READ',
  ]);
  assert.ok(!compatible.includes('HR_EMPLOYEE_READ'), 'detail-only access must not display the employee list');
  assert.deepEqual(codes, ['HR_SCHEDULE_LIST_READ', 'HR_EMPLOYEE_DETAIL_READ', 'HR_TIME_CORRECTION_EDIT']);
});
