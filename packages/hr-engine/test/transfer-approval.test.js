const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialTransferApprovalProgress, applyTransferDecision } = require('../dist');

test('new transfers are approved by destination store and then HR', () => {
  let progress = initialTransferApprovalProgress();
  assert.equal(progress.nextStep, 'DESTINATION_STORE');
  assert.throws(() => applyTransferDecision(progress, 'SOURCE_STORE', 'APPROVE'));
  progress = applyTransferDecision(progress, 'DESTINATION_STORE', 'APPROVE');
  assert.equal(progress.nextStep, 'HR');
  progress = applyTransferDecision(progress, 'HR', 'APPROVE');
  assert.equal(progress.status, 'APPROVED_AWAITING_EFFECTIVE');
  assert.equal(progress.nextStep, null);
});

test('legacy pending transfers keep the original source, destination, HR approval chain', () => {
  let progress = { status: 'PENDING', nextStep: 'SOURCE_STORE', decisions: [] };
  progress = applyTransferDecision(progress, 'SOURCE_STORE', 'APPROVE');
  assert.equal(progress.nextStep, 'DESTINATION_STORE');
  progress = applyTransferDecision(progress, 'DESTINATION_STORE', 'APPROVE');
  assert.equal(progress.nextStep, 'HR');
  progress = applyTransferDecision(progress, 'HR', 'APPROVE');
  assert.equal(progress.status, 'APPROVED_AWAITING_EFFECTIVE');
});

test('a rejection stops either approval flow', () => {
  const cases = [
    ['DESTINATION_STORE', ['DESTINATION_STORE', 'HR']],
    ['HR', ['DESTINATION_STORE', 'HR']],
    ['SOURCE_STORE', ['SOURCE_STORE', 'DESTINATION_STORE', 'HR']],
  ];
  for (const [rejectedStep, steps] of cases) {
    let progress = rejectedStep === 'SOURCE_STORE'
      ? { status: 'PENDING', nextStep: 'SOURCE_STORE', decisions: [] }
      : initialTransferApprovalProgress();
    for (const step of steps) {
      progress = applyTransferDecision(progress, step, step === rejectedStep ? 'REJECT' : 'APPROVE');
      if (step === rejectedStep) break;
    }
    assert.equal(progress.status, 'REJECTED');
    assert.equal(progress.nextStep, null);
  }
});
