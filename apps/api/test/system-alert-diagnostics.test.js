const { test } = require('node:test');
const assert = require('node:assert/strict');
const { alertFingerprint, cleanAlertMessage, diagnoseAlert } = require('../dist/system-alert-diagnostics');

test('alert messages redact tokens and personal identifiers before they are stored', () => {
  const cleaned = cleanAlertMessage('Authorization=secret123 phone 13812345678 card 6222021234567890\n at internal/path');
  assert.match(cleaned, /Authorization=\[已隐藏\]/i);
  assert.doesNotMatch(cleaned, /secret123|13812345678|6222021234567890/);
  assert.doesNotMatch(cleaned, /internal\/path/);
});

test('POS catalog errors receive a useful diagnostic and stable fingerprints', () => {
  const diagnosis = diagnoseAlert('菜品未关联，请先同步分类资料');
  assert.equal(diagnosis.title, 'POS 菜品或分类关联异常');
  assert.match(diagnosis.suggestion, /同步 POS 菜品与分类/);
  assert.equal(alertFingerprint('HTTP', 'GET', '/api/reports', 503, 'timeout'),
    alertFingerprint('HTTP', 'GET', '/api/reports', 503, 'timeout'));
});
