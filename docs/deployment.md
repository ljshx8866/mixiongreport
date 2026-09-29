# 服务器部署

本项目的 `compose.yaml` 启动 MySQL 8.4 与 NestJS API。API 仅绑定服务器的 `127.0.0.1`，可在确认域名与证书后通过反向代理提供 HTTPS。目标服务器需运行受维护的 Linux 发行版并支持当前 Docker Engine；不能在 CentOS 7 上按本流程部署。

## 首次启动

1. 在服务器安装 Docker Engine 与 Compose 插件。
2. 将仓库复制到服务器，复制 `.env.production.example` 为 `.env`，替换所有密码和 `API_KEY`。`.env` 不进入版本库。
3. 执行 `docker compose up -d --build`。API 容器启动时运行 `prisma migrate deploy`。
4. 验证 `curl http://127.0.0.1:3000/health` 返回 `{"status":"ok"}`。
5. 请求日报时带 `x-api-key` 请求头。例如：

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3000/api/reports/daily?storeId=1&date=2026-09-27"
```

设置 `POS_ADAPTER=wuuxiang` 及吾享接入参数后，先用 `POST /api/sync/master` 导入门店和商品档案，再用 `POST /api/sync/{storeId}/{date}` 同步指定日期。`POS_LUNCH_SHIFT_ID` 与 `POS_DINNER_SHIFT_ID` 可在首次导入时设置 POS 市别映射；后续可通过营业时段配置接口调整。`POS_LOG_KEY` 可用 `openssl rand -base64 32` 生成，必须安全备份，丢失后无法解密历史同步原始数据。

模拟数据只用于测试：`docker compose exec api npx tsx database/prisma/seed.ts`。生产环境不应导入模拟经营数据。

## 接入真实 POS 前

`SYNC_ENABLED=false` 保持关闭，先在一店一天验证接口结果和旧报表业务口径，再启用自动同步。真实吾享适配器已对山西大学店 2026-09-27 的金额、时段和团购核销做过在线验证；人数与商品分类仍待确认。

数据库备份、HTTPS 域名和服务器访问控制应在对外开放前配置。当前的单一 API 密钥只用于后端第一阶段联调；微信小程序和总部后台接入前需要按用户角色实现登录和门店级权限。
