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
  - **已证明并修复的 lifecycle 缺陷**（均经确定性测试固定）：
    1. 缺供外部调用方等待完整 execution 生命周期的边界——此前只能轮询 `completed` 与 `capture.recorded` 两个独立持久化的合取。
    2. item `completed` 与 capture `recorded` 是两个独立 store.update，中间隔着 HAR flush。
    3. abort 时旧逻辑可能产生 `item=pending` 但 `capture=recorded` 的不一致。
    4. executor close / HAR flush 错误旧逻辑可能被吞掉，capture 停留在 `recording`。
    5. 已 settle 的 execution 可能让 capture 永久停留 `recording`（无终态）。
    6. `batch-store.js` 此前缺 EPERM/EBUSY rename 重试（**Windows 文件系统加固，非 `interrupted_unknown` 根因**）。
  - **尚未证明（Issue #37 保持 Open）**：首次 run `30718340154` 的 `actual interrupted_unknown` 不由上述解释——HAR flush 慢只能产生 `completed + recording`；状态机中 `completed`/`pending`/`confirmed`/`failed_pre_submit` 均无到 `interrupted_unknown` 的出边（仅 `generating_asset`/`asset_confirmed`/`submitted`/`download_pending` 可达）。**不把 NTFS/rename 延迟当作 `interrupted_unknown` 的确定根因**；具体写入者（哪个调用方/executionId/transition source、是否二次 runBatch、启动 recovery 或其他写入者）尚无 transition provenance 证据。
  - **新增诊断与修复**：
    - **transition provenance**：每次进入 `interrupted_unknown` 发出脱敏 `task.transition_provenance` 事件（batchId/taskId/executionKey/previousStatus/eventType/transitionSource/errorCode/timestamp），区分 executor_timeout/executor_interrupted_unknown/reconcile_ambiguous/recovery/explicit；新增测试证明正常完成路径零 INTERRUPT_UNKNOWN provenance。
    - **completion API**：改为 `GET /api/executions/:batchId/:executionId/wait`（幂等、无 body、不改动全局 JSON parser——原全局 parser 覆盖已撤销）；executionId 绑定 batchId 并对**持久化 execution snapshot** 校验（重启后仍可解析）；返回值为持久化 snapshot executionKey 而非用户 idempotencyKey；未知/跨批 id 返回 404 EXECUTION_NOT_FOUND（不 fallback 成 batchId）；settle 后释放内存注册项（无无界 Map）。
    - **capture 终态**：新增 `recording_interrupted`/`recording_failed`（含脱敏错误码 CAPTURE_RECORDING_INTERRUPTED/CAPTURE_HAR_FLUSH_FAILED 与中文标签「录制已中断/录制失败」）；settle 后不再停留 `recording`。
    - **batch-store rename retry** 改为注入 backoff/rename 的可控测试（EPERM/EBUSY 前 N 次后成功、超次数抛原错、临时文件清理、非重试错误立即失败，零真实 sleep）。**Windows 实测加固**：本 PR 恢复的原始 GET polling 回归在 Windows CI（run `30741311736`，测试 #340）暴露 `batch.json` rename 连续 5 次 EPERM（214ms 窗口）仍失败——并发轮询 reader + AV/索引器持锁超出旧 5×/100ms 窗口；已将 `batch-store.js` 与 `rpa-state.js` 的 retry 统一加固为 **8 次 / 封顶指数 backoff（10ms→250ms，最坏 ~1.2s）**，新增「第 6 次后仍成功」回归测试固定，非重试错误仍立即失败、持久锁仍抛原 EPERM。
    - **进程内 committed snapshot reader（机制级根治 Windows rename 竞态，commit `f9d2577`）**：诊断确认 Windows EPERM 的进程内根因——单 server 进程内 writer（每次状态迁移 rename `batch.json`）与高频 reader（GET 轮询每 0ms `readFile(batch.json)` 打开 handle）打同一文件。owner 决策：保留原子写、不扩大 5s 预算，改为消除进程内 reader/writer 竞争——`BatchStore` 维护进程内 committed snapshot（仅 rename 成功后 populate，恒为已提交值），GET `/api/batches/:id` 经新 `readCommitted()` 读快照（不打开文件、不与 rename 竞争）；强一致调用方（batch-runner/executions/imports/capture gates）仍读磁盘；冷启动/第二实例 snapshot 空→冷读磁盘并回填。retry+jitter 仅作外部 AV 锁容错（非主并发控制）。确定性测试（注入 rename fault、零真实 sleep）：readCommitted 命中不触文件+返回隔离 clone、与已提交写同步、冷启动回填、50 并发 reader 在 writer EPERM 重试窗口内**零 rename 调用**、原始 GET polling 路径在每次 rename 被 ~2/3 注入失败下仍 completed+recorded。`:2168` 500 测试改直接 seed 损坏文件（不经 store→snapshot 冷→冷读磁盘命中 parse 错），保留错误中间件脱敏语义。**仍非 `interrupted_unknown` 根因**。
    - **stale-writer 测试改为确定性**：真实驱动一次竞态 INTERRUPT_UNKNOWN 写入到 completed，断言被拒绝。
    - **恢复原始用户路径回归**：POST /api/executions → 周期 GET /api/batches/:batchId → 严格断言 completed+recorded，不允许 interrupted_unknown、不扩大 5s 预算，失败时输出观察到的状态时间线+持久化 item/batch/capture/execution_error+provenance。
  - **确定性验证**：本地原始轮询路径 100/100、新 wait 路径 100/100、capture lifecycle 组 30/30、全量 438 pass/0 fail ×3（含 5 个新 snapshot/fault 测试）；`npm ci/check/test/validate` 与 `git diff --check` 全绿；PR #38 标准 CI Ubuntu/Windows 双绿。
  - **Windows 专项压力**：`.github/workflows/capture-stress.yml` 现对 lifecycle 相关路径在 `pull_request` 触发（另保留 `workflow_dispatch`），重复原始轮询+completion API+8 个 deterministic 测试 **≥20 次**，任一失败即失败并保留 TAP（状态时间线+provenance）。**已达成 20/20**：snapshot reader 落地后 run `30743195838`（commit `f9d2577`）`reps=20 failed=0`（含此前失败的 iteration 11）；标准 CI run `30743195840` Ubuntu/Windows 双绿。此前 retry-only（`ea6ad08`）为 19/20（run `30741562516`，iteration 11 EPERM 超 ~1.2s 窗口）。
  - **待办**：Issue #37 保持 Open，直到原始 `interrupted_unknown` 有确定 provenance，或被压力充分证明不再出现；稳定 main commit 届时更新到真实通过压力验证的 commit。

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
