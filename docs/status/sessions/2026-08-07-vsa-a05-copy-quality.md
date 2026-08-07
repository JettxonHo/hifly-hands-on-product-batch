# VSA-A05 / Issue #61 实现会话

- 逻辑角色：独立 IMPLEMENTER
- 分支：`codex/vsa-a05-copy-qc`
- 基准：`2484197964e203813ca5511102d0e7ccbdfc0384`（A04 已合并）
- 工作树：`/private/tmp/hifly-vsa-a05`
- 状态：Terra/High 最终复审追加的四项 Important 与主控追加的异步竞态均已完成 TDD 修复；
  最终独立复审结论为 `APPROVED`，未 commit、未 push、未创建 PR。

## 已完成

- QualityRun 技术状态与不可变 QualityResult/QualityFinding 业务证据分离。
- 受控异步 evaluator、业务结论聚合、技术失败安全重跑、取消、租约/心跳/过期恢复。
- profile/rule 版本完全由服务端 policy resolver 选择；客户端字段不再进入 API。关联
  ProductRevision 在 start/retry/rewrite 和 worker 完成前均须保持 current ready。
- 同版本/profile/rule 并发去重，跨幂等键仍只形成一个有效 Run。
- QualityFinding 已包含 severity、matched_text、evidence_reference、rule_source 与 suggestion，
  并贯通 memory/PostgreSQL/API/UI。
- Finding 逐条追加处理；接受必须填理由，hard block/fact gate 不可接受，无批量接受。
- 人工修改、返回商品事实与受控 AI 改写路径；RewriteJob 持久化 queued/running/succeeded/
  failed/timed_out 状态，支持租约、心跳、显式重试、刷新恢复与同键并发去重。worker 完成后才创建
  新 CopyVersion 并自动完整 QC；Dialog 只暴露改写范围和业务指令，不提供 Prompt 编辑器。
- memory 与 PostgreSQL repository、独立 migration ledger、组织隔离、审计、幂等和安全公开投影。
- A04 `copy.html` 增量右栏、390px 单列布局、技术失败恢复、历史质检；未实现 A06 操作。
- 配置样例、迁移命令和 A05 长期业务说明。

## 最终整改

- `startQualityCheck` 在冻结 draft 前先确认关联 ProductRevision 仍为 current/ready；service/API
  回归证明 stale 请求返回后文案仍保持 draft。
- `completeQualityRun` 在写入不可变 Result 前重新解析当前服务端 profile/rule policy。版本变化时
  Run 失败为稳定码 `COPY_QUALITY_POLICY_CHANGED`，不生成 Result；retry 使用当前 policy 创建完整
  新 Run。service、API 与 PostgreSQL 16 均覆盖该路径。
- 本轮未增加哈希/SHA 或与核心合同无关的防御逻辑。
- project-content `productRevisionPort` 新增正式 current-ready 查询；A05 通过 copy-generation 最小
  下游接口核对 `Product.current_revision_id`。child draft 尚未 ready 时，旧 ready revision 已不再
  current，QC 请求被拒绝且 CopyVersion 仍保持 draft。
- 已完成 QualityResult 增加读取时 `current_valid`/`invalidation_reason` 投影；事实或 policy 变化只
  阻断当前使用，不修改不可变原始 conclusion。API 与 UI 均覆盖，UI 使用 amber 阻断；失效
  Finding 保留历史卡片和证据，但接受、返回事实、人工修改、AI 改写按钮均不渲染。
- evaluator Finding 九个正式字段必须合法非空；不完整输出失败为 `QUALITY_EVALUATION_INVALID`，
  不再依靠默认文案补齐证据。
- AI 改写 Dialog 每次打开固定一个幂等键，请求期间同步锁定提交；快速双提交只发出一个请求。
  服务/API 同键并发仍只创建一个 RewriteJob。
- Rewrite Provider 调用可能跨越事实更新，因此 worker 在取得或恢复 rewritten body 后、创建
  CopyVersion 前再次核对 current ProductRevision。deferred rewriter 回归证明事实变化时 Job 以
  `COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT` 失败且 CopyVersion 数量不增加；不为之后的极小窗口
  扩张事务或锁设计。
- 历史列表逐 Run 读取产生的 N+1 查询保留为非阻塞后续建议，本轮不扩张优化范围。

## 验证

- 当前 `npm test`：673 tests，644 passed，0 failed，29 environment skips。
- 当前 `npm run check`：通过，检查 119 个 JavaScript 文件。
- PostgreSQL 16 clean isolated schema：1 passed、0 skipped；系统 Chrome 1440/390：1 passed、0 skipped；
  `git diff --check` 通过。最终截图位于仓库外 `/private/tmp/hifly-a05-final-visual-qa/`。
- Terra/High 最终复审结论为 `APPROVED`，无 Critical/Important；唯一 Suggestion 是后续将
  PostgreSQL Finding resolution 的逐条读取改为批量查询，不阻塞本轮。

## 未完成与真实风险

- A06 人工审核未实现，页面仅显示“尚未提交人工审核”，没有批准、打回或提交审核按钮。
- evaluator/rewriter 为受控测试替身，不是生产 AI Provider。
- 改写编排跨 A04/A05 repository，不伪装为单一数据库事务。Job 先持久化改写输出，再用 Job ID
  派生 CopyVersion/QC 幂等键；进程崩溃在 rewriter 返回前仍无法提供外部 Provider 的绝对 exactly-once，
  生产 Provider 接入时必须使用其幂等合同或可恢复请求标识。

## 外部服务与积分

- 未访问 Hifly，未发送真实外部 HTTP，未调用真实模型，飞影积分消耗为 0。

## 下一步

1. 由主控负责 commit、push、PR、CI 与合并；本 IMPLEMENTER 不执行 Git 写入。
2. CI 全绿后按 Owner 对 A04-A13 的既有授权合并并关闭 Issue #61。
3. A05 合并后按已批准批次流程进入 A06，不在本分支提前实现。

## 主控 Git 交付清单

建议单一提交标题：

```text
feat: add VSA-A05 copy quality workflow
```

提交范围应只包含以下逻辑组：

1. `src/copy-quality/`、`src/server/routes/copy-quality.js` 与 `scripts/migrate-copy-quality.mjs`：
   A05 domain/service/worker/repository/migration/API。
2. `src/copy-generation/` 三个受影响文件：仅为冻结 CopyVersion 派生子版本补充可重放幂等键，
   服务于 RequestCopyRewrite；不得夹带 A06 行为。
3. `src/server/app.js`、`src/server/start.js`、`config.example.json`、`package.json`：默认关闭的
   A05 装配、迁移命令和运行配置。
4. `web/copy.html`、`web/copy.js`、`web/copy.css`：现有 A04 工作区的质检右栏增量；不得出现
   “批准”或“提交审核”操作。
5. 四个 `test/copy-quality-*.test.js` 与 `test/helpers/identity-world.js`：domain/API/PG16/系统
   Chrome 证据。
6. `docs/copy-quality/VSA-A05.md`、本会话记录、`docs/status/CURRENT.md` 与 `GOAL.md`：长期合同
   与接力状态。

建议 PR 标题：`VSA-A05: add copy quality checks and finding resolution`。PR 正文应明确：

- 关联并在合并后关闭 Issue #61；A04 为已合并基线。
- 实现 QualityRun/Result/Finding 分离、逐条 Resolution、完整重检、组织隔离与历史保留。
- evaluator/rewriter 是离线受控替身；没有真实 LLM、Hifly、外部 HTTP 或积分。
- `passed` 不等于 `approved`，A06 HumanReview 明确不在范围内。
- 验证证据：673/673 无失败（644 pass、29 环境跳过）、真实 PG16 1/1、系统 Chrome 1/1、
  `npm run check` 119 文件、`git diff --check` 通过。
- 已知边界：A04 CopyVersion 创建与 A05 Run 创建不是单一数据库事务，但每一步均可幂等重放；
  生产 Provider 接入后仍需验证 Provider 自身幂等合同。

主控在提交前应再次确认 `git status --short` 不包含 `config.local.json`、登录态、批次、输出、
视频、HAR、日志、截图、`node_modules` 或 `docs/resume/`。CI 全绿且 diff 审查无新增
Critical/Important 后，可使用 Owner 已给出的 A04-A13 合并授权合并 PR 并关闭 Issue #61。
