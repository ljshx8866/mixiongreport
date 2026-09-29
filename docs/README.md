# 餐饮连锁门店经营日报系统 — 第一阶段

本仓库当前包含 NestJS API、Prisma/MySQL schema、模拟 POS 数据、日报计算引擎与自动测试。总部 Web 和微信小程序留待后续阶段。

## 模拟模式（无需 MySQL）

```powershell
npm install
npm run prisma:generate
npm run build
$env:REPORT_SOURCE='mock'
npm run dev
```

访问 `http://localhost:3000/api/reports/daily?storeId=1&date=2026-09-27`。模拟模式仅有山大店该日期的数据。根目录 `npm test` 运行公式与接口测试。

## MySQL 模式

创建 MySQL 8 数据库，按 `.env.example` 配置 `DATABASE_URL`，然后执行：

```powershell
npm run prisma:migrate
npm run prisma:seed
$env:REPORT_SOURCE='database'
npm run dev
```

模拟 POS 模式可 `POST /api/sync/1/2026-09-27` 重放示例数据。真实吾享接口模式设置 `POS_ADAPTER=wuuxiang` 与 `POS_CENTER_ID`、`POS_APP_ID`、`POS_ACCESS_ID`、`POS_LOG_KEY`，先调用 `POST /api/sync/master` 导入门店、分类与商品，再调用 `POST /api/sync/{storeId}/{date}`。同步使用精确的 POS 商品 ID，未映射商品将使同步失败并写入日志。真实响应会用 AES-256-GCM 加密存入同步日志。`SYNC_ENABLED=true` 才开启定时任务；每天 08:30 刷新 POS 主数据，09:00–23:00 每小时同步当日经营数据，次日 02:00 做最终同步。定时区使用服务器本地时区。

## API

- `GET /api/reports/daily?storeId=1&date=2026-09-27`：完整日报 DTO；除零返回 `null`，毛利字段在缺成本数据时为 `null`。
- `GET/POST/PATCH /api/stores`、`/api/categories`、`/api/products`：主数据维护（PATCH 使用 `/:id`）。
- `GET/POST/PATCH /api/users`、`POST /api/users/:id/stores`：用户及门店关联。
- `GET/POST /api/period-config`：营业时段配置。
- `GET/POST /api/power-config`：门店总用电计算方式。
- `GET/POST /api/daily-inputs`、`POST /api/daily-inputs/:id/submit`：人工填报与提交。
- `GET /api/report-states`、`POST /api/report-states/verify`、`POST /api/report-states/lock`：日报状态流转。
- `GET /api/sync/logs?storeId=1&date=2026-09-27`：同步日志。
- `POST /api/sync/master`：从吾享 API 导入门店、POS 分类与商品档案；商品分类始终以 API 返回的小类为准，小类缺失时使用大类。
- `POST /api/sync/{storeId}/{date}`：同步指定门店营业日的数据。

`status.complete` 要求销售、商品、已提交人工数据齐备，且销售渠道及营业时段校验通过。商品销量按 POS API 分类汇总，不在计算引擎中固定分类。日报一店一天通过表的唯一约束保证只有一套原始数据。

数据库模式要求 `API_KEY` 和 `JWT_SECRET`。`POST /api/auth/login` 返回 12 小时 Bearer Token；用户登录后的请求按角色和授权门店限制访问。`x-api-key` 仍可供服务器侧同步与首次初始化使用，不能放入前端或小程序。首次部署在尚无管理员时，可使用 API 密钥调用 `POST /api/auth/bootstrap` 创建管理员。数据库模式需要可访问的 MySQL；本环境未提供 MySQL 服务，数据库联调需在有 MySQL 的环境进行。

## 真实 POS 已核对口径

吾享接口文档见 [接口文档](https://doc.wuuxiang.com/showdoc/web/#/46?page_id=441)。日报销售额按已结账且未删除账单的 `income_total` 计算。堂食包含“堂食、外带”，外卖包含“外卖、自提”。午晚餐优先按配置的 POS `settle_shift_id` 汇总；未配置市别 ID 时按后台营业时段时间划分。团购人数和金额来自团购券核销接口，按 `pwDetailId + ticketCode` 去重。商品销量展开套餐内品项并排除套餐父项，按 POS 商品 ID 聚合。

2026-09-27 山西大学店的金额与旧日报示例完全一致：总销售 5644.74，午餐 4043.21，晚餐 1601.53，抖音 352.10/17 人，美团点评 157.20/8 人。入客数按销售收入分类“计算碗数”的菜品销量统计，套餐展开到明细，名称含“半份”的按 0.5 计算，全天汇总后四舍五入；结算明细含“员工餐”的订单不计入入客数和时段人数。菜品名称、分类、售价、成本和启用状态随 POS 主数据同步，其中日报分类使用 API 商品小类，小类缺失时使用大类。
