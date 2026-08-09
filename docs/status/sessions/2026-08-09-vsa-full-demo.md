# A01-A14 本地演示入口实现

- 日期：2026-08-09
- 角色：IMPLEMENTER
- 请求的自定义 Agent：`luna-worker`
- 配置：`~/.codex/agents/luna-worker.toml`，`gpt-5.6-luna`，推理强度 `max`
- 配置状态：`CONFIG_VERIFIED`
- 运行时模型：`UNVERIFIED_RUNTIME_MODEL`（当前工具未暴露实际模型身份）
- worktree：`/private/tmp/hifly-vsa-full-demo`
- 分支：`codex/vsa-full-demo`
- 基准：`origin/main @ 3aa4cf0`

## 改动

- 新增 `npm run demo`、`npm run demo:stop`、显式 `npm run demo:reset`；Docker Compose 使用独立 project、volume 和 loopback DB 端口。
- 新增 Node-only demo compose/DB readiness/migration/server 编排；migration 顺序固定为 identity、assets、projectContent、copyGeneration、copyQuality、copyReview、avatarSelection、videoPlanning、productionOrders、manualHandoff、manualExecution、artifactVerification、workDelivery。
- 新增缺失的 manual-execution migration CLI。
- 新增 demo 专用配置和 server：全量 A01-A14 feature、controlled provider/evaluator、fake executor、disabled capture transport、loopback `/login.html` 和固定本地临时凭据首次改密提示。
- 更新 README 与 `docs/ENVIRONMENT.md`。

## 验证

- `node --test test/demo-*.test.js`：10 tests / 10 pass。
- `npm run check`：通过，186 个 JavaScript 文件。
- `git diff --check`：通过。
- `npm test`：813 tests / 768 pass / 0 fail / 45 environment skips。
- 独立 worktree 移除指向根目录空依赖目录的 symlink 后执行 `npm ci`；没有修改根工作区或其 `node_modules`。
- Docker 实跑：`55432`～`55434` 已被其他本地数据库占用，端口探测自动选择 `127.0.0.1:55435`；PostgreSQL healthcheck 正常，13 组 migration 全部完成。
- 本地浏览器实跑：`/login.html` 临时密码登录 → 强制改密 → `/projects.html`；项目、素材中心、作品库、成员管理入口可见。验收后已 reset 数据库并重新启动干净环境，临时密码恢复为初始值。

## 安全与积分

- 未访问飞影、未读取飞影登录态、未调用真实 Provider/Capture HTTP/Playwright/影刀，未消耗积分。
- demo 的真实 capture runtime auth 和 transport 均 fail-closed；`realLive.batch.enabled` 为 `false`。
- `demo:stop` 默认保留 demo volume；`demo:reset` 才删除专用数据库 volume，不触碰 identity compose 测试库，也不删除 `.local-demo/` 文件。
