const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { SystemAlertExceptionFilter } = require('../dist/system-alert-exception.filter');

function hostFor(request) {
  const response = { headersSent: false, code: 0, body: null,
    status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  return { response, host: { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } };
}

test('unexpected HTTP 500 errors are saved with sanitized route and actionable alert metadata', async () => {
  let saved;
  const filter = new SystemAlertExceptionFilter({ systemAlert: { upsert: async (args) => { saved = args; } } });
  const { host, response } = hostFor({ method: 'POST', path: '/api/login?token=should-not-store', route: { path: '/api/login' } });
  await filter.catch(new Error('upstream failed for phone 13812345678'), host);
  assert.equal(response.code, 500);
  assert.equal(response.body.message, '服务器暂时异常，请稍后重试。');
  assert.equal(saved.create.route, '/api/login');
  assert.match(saved.create.message, /\[手机号已隐藏\]/);
  assert.doesNotMatch(saved.create.message, /13812345678|should-not-store/);
});

test('client errors are returned normally and do not clutter the error inbox', async () => {
  let recorded = 0;
  const filter = new SystemAlertExceptionFilter({ systemAlert: { upsert: async () => { recorded += 1; } } });
  const { host, response } = hostFor({ method: 'POST', path: '/api/login' });
  await filter.catch(new BadRequestException('手机号格式不正确'), host);
  assert.equal(response.code, 400);
  assert.equal(response.body.message, '手机号格式不正确');
  assert.equal(recorded, 0);
});
