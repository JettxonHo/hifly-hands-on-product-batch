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
2. 不可变 `AppearanceCandidate` 只在候选 bytes 写入系统管理 AssetVersion 且服务端核验后创建，并绑定 exact 上游和
   `source_asset_version_id`；1:1 可变 `AppearanceCandidateState` 持有 state、row version、受控 reason 和 supersede head，
   每次转换追加审计事件。暂时读取失败或未知不改写 state。
3. 私有 append-only `ProviderReferenceObservation` 绑定 candidate/reference fingerprint，记录受控 status、method/seam/policy、
   observed/valid-until 和 reason。公共 API 只投影 exact observation ID、状态、时间和是否过期；不返回引用或凭据。
4. `AppearanceCheckRun/Result` 分离技术状态与逐维结论，并新增 exact check 读取合同。Result 精确绑定 candidate state
   revision、source/candidate checksum、policy/model version；`AppearanceReview` 批准事务验证同一 current result，且与最终
   `WorkInspection` 保持独立。
5. ProductionOrder 创建与 claim 前均验证 exact current candidate/state、readable bytes、current upstream、current exact
   check result、approved review 和 exact available Provider Observation。创建 snapshot 与 claim audit/attempt precondition
   分别绑定 observation ID；过期、读取失败或不能安全再观察均为 unknown，任一未知零 attempt 阻断。
6. 分阶段 Production 执行被否决。Fidelity-B 必须证明 Observation 的产生、合理有效期与 claim-side 无副作用再观察；
   无法证明时 Fidelity-D 明确停止，不能用 `gen_id` 或历史 observed_at 代替。

## 独立复审纠偏

初始 Draft fixed head `0d841800df9525e231c7e856fbe7e4f3c18b8cd2` 的三组 CI 成功，但独立复审发现三处合同冲突：

1. Candidate 被声明不可变，却同时承担 durable state 转换和未定义的 revision；
2. Provider reference 的历史 observation time 没有时效与 create/claim 精确绑定，不能证明“当前可用”；
3. CheckRun/Result 虽概念分离，但缺 exact resource/response，人工批准无法核对 exact current result。

本次修正增加 CandidateState current head、ProviderReferenceObservation append-only evidence 和 exact Check API，且保持
ProductionOrder 前候选门禁、零 attempt fail-closed 与 7-doc docs-only 边界不变。这是设计合同纠偏，不是实现证据。

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
