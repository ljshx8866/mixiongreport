# 快速增量发布

日常小改动不再安装系统依赖或完整重建 Docker 镜像。`scripts/deploy-fast.ps1` 在本地构建并压缩目标产物，通过 OpenSSH 传到服务器，只更新正在运行的 `admin` 或 `api` 容器，并保留一个 `rollback-latest` 镜像。发布后脚本会做健康检查；失败时自动恢复上一镜像。无需在脚本或命令行参数中保存服务器密码，可用 SSH 密钥，也可由 OpenSSH 交互式询问。

```powershell
# 后台页面、样式、静态资源
./scripts/deploy-fast.ps1 -Target admin

# API 代码改动；仅当 Prisma schema、migration、依赖和环境配置都未变化时使用
./scripts/deploy-fast.ps1 -Target api -ApiCodeOnly

# API/Prisma schema 改动；须先应用并验证迁移，再部署生成后的 Prisma Client
./scripts/deploy-fast.ps1 -Target api -ApiWithPrismaClient -RequiredMigration 20261019100000_onboarding_hr_role_assignment
```

脚本通过本机 OpenSSH 配置连接现役生产服务器。连接地址、账号和密钥只保存在本机配置中，不写入仓库或命令历史。可用 `-Server`、`-RemoteUser`、`-SshKey` 覆盖。远程发布命令用 `sudo -n` 执行。脚本不会执行数据库迁移。普通 API 热发布必须使用 `-ApiCodeOnly`，并确认 schema、migration、依赖和环境均未变化。若 Prisma schema 已变化，先备份数据库并在生产库应用、验证 migration，再使用 `-ApiWithPrismaClient -RequiredMigration <已应用的迁移名>`；脚本会先核验迁移记录，再把 schema、migrations 和 API 代码传到服务器，并在 Linux API 容器内生成匹配的 Prisma Client 后发布。不要从 Windows 直接复制 Prisma Client 到 Linux 容器。包含依赖、环境变量或 Docker 配置变化的发布仍须走完整发布流程。后台健康检查使用 `https://mixiong6.com/`。

小程序另行构建并用微信开发者工具 CLI 上传开发版；开发版上传不等于提交审核或发布线上。

## 手动回滚

脚本把上一个容器镜像保存为 `restaurant-report-admin:rollback-latest` 或 `restaurant-report-api:rollback-latest`。确认目标服务后可回退：

```bash
cd /opt/restaurant-report
docker image tag restaurant-report-admin:rollback-latest restaurant-report-admin:latest
docker compose up -d --no-deps --no-build --force-recreate admin

# API 代码发布回退时使用：
docker image tag restaurant-report-api:rollback-latest restaurant-report-api:latest
docker compose up -d --no-deps --no-build --force-recreate api
```

回滚镜像仅覆盖程序版本；若发布涉及数据库迁移，不能用这套快速发布/回滚流程。

## 数据库备份保留与清理

`scripts/cleanup-backups.py` 仅处理 `backups/` 根目录中的 `*.sql.gz` 全量备份，不会遍历或删除其他文件。保留最近 3 个上海自然日（含今天）内每天最新的一份完整备份；删除同一天多余备份及超过 3 天的备份。保留前会校验 gzip CRC、MySQL/MariaDB dump 头及至少 5 个 `CREATE TABLE` 定义，避免将小型单表导出误当成全库备份；如果最近 3 天没有完整备份则停止，不删除任何文件。请在备份生成完成后运行；文件完整性检查不等于数据库恢复演练。

服务器空间不足时，先预览：

```bash
cd /opt/restaurant-report
python3 scripts/cleanup-backups.py --dir /opt/restaurant-report/backups
```

确认输出的 `DELETE` 文件后，按本项目已授权的保留规则执行：

```bash
python3 scripts/cleanup-backups.py --dir /opt/restaurant-report/backups --apply
```


