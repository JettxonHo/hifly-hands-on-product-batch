# 项目当前状态

> 最后更新：2026-08-02
> 最后验证 commit：`6f8e84e` (style(gui): refresh visual and interaction details (#15))
> 稳定 main commit：`6f8e84e`

## Open PR

无（PR #15 已由 owner 视觉确认后 squash 合并）。

## 当前工作分支

无

## 当前生产路径

- **默认批量生产**：Playwright 浏览器自动化（GUI → Fastify → 状态机 → Playwright → 飞影网页）
- **Capture HTTP**：默认关闭，仅作为实验/恢复能力，不替代 Playwright

## 真实积分授权状态

**当前没有真实飞影执行授权。**

- 不得执行 `MULTI-002`。
- `pointBudget` 表示本次最多执行任务数，不等于飞影实际积分数。
- 真实积分必须以飞影后台为准。

## 当前关键批次

| 批次 ID | 状态 | 说明 |
|---------|------|------|
| `batch-ec174f28-e9b8-4541-b2e7-c60b10e22474` | `real_batch_completed` | MULTI-001 已完成 (remote_id=652265)；MULTI-002 仍 pending |
| `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` | 混合态 | 历史 GUI 排障样本，不重跑 |

## 已知阻塞项

1. MULTI-002 需用户新会话明确授权积分后才可执行。

## 已知技术债

- CORE-004：portable-path API 边界加固（`toPortableRelativePath` 不强制验证，依赖调用者纪律）
- **CI-002（处理中，PR #38 待审查合并）**：Windows capture completion timing flake。
  - **首次失败**：main commit `afdb32b`，run `30718340154`，Windows job 测试 #328 `capture-enabled executions use a per-run HAR executor and mark capture recorded`，expected `completed` / actual `interrupted_unknown`（420 total / 403 pass / 1 fail / 16 skipped）；同 commit Ubuntu 通过；failed-job rerun 通过（**这是一次 rerun，非首次成功**）；前一 main commit `6f8e84e` Ubuntu/Windows 均通过。
  - **根因**：capture execution 缺单一 terminal-completion 边界——item `completed`（runBatch 内）与 capture `recorded`（coordinator `done.finally`，executor.close/HAR flush 之后）是两个独立 store.update，客户端只能轮询二者合取；Windows 事件循环/NTFS rename 停顿（且 `batch-store.js` 此前缺 rename 重试）拉长该窗口导致盲轮询超时。属**生产竞态**（`start.js` 生产 close() 同机制）。
  - **修复（方向 A）**：coordinator 暴露 `waitForCompletion` terminal 边界（runBatch + executor.close/HAR flush + terminal 持久化 + lock 释放全部完成后才 settle）+ terminal-transition guard（全 completed 才写 recorded）+ executor close 错误显式记录 + `batch-store.js` EPERM/EBUSY rename 重试 + 空 JSON body 容忍。
  - **确定性验证**：新增 8 个 deferred-barrier 测试；本地目标测试 100/100、capture 组 30/30、全量 3/3（412 pass/16 skipped/0 fail）、并发 8 压力 50/50；PR #38 标准 CI Ubuntu/Windows 双绿。
  - **测试中发现的第二处时序缺陷（已修复）**：slow-HAR 测试初版仍用盲轮询等待 `completed/recording` 中间态，在 Windows 慢机器上超时并泄漏 pending promise 级联取消后续测试（PR #38 run `30738227509` Windows fail #331-346）。已改为 `closeStarted` 信号握手（close 被调 ⟺ runBatch 已返回 ⟺ item 已 completed，即确定的 completed-未 flush 窗口），删除盲轮询 helper；修复后 run `30738426981` Windows/Ubuntu 双绿。这再次印证「不得把首次失败当噪声」。
  - **待办**：Windows 专项压力（`.github/workflows/capture-stress.yml`，仅 `workflow_dispatch`）需**合并到 main 后**由 owner 触发跑 ≥20 次完成最终验收；稳定 main commit 届时更新到真实通过压力验证的 commit。

## 下一步（最多 5 项）

1. 审查并决定 CI-002 修复 PR #38（合并后触发 Windows 压力 workflow 完成验收）。
2. 推进 CORE-001：batch schema version 与 migrations。
3. 推进 CORE-002：crash-recovery fault-injection tests。
4. 推进 CORE-003：stale execution-lock recovery。
5. 评审 EXP-001 人物策略实验方案。

## 必须禁止的操作

- 未授权访问飞影 / 运行 Playwright 真实出片 / 运行 Capture HTTP real_live 或 real_batch。
- 执行 MULTI-002。
- 提交 config.local.json、登录态、batches、outputs、视频、HAR、日志、截图、node_modules、docs/resume/。
- 回滚/删除用户未提交文件。
- 执行 git reset --hard / git clean -fd / 修改 stash。

## 最近一次验证

```
main commit: 6f8e84e (PR #15 squash merge)
npm run check: 66 JavaScript file(s) ✓
npm test: 420 tests / 404 pass / 16 skipped / 0 fail ✓
npm run validate: Validated 3 product row(s) ✓
git diff --check: ✓
Ubuntu CI: success ✓
Windows CI: success ✓
GitHub Actions run ID: 30718127693
```

## 重要文档索引

| 文档 | 用途 |
|------|------|
| `docs/status/CURRENT.md` | 当前状态唯一事实来源（本文件） |
| `docs/status/sessions/` | 每轮重要会话执行记录 |
| `docs/ROADMAP.md` | 版本目标与 Issue 依赖 |
| `docs/decisions/` | 架构决策记录 (ADR) |
| `docs/experiments/` | 实验设计与结果 |
| `docs/PROJECT_HANDOFF.md` | 历史接力记录（不再作为唯一当前状态来源） |
| `AGENTS.md` | 协作规范入口 |
| `docs/SOP.md` | 批量生产标准操作流程 |
| `docs/ENVIRONMENT.md` | 运行环境与打包说明 |
| `docs/CALIBRATION.md` | 飞影页面校准清单 |
