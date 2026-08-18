# Issue #193 内部部署与只读验收

## 基本信息

- 日期：2026-08-18
- 环境：阿里云 `8.163.60.0` 内部验收环境
- 部署前 commit：`5c6384d523cc8b251a2def04f47e99b3cdbd142a`
- 部署后 commit：`db36cc53d63f1db85e810bd72b0a8b21d86aedfa`
- 事实来源：部署、migration、运行态和真实管理员 UI 验收由主控在既有授权下完成；本 session 只固化已经复核的证据
- 结论：Issue #193 的仓库实现已完成内部部署、schema/backfill 与只读 UI/历史快照验收；真实 Hifly 尺寸效果、
  外观保真、积分链路和公网可信 TLS 仍未验收

## Git、备份与回滚

- GitHub `main`、服务器 Git 与运行 App 最终固定为 `db36cc53d63f1db85e810bd72b0a8b21d86aedfa`；服务器
  `main...origin/main` 和工作树均 clean。
- 阿里云到 GitHub 的直连历史不稳定，本轮使用本地 verified Git bundle 将服务器从 `5c6384d` fast-forward 到
  `db36cc53`，没有混入其他分支或工作区改动。
- 部署前数据库备份：`/var/backups/hifly/hifly-20260818T090310Z.dump`，580188 bytes。
- 旧 App 回滚镜像：`hifly-pilot-app:rollback-5c6384d-20260818`，image
  `sha256:3270e60aa44640e6c1cfc89cadf068c8a312ca31d5a1efaecb3febf65d9c6690`。
- 新 App image：`sha256:d9cf8c8099091e182dc7674c00c9350755b417254c1af50c8d678a26011c0e4e`，OCI revision
  label 为 `db36cc53d63f1db85e810bd72b0a8b21d86aedfa`。
- 构建使用 `/opt/hifly-runtime/Dockerfile`；它与仓库 Dockerfile 的唯一长期差异仍为阿里云 Debian apt 镜像。

## Migration 与已有数据

- `migrate:production` 的 13 组 migration 全部成功。
- `project_content_product_revisions.physical_dimensions` 为 nullable JSONB，object check constraint 存在。
- `video_plan_versions.presentation_size_code` 为 NOT NULL、默认 `smart_fit`，六档 check constraint 存在。
- 既有 10 个 ProductRevision 的 `physical_dimensions` 全部保持 SQL `NULL`；没有从图片或旧文本推断尺寸。
- 既有 6 个 VideoPlan 全部安全回填 `smart_fit`，invalid=0。
- 除 schema migration 与上述确定性回填外，本轮没有修改商品、文案、人物、方案、订单、attempt、Work、交付或
  其他生产业务对象，也没有生成新交接包。

## 容器与 fail-closed 运行态

- 只 recreate App；App healthy 后 restart Proxy。PostgreSQL 未重启，其 `startedAt` 保持
  `2026-08-09T16:39:22Z`。
- 最终 App、PostgreSQL、Proxy 均 healthy；公网和 loopback `/healthz` 均返回 `{ "status": "ok" }`。
- Cloud Executor 保持 `exited / running=false / exit=0`；运行配置保持
  `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`，且 `HIFLY_API_TOKEN` 未配置。
- 部署前后最终 SQL 均为 `eligible=0`、`active_attempts=0`、`waiting_orders=0`；`total_attempts=15` 仅为历史记录。

## 代码与隔离测试证据

- 部署的 `project.html`、`project.js`、`plan.html`、`plan.js`、`production.html`、`production.js` 与
  `db36cc53` 仓库内容逐字节一致，6/6。
- 候选 App image 在 `--network none` 下运行 Issue #193 相关隔离组：ProjectContent、VideoPlanning、
  ManualHandoff、Local package compiler、Cloud Playwright adapter 和 batch runner，共 139/139 pass。
- 这些证据证明部署内容与仓库目标一致并通过隔离回归；它们不是 Provider E2E、真实生成效果或积分证据。

## 真实管理员只读 UI 验收

### 商品资料

- 真实防晒霜 current revision `f3b97d50...` 显示“实物尺寸”区域。
- 页面提供高度、宽度、可选深度及 `mm/cm/m`，可选容量 `ml/l`，可选重量 `g/kg`。
- 数据库与 UI 当前均为未知/`NULL`，页面明确留空且不从图片推断；本轮没有保存或改写该 revision。

### 视频方案

- Product `c2b3404c...` 的当前 Plan `22483a28...` v1 为 `frozen/approved`。
- “商品呈现大小”显示飞影原生六档：智能适配、超大、大、中、小、超小；既有方案安全显示
  `smart_fit / 智能适配`。
- 页面明确说明原生档位不保证瓶盖、包装、标签或商品形态保真。本轮没有 derive、save、preflight 或 review 写入。

### 生产历史快照

- 历史 order `dcb2c786...` 创建于 Issue #193 之前，其冻结 `input_snapshot` 不含 `physical_dimensions` 或
  `presentation_size_code`。
- Production 页面诚实显示“实物尺寸：未知 / 商品呈现大小：未设置”，没有使用迁移后的当前 Plan 反向篡改历史快照。
  只有新工单才会固定新字段。
- 三页 console errors 均为空；验收结束后浏览器恢复到用户原来的 `assets.html`。

## 已知 P1 与后续顺序

- #190 仍 OPEN：真实 Project 页面仍可看到 `work_video` 混入“商品图片”选择器。本轮未修复。
- #191 仍 OPEN：Worker 关闭后，Production 顶层摘要仍错误显示生产门禁未通过；下方历史工单与 Work 真值保持。
  后续修复不得弱化 Worker off、唯一 eligible、零初始 attempt、active attempts=0、terminal 关 Worker、失败停批与
  不自动重试合同。
- 后续继续严格串行 #190 → #191。Issue #193 的真实效果验收是另一条独立门禁，不得借修复 P1 自动触发生成。

## 未验证边界

- 未访问 Hifly、未启动 Cloud Executor 或 Local Agent、未 claim 工单、未新增 attempt、未生成视频、未消耗积分。
- 本次 UI 验收只证明功能可见、迁移默认与历史快照真值正确，不证明新商品大小的真实生产效果、外观保真、
  Provider E2E 或积分链路。
- 下一次真实生成仍须独立零-attempt 工单和单条积分授权，失败立即停止且不自动重试。
- 入口仍为 IP + 自签证书；正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 尚未完成，不能宣称公网生产就绪。

## 文档收口门禁

本 docs-only 收口严格限制为：

```text
docs/status/CURRENT.md
docs/ROADMAP.md
docs/status/sessions/2026-08-18-issue-193-internal-deployment.md
```

固定 head 必须通过 `npm run check`、`git diff --check`、strict allowlist 与固定 head CI 后，才交给主控独立审阅。
