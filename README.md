# 米熊经营系统

这是米熊门店经营日报、人事、排班与工时管理系统的完整代码仓库。经营与人事功能共用一套账号、门店范围和权限体系。

## 项目入口

- [项目交接与开发避坑指南](docs/project-handover-and-engineering-guide.md)：架构、业务规则、兼容经验、常用命令和发布流程。
- [GitHub 使用与上传指南](docs/github-publishing-guide.md)：如何安全上传、日常提交和协作。
- [当前生产环境](docs/current-deployment.md)
- [增量发布步骤](docs/fast-deployment.md)
- [数据保留与备份规则](docs/database-retention.md)、[备份保留规则](docs/backup-retention.md)
- [门店小程序操作手册](docs/门店小程序使用手册.pdf)
- [人事管理 2.1 开发规格](docs/人事管理2.1开发规格.md)

新建 Codex 对话时，请先阅读仓库根目录的 `AGENTS.md` 和上述交接指南。可直接使用交接指南末尾的启动提示词。

## 项目结构

| 目录 | 内容 |
|---|---|
| `apps/api` | NestJS API、鉴权、POS 同步、人事与排班接口 |
| `apps/admin` | Vue 3 + Vite 后台 |
| `apps/miniapp` | Uni-app / Vue 3 微信小程序 |
| `packages/report-engine` | 经营日报计算逻辑 |
| `packages/hr-engine` | 排班、工时和人事领域计算逻辑 |
| `database/prisma` | Prisma 数据模型、迁移和种子数据 |
| `scripts` | 构建、增量部署、备份与数据维护脚本 |
| `deploy/systemd` | 服务器定时备份和日志整理单元 |

## 本地开发

建议使用 Node.js LTS 与 npm。首次初始化：

```powershell
npm ci
npm run prisma:generate
```

主要验证命令：

```powershell
npm test
npm run build
npm run build -w admin
npm run build:mp-weixin -w @restaurant/miniapp
npm run test:time -w @restaurant/miniapp
```

API 的本地运行需要 `.env` 中的配置；从 `.env.example` 开始设置。不要把生产环境配置、数据库备份或任何访问密钥提交到 Git。

## 生产发布

正式环境使用 Docker Compose。代码托管和生产部署是两件不同的事：GitHub 负责保存源代码；服务器发布仍按 `docs/fast-deployment.md` 执行。涉及数据库结构时，必须先完成备份和迁移，再发布与新 schema 匹配的 API / Prisma Client。小程序上传开发版后，由产品负责人通过微信公众平台提交审核与发布。

生产连接配置来自本机已设置的 SSH 环境。不要把私钥、口令或 `.env` 发到聊天或放入仓库。
