const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MiniappDecorationController } = require('../dist/miniapp-decoration.controller');

function setup() {
  let row = null;
  const audits = [];
  const db = {
    miniappDecoration: {
      upsert: async ({ create, update }) => {
        row = { ...(row ?? create), ...(row ? update : {}), updatedAt: new Date('2026-10-16T00:00:00Z') };
        return row;
      },
      update: async ({ data }) => { row = { ...row, ...data, updatedAt: new Date('2026-10-16T00:01:00Z') }; return row; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  return { controller: new MiniappDecorationController(db), audits };
}

test('public decoration returns default entries and branding without login', async () => {
  const { controller } = setup();
  const result = await controller.publicDecoration();
  assert.equal(result.homeTitle, '米熊 · 经营工作台');
  assert.deepEqual(result.defaultHomeModules, ['input', 'report', 'history', 'reminders']);
  assert.equal(result.bannerUrl, null);
});

test('admin decoration saves validated defaults and audits the change', async () => {
  const { controller, audits } = setup();
  const result = await controller.save({ user: { id: 9, role: 'ADMIN', storeIds: [] } }, {
    homeTitle: '米熊经营工作台', homeSubtitle: '今日经营，一目了然', defaultHomeModules: ['input', 'history', 'onboarding', 'offboarding', 'my-schedule'],
  });
  assert.equal(result.homeTitle, '米熊经营工作台');
  assert.deepEqual(result.defaultHomeModules, ['input', 'history', 'onboarding', 'offboarding', 'my-schedule']);
  assert.equal(audits[0].entityType, 'MINIAPP_DECORATION');
  assert.equal(audits[0].userId, 9n);
});

test('decoration rejects an empty or unsupported default entry list', async () => {
  const { controller } = setup();
  const request = { user: { id: 9, role: 'ADMIN', storeIds: [] } };
  await assert.rejects(controller.save(request, { homeTitle: '首页', homeSubtitle: '', defaultHomeModules: [] }), /默认入口最多选择 5 项/);
  await assert.rejects(controller.save(request, { homeTitle: '首页', homeSubtitle: '', defaultHomeModules: ['admin-secret'] }), /默认入口最多选择 5 项/);
  await assert.rejects(controller.save(request, { homeTitle: '首页', homeSubtitle: '', defaultHomeModules: ['hr'] }), /默认入口最多选择 5 项/);
  await assert.rejects(controller.save(request, { homeTitle: '首页', homeSubtitle: '', defaultHomeModules: ['input', 'report', 'history', 'reminders', 'schedule', 'onboarding'] }), /默认入口最多选择 5 项/);
});

test('banner upload rejects non-image bytes before changing settings', async () => {
  let updates = 0;
  const controller = new MiniappDecorationController({
    miniappDecoration: { upsert: async ({ create }) => create, update: async () => { updates += 1; } },
    auditLog: { create: async () => undefined },
  });
  await assert.rejects(controller.uploadBanner({ user: { id: 9 } }, { buffer: Buffer.from('not-image'), mimetype: 'image/png', size: 9 }), /有效的 PNG、JPG 或 WebP/);
  assert.equal(updates, 0);
});
