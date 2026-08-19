# 2026-08-20 Fidelity-A 领域/API 设计

## 任务与基线

- 任务：Issue #212，Fidelity-A 领域/API 设计 gate；docs-only，不实施。
- 精确 base：`origin/main@303ea9c762ee031839027242203a8cad8c4897b0`。
- 分支：`codex/fidelity-a-domain-api-design`。
- Worktree：`/private/tmp/hifly-fidelity-a-domain-api-design`。
- 生命周期：本次 Specification 与 D-036 随独立审阅后的 PR 合并进入 `main` 才计为 `designed`；实现、部署和 Provider
  验收仍为 pending。

## 真值审计

已读取 D-035、Fidelity-0 Evidence、D-028 领域状态机及当前 Asset、ProjectContent、CopyReview、AvatarSelection、
VideoPlanning、ProductionOrder、ManualHandoff、ExecutionAttempt、A12、WorkDelivery 的服务、路由和 migration 合同。

仓库已提供的可复用约定：

- Organization-scoped repository lookup 和不可见/不存在统一 404；
- immutable version + mutable current head + append-only event/audit；
- `Idempotency-Key`、payload fingerprint、`expected_revision`、409 optimistic conflict；
- 技术 run、业务 result 和人工 review 分离；
- AssetVersion 由服务端核验 media/size/checksum 后才 `available`；
- ProductionOrder 冻结 input snapshot，ExecutionAttempt、A12、WorkInspection 与 DeliveryRecord 各自持有真值；
- 现有生产激活要求 Worker off、唯一 eligible、当前 order attempts=[]、active attempts=0，失败停批且无自动重试。

Fidelity-0 只证明同 Profile 即时恢复，不证明长期/跨设备 Provider reference。当前 Production `ExecutionAttempt` 也不能
持有 lease 等待人工。因此没有发现需要 Owner 另选的未决产品分叉；由现有证据可唯一推荐 ProductionOrder 前独立候选门禁。

## 本次决定

1. `AppearanceCaptureRequest` 管理候选意图、管理员单次授权与短生命周期异步状态；创建 request 本身不访问 Provider。
2. `AppearanceCandidate` 只在候选 bytes 写入系统管理 AssetVersion 且服务端核验后创建，并绑定 exact 上游和
   `source_asset_version_id`；不保存完整 Provider URL 或凭据。
3. `AppearanceCheckRun/Result` 分离技术状态与逐维结论；`AppearanceReview` 与最终 `WorkInspection` 保持独立。
4. ProductionOrder 创建与 claim 前均验证 exact current candidate、readable bytes、current upstream、无 unresolved check、
   approved review 和 available Provider reference；任一未知零 attempt 阻断。
5. 分阶段 Production 执行被否决，除非未来取得正式 Provider API 与长期/跨节点恢复 Evidence 并另过决策 gate。

## 文件范围

- `docs/product/PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md`（新增）
- `docs/product/PRODUCT_APPEARANCE_FIDELITY_GATE.md`
- `docs/product/DECISION_LOG.md`
- `docs/product/README.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-20-fidelity-a-domain-api-design.md`（新增）

未修改 `src/`、`web/`、`test/`、API、数据库、migration、package、依赖或部署文件。

## 验证

本地验证结果：

- `npm run check`：230 个 JavaScript 文件通过；
- `git diff --check`：通过；
- DSE 链接、D-036 编号、Fidelity stale wording：通过；
- 严格 7 文件 docs-only allowlist：通过。

Draft PR 的 fixed head 与 Ubuntu、Windows、identity-postgres CI 作为 PR 审阅证据记录，不把分支时效状态写成永久项目真值。

## 未执行边界

- 未访问 Hifly 或真实 Provider；
- 未创建候选、工单或生产数据；
- 未启动 Cloud Executor、Worker 或 Local Agent；
- 未生成图片或视频，未消耗积分；
- 未 SSH、部署或修改云端环境；
- 未开始 Fidelity-B～E、模型选型、阈值调参、UI 或任何代码实现。
