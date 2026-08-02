# 项目当前状态

> 最后更新：2026-08-03
> 最后验证 commit：`7157d07` (fix(core): make capture execution completion deterministic (#38))
> 稳定 main commit：`7157d0799d60ca7cbb5d3cc2939bf5924a23bf4e`

## Open PR

- **CORE-004 / Issue #33**：portable-path API 边界加固（`fix/core-004-safe-portable-path-boundaries`），**待审查，未合并**。

## 当前工作分支

`fix/core-004-safe-portable-path-boundaries`（基于 `7157d07`，独立 worktree，等待审查）

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

- **CORE-004（进行中，PR 待审查）**：portable-path API 边界加固（Issue #33）。
  - **统一安全语义**：模块只有一套私有验证核心（`normalizeAndValidatePortablePath`）与一个 segment 验证循环；`toPortableRelativePath`、`assertSafeRelative`、`relativePortablePath`、`fromPortablePath` 全部执行同一规则，fail-closed：必须 string（null/undefined/非 string 抛 TypeError）；先规范化 `\`→`/` 再验证；拒绝空串、裸 `"."`、内嵌 `"."` 段、`..` traversal、空段、绝对 POSIX/Windows drive/UNC/单反斜杠 rooted。纯分隔符转换隔离为模块私有 `normalizePortableSeparatorsUnsafe`（不导出）。**旧 `assertSafeRelative` 放行空串/`"."`/内嵌 `"."` 段的公开绕过入口已删除**，不得有任何公开 validator 允许空路径或 `"."`。
  - **参数边界**：`relativePortablePath(from, to)` 要求 from/to 均为当前平台 absolute path string；`fromPortablePath(root, portablePath)` 要求 root 为 absolute path string；相对或非 string 参数在边界拒绝（不再隐式依赖 `process.cwd()`）；错误为稳定边界错误，不来自 Node 内部偶然异常。
  - **person pool 契约**（`person-pool.js` 与 `person-strategy.js` 语义一致，共享窄范围 helper `src/core/person-pool-files.js`，不再重复实现）：配置 rootDir 先经 `resolveFromRoot` 解析为 absolute filesystem path；持久化路径始终从项目根（`config.__rootDir`）到 absolute file 重新计算（`relativePortablePath(projectRoot, absoluteFile)`），配置值本身不直接持久化。**relative rootDir 支持；absolute rootDir 位于项目根内支持，且与 relative 形式产生完全相同的 persisted POSIX 路径；absolute/traversal rootDir 越出项目根 fail-closed，在 `readdirSync` 前拒绝、不读取外部目录**；缺 absolute `__rootDir` 的配置抛稳定边界错误。**containment 双层**：lexical（`relativePortablePath`，在任何 FS 操作前拒绝 `../`、absolute 外部、跨盘）+ **canonical realpath**（`readdirSync` 前 canonicalize 项目根与 pool 目录，canonical pool 必须等于 canonical 项目根 + lexical 相对路径；**中间目录组件的 symlink/junction 重定向一律 fail-closed 拒绝**，项目根本身可经 symlink 启动）。枚举仅接受 `dirent.isFile()` 的常规文件 + 允许扩展名：**symlinked image entry 不进入候选列表**（不返回、不被策略选中、不成为 `__resolved_person_image_path`、不持久化）。
  - **Hifly 下载**：`downloadArtifact` 先把 destination 在项目根（`config.__rootDir ?? process.cwd()` 明确 fallback）下解析为 absolute filesystem path（**默认相对 `downloadDir`（如 `"downloads"`）、显式相对 destination、absolute destination 均支持**；不经 `path.resolve` 隐式依赖进程偶然 cwd），再在 `saveAs` 之前计算并验证 relative path（先验证后副作用）；越界/traversal destination 在创建文件前抛错（saveAs 零调用、外部目录零写入），合法下载（含 `submitAndDownload` 生产调用链）的文件名与 persisted relative path 不变。
  - **持久化格式不变**（POSIX `/`），无 batch 迁移。旧 null/空值放行与 absolute rootDir 静默持久化绝对路径的行为为有意移除的安全契约修正。
- **CI-002（已完成，由 PR #38 squash 合并）**：Windows capture completion timing flake。PR #38 squash commit `7157d0799d60ca7cbb5d3cc2939bf5924a23bf4e`，mergedAt `2026-08-02T18:35:28Z`；合并后 main CI run `30761463482` Ubuntu/Windows 双绿（check：Checked 67 JavaScript file(s)；test：477 total / 461 passed / 0 failed / 16 skipped；validate：Validated 3 product row(s)；git diff --check success）。已合并其已证明的 lifecycle、Windows rename、snapshot 与 idempotency 修复：
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
    - **第四轮：per-batch queue 读写协调 + idempotency 背压（commit `b1d9d26`，owner 第四轮 review 的 3 个合并阻塞项；取代第三轮 generation 方案）**：
      (1) **snapshot cold read 与 commit 竞态**——第三轮的「generation + LRU」有缺陷：LRU 驱逐删 generation 后 cold read 仍可能用 stale V1 覆盖新提交 V2。**废除 generation**，改用 **per-batch operation queue**（`enqueueBatchOperation`）：同 batch 的 `update` 与 cold `readCommitted` 共用一条 queue 串行——cold 先进则先回填当时已提交值、随后 update 提交覆盖；update 先进则提交后 cold recheck 命中新值；并发 cold read 合并（仅 1 次磁盘读回填，其余命中 snapshot）。**无全局锁、跨 batch 并行**；hot GET 轮询仍无锁、无磁盘读；bounded LRU/atomic rename/rename retry 保留。确定性测试（注入 read/rename gate，零 sleep）：cold-first / update-first / 驱逐压力下仍取最新值 / 50 并发 cold read 合并。
      (2) **idempotency 容量驱逐未过期 receipt（违反 TTL 内不得重复执行）**——改为**容量背压**：`reserve` 先清过期 settled receipt，满载（≥maxEntries，默认 512）则拒新 key 返回 **503 `IDEMPOTENCY_REGISTRY_FULL`**，**不驱逐任何未过期 receipt**（active 与未过期 settled 均不删）；仅清过期 settled 与显式 release 的未接受 receipt。`apiError` 将 `SERVER_STOPPING`/`IDEMPOTENCY_REGISTRY_FULL` 映射 503。PR 文档注明：超 512 个仍处保护窗口的 receipt 时新 execution 得 503 背压直到最早 receipt 过期（安全取舍，非缺陷）。
      (3) **active receipt 按普通 TTL 过期（长任务失去重试保护）**——receipt 增 `settledAt`；`isExpired` 仅在 `active===false && expiresAt 有效 && now≥expiresAt` 为真，**active receipt 永不过期、永不被容量删除**；**settled TTL 从 settle 时刻起算**（非 accept）。`start()` 用 `reserve/accept/settle/release`（duplicate→stopping→executor→active→reserve→async lock/prep）。确定性测试：active 超 TTL 仍命中、TTL 从 settle 起、满载 503 背压（原 key 仍 409、executor 不增）、过期清理、safe-stop active 阶段超 TTL 后同 key 仍 409。**重启不保证幂等（已知限制，不新增持久化）**；executionId 仍=executionKey。
    - **stale-writer 测试改为确定性**：真实驱动一次竞态 INTERRUPT_UNKNOWN 写入到 completed，断言被拒绝。
    - **恢复原始用户路径回归**：POST /api/executions → 周期 GET /api/batches/:batchId → 严格断言 completed+recorded，不允许 interrupted_unknown、不扩大 5s 预算，失败时输出观察到的状态时间线+持久化 item/batch/capture/execution_error+provenance。
  - **确定性验证**：全量 461 pass/0 fail ×3（含 per-batch queue / 背压 / TTL-from-settle 等新测试）；batch-store ×100（cold/update queue+驱逐+合并）、idempotency-registry ×100（active 不过期+背压+TTL-from-settle）、server-api ×100（polling+rename-fault+idempotency 集成+503 背压+safe-stop-over-TTL+capture lifecycle+completion）均 0 失败；`npm ci/check（67 文件）/test/validate` 与 `git diff --check` 全绿；全程注入 gate/clock/rename/read，零真实 sleep。
  - **Windows 专项压力**：`.github/workflows/capture-stress.yml` 现对 lifecycle 相关路径在 `pull_request` 触发（另保留 `workflow_dispatch`），重复原始轮询+completion API+deterministic 测试 **≥20 次**，任一失败即失败并保留 TAP（状态时间线+provenance）。**最新 head `b1d9d26` 已达成 20/20**：stress run `30760463897` `reps=20 failed=0`、标准 CI run `30760463905` Ubuntu/Windows 双绿。历史：retry-only（`ea6ad08`）19/20 → snapshot reader（`f9d2577`）20/20 → 第三轮三修复（`75bc688`/`f2c2faf`）20/20 → 第四轮 per-batch queue + 背压（`b1d9d26`）20/20。门禁引用最新 head，不引用旧 commit。
  - **待办**：Issue #37 保持 Open，直到原始 `interrupted_unknown` 有确定 provenance，或被压力充分证明不再出现。**最初 `interrupted_unknown` 的精确写入者仍未获得 provenance 证据，不得视为根因已完全解决。**

## 下一步（最多 5 项）

1. 审查 CORE-004 PR（portable-path 边界加固，Issue #33）。
2. CORE-004 合并后推进 CORE-001：batch schema version 与 migrations。
3. 推进 CORE-002：crash-recovery fault-injection tests。
4. 推进 CORE-003：stale execution-lock recovery。
5. 继续观察 Issue #37 provenance（原始 `interrupted_unknown` 写入者）。

## 必须禁止的操作

- 未授权访问飞影 / 运行 Playwright 真实出片 / 运行 Capture HTTP real_live 或 real_batch。
- 执行 MULTI-002。
- 提交 config.local.json、登录态、batches、outputs、视频、HAR、日志、截图、node_modules、docs/resume/。
- 回滚/删除用户未提交文件。
- 执行 git reset --hard / git clean -fd / 修改 stash。

## 最近一次验证

```
main commit: 7157d07 (PR #38 squash merge)
GitHub Actions run ID: 30761463482 (event=push, branch=main, headSha=7157d07)
npm run check: Checked 67 JavaScript file(s) ✓
npm test: 477 tests / 461 passed / 0 failed / 16 skipped ✓
npm run validate: Validated 3 product row(s) ✓
git diff --check: ✓
Ubuntu CI: success ✓
Windows CI: success ✓
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
