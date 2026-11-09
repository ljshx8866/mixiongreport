# 当前生产部署（最近实际核验 2026-11-02）

- **生产服务器：** Ubuntu 26.04 LTS，项目目录 `/opt/restaurant-report`。具体 SSH 主机地址只保存在本机 SSH 配置中，不写入仓库。
- **生产域名：** `https://mixiong6.com` 与 `https://www.mixiong6.com`；两者均由 Caddy 自动签发并续期 HTTPS 证书，小程序生产 API 地址使用主域名。
- **服务：** Docker Compose 管理 MySQL、NestJS API、后台和 Caddy；MySQL 不对公网开放，API 仅监听服务器本机 `127.0.0.1:3000`。
- **数据：** 迁移后已完成主要业务表对账；验收记录见 [业务数据迁移对账](business-data-migration-reconciliation-20261024.md)。
- **备份与日志：** 数据库备份保留最近 3 个上海自然日内每天最新的一份；同步日志保留必要状态和错误信息，并清理过期的大型响应正文。规则见 [数据库保留策略](database-retention.md) 和 [备份保留策略](backup-retention.md)。
- **最近验证：** 2026-11-02 试岗历史迁移完成后，数据库迁移状态为 up to date（51 项）；API 健康检查通过，后台 HTTPS 返回 200。

## 当前安全与运行状态

- SSH 仅允许密钥登录，禁止 root 和密码登录；UFW 入站默认拒绝，只开放 22、80、443 端口。
- MySQL 没有映射公网端口；root 网络账号限制为容器回环地址。API 账号仅有业务库读写权限，数据库迁移使用单独的手动运行服务和账号。
- Caddy 已启用 HTTPS 和安全响应头；主域名与 `www` 子域名访问同一后台站点。
- 2026-11-02 结构迁移前生成并校验了数据库备份；每日备份定时器和自动安全更新在上次检查时处于启用状态。
- 磁盘、内存等瞬时容量数据以实际检查为准，不把旧快照当成当前指标。

## 自动备份状态

- 2026-10-28 曾发现备份定时器缺失，现已安装并启用 `restaurant-report-backup.timer`，每日北京时间 02:30 运行，最多随机延迟 5 分钟。服务通过 Bash 启动脚本，避免执行位遗漏导致任务失败。
- 最新已知的校验备份在 2026-11-02 生成，权限为 `0600`。备份不包含生产 `.env` 和员工敏感资料加密密钥；灾难恢复还需要把必要密钥另行加密保存在服务器之外，并定期做恢复演练。

## SSH 与发布

发布脚本 `scripts/deploy-fast.ps1` 使用本机 SSH 配置连接当前服务器，并以 `sudo -n` 执行远程部署。具体主机别名、账号和私钥路径应保留在本机 SSH 配置；不要把私钥或口令发到聊天或提交到仓库。

常规发布前运行完整构建与测试。后台/API 可分别增量发布；涉及 Prisma schema 时，先应用并确认数据库迁移，再使用脚本要求的迁移名发布 Prisma Client。小程序使用 `https://mixiong6.com` 构建，上传开发版后交由产品负责人手动提交审核和发布。

```powershell
./scripts/deploy-fast.ps1 -Target admin
./scripts/deploy-fast.ps1 -Target api -ApiCodeOnly
```

不要将生产 `.env`、API 密钥、POS 凭据或 OCR 凭据复制到客户端或提交到 Git。
