# 服务器部署

本项目的 `compose.yaml` 启动 MySQL 8.4 与 NestJS API。API 仅绑定服务器的 `127.0.0.1`，可在确认域名与证书后通过反向代理提供 HTTPS。目标服务器需运行受维护的 Linux 发行版并支持当前 Docker Engine；不能在 CentOS 7 上按本流程部署。

## 首次启动

1. 在服务器安装 Docker Engine 与 Compose 插件。
2. 将仓库复制到服务器，复制 `.env.production.example` 为 `.env`。为应用库和迁移库分别生成 64 位十六进制密码（`openssl rand -hex 32`），并设置独立的 MySQL root 密码和 `API_KEY`。`.env` 不进入版本库。
3. 仅使用已验收的发布版本。先构建镜像，完成数据库备份与恢复演练，检查待执行迁移，再显式执行该版本已批准的迁移。人事 2.1 已于 2026-10-15 部署；其生产状态和后续开关变更见 `2.1-生产发布记录-20261015.md`。
4. 执行 `docker compose up -d --build`。API 容器启动时不再自动执行迁移。
5. 验证 `curl http://127.0.0.1:3000/health` 返回 `{"status":"ok"}`。
6. 请求日报时带 `x-api-key` 请求头。例如：

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3000/api/reports/daily?storeId=1&date=2026-09-27"
```

## 数据库迁移发布闸口

每次发布前，在隔离 MySQL 8 上用备份副本完成完整迁移和恢复演练，并核对 `prisma migrate status`。由发布负责人确认迁移清单后，才在维护窗口显式执行 `docker compose run --rm --profile ops migrate`，随后启动新版本 API。迁移服务只在手动运行时启用，并使用独立的 `MIGRATION_DATABASE_URL`；API 运行账号仅有业务库读写权限。迁移命令会应用代码中**所有尚未执行的迁移**，不能用于跳过或只选取某一个人事迁移。当前生产库迁移状态已核验为 up to date；不要在新发布中重放已应用迁移。

设置 `POS_ADAPTER=wuuxiang` 及吾享接入参数后，先用 `POST /api/sync/master` 导入门店和商品档案，再用 `POST /api/sync/{storeId}/{date}` 同步指定日期。`POS_LUNCH_SHIFT_ID` 与 `POS_DINNER_SHIFT_ID` 可在首次导入时设置 POS 市别映射；后续可通过营业时段配置接口调整。`POS_LOG_KEY` 可用 `openssl rand -base64 32` 生成，必须安全备份，丢失后无法解密历史同步原始数据。

人事入口、入离职、转店、排班工时、调薪、银行卡变更和敏感资料已在生产开启。身份证/银行卡数据由独立 `HR_DATA_ACTIVE_KEY_ID`、`HR_DATA_KEYS_JSON`（键 ID 到 32 字节 base64 密钥的映射）、`HR_DATA_LOOKUP_KEY`（独立 32 字节 base64 密钥）加密和查重；密钥仅保存在服务器 `.env` 和受控备份中，不可放入版本库或小程序。阿里云 OCR AccessKey 在后台配置并由 `HR_OCR_CREDENTIAL_ENCRYPTION_KEY` 加密后存入数据库；本次核验生产 OCR、审批通知及排班通知开关均已启用。

模拟数据只用于测试：`docker compose exec api npx tsx database/prisma/seed.ts`。生产环境不应导入模拟经营数据。

## 人事功能状态

当前生产迁移服务读取服务器发布目录中的迁移文件。本次核验到 49 项迁移均已应用，Prisma 返回数据库结构为最新状态。

微信审批与排班通知分别由 `HR_APPROVAL_NOTIFY_ENABLED` 和 `HR_SCHEDULE_NOTIFY_ENABLED` 控制。本次核验两项均开启；模板字段或用户订阅状态导致的单条发送失败应在消息通知/系统告警中检查。

真实吾享适配器和定时同步已在生产运行；历史人数和菜品分类口径问题记录于日报验收流程，后续校准不应覆盖原始 POS 返回记录。

生产 HTTPS 使用 `mixiong6.com`。发布前继续检查数据库备份和恢复、访问控制、运行日志及业务权限。
