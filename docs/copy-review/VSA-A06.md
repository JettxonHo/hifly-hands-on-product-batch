# VSA-A06 文案人工审核与失效传播

> 对应 Issue #62；依据 D-025、D-028 与 `docs/frontend/VSA-A04-A06_UIUX_DESIGN.md`。

## 交付范围

- `HumanReview` 与 `QualityResult` 完全分离。QC `passed` 只提供提交资格，不产生批准。
- 每次提交创建不可变审核周期；状态变化写 append-only transition/event；mutable head 仅提供当前状态和 `row_version`。
- active member 可查看与提交；当前身份模型中 admin 可批准、要求修改和撤销；本人审核允许并记录 `review_mode=self_review`。
- 批准时服务端重新验证 frozen 且未 superseded 的 CopyVersion、当前有效 QualityResult、effective passed、current ready ProductRevision、QC Profile 与 rule version。
- 商品事实、CopyVersion、QC policy 或精确 QualityResult 变化会在读取或命令路径追加 revoked 事件。展示名等非生产元数据不会撤销。
- revoked 不恢复。重新提交创建新的 HumanReview，旧周期与事件永久保留。
- `getCurrentApprovedGate` 与 `/api/copy-versions/:id/approved-gate` 可供后续 A07/A08 复用；本轮未实现下游页面。

## 幂等与失效协调

- submit/approve/request-changes/revoke 先按 Organization、命令类型、`Idempotency-Key` 和请求 fingerprint 读取 receipt，再访问动态 gate。相同 key 与相同 payload 返回该业务命令完成时的审核 head；即使之后上游失效，也不把历史命令回放改成新失败。相同 key 的不同 payload 返回 `IDEMPOTENCY_CONFLICT`。
- 商品 ready revision 派生、子 CopyVersion 冻结并 supersede 父版本、新 QualityResult 完成、Finding resolution 改变 effective conclusion 后，现有单体服务通过明确的进程内 coordinator 同步请求审核 reconcile。它只连接这些已知命令，不是通用 event bus 或 Outbox；同一批准只会追加一次 revoked。
- 当前 QC policy resolver 没有可变策略命令。未来若增加策略修改命令，完成持久化后必须调用同一 copy-version reconcile；在此之前，审核读取和下游 approved gate 的动态 policy 重验仍会持久化撤销。
- 协调调用发生在上游事务提交后，与上游写入不是跨模块原子事务。若进程在两者之间中断，审核读取与每次下游 gate 重验负责兜底；本轮没有为此引入分布式锁或 Outbox。

## 批准竞态口径

批准先执行完整 gate，写入 approved transition 后、返回前再执行一次权威 gate，随后返回投影仍会再做读取兜底。final gate 或返回投影发现已完成的上游变化时，服务都在返回前追加 revoked，并把本次批准 receipt 的业务结果同步修正为 revoked。可控 barrier 测试分别覆盖“首次 gate 通过 → 上游变化完成 → transition/return”和“final gate 有效 → 返回投影前上游变化完成”；首次结果与同 key 回放均为 revoked，撤销事件只追加一次。

最后一次检查之后仍存在不使用分布式锁时无法消除的极窄并发窗口，因此 approved 不是可长期缓存的授权；`getCurrentApprovedGate` 及未来 A07/A08 下游命令每次都必须重验，并在发现漂移时持久化撤销。

## 数据与迁移

- 独立 ledger：`copy_review_schema_migrations`。
- 不可变表：`copy_human_reviews`；append-only 表：`copy_human_review_events`。
- `copy_human_review_heads` 是带乐观版本的当前投影；幂等 receipt 和审计事件与业务变化同事务写入。
- 迁移命令：`npm run migrate:copy-review`。生产启用前须按 A01→A06 顺序完成前置模块迁移。
- 配置：`gui.copyReview.enabled=true`，且 identity、projectContent、copyGeneration、copyQuality 必须同时启用。

## API

- `GET /api/copy-versions/:copyVersionId/review`
- `GET /api/copy-versions/:copyVersionId/approved-gate`
- `POST /api/copy-versions/:copyVersionId/reviews`
- `POST /api/copy-reviews/:reviewId/approve`
- `POST /api/copy-reviews/:reviewId/request-changes`
- `POST /api/copy-reviews/:reviewId/revoke`

所有命令使用 `Idempotency-Key`。决策与撤销还要求 `expected_revision`；要求修改与手动撤销必须提供非空 `reason`。

## 界面

`/copy.html` 右栏复用既有 tokens/components，增加 `[质检] / [审核]` tabs。审核页逐条展示门禁、权限说明、批准摘要 Dialog、修改/撤销理由 Dialog、self-review、revoked amber 阻断和完整历史。A07 尚不存在时只显示禁用说明，不提供假链接。

## 验证与边界

- 服务/API：提交、批准、要求修改、撤销、self-review、401/403、跨 Organization、gate 前幂等重放/冲突、并发决定与批准竞态、命令主动失效、读取兜底、无关元数据不失效、revoked 新周期。
- PostgreSQL 16.14 clean migration/integration 实际通过。
- 系统 Chrome 完整流程实际通过；1440 与 390px 无横向滚动。截图仅在 `/private/tmp/hifly-a06-visual-qa/`。
- 本轮使用 controlled evaluator/rewriter 与内存测试仓储，不是真实模型或 Provider 验证。
- 未访问 Hifly、未运行真实飞影生成、未消耗积分。
