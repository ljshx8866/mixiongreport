const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrEmployeeController } = require('../dist/hr/hr-employee.controller');

test('employee list returns onboarding business status separately from approved decision', async () => {
  const controller = new HrEmployeeController({
    hrEmployee: { findMany: async () => [{
      id: 12n, displayName: 'Li Jun', status: 'DRAFT', userId: null, initialStoreId: 4n,
      primaryAppointments: [],
      onboardingRequests: [{ id: 30n, status: 'EFFECTIVE_FAILED', failureCode: 'PHONE_REQUIRED' }],
    }] },
    hrApprovalInstance: { findMany: async () => [{ subjectId: 30n, status: 'APPROVED' }] },
  }, {
    currentAccess: async () => ({ stores: [{ id: 4, storeName: 'Store', permissionCodes: ['HR_EMPLOYEE_LIST_READ'] }] }),
  });

  const [employee] = await controller.list({ user: { id: 7 } });
  assert.equal(employee.status, 'DRAFT');
  assert.equal(employee.onboardingStatus, 'EFFECTIVE_FAILED');
  assert.equal(employee.onboardingFailureCode, 'PHONE_REQUIRED');
  assert.equal(employee.onboardingApprovalStatus, 'APPROVED');
});
