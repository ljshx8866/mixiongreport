const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AliyunIdcardOcrProvider, createAliyunIdcardOcrProvider, createAliyunIdcardOcrProviderFromCredentials, parseAliyunIdcardResult } = require('../dist/hr/aliyun-idcard-ocr.provider');

test('Aliyun ID card result maps face fields and confidence without exposing raw payload', () => {
  const result = parseAliyunIdcardResult({
    RequestId: 'req-1',
    Data: JSON.stringify({ data: { face: { data: { name: '测试姓名', idNumber: '110101199001011234' },
      prism_keyValueInfo: [{ key: 'name', valueProb: 97 }] } } }),
  }, 'ID_CARD_FRONT');
  assert.deepEqual(result, {
    provider: 'ALIYUN_RECOGNIZE_IDCARD', providerResultId: 'req-1',
    fields: { name: { value: '测试姓名', confidence: 0.97 }, idNumber: { value: '110101199001011234', confidence: null } },
  });
  assert.ok(!JSON.stringify(result).includes('prism_keyValueInfo'));
});

test('Aliyun provider rejects unsupported or oversized images before calling cloud client', async () => {
  let called = 0;
  const provider = new AliyunIdcardOcrProvider(async () => { called++; return {}; });
  await assert.rejects(provider.recognize({ documentType: 'BANK_CARD', mimeType: 'image/jpeg', content: new Uint8Array([1]) }));
  await assert.rejects(provider.recognize({ documentType: 'ID_CARD_FRONT', mimeType: 'image/png', content: new Uint8Array(10 * 1024 * 1024 + 1) }));
  assert.equal(called, 0);
});

test('Aliyun OCR errors do not disclose service payload', () => {
  assert.throws(() => parseAliyunIdcardResult({ Code: 'noPermission', Message: 'secret detail' }, 'ID_CARD_FRONT'), (error) => {
    assert.ok(!error.message.includes('secret detail'));
    return true;
  });
});

test('Aliyun service and image errors return actionable safe messages', () => {
  const cases = [
    ['ocrServiceNotOpen', /尚未开通/],
    ['illegalImageContent', /未收到有效图片内容/],
    ['unsupportedImageFormat', /不支持当前图片格式或尺寸/],
  ];
  for (const [code, expected] of cases) {
    assert.throws(() => parseAliyunIdcardResult({ Code: code, Message: 'vendor detail' }, 'ID_CARD_FRONT'), (error) => {
      assert.match(error.message, expected);
      assert.ok(!error.message.includes('vendor detail'));
      return true;
    });
  }
});

test('official SDK response shape and binary request are supported without a public URL', async () => {
  let request;
  const provider = createAliyunIdcardOcrProvider({
    recognizeIdcard: async (value) => {
      request = value;
      return { statusCode: 200, body: {
        requestId: 'sdk-1',
        data: JSON.stringify({ data: { back: { data: { issueAuthority: 'Test authority' } } } }),
      } };
    },
  });
  const result = await provider.recognize({ documentType: 'ID_CARD_BACK', mimeType: 'image/jpeg', content: Uint8Array.from([1, 2, 3]) });
  assert.equal(result.providerResultId, 'sdk-1');
  assert.equal(result.fields.issueAuthority.value, 'Test authority');
  assert.equal(request.url, undefined);
  const chunks = [];
  for await (const chunk of request.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3]));
});

test('official SDK failure does not expose response details', () => {
  assert.throws(() => parseAliyunIdcardResult({ statusCode: 403, body: { code: 'noPermission', message: 'sensitive vendor detail' } }, 'ID_CARD_FRONT'), (error) => {
    assert.ok(!error.message.includes('sensitive vendor detail'));
    return true;
  });
});

test('server SDK config accepts decrypted credential pair', () => {
  assert.ok(createAliyunIdcardOcrProviderFromCredentials({
    accessKeyId: 'test-access-key-id', accessKeySecret: 'test-access-key-secret',
  }));
});

test('SDK exceptions never leak provider payload through the OCR boundary', async () => {
  const error = new Error('vendor request contains identity 123');
  error.code = 'noPermission';
  const provider = new AliyunIdcardOcrProvider(async () => { throw error; });
  await assert.rejects(provider.recognize({
    documentType: 'ID_CARD_FRONT', mimeType: 'image/jpeg', content: Uint8Array.from([1]),
  }), (error) => {
    assert.ok(!error.message.includes('identity 123'));
    assert.match(error.message, /ocr:RecognizeIdcard/);
    return true;
  });
});
