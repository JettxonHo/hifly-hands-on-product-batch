# Release-readiness 内部验收环境部署

## 基本信息

- **日期**：2026-08-13
- **执行者/工具**：主控会话在 Owner 明确授权下执行生产变更；本 session 由主开发会话据实固化
- **部署前 commit**：`40e92414d4ef4a4015da9bb3f709f775c67843b6`
- **部署后 commit**：`5e449021eee6802b51a220009a8a3620d9bd40f4`
- **环境**：阿里云 `8.163.60.0` 内部验收环境

## 目标与授权边界

本轮把已经合并的 #156 Works 深链修复与 #157 依赖治理部署到现有内部验收环境，并验证无副作用启动、
依赖实际加载和指定 Works 深链的只读页面行为。

Owner 本轮授权 SSH、数据库备份、production migration、App 与 Proxy 重启。未授权真实飞影生成、Worker
启动、生产任务领取或下载授权写入，因此这些动作均未执行。

## 部署前门禁

- 服务器 Git HEAD 为 `40e92414d4ef4a4015da9bb3f709f775c67843b6`，工作树 clean。
- App、PostgreSQL、Proxy 均 healthy；Cloud Executor 为 `exited 0`。
- 执行相关配置：

  ```text
  PRODUCTION_EXECUTOR=fail_closed
  LOCAL_AGENT_ENABLED=false
  CLOUD_EXECUTOR_ENABLED=false
  CLOUD_EXECUTOR_MODE=fail_closed
  CLOUD_EXECUTOR_CONCURRENCY=1
  ```

- standby heartbeat 环境变量仍为 true，但 Cloud Executor 容器保持停止。
- 部署前 SQL：`eligible=0`、`active_attempts=0`、`total_attempts=13`。

## 备份、传输与回滚

- 新数据库备份：`/var/backups/hifly/hifly-20260813T092726Z.dump`，533808 bytes。
- 回滚镜像：`hifly-pilot-app:rollback-40e9241-pre-5e449021`。
- 回滚镜像 ID：`sha256:658b0aa9c37f9f0daeaf051fe5e24b1e2a0c7f9c58a13feaaa90b4e6a478e3c8`。
- 因阿里云到 GitHub 的直连历史不稳定，使用本地已验证 Git bundle 将服务器快进；bundle 只携带
  `40e924..5e449021`，没有复制本地主工作区或其他分支的脏改动。

## 构建与 migration

- 使用 `/opt/hifly-runtime/Dockerfile` 构建新 App；它与仓库 Dockerfile 的唯一长期差异仍是阿里云 Debian
  apt mirror。
- 构建期间的生产依赖审计为 `0 critical / 0 high / 2 moderate`，未运行 `npm audit fix --force`。
- 13 组 production migrations 全部成功。
- Archiver 8 `ZipArchive` 在实际镜像中加载成功。
- 镜像内实际依赖版本：

  ```text
  @fastify/static 10.1.3
  archiver 8.0.0
  fastify 5.11.3
  sharp 0.35.3
  ```

## 部署动作与运行时结果

- 只重建 App；App healthy 后重启 Proxy。PostgreSQL 未重启，Cloud Executor 未启动。
- 部署后服务器精确 HEAD 为 `5e449021eee6802b51a220009a8a3620d9bd40f4`，Git 工作树 clean。
- 新 App image ID：`sha256:1d188bb9f69d3bb86c39cfca3c6599aa02e020b39e14781b60256ab9d72ad0ee`。
- App、PostgreSQL、Proxy 均 healthy；服务器本机和公网 HTTPS `/healthz` 均返回 ok，`login.html` 返回 200。
- 容器与目标提交文件校验：

  ```text
  web/works.js
  572d2746badd70876d464645ee84f8dbd99fce1fabb1264a0fa95605cd6796f9

  src/manual-handoff/manual-handoff-package-store.js
  340feb401759fb9365a9ea1a1cf04102acc4a5a0c61246bab991dc336c7c613f
  ```

- 部署后 SQL 仍为 `eligible=0`、`active_attempts=0`、`total_attempts=13`。
- Cloud Executor 仍为 `exited / running=false / exit=0`；App logs 只有正常 production startup。

## #156 部署后只读 UI 证据

主控使用现有已登录 Chrome 只读刷新：

```text
https://8.163.60.0/works.html?work=936e9b2e-027a-496b-9b3b-067f5b401cfc
```

结果：

- 首次选择严格为 query 指定的非首项 Work。
- 详情显示 `SKU003 · 麦香坚果脆`。
- 作品列表显示 10 条。
- 页面未重定向到登录页，console errors 为 0。

该证据证明 #156 修复已部署并在既有已登录会话中通过指定目标的只读运行时验证。它不是新登录流程、跨组织
不可见 ID 或鉴权下载的本轮复验。

## 未执行动作

- 未点击下载，也未创建新的 download authorization；Owner 本轮授权不包含该生产写入。
- 未访问 `hifly.cc`，未生成视频，未消耗积分。
- 未启动 Cloud Executor 或 Mac Local Agent，未 claim 工单，未新增 attempt。
- 未重启 PostgreSQL，未修改业务生产数据。

## 仍未完成的发布阻断

- 当前入口仍为 IP + 自签证书，严格 CA 校验尚未通过。
- 正式域名、DNS、可信证书签发与部署均未完成。
- 当前 HTTP `/healthz` 返回 200 而不是跳转到 HTTPS。
- 因此本轮只证明内部验收环境完成版本更新和只读 UI 验证，不得宣称公网生产就绪。
- Issue #157 应继续保持 OPEN，直到按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 完成可信 TLS、
  严格 CA 和 HTTP→HTTPS 验收。

## 仓库文档验证

```bash
npm run check
git diff --check
```

文档分支只允许修改 `docs/status/CURRENT.md`、`docs/ROADMAP.md` 和本 session；验证结果由 Draft PR 固定
head 完成后报告。

- `npm run check`：229 个 JavaScript 文件通过。
- `git diff --check`：通过。
- allowlist 检查：仅上述 3 份文档，无其他 tracked/untracked 文件。

测试或健康检查通过不等同于用户采用、正式 SLA 或公网生产就绪。
