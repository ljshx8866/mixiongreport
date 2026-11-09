const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HrSensitiveCrypto, maskBankCard } = require('../dist/hr/hr-sensitive-crypto');

const key = Buffer.alloc(32, 11).toString('base64');
const oldKey = Buffer.alloc(32, 12).toString('base64');
const lookupKey = Buffer.alloc(32, 13).toString('base64');

test('HR fields are sealed for one employee and purpose and support key rotation', () => {
  const first = new HrSensitiveCrypto({ activeKeyId: 'v1', keys: { v1: oldKey }, lookupKey });
  const old = first.seal(8n, 'IDENTITY', { idNumber: '123456789012345678', name: '张三' });
  const rotated = new HrSensitiveCrypto({ activeKeyId: 'v2', keys: { v1: oldKey, v2: key }, lookupKey });
  assert.deepEqual(rotated.open(8n, 'IDENTITY', old),
    { idNumber: '123456789012345678', name: '张三' });
  const sealed = rotated.seal(8n, 'BANK', { cardNumber: '6222020000000000000' });
  assert.equal(sealed.keyId, 'v2');
  assert.ok(!JSON.stringify(sealed).includes('6222020000000000000'));
  assert.deepEqual(rotated.open(8n, 'BANK', sealed), { cardNumber: '6222020000000000000' });
  assert.throws(() => rotated.open(9n, 'BANK', sealed), /unavailable/);
  assert.throws(() => rotated.open(8n, 'IDENTITY', sealed), /unavailable/);
  assert.throws(() => rotated.open(8n, 'BANK', { ...sealed, data: 'AAAA' }), /unavailable/);
});

test('HR encryption rejects absent keys and fingerprints do not expose identity numbers', () => {
  assert.throws(() => new HrSensitiveCrypto({ activeKeyId: 'v1', keys: {}, lookupKey }), /active data key/);
  const crypto = new HrSensitiveCrypto({ activeKeyId: 'v1', keys: { v1: key }, lookupKey });
  const fingerprint = crypto.identityFingerprint(' 12345678901234567x ');
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, crypto.identityFingerprint('12345678901234567X'));
  assert.ok(!fingerprint.includes('12345678901234567'));
  assert.equal(maskBankCard('6222 0200 0000 0000 000'), '***************0000');
  assert.throws(() => maskBankCard('abc'), /Invalid bank card/);
});
