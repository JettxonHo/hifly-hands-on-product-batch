# 商品外观保真领域与 API 合同

> DSE 类型：Specification
> 决策：D-036
> 生命周期门禁：本文件随对应 PR 合并进入 `main` 后，Fidelity-A 才计为 `designed`；实现仍为 `pending`
> 跟踪：Issue #212
> 非目标：本文件不实现数据库、API、UI、Provider Adapter、Worker 或自动检查模型

## 1. 目标与证据边界

本合同把 D-035 与已接受的 Fidelity-0 Provider Evidence 转换为可实现、难以误用的领域和 API 边界。目标是在
`ProductionOrder` 创建之前，形成以下可审计真值链：

```text
当前 ProductRevision
  + 显式 source_asset_version_id
  + 当前已批准 CopyVersion
  + 当前 confirmed AvatarSelection
  + 当前 frozen/approved VideoPlanVersion
  + presentation_size_code
→ 受控候选捕获
→ 候选 bytes 进入系统管理 AssetVersion
→ 自动外观检查及逐维证据
→ 人工候选审核
→ ProductionOrder 冻结输入
→ 视频生成
→ A12
→ WorkInspection / DeliveryRecord
```

Fidelity-0 已证明的范围只有：一次受控源图上传与本地 bytes 一致、候选响应可绑定 `gen_id` 和可读 JPEG bytes、同一
受控 Profile 可即时恢复候选、流程能在候选确认和外层视频提交前停止。它没有证明 Provider 正式下载 API、长期或跨设备
恢复、引用稳定期、自动评分、产品领域绑定或外观保真通过。因此本合同不把这些未知当作实现能力。

## 2. 现有合同复用

Fidelity-A 不重建已有系统。以下现有语义保持权威：

| 现有合同 | Fidelity-A 的复用方式 |
|---|---|
| Organization scope | 所有记录都带 `organization_id`；查询和命令都从登录 actor 取得组织，不接受客户端组织 ID |
| ProductRevision | 继续是商品事实与素材引用的不可变版本；候选只能绑定当前 `ready` revision |
| Asset / AssetVersion | 复用受控对象存储、服务端核验、media/size/checksum 和短时下载授权；候选不得只保留 Provider URL |
| CopyVersion / HumanReview | 候选绑定当前 frozen CopyVersion 与有效 approved review；QC passed 仍不等于人工批准 |
| AvatarSelection | 候选绑定当前 confirmed selection 与精确人物 AssetVersion；授权和能力失效会使候选失效 |
| VideoPlanVersion / PlanReview | 候选绑定当前 frozen/approved plan、有效 preflight 和 `presentation_size_code`；preflight 仍不等于批准 |
| Async run | 技术排队、运行、失败与业务结论分离；失败不自动重试 |
| Idempotency / row_version | 创建命令使用 `Idempotency-Key`；状态命令使用 `expected_revision`；冲突返回 409 |
| ProductionOrder snapshot | 新工单冻结完整输入；历史工单不被当前状态反向改写 |
| ExecutionAttempt / A12 / Work | 候选批准不等于视频成功、A12 passed、Work 可用或 Works 内容通过 |

现有公开端点、字段、状态与错误语义不删除、不改名。Fidelity-A 只定义后续可按切片新增的资源和字段。

## 3. 架构选择

### 3.1 方案 A：ProductionOrder 之前的独立候选门禁（推荐）

候选捕获、检查和人工审核在创建视频 `ProductionOrder` 之前完成。候选捕获使用独立短生命周期异步任务；捕获成功并把
bytes 写入受控 AssetVersion 后任务结束，不持有 Production `ExecutionAttempt` lease 等待人工。ProductionOrder 只在
完整证据链仍为 current、readable、approved 时创建。

选择理由：

1. Fidelity-0 只证明同 Profile 即时恢复，没有证明 Provider 引用可以长期或跨设备恢复；
2. 人工审核时长不可预测，不能让 Cloud Executor lease、浏览器或积分动作长期悬挂；
3. 候选失败和视频失败的费用、重试与审计语义不同，拆开后不会把候选重生伪装成 Production retry；
4. ProductionOrder 继续代表一次已批准的视频生产意图，不需要扩写现有 attempt 状态机；
5. 候选 bytes 已进入平台控制范围，即使 Provider 页面引用失效，仍能审计为什么曾批准，但不能据此继续视频。

### 3.2 方案 B：一个 ProductionOrder 内分阶段暂停和恢复（否决）

该方案在一个 ProductionOrder/ExecutionAttempt 内生成候选，暂停等待人工，再恢复同一 Provider 页面提交视频。

当前否决原因：

- 会让人工等待进入 Worker lease 和 attempt 生命周期；
- Provider 引用长期有效期、跨设备恢复和 Profile 可迁移性尚未证明；
- 浏览器重建或引用失效后，容易把“恢复”退化为隐藏的第二次付费生成；
- 需要改变现有 claim、heartbeat、requires_action、retry 和 terminal 合同，风险远大于独立门禁；
- 现有一单一次、失败停批和零 attempt 激活前门禁会变得难以审计。

重新评估条件：Provider 提供稳定、正式、可授权的候选 API 与恢复令牌，并有跨会话/跨节点生命周期证据；即便满足，仍需
新的 Product/Provider/Execution ADR，不在 Fidelity-B～E 中顺手改造。

## 4. 最小领域对象与状态所有权

### 4.1 `AppearanceCaptureRequest`

表示一次候选捕获意图和付费授权边界，不是候选本身，也不是 ProductionOrder。

最小字段：

- `id`, `organization_id`, `product_id`, `product_revision_id`；
- 显式 `source_asset_version_id`；
- `copy_version_id`, `copy_review_id`；
- `avatar_selection_id`, `avatar_asset_version_id`；
- `video_plan_version_id`, `plan_review_id`, `preflight_result_id`；
- `presentation_size_code`；
- `status`, `row_version`, `status_history`；
- `requested_by_member_id`, `authorized_by_member_id`, `authorized_at`；
- `max_candidate_generations=1`；
- `created_at`, `updated_at`；
- 成功时的 `appearance_candidate_id`，失败时的受控 `failure_code`。

状态机：

```text
awaiting_authorization
  → queued
  → running
  → succeeded

awaiting_authorization → cancelled
queued → cancelled
queued/running → failed
```

- 创建 request 不访问 Provider、不收费；
- 只有管理员显式授权后才可从 `awaiting_authorization` 进入 `queued`；
- 授权固定一次候选生成上限，不能被 Worker 或客户端提高；
- `failed`、`cancelled` 均为 terminal；再次尝试必须创建新 request、取得新授权和新幂等键；
- 不提供自动 retry、resume-as-retry 或“重新领取”命令。

### 4.2 `AppearanceCandidate`

表示已经从 Provider 取得并写入受控存储的不可变候选。捕获未完成时不创建空候选占位。

最小字段：

- `id`, `organization_id`, `capture_request_id`；
- 与 request 相同的完整上游绑定；
- `candidate_asset_id`, `candidate_asset_version_id`；
- 候选服务端核验后的 `media_type`, `size`, `checksum_sha256`；
- `provider`, `provider_reference_type`, 私有且受校验的 `provider_reference`；
- `generation_context_version`；
- `created_at`。

候选 bytes 使用系统管理的 Asset/AssetVersion，未来新增内部 kind `appearance_candidate_image`。该 kind 默认不进入现有
`GET /api/assets` 的三类业务素材列表，避免破坏现有 Assets 页面；只能通过外观保真资源和组织作用域下载授权读取。
完整 Provider URL、Cookie、Token、浏览器 Profile 路径、请求头和签名参数不得进入公共 API 或业务快照。受控内部
`provider_reference` 仅供 Provider adapter 使用，并通过不可逆的内部 reference fingerprint 与观察记录绑定。

候选创建后永不改写。当前可用性由 1:1 可变头 `AppearanceCandidateState` 持有：

- `candidate_id`, `organization_id`；
- `state`, `row_version`, `reason_code`, `observed_at`, `updated_at`；
- `superseded_by_candidate_id`，仅 `superseded` 时非空；
- 每次转换追加 `appearance.candidate_state_changed` 审计事件，事件包含 before/after、expected/new revision 和受控 reason。

`AppearanceCandidateState.state` 使用以下互斥值：

| 状态 | 含义 | 可进入检查/审核/Production |
|---|---|---|
| `available` | 候选 AssetVersion 可读且绑定上游仍 current；Provider 引用另由当前 Observation 判定 | 仅同时有有效 Provider Observation 时可继续 |
| `candidate_unavailable` | 受控候选 AssetVersion 或对象已确认不可读/不一致 | 否 |
| `upstream_changed` | 任一绑定上游被替换、撤销或失效 | 否 |
| `reference_unavailable` | 候选 bytes 仍可审计，但 Provider 引用无法安全继续视频 | 否 |
| `superseded` | 已有更新候选成为当前候选 | 否 |

候选与初始 `available` state 在同一事务创建，前提是 candidate AssetVersion 可读且已有一次 `available` Provider
Observation。后续转换只允许 `available` 进入任一阻断态，或较低优先级阻断态被更强事实替代；优先级固定为
`superseded > upstream_changed > candidate_unavailable > reference_unavailable > available`，不得逆向恢复为 `available`。
同 revision 并发通过 `expected_candidate_state_revision` 返回 409。读取失败、Observation 过期或状态无法确定只返回
fail-visible `unknown` gate，不持久改写为 `available` 或任一 unavailable；只有确认对象缺失、完整性不一致或引用明确失效
后才转换 state。恢复必须创建新 candidate，历史 candidate/state/event 不改写。

### 4.3 `ProviderReferenceObservation`

Provider 引用的“当前可用”不是 Candidate 字段，也不能由旧时间、`gen_id` 非空或历史成功推断。服务端保存私有、
append-only 的 `ProviderReferenceObservation`：

- `id`, `organization_id`, `candidate_id`, `reference_fingerprint`；
- `status: available | unavailable | unknown`；
- `method`, `seam_version`, `policy_version`；
- `observed_at`, `valid_until`, `reason_code`, `created_at`。

Observation 必须绑定 Candidate 内部 reference 的同一受控 fingerprint；不保存另一份 URL、Cookie、Token 或 Profile path。
只有 Fidelity-B 已接受的无副作用 read/recovery seam 能写 Observation。公共 API 只投影 observation ID、status、
`observed_at`, `valid_until`, `expired` 和受控 reason，不返回 fingerprint、method 细节或原始引用。

`available` 只在 `valid_until` 未过期时成立；读取失败、策略未知、seam 漂移、部署节点不能安全观察或 Observation 过期均按
`unknown` fail-visible，不自动写成 `reference_unavailable`。只有无副作用观察明确返回 unavailable 才写 unavailable
Observation，并以 expected state revision 把 CandidateState 转为 `reference_unavailable`。

ProductionOrder 创建和 claim 各自必须绑定一个 exact available Observation ID。允许复用尚未过期且 policy 匹配的同一
Observation，也允许在同一次 gate 内成功完成无副作用再观察并绑定新 ID；否则零 attempt 阻断。创建证据写入 immutable
input snapshot；claim 证据写入 append-only claim-gate audit，并在成功 claim 时复制到 ExecutionAttempt precondition
snapshot。Fidelity-B 必须证明 Observation 的产生与恢复 seam；若无法证明合理有效期或 claim-side 无副作用再观察，
Fidelity-D 必须停止，不能用历史 observed_at 代替。

### 4.4 `AppearanceCheckRun` 与 `AppearanceCheckResult`

自动检查的技术运行与业务结论分离：

- `AppearanceCheckRun` 最小字段：`id`, `organization_id`, `candidate_id`, `candidate_state_revision`, `status`,
  `policy_version`, `model_version`, `source_checksum_sha256`, `candidate_checksum_sha256`, `created_at`, `started_at`,
  `completed_at`；
- `AppearanceCheckRun.status`: `queued | running | succeeded | failed | cancelled | timed_out`；
- `AppearanceCheckResult` 是成功 run 的唯一不可变业务结果，最小字段：`id`, `organization_id`, `check_run_id`,
  `candidate_id`, `candidate_state_revision`, source/candidate checksum、`policy_version`, `model_version`, `dimensions`,
  `findings`, `conclusion`, `created_at`；
- `dimensions` 为固定身份维度数组 `{dimension,status,evidence_references}`，status 仅
  `supported | unsupported | unknown`；`findings` 为受控数组 `{code,dimension,severity,evidence_reference}`，不得包含模型原始
  提示、第三方正文或临时 URL；
- `AppearanceCheckResult.conclusion`: `passed | needs_review | blocked`；
- 每个身份维度独立记录 `supported | unsupported | unknown`，包括轮廓/几何、部件、颜色、比例、包装、Logo、标签文字；
- 每项保存受控 evidence reference、规则/模型版本、输入 candidate/source checksum、时间；
- 不保存一个不可解释的总分作为唯一判断；
- run 失败时没有伪造 result，公共投影显示 `failed`；queued/running 显示 `pending`。

聚合规则：任一 `unsupported` 得出 `blocked`；没有 unsupported 但存在 `unknown` 得出 `needs_review`；全部 supported 才是
`passed`。run 未 `succeeded` 时 `check_result=null`，不能伪造业务结论。结果必须绑定 run 启动时的 exact candidate state
revision、source/candidate checksum、policy/model version；旧 state、旧 policy 或旧 run 的 result 不可批准。模型、阈值、
供应商和费用不在 Fidelity-A 决定，后续能力 gate 未通过前不得实现假检查器。

### 4.5 `AppearanceReview`

沿用 Copy/Plan 审核模式，保存独立人工审核记录和事件历史：

```text
pending → approved
pending → rejected
approved → revoked
```

- `approved` 必须由管理员决定；提交人和审核人、时间、原因和 review mode 都进入审计；
- `blocked` 或 check run `failed` 不可提交批准；
- `needs_review` 只有在审核人对每个 unknown 逐项给出受控理由和证据引用、使当前 gate 不再含 unresolved dimension 时才可批准；
- 上游变化、候选 superseded、候选不可读或 Provider 引用不可用会自动把 approved review 转为 `revoked`；
- revoked 不得原地恢复。恢复后必须创建新 candidate/check/review 或按明确规则创建新 review，重新通过所有门禁；
- rejected 不能改写为 approved，历史永远保留。

`AppearanceReview` 不修改自动检查结果，也不替代最终 `WorkInspection`。

## 5. 精确源图与候选完整性

### 5.1 源图冻结

`source_asset_version_id` 是 request 的必填字段。服务端必须同时证明：

1. 该 AssetVersion 属于当前 Organization；
2. 父 Asset 为 `active` 且 `kind=product_image`；
3. AssetVersion 为 `available`；
4. ID 存在于当前 ProductRevision 的 `asset_version_ids`；
5. 受控存储读取的 bytes/media/size/checksum 与 AssetVersion 核验字段一致；
6. 实际发送给 Provider 的 bytes 再次与同一快照一致。

任一不成立返回 422 gate reason；对象不存在、跨组织或不可见统一返回 404，不能泄漏存在性。数组顺序、文件名、图片尺寸、
页面缩略图和生成后候选都不是源图选择依据。

### 5.2 候选写入

Provider 返回按不可信输入处理。候选落库前必须：

- 校验允许的图片 media type、大小上限和实际文件签名；
- 读取完整 bytes 并由服务端计算 size/checksum；
- 使用受控对象 key，不接受 Provider 指定存储路径；
- 完成 AssetVersion 服务端核验后才创建 `AppearanceCandidate`；
- 确认 candidate 的 Provider generation reference 与本次 request 绑定；
- 任何 URL、页面文案、DOM 高亮或 `gen_id` 单独存在都不能代替 bytes 与绑定证据。

## 6. 失效传播与历史

以下变化以 `expected_candidate_state_revision` 把当前 CandidateState 转为 `upstream_changed`，同时撤销当前 approved
AppearanceReview，但保留 candidate/state/check/review 历史：

- Product 当前 revision 改变或源 Asset/AssetVersion 不再 active+available；
- CopyVersion、其 approved HumanReview 或质量策略失效；
- AvatarSelection、人物授权、能力 Evidence 或人物 AssetVersion 失效；
- VideoPlanVersion、PreflightResult、PlanReview 或 `presentation_size_code` 改变；
- candidate 被更新候选 supersede；
- source 核验信息与冻结快照不一致时使用 `upstream_changed`；candidate bytes 不可读或不一致时使用
  `candidate_unavailable`。

Provider Observation 明确 unavailable 时使用 `reference_unavailable`，不篡改候选 bytes，也不把它误写成外观检查失败。
Observation 过期、读取失败或无法安全观察只形成 `unknown` gate，不把未知持久化成 unavailable。恢复引用不能自动恢复审核；
由于长期恢复能力未知，当前唯一安全动作是新建 capture request、取得新单条授权并生成新候选。

历史 ProductionOrder 的 snapshot 和 Work 不因后续失效被改写。失效只阻止创建或 claim 新工单。

## 7. Production 硬门禁与冻结快照

### 7.1 创建工单前

当组织启用外观保真 capability 时，`createProductionOrder` 必须在现有 Plan gate 之后再次验证：

- exact current `AppearanceCandidate` 属于同一 Organization/Product/ProductRevision，且 exact CandidateState 为 `available`；
- exact `source_asset_version_id` 仍是当前 revision 的 active+available product image；
- candidate 绑定的 CopyVersion/review、AvatarSelection、VideoPlanVersion/review/preflight 均与当前批准链完全一致；
- `presentation_size_code` 与 plan 当前冻结值一致；
- candidate AssetVersion 仍可读，media/size/checksum 与 candidate 记录一致；
- 当前 check result 属于 exact candidate 和 `candidate_state_revision`，policy/model/checksum 均匹配，且没有
  unresolved/unknown/blocked/failed；
- exact AppearanceReview 为 current `approved`，未 revoked/superseded；
- exact create-gate ProviderReferenceObservation 属于同一 candidate/reference fingerprint、policy 匹配、未过期且为
  `available`，不是 unknown 或 unavailable。

任一未知或不一致都返回 422 `PRODUCTION_ORDER_APPEARANCE_GATE_BLOCKED` 与受控 reason code，不创建工单。

### 7.2 claim 前二次验证

由于 Provider 引用可能在创建工单后、claim 前失效，Cloud Executor 的 eligible 查询与 claim 事务必须执行同一证据链的
只读二次验证，并绑定 exact claim-gate ProviderReferenceObservation。历史 create observation 只有仍未过期且 policy 匹配
时才可复用；否则必须在同一 gate 内通过 Fidelity-B 已接受的无副作用 seam 生成新 observation。失败时：

- 不创建 ExecutionAttempt；
- 该工单从 eligible 投影排除，不能在后续 poll 中被反复选择；
- 工单保持 `waiting_for_executor`，以外观门禁阻断投影和审计 reason 呈现；不新增仓库当前不存在的
  `waiting_for_executor → requires_action` 状态转换；
- 不自动重生候选、不自动重试、不重新领取、不创建下一工单。

冻结 snapshot 不能换绑新候选。唯一安全恢复是运营人员显式取消该 waiting 工单，完成新的候选证据链后创建新工单；
旧工单、阻断原因和零 attempt 事实继续保留。

### 7.3 新订单 snapshot

新 `input_snapshot.appearance_fidelity` 冻结：

- `appearance_candidate_id`, `candidate_asset_version_id`；
- `appearance_candidate_state_revision`；
- `source_asset_version_id` 及源/候选 media、size、checksum；
- `appearance_check_run_id`, `appearance_check_result_id`, check policy/model version 和 result 绑定的 candidate state revision；
- `appearance_review_id`, reviewer、decision time、resolved dimensions；
- candidate 绑定的完整上游 ID；
- `presentation_size_code`；
- Provider reference type、`creation_provider_reference_observation_id`、observation policy version、`observed_at`,
  `valid_until` 与内部受控 reference fingerprint；原始 reference 仅留在私有 adapter 边界。

公开 Production API 不返回原始 Provider reference。Manual handoff manifest 只包含执行器完成视频所需的最小受控引用和完整
审计 ID，不包含 URL、Cookie、Token、Profile path 或签名请求头。claim 成功时把 exact
`claim_provider_reference_observation_id` 与 policy/validity 记录进 claim-gate audit 和 ExecutionAttempt precondition snapshot；
claim 被阻断时仍保留零 attempt 的 gate audit。

## 8. Additive REST API 合同

### 8.1 统一约定

- 身份和 Organization 从现有 session 取得；客户端不能提交 `organization_id`；
- 创建/命令使用 `Idempotency-Key`，最长 128；同 key 不同 fingerprint 返回 409 `IDEMPOTENCY_CONFLICT`；
- 修改状态必须提交 `expected_revision`；版本冲突返回 409；
- 跨组织、不可见和不存在资源统一返回对应 404；
- domain gate 使用 422 与稳定 `reasons` 数组；第三方原始错误、URL 和正文不进入公共响应；
- 列表采用 `limit`（默认 50，最大 100）与 opaque `cursor`，返回 `next_cursor`；
- 时间为 ISO 8601 UTC；ID 为服务端生成的 opaque ID；
- 所有 response 保持现有单资源 envelope 风格，不把组织 ID 投影到公共对象。

### 8.2 Workspace 与候选读取

| 方法与路径 | 响应 | 用途 |
|---|---|---|
| `GET /api/products/:productId/appearance-fidelity-workspace` | `{upstream, gate, current_capture, current_candidate, current_check, current_review}` | 当前业务工作区；服务端计算 gate |
| `GET /api/products/:productId/appearance-capture-requests?status=&limit=&cursor=` | `{capture_requests, next_cursor}` | 当前商品捕获历史 |
| `GET /api/products/:productId/appearance-candidates?state=&limit=&cursor=` | `{candidates, next_cursor}` | 当前组织/商品候选历史 |
| `GET /api/appearance-candidates/:candidateId` | `{candidate,candidate_state,provider_reference_status}` | 精确候选与可变状态头；404 不泄漏跨组织存在性 |
| `POST /api/appearance-candidates/:candidateId/download-authorizations` | `{download:{url,expires_at,filename,media_type,size,checksum_sha256}}` | 复用短时授权读取受控候选 bytes |

公共 candidate 投影包括上游 ID、candidate AssetVersion ID、核验元数据、不可变候选时间；`candidate_state` 明确返回
`state`, `row_version`, reason 和 observed time。`provider_reference_status` 只返回 exact observation ID、受控 status、
observed/valid-until/expired 与 reason。workspace 的 `current_candidate` 使用同一 envelope；不包括 object key、reference
fingerprint、Provider URL、原始 Provider reference、method 内情或凭据。

### 8.3 候选捕获命令

`POST /api/products/:productId/appearance-capture-requests`

```json
{
  "product_revision_id": "opaque-id",
  "source_asset_version_id": "opaque-id",
  "copy_version_id": "opaque-id",
  "avatar_selection_id": "opaque-id",
  "video_plan_version_id": "opaque-id",
  "expected_workspace_revision": 4
}
```

响应 `201 {capture_request,replayed}`，初始状态固定为 `awaiting_authorization`，不触发 Provider。

`POST /api/appearance-capture-requests/:requestId/authorize`

```json
{
  "expected_revision": 1,
  "max_candidate_generations": 1
}
```

仅管理员可调用；响应 `202 {capture_request,replayed}`。服务端不接受大于 1 的上限。该命令是一次候选可能收费动作的产品内
授权记录；外部 Owner 授权如何映射到企业管理员仍由 Fidelity-B 的运营 SOP gate 验证，不能由聊天文本或前端 checkbox
自动伪造。

`GET /api/appearance-capture-requests/:requestId` 返回 `{capture_request}`。除 queued 且尚未 claim 的显式 cancel 外，不提供
retry/resume 命令；失败后只能新建 request。

`POST /api/appearance-capture-requests/:requestId/cancel` 接受 `{expected_revision}` 与 `Idempotency-Key`；只有 request
创建者或管理员可取消 `awaiting_authorization/queued`，响应 `{capture_request,replayed}`。running/terminal request
返回 409，不把 cancel 当成 Provider 撤销保证。

Provider reference 的 `available` 只能来自 Fidelity-B 已接受的无副作用 read/recovery Observation。每次 Observation 都必须
持久化 exact ID、candidate/reference fingerprint、status、method/seam/policy version、observed/valid-until 和 reason。
如果观察需要新的付费候选、会改变 Provider 状态、seam 已漂移、已过期或部署节点无法安全执行，公共投影为 unknown 并阻断，
而不是由时间、`gen_id` 非空或历史成功推断。

### 8.4 自动检查与人工审核

| 方法与路径 | 权限 | 响应 |
|---|---|---|
| `POST /api/appearance-candidates/:candidateId/checks` | admin | `202 {check_run,replayed}` |
| `GET /api/appearance-candidates/:candidateId/checks?limit=&cursor=` | member/admin | `{checks,next_cursor}` |
| `GET /api/appearance-checks/:checkId` | member/admin | `{check_run,check_result}`；run 未 succeeded 时 result 为 null |
| `POST /api/appearance-candidates/:candidateId/reviews` | member/admin | `201 {review,replayed}` |
| `GET /api/appearance-candidates/:candidateId/reviews?limit=&cursor=` | member/admin | `{reviews,next_cursor}` |
| `GET /api/appearance-reviews/:reviewId` | member/admin | `{review}` |
| `POST /api/appearance-reviews/:reviewId/approve` | admin | `{review}` |
| `POST /api/appearance-reviews/:reviewId/reject` | admin | `{review}` |

检查启动命令只接受 candidate ID、`expected_candidate_state_revision` 和幂等键，不允许客户端选择未获批准的模型、阈值或供应商。
如后续检查能力本身收费，必须先经过独立费用授权设计，不得复用候选授权。

精确检查读取返回完整 `check_run`；只有 succeeded run 才返回不可变 `check_result`。workspace 的 `current_check` 至少投影
`check_run_id`, `check_result_id`, run status、conclusion、candidate ID、candidate state revision 和 policy version，不能只给
模糊的 passed/failed 摘要。

批准 body 包含 `expected_revision`、`expected_candidate_state_revision`、精确 `appearance_check_result_id`，以及 needs_review 时逐维的
`resolved_unknowns:[{dimension,decision_reason,evidence_reference}]`。blocked/failed、候选不可读、上游失效或仍有 unresolved
dimension 时返回 422。批准事务必须重读 exact result，验证它属于同一 current candidate/state revision、current policy/run，
且 source/candidate checksum 与当前不可变证据一致；旧 policy、旧 run 或旧 state result 返回 422 gate reason，状态并发返回
409。拒绝要求受控 reason；批准和拒绝均幂等且写审计事件。

### 8.5 稳定错误码

| HTTP | 错误码 | 语义 |
|---|---|---|
| 401 | `AUTH_REQUIRED` | 未登录 |
| 403 | `APPEARANCE_FIDELITY_FORBIDDEN` | 当前角色不能执行命令 |
| 404 | `APPEARANCE_CAPTURE_REQUEST_NOT_FOUND` | 不存在或不可见 request |
| 404 | `APPEARANCE_CANDIDATE_NOT_FOUND` | 不存在或不可见 candidate |
| 404 | `APPEARANCE_CHECK_NOT_FOUND` | 不存在或不可见 check |
| 404 | `APPEARANCE_REVIEW_NOT_FOUND` | 不存在或不可见 review |
| 409 | `APPEARANCE_CAPTURE_CONFLICT` | expected revision 或状态冲突 |
| 409 | `APPEARANCE_CANDIDATE_CONFLICT` | candidate current/supersede 冲突 |
| 409 | `APPEARANCE_REVIEW_CONFLICT` | review expected revision 冲突 |
| 409 | `APPEARANCE_REVIEW_ACTIVE_EXISTS` | 已有 pending review |
| 409 | `IDEMPOTENCY_CONFLICT` | 同 key 不同请求 |
| 422 | `APPEARANCE_CAPTURE_GATE_BLOCKED` | 上游、源图、授权或 capability 门禁失败 |
| 422 | `APPEARANCE_CHECK_GATE_BLOCKED` | candidate 不可检查 |
| 422 | `APPEARANCE_REVIEW_GATE_BLOCKED` | check/candidate/upstream 不允许审核决定 |
| 422 | `PRODUCTION_ORDER_APPEARANCE_GATE_BLOCKED` | 当前批准证据链不足以创建/claim 工单 |
| 503 | `APPEARANCE_CAPTURE_UNAVAILABLE` | Provider/adapter/candidate store 无法安全执行 |
| 503 | `APPEARANCE_CHECK_UNAVAILABLE` | 自动检查能力不可用 |

422 的 `reasons` 只能使用稳定枚举，例如 `source_asset_not_current`、`source_asset_unavailable`、
`candidate_unreadable`、`candidate_upstream_changed`、`provider_reference_unknown`、`provider_reference_expired`、
`provider_reference_unavailable`、`check_missing`、`check_stale`、`check_failed`、
`check_blocked`、`check_unknown_unresolved`、`review_not_approved`。不得把第三方异常正文放入 reasons。

## 9. 权限与审计矩阵

现有身份只有 `member` 与 `admin`；“运营人员”映射为 member，不新增虚构角色。

| 动作 | member | admin | 审计事件 |
|---|---:|---:|---|
| 读取 workspace、候选、检查和审核历史 | 是 | 是 | 普通读取不强制逐次事件 |
| 创建不付费的 capture request | 是 | 是 | `appearance.capture_requested` |
| 授权并排队一次候选生成 | 否 | 是 | `appearance.capture_authorized` |
| 取消尚未 claim 的 request | 创建者 | 是 | `appearance.capture_cancelled` |
| 启动自动检查 | 否 | 是 | `appearance.check_requested` |
| 提交人工审核 | 是 | 是 | `appearance.review_submitted` |
| 批准/拒绝候选 | 否 | 是 | `appearance.review_approved/rejected` |
| 系统因失效撤销批准 | 系统 | 系统 | `appearance.review_revoked_by_invalidation` |

捕获 claim、Provider 引用写入和候选 AssetVersion 完成由专用系统 actor 执行，不冒充 member。审计 metadata 只保存受控 ID、
状态、reason code、版本和计费边界，不保存凭据、URL、Profile path 或第三方正文。

## 10. 事务、幂等与并发

- capture request 创建、幂等 receipt 和审计事件在同一事务；
- admin authorize 的状态转换、`max_candidate_generations=1`、队列任务和审计在同一事务；
- candidate AssetVersion 服务端核验完成、AppearanceCandidate + 初始 CandidateState 创建、首个 available
  ProviderReferenceObservation、request succeeded 和事件在同一事务，或使用可重放的 outbox/补偿流程，绝不能出现
  request succeeded 但候选 bytes 不可读；
- 同一 product/upstream fingerprint 同时最多一个 queued/running capture request；冲突返回 409，不静默合并；
- check result 与 findings 不可变；同一 candidate/state revision/policy version 最多一个 active run；
- CandidateState 转换使用 expected candidate state revision，并追加不可变事件；未知观察或暂时读取失败不触发转换；
- review transition 使用 expected review revision；批准前在事务内重读 exact candidate state/check result/upstream；
- ProductionOrder 创建在事务内重读 exact approved review、current evidence chain 和 exact 未过期 create Observation；
- claim 在事务内消费 exact claim Observation；门禁失败写 audit 但不得创建 attempt；
- 所有系统自动失效使用 CandidateState/review 自己的 row_version，冲突后重读并保持已失效结果幂等；
- Worker/adapter 回调、HTTP response 和页面 DOM 都作为不可信输入，必须绑定 request/candidate 并校验状态后写入。

## 11. 恢复与费用边界

| 情况 | 唯一安全动作 |
|---|---|
| capture 未授权 | 等待管理员授权或取消；不访问 Provider |
| Provider 控件/响应漂移 | request failed，停止；新 request + 新授权后才可再试 |
| candidate bytes 缺失/不可读 | 确认后标记 candidate_unavailable，禁止检查/审核/Production；不得用 URL 或截图补位 |
| Provider observation 过期/unknown | fail-visible、零 attempt 阻断；仅允许同一 gate 内无副作用再观察，不把未知写为 unavailable |
| Provider reference 明确失效 | 写 unavailable Observation，CandidateState 转 reference_unavailable，review revoked；取消被阻断的 waiting 工单，新 request + 新授权生成新候选 |
| check 模型不可用/运行失败 | 显示 failed；管理员显式新建 check run，不自动重试 |
| check needs_review | 逐维处理 unknown；未全部解决前阻断 Production |
| check blocked | 只能拒绝或新建候选；不得管理员强制通过 |
| 人工拒绝 | candidate 历史保留；新候选需新 request 和新授权 |
| 409 | 保留用户输入，重载 exact current resource，再显式提交新命令 |
| 浏览器/Profile 无法恢复 | 当前 request failed/reference unavailable；不自动生成第二次 |

一次 capture authorization 只允许一次候选生成动作，不包含视频提交、第二次候选、自动检查付费或 Fidelity-E 验收。每次真实
capability probe、候选生成或视频动作仍需当次明确单条授权；候选阶段失败关闭只能阻止后续视频，不能证明零积分。

## 12. 迁移与兼容策略

Fidelity-B～D 实现时必须保持 additive：

1. 新建 appearance capture/candidate/candidate-state/provider-observation/check/review/audit/receipt 表或等价深模块；不改写现有历史对象；
2. 扩展 Asset kind 时只新增内部 `appearance_candidate_image`，现有 `/api/assets` 默认三类投影保持不变；
3. `ProductionOrder.input_snapshot.appearance_fidelity` 对历史工单为 absent，历史读取和交付继续有效；
4. 外观保真 feature gate 关闭时，新 API 不可用或明确 disabled，现有 ProductionOrder 行为保持不变；
5. feature gate 对组织/产品启用后，所有新工单必须满足本合同，不能对旧 approved plan 静默 grandfather；
6. 不回填虚构 candidate/check/review，不从历史 `asset_version_ids[0]`、manifest 或 Provider URL 推断；
7. 现有错误码、响应 envelope、role、CSRF/session、CSP、eligible/attempt/Worker 时序不变；
8. 回滚时新表和 snapshot 字段可以被旧代码忽略，但不得删除已产生的审计历史或候选 bytes。

## 13. 严格串行实施与 TDD acceptance

### Fidelity-B：Provider capture

- 实现 request/authorization、精确源图读取与 upload proof、候选 bytes 写入 AssetVersion、CandidateState、私有
  ProviderReferenceObservation 与失败关闭；
- public seams：memory + PostgreSQL + route + adapter；Provider 使用脱敏 fixture，真实动作另需单条授权；
- RED：数组首图误选、source checksum 不一致、DOM/HTTP 漂移、候选只返回 URL、第二次 generation、Profile 不可恢复；
- GREEN：一次授权最多一个 candidate、bytes 可读、state revision/observation/audit 准确，并证明 observation 的产生、
  即时恢复和有界 validity policy；
- 停止：候选无法在视频前保存并结束任务、需要长期持有 Production lease，或无法定义合理 observation 有效期和
  claim-side 无副作用再观察。

### Fidelity-C：自动检查与运营审核

- 实现 exact check run/result/findings API、candidate workspace、review/approve/reject/revoke、冲突与历史；
- RED：passed 冒充 approved、unknown 未解决却批准、blocked 被管理员绕过、失效后 approval 仍 current；
- GREEN：三层状态独立、组织隔离、409 保留输入、审计可追踪；
- 停止：没有受控检查能力或产品必须先决定模型/阈值/成本。

### Fidelity-D：Production 集成

- 扩展 create/claim gate、snapshot、handoff 和 adapter 的显式 candidate/state/Provider Observation 输入；
- RED：source/plan/candidate mismatch、reference unavailable、candidate bytes missing、review revoked、claim 前失效；
- GREEN：任一未知零 attempt 阻断，exact snapshot 可审计，视频提交幂等且不自动重生候选；
- 停止：无法证明一次 approved candidate 只对应一次视频提交，或 claim 节点无法安全取得未过期 Observation/执行无副作用再观察。

### Fidelity-E：单条真实验收

- 新批准上游、新 capture request、新单条候选授权、新 ProductionOrder；
- Worker off、唯一 eligible、零 attempt、active attempts=0；首失败停；
- 验证源图→候选→check→review→video→A12→Work→真实字节下载→Works 检查的 exact IDs 和 bytes；
- 需要当次单条积分授权，不复用失败或返工工单，不自动重试。

每片独立 Issue、分支、Draft PR、TDD、PostgreSQL 和固定 head CI；前片合并后才开始下一片，不自动部署。

## 14. 未决风险与重新决策门禁

- 自动视觉模型、阈值、误判率和费用尚无 Evidence；在 Fidelity-C 前必须单独选择并验收；
- Provider 引用长期/跨设备有效性未知，因此本合同不承诺隔日或跨节点恢复；Observation 过期后必须重新无副作用观察，
  无法观察即零 attempt 阻断；
- 如果 Provider 无法通过受控引用提交已批准候选，Fidelity-D 必须停下，不得偷偷重新生成；
- 如果纯生成持续改变商品身份，受控抠图合成或产品锁定能力另开 Product/Provider/架构 gate；
- 正式域名、可信 TLS 和公网发布仍是独立 release-readiness gate。

本合同合并只表示 Fidelity-A 设计完成，不表示 Fidelity-B～E 获得实现授权，也不表示能力已实现、部署、真实 Provider 验收
或外观保真通过。
