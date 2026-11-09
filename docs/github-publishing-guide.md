# GitHub 保存与协作指南

## 先理解三个动作

- **工作区修改**：电脑上的文件变化。
- **提交（commit）**：在本地保存一个有说明的代码版本；此时还没有上传。
- **推送（push）**：把本地提交上传到 GitHub。

GitHub 只保存代码和文档，不会自动部署生产服务器，也不会替代数据库备份。生产发布继续使用仓库里的部署脚本。

## 本项目当前状态

- 本地仓库已在 `E:\mixiongreport`，默认分支是 `main`。
- `origin` 已配置为 `https://github.com/ljshx8866/mixiongreport.git`。
- 本地项目基线已提交，提交说明为 `chore: prepare project handover and GitHub baseline`。
- GitHub CLI（`gh`）未安装。用户已确认当前远程仓库归其管理且为 Private。2026-11-09 首次推送失败是因为命令行代理环境变量指向未监听的本地端口；改用当时已运行的本机系统代理后，GitHub HTTPS 正常，项目已成功推送到 `origin/main`。代理端口可能变化；如再次失败，检查命令行代理和系统代理是否一致，不要把代理凭据或 token 写入仓库/全局 Git 配置。

**建议仓库设为 Private（私有）**。系统包含经营流程、员工功能和部署配置。即使仓库私有，也不要上传真实密钥、个人资料或数据库备份。

## A. 如果现有 GitHub 仓库就是你的

1. 浏览器打开 [当前配置的仓库](https://github.com/ljshx8866/mixiongreport)，登录 GitHub，确认仓库归你管理且设置为 **Private**。如果不是你的仓库或不确定，不要推送；先在 GitHub 创建你自己的私有空仓库，并把新地址记下来。
2. 在 Codex 底部终端/PowerShell进入项目目录：

   ```powershell
   cd E:\mixiongreport
   git remote -v
   git status --short
   ```

3. 本地项目基线提交已经准备好。确认远端 `main` 没有别人新提交后，再上传：

   ```powershell
   git fetch origin
   git status -sb
   git push -u origin main
   ```

   如果 `git fetch` 或 `git push` 报网络错误，先修复公司网络、VPN 或 Git 代理。不要把访问令牌、密码或 SSH 私钥发给 Codex。

4. 如果 GitHub 提示远端有本地没有的提交，**不要使用 `git push --force`**。先停止，把 `git status -sb` 和 Git 提示发给 Codex，确认如何合并。

## B. 如果还没有 GitHub 仓库

1. 在 GitHub 网站点右上角 **+ → New repository**。
2. Repository name 可填 `mixiongreport`；Description 可填“米熊经营系统：门店经营日报、人事、排班与工时管理”。
3. 选择 **Private**。不要勾选初始化 README、`.gitignore` 或 License，因为本地项目已经有这些文件和 Git 历史。
4. 创建后复制 HTTPS 地址，例如 `https://github.com/你的用户名/mixiongreport.git`。不要复制或发送任何 token。
5. 在项目终端把 `你的仓库地址` 换成页面上复制的地址：

   ```powershell
   git remote set-url origin 你的仓库地址
   git fetch origin
   git push -u origin main
   ```

6. Windows Git Credential Manager 会通过浏览器完成 GitHub 登录/授权；不要在终端命令中写密码或 token。若它提示登录，按系统弹出的 GitHub 页面操作。

## 上传前的安全检查

本仓库 `.gitignore` 会排除真实环境文件、`release-staging/`、备份/dump、zip/tar 发布包以及小程序上传记录。`apps/miniapp/.env.production` 会保留在你的电脑供本地构建使用，但不应提交；可提交的是 `.env.example` 和 `.env.production.example` 这类模板。

推送前检查：

```powershell
git status --short
git diff --cached --check
git diff --cached --name-only
```

文件列表里不应该出现 `.env`、`.env.production`、`.sql`、`.sql.gz`、员工导出表、密钥、`node_modules`、`dist`、`release-staging` 或部署临时包。若发现凭据曾经提交过，应先按密钥类型轮换/吊销，再清理 Git 历史；仅删除当前文件不足以从历史中移除。

## 后续日常迭代

建议每个功能单独建分支，代码和测试通过后再合并到 `main`：

```powershell
git pull --ff-only
git switch -c feature/简短功能名
# 修改代码并执行相关测试
git add -A
git diff --cached --check
git diff --cached
git commit -m "feat: 简短说明"
git push -u origin feature/简短功能名
```

然后在 GitHub 网页创建 Pull Request，查看差异、合并到 `main`。修复问题可用 `fix:`，文档可用 `docs:`。如果你选择直接在 `main` 开发，也至少先 `git pull --ff-only`，再提交和推送。

GitHub 仓库私有设置、成员授权和 GitHub 登录由仓库所有者在网页完成。Codex 不需要也不应该接收你的 GitHub 密码或个人访问令牌。
