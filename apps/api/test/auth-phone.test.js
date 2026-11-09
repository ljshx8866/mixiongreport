const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/auth');

test('phone authorization refreshes an invalid WeChat access token once', async () => {
  const oldFetch = global.fetch;
  const oldAppId = process.env.WECHAT_APP_ID;
  const oldSecret = process.env.WECHAT_APP_SECRET;
  process.env.WECHAT_APP_ID = 'test-app';
  process.env.WECHAT_APP_SECRET = 'test-secret';
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url).includes('/cgi-bin/token') ? 'token' : 'phone');
    const data = calls.length === 1 ? { access_token: 'old', expires_in: 7200 }
      : calls.length === 2 ? { errcode: 40001, errmsg: 'invalid credential' }
        : calls.length === 3 ? { access_token: 'new', expires_in: 7200 }
          : { errcode: 0, phone_info: { purePhoneNumber: '16636609695' } };
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const service = new AuthService({}, {});
    assert.equal(await service.getWechatPhoneNumber('one-time-code'), '16636609695');
    assert.deepEqual(calls, ['token', 'phone', 'token', 'phone']);
  } finally {
    global.fetch = oldFetch;
    if (oldAppId === undefined) delete process.env.WECHAT_APP_ID; else process.env.WECHAT_APP_ID = oldAppId;
    if (oldSecret === undefined) delete process.env.WECHAT_APP_SECRET; else process.env.WECHAT_APP_SECRET = oldSecret;
  }
});

test('phone authorization binds a new OpenID to an account after its previous binding was reset', async () => {
  const oldFetch = global.fetch;
  const oldAppId = process.env.WECHAT_APP_ID;
  const oldSecret = process.env.WECHAT_APP_SECRET;
  process.env.WECHAT_APP_ID = 'test-app';
  process.env.WECHAT_APP_SECRET = 'test-secret';
  let boundOpenId = null;
  let userLookup = 0;
  global.fetch = async (url) => {
    const address = String(url);
    if (address.includes('/sns/jscode2session'))
      return { ok: true, json: async () => ({ openid: 'new-open-id' }) };
    if (address.includes('/cgi-bin/token'))
      return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 7200 }) };
    if (address.includes('/getuserphonenumber'))
      return { ok: true, json: async () => ({ errcode: 0, phone_info: { purePhoneNumber: '13800000000' } }) };
    throw new Error('Unexpected WeChat request');
  };
  const account = { id: 9n, name: '员工', mobile: '13800000000', role: 'STORE_MANAGER', status: true,
    passwordHash: 'hash', openid: null, stores: [{ storeId: 2n }] };
  const db = { user: {
    findUnique: async ({ where }) => {
      userLookup++;
      return 'openid' in where ? null : account;
    },
    update: async ({ data }) => { boundOpenId = data.openid; return { ...account, ...data }; },
  } };
  const jwt = { signAsync: async () => 'test-access-token' };
  try {
    const service = new AuthService(db, jwt);
    const result = await service.wechatPhoneLogin('login-code', 'phone-code');
    assert.equal(boundOpenId, 'new-open-id');
    assert.equal(userLookup, 2);
    assert.equal(result.user.wechatBound, true);
  } finally {
    global.fetch = oldFetch;
    if (oldAppId === undefined) delete process.env.WECHAT_APP_ID; else process.env.WECHAT_APP_ID = oldAppId;
    if (oldSecret === undefined) delete process.env.WECHAT_APP_SECRET; else process.env.WECHAT_APP_SECRET = oldSecret;
  }
});
