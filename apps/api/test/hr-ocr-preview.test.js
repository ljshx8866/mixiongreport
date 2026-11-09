const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrOcrPreviewService, validateIdcardImage } = require('../dist/hr/hr-ocr-preview.service');
const { HrOcrUploadGuard } = require('../dist/hr/hr-ocr-upload.guard');

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);

test('OCR preview rejects a MIME mismatch and unsupported card side', () => {
  assert.throws(() => validateIdcardImage({ documentType: 'ID_CARD_FRONT', mimeType: 'image/png', content: jpeg }), /format/);
  assert.throws(() => validateIdcardImage({ documentType: 'OTHER', mimeType: 'image/jpeg', content: jpeg }), /side/);
});

test('OCR preview requires independent gate, scoped draft and onboarding permission', async () => {
  const old = { intake: process.env.HR_SENSITIVE_INTAKE_ENABLED, ocr: process.env.HR_OCR_ENABLED };
  const image = { documentType: 'ID_CARD_FRONT', mimeType: 'image/jpeg', content: jpeg };
  let reads = 0;
  const service = new HrOcrPreviewService({ hrEmployee: { findUnique: async () => {
    reads++; return { status: 'DRAFT', initialStoreId: 2n };
  } } }, { assertStorePermission: async () => { throw new Error('permission denied'); } },
  { runtimeCredentials: async () => ({ accessKeyId: 'test-access-key-id', accessKeySecret: 'test-access-key-secret' }) });
  try {
    delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
    process.env.HR_OCR_ENABLED = 'true';
    await assert.rejects(service.preview(3n, { id: 4 }, image), /not enabled/);
    assert.equal(reads, 0);
    process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
    await assert.rejects(service.preview(3n, { id: 4 }, image), /permission denied/);
  } finally {
    if (old.intake === undefined) delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
    else process.env.HR_SENSITIVE_INTAKE_ENABLED = old.intake;
    if (old.ocr === undefined) delete process.env.HR_OCR_ENABLED;
    else process.env.HR_OCR_ENABLED = old.ocr;
  }
});

test('OCR preview returns structured suggestions for manual confirmation without storing image', async () => {
  const old = { intake: process.env.HR_SENSITIVE_INTAKE_ENABLED, ocr: process.env.HR_OCR_ENABLED };
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_OCR_ENABLED = 'true';
  let calls = 0;
  const permissionCalls = [];
  const service = new HrOcrPreviewService({ hrEmployee: { findUnique: async () =>
    ({ status: 'DRAFT', initialStoreId: 2n }) } }, { assertStorePermission: async (_user, code, storeId) => {
    permissionCalls.push({ code, storeId });
  } }, { runtimeCredentials: async () => ({ accessKeyId: 'test-access-key-id', accessKeySecret: 'test-access-key-secret' }) });
  service.provider = async () => ({ recognize: async (input) => {
    calls++;
    assert.deepEqual(input.content, jpeg);
    return { provider: 'ALIYUN_RECOGNIZE_IDCARD', providerResultId: 'mock',
      fields: { name: { value: 'Test Person', confidence: 0.98 } } };
  } });
  try {
    const result = await service.preview(3n, { id: 4 },
      { documentType: 'ID_CARD_FRONT', mimeType: 'image/jpeg', content: jpeg });
    assert.equal(calls, 1);
    assert.equal(result.requiresManualConfirmation, true);
    assert.equal(result.fields.name.value, 'Test Person');
    assert.deepEqual(permissionCalls, [
      { code: 'HR_ONBOARDING_CREATE', storeId: 2n },
    ]);
  } finally {
    if (old.intake === undefined) delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
    else process.env.HR_SENSITIVE_INTAKE_ENABLED = old.intake;
    if (old.ocr === undefined) delete process.env.HR_OCR_ENABLED;
    else process.env.HR_OCR_ENABLED = old.ocr;
  }
});

test('upload guard checks employee scope before the image interceptor', async () => {
  const old = { intake: process.env.HR_SENSITIVE_INTAKE_ENABLED, ocr: process.env.HR_OCR_ENABLED };
  process.env.HR_SENSITIVE_INTAKE_ENABLED = 'true';
  process.env.HR_OCR_ENABLED = 'true';
  const calls = [];
  const guard = new HrOcrUploadGuard({ hrEmployee: { findUnique: async () =>
    ({ status: 'DRAFT', initialStoreId: 2n }) } }, { assertStorePermission: async (_user, code, storeId) =>
    calls.push({ code, storeId }) },
  { runtimeCredentials: async () => ({ accessKeyId: 'test-access-key-id', accessKeySecret: 'test-access-key-secret' }) });
  const context = { switchToHttp: () => ({ getRequest: () => ({ params: { id: '3' }, user: { id: 4 } }) }) };
  try {
    assert.equal(await guard.canActivate(context), true);
    assert.deepEqual(calls, [
      { code: 'HR_ONBOARDING_CREATE', storeId: 2n },
    ]);
  } finally {
    if (old.intake === undefined) delete process.env.HR_SENSITIVE_INTAKE_ENABLED;
    else process.env.HR_SENSITIVE_INTAKE_ENABLED = old.intake;
    if (old.ocr === undefined) delete process.env.HR_OCR_ENABLED;
    else process.env.HR_OCR_ENABLED = old.ocr;
  }
});
