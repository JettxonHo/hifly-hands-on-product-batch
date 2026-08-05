# 核心领域模型与状态机契约

> 状态：Accepted at product specification level
> Owner：owner（JettxonHo）
> 最后更新：2026-08-05
> 关联 Decision：[D-028](DECISION_LOG.md)
> 解决范围：核心领域对象关系、不可变版本、状态机、失效传播、并发、幂等与事务边界
> 非目标：不实现数据库、Schema、Migration、API、前端、状态机代码或 Local Agent；不关闭 Q-018；不声称 HIFLY-001 已执行

本文件是 D-028 的详细 Specification。它是**产品与领域合同**，不代表数据库、API、状态机代码、Local Agent 或 Hifly 自动执行已经实现。本文不固定数据库表名/字段名、ORM、API 路径、JSON Schema、事件总线产品、前端状态管理实现、状态机代码库、密码策略、文件大小限制、Hifly 页面状态映射、Playwright/影刀最终职责、Provider 官方 API、Hifly Token 保管实现、ManualHandoffPackage 文件格式、完整 RBAC 或高保真 UI。

---

## 1. 目的与范围

- 将 D-025（文案质检/人工批准门禁）与 D-027（低保真页面结构与交互边界）中的业务门禁转化为一致的领域对象关系；
- 明确对象版本、执行状态、审核状态和业务有效性不得混用；
- 明确不可变版本和历史保留规则；
- 明确状态转换的业务前置条件；
- 明确 ProductionOrder 与 ExecutionAttempt 的关系；
- 明确 Work 与 DeliveryRecord 的关系；
- 明确失效传播边界；
- 明确并发、幂等和事务边界；
- 为后续数据库、API 和 Vertical Slice A Issue 拆分提供领域依据。

与既有规范的关系：遵守 D-021（商品事实门禁）、D-022（ContentBrief 可选）、D-023（DeepSeek 生成契约）、D-025（QC/批准门禁）、D-026（基础设施抽象）、D-027（页面结构与失效口径）；权威页面结构与界面术语以 [LOW_FIDELITY_PAGE_STRUCTURE.md](LOW_FIDELITY_PAGE_STRUCTURE.md) 为准。

## 2. 建模原则

1. **不使用单一 status 承载全部含义**。文案至少区分 CopyVersion 生命周期、QualityRun 技术执行状态、QualityResult 业务结论、HumanReview 状态、当前业务可用性投影。VideoPlan 至少区分 VideoPlanVersion 生命周期、PreflightRun/PreflightResult、PlanReview、当前业务可用性投影。生产至少区分 ProductionOrder 状态、ExecutionAttempt 状态、产物核验状态、WorkInspection、DeliveryRecord。这些状态不得相互替代。
2. **已进入审核或生产引用的内容不可原地覆盖**：ProductRevision、CopyVersion、QualityResult、QualityFinding、HumanReview、AvatarSelection、VideoPlanVersion、PreflightResult、PlanReview、ProductionOrder 输入快照、ExecutionAttempt、ManualHandoffPackage、Work、WorkInspection、DeliveryRecord、AuditEvent 一旦参与质检/审核/生产引用，必须作为不可变记录保留；修改必须创建新版本或新记录。
3. **当前有效不等于历史不存在**：必须支持同时存在历史版本、当前编辑版本、当前有效版本、曾经 approved 后来 revoked 的版本、已失效但被历史 ProductionOrder 使用的版本。不得仅依靠一个 `is_active` 布尔值表达全部关系。
4. **前端提交业务命令，不直接写最终状态**。前端不得直接写 `approved`/`succeeded`/`online`/`passed`/`cancelled`；只能发起业务命令（如 SubmitCopyForReview、ApproveCopy、RequestCopyChanges、RunPreflight、ApprovePlan、CreateProductionOrder、RequestOrderCancellation、MarkHumanActionCompleted）。最终状态由服务端重新验证门禁后决定。

## 3. 领域边界

- **Organization & Identity**：Organization、Member、RoleAssignment
- **Project Content**：Project、Product、ProductRevision、ProductFact、ContentBrief、Asset、AssetVersion、AssetReference
- **Copy Quality**：CopyVersion、QualityRun、QualityResult、QualityFinding、HumanReview
- **Video Planning**：AvatarAsset、AvatarSelection、VideoPlanVersion、PreflightRun、PreflightResult、PlanReview
- **Production**：ProductionOrder、ExecutionAttempt、ProviderTaskReference、ManualHandoffPackage、AsyncJob
- **Output & Delivery**：Work、WorkInspection、DeliveryRecord
- **Execution Environment**：LocalAgent、AgentCredential、ProviderConnection、AgentCapabilitySnapshot

## 4. 总体对象关系

```text
Organization
└── Project
    └── Product
        ├── ProductRevision
        │   └── CopyVersion
        │       ├── QualityRun / QualityResult / QualityFinding
        │       └── HumanReview
        │
        └── AvatarSelection
            └── VideoPlanVersion
                ├── PreflightRun / PreflightResult
                ├── PlanReview
                └── ProductionOrder
                    ├── ExecutionAttempt
                    ├── ManualHandoffPackage
                    └── Work
                        ├── WorkInspection
                        └── DeliveryRecord
```

该关系用于产品与领域语义，不要求文档直接定义数据库外键名称。

## 5. Product / ProductRevision

**Product**：项目中的长期商品身份；可更新少量非生产元数据；展示名称、排序、归档等无关变化通常不触发下游失效。

**ProductRevision**：可用于文案生成、质检和审核的商品权威输入快照；使用不可变完整快照；不以逐字段事件回放作为 MVP 权威模型（**DM-001**）。至少固定：商品名称、已核验商品图片版本、已确认核心卖点、参与生成的商品描述事实、ContentBrief、品类或 QC Profile、创建人、创建时间、父 revision。

| 生命周期 | 含义 |
|---|---|
| `draft` | 门禁不完整或尚未稳定保存 |
| `ready` | 满足门禁并稳定保存，可作为权威输入 |
| `superseded` | 已被新 ready revision 取代，历史保留 |

`draft → ready` 最低门禁：商品名称非空；至少一张服务端核验成功的商品图片；至少一条非空且由用户确认的核心卖点；当前 revision 已稳定保存；所有引用属于当前 Organization 且可访问。相关商品事实变化时创建新 draft ProductRevision；新 revision 成为 ready 后旧 revision 变为 superseded。

## 6. Asset / AssetVersion

**Asset**：长期素材身份。生命周期：`active` / `disabled` / `deleted`。`deleted` 仅允许：无历史业务引用、符合保留政策、不属于必须保留的审计对象（**disabled ≠ deleted**）。

**AssetVersion**：实际文件或生产相关元数据版本。核验状态：`upload_pending` / `uploading` / `verifying` / `available` / `verification_failed` / `unavailable`。**上传完成 ≠ available**；只有服务端核验成功后 AssetVersion 才为 `available`。文件内容/授权范围/生产能力变化时创建新 AssetVersion；仅修改展示名称、普通标签或非生产备注时可更新非生产元数据，不必创建生产版本。

AvatarAsset/人物资产附加状态：
- `authorization_status`：`valid` / `expiring` / `expired` / `incomplete`
- `capability_status`：`verified` / `unverified` / `incompatible` / `unavailable`

人物存在不等于可以用于新 VideoPlan。

## 7. CopyVersion

CopyVersion 自身只描述版本生命周期，不承担 QC 和人工审核状态。

| 生命周期 | 含义 |
|---|---|
| `draft` | 当前可编辑；尚未进入正式 QC |
| `frozen` | 已启动 QC、进入审核或被下游引用；正文不得原地覆盖 |
| `superseded` | 已产生更新版本；历史保留 |

- `draft` 编辑并保存后仍为 `draft`；启动 QC 后进入 `frozen`。
- 对 `frozen` 版本执行人工修改、AI 改写或复制历史版本时，创建新的 `draft` CopyVersion；新版本形成后旧版本可标记为 `superseded`。
- **任何正文变化都必须创建新版本。**

## 8. QualityRun / QualityResult / QualityFinding

**QualityRun**（技术执行记录）：`queued` / `running` / `succeeded` / `failed` / `cancelled`。QualityRun 状态 ≠ 业务质检结果。

**QualityResult**（不可变业务结论）：`invalid` / `blocked` / `needs_review` / `passed`。继续遵守 D-025：QC passed ≠ 文案 approved；`invalid`/`blocked` 不允许人工绕过；`blocked` 不允许管理员覆盖。

QualityResult 聚合规则：必要 QC 未完整执行 → `invalid`；存在任意硬阻断 Finding → `blocked`；无硬阻断但存在未完成处理的人工判断 Finding → `needs_review`；其他检查完成且无未处理问题 → `passed`。QualityRun 技术失败通常意味着当前 CopyVersion 没有新的有效 QualityResult，页面表达为「质检未完成」。

**QualityFinding** 至少保存：Finding ID、规则或 Evidence 引用、严重程度、命中文本、原因、修复建议、`resolution_state`、`resolution_reason`、`resolved_by`、`resolved_at`。`needs_review` Finding 处理状态：`unresolved` / `accepted_with_reason` / `change_requested` / `returned_to_facts` / `superseded`。

禁止：删除原 Finding；修改历史 Finding 使其看起来从未发生；接受 blocked Finding；用人工批准补救 invalid 结果；批量忽略全部 Finding。

## 9. 文案 HumanReview

HumanReview 是独立、不可变的审核记录。界面状态：`not_submitted` / `pending` / `approved` / `changes_requested` / `revoked`。`not_submitted` 可以是服务端计算出的界面状态，不强制要求存在空 Review 数据行。

| 转换 | 触发 |
|---|---|
| `not_submitted → pending` | SubmitCopyForReview |
| `pending → approved` | ApproveCopy |
| `pending → changes_requested` | RequestCopyChanges |
| `approved → revoked` | RevokeCopyApproval 或相关权威上游输入变化 |
| `changes_requested → not_submitted`（新版本） | 创建新 CopyVersion 后重新进入 |

提交审核门禁：CopyVersion 已 frozen；存在有效 QualityResult 且不是 invalid/blocked；needs_review Finding 已按规则处理；ProductRevision 仍匹配；QC Profile 和规则版本仍有效；CopyVersion 未 superseded。批准前必须再次验证 Review 仍为 pending、CopyVersion 未被替代、QC 未失效、ProductRevision 未变化、所有 Finding 已满足处理要求、审核人有权限。本人审核允许但记录 `review_mode = self_review`。

**DM-005**：已 revoked 的 Review 不得原地恢复为 approved；再次批准必须创建新 Review 并重新检查门禁。

## 10. 文案业务可用性

「文案可以进入新 VideoPlan」是服务端计算结果，而非前端可直接修改的字段。计算条件：CopyVersion 未 superseded；存在当前有效 QualityResult 且满足提交/批准门禁；存在当前有效 approved HumanReview；ProductRevision 仍匹配；QC Profile 和规则版本仍匹配。页面可展示 `current_valid` / `invalidated` / `approval_revoked` / `superseded`，但权威依据是版本引用和 Review 记录。

## 11. AvatarSelection

AvatarSelection 表示用户为当前产品和文案选择的人物版本引用。生命周期：`draft` / `confirmed` / `superseded`。

确认门禁：当前文案 approved 仍有效；Avatar AssetVersion 可用；授权有效；当前已有 Evidence 支持其能力；当前 Organization 有权使用；必要素材可访问。更换人物：创建新 AvatarSelection；旧选择保留；不静默修改已有 VideoPlan；相关 VideoPlan 需重新确认或创建新版本。

## 12. VideoPlanVersion

VideoPlanVersion 使用不可变版本。生命周期：`draft` / `frozen` / `superseded`。必须固定引用：ProductRevision、CopyVersion、AvatarSelection（或 Avatar AssetVersion）、能力配置快照、输出说明、创建人、创建时间、父版本。

- `draft` 可编辑；启动 Preflight 后进入 `frozen`。
- 对 `frozen` 方案的关键修改创建新 `draft` VideoPlanVersion；新方案形成后旧方案可 `superseded`。
- 商品、文案、人物不得在 VideoPlan 内被原地覆盖。

## 13. PreflightRun / PreflightResult

**PreflightRun**（技术执行记录）：`queued` / `running` / `succeeded` / `failed` / `cancelled`。PreflightRun 状态 ≠ PreflightResult。

**PreflightResult**（业务结论）：`not_run` / `passed` / `warning` / `blocked` / `invalidated`。区分三组检查：`upstream_validity`、`plan_completeness`、`production_readiness`。

- 上游无效、授权失效、配置缺失属于 hard block；
- Local Agent 离线属于 production readiness 提醒；
- Provider 登录失效不撤销方案内容和审核，但会影响自动执行；
- 未验证能力不能被视为已支持能力。

语义：Preflight passed（或允许审核的 warning）→ 可提交方案审核；production readiness satisfied → 可立即自动执行；production readiness 不满足 → 仍可审核、仍可创建 `waiting_for_executor` ProductionOrder、可生成人工交接包。**Preflight passed ≠ VideoPlan approved。**

## 14. PlanReview

PlanReview 为独立审核记录。状态：`not_submitted` / `pending` / `approved` / `changes_requested` / `revoked`。

| 转换 | 触发 |
|---|---|
| `not_submitted → pending` | SubmitPlanForReview |
| `pending → approved` | ApprovePlan |
| `pending → changes_requested` | RequestPlanChanges |
| `approved → revoked` | RevokePlanApproval 或相关上游变化 |

提交审核门禁：VideoPlanVersion 已 frozen；PreflightResult 为 passed 或允许审核的 warning；不存在 hard block；CopyVersion approved 仍有效；Avatar 授权和能力仍有效；VideoPlanVersion 未 superseded。创建 ProductionOrder 前必须再次验证 PlanReview，不能依赖页面缓存。撤销后再次批准需创建新 PlanReview，不能恢复旧 revoked 记录。

## 15. ProductionOrder

| 状态 | 含义 |
|---|---|
| `draft` | 工单记录尚未固定全部必要输入 |
| `ready` | 输入和批准有效，可进入调度 |
| `waiting_for_executor` | 等待符合条件的 Local Agent 或人工执行；可已生成 ManualHandoffPackage |
| `claimed` | 执行环境已获得工单租约 |
| `running` | 已开始真实自动或人工执行 |
| `requires_action` | 经人工处理后可能继续；≠ failed |
| `succeeded` | 产物核验成功且正式 Work 已创建 |
| `failed` | 当前工单无法在原业务条件下继续 |
| `cancel_requested` | 已请求取消，尚未得到执行环境确认 |
| `cancelled` | 已确认停止，不再继续执行 |

CreateProductionOrder 门禁：VideoPlanVersion 是当前有效版本；PlanReview 是当前有效 approved；Preflight 未失效；ProductRevision/CopyVersion/Avatar AssetVersion 引用完整；不存在由相同幂等键产生的等价工单；用户有权限；业务目的明确。

主要转换：`draft → ready`（固定输入快照）；`ready → waiting_for_executor`（无可用 Agent 或选择人工交接）；`ready/waiting_for_executor → claimed`（Agent 接受）；`claimed → running`；`claimed → waiting_for_executor/requires_action`（lease 超时）；`running → requires_action`（需人工介入）；`running → 新 ExecutionAttempt`（可重试技术失败）；`running → failed`（业务不可恢复）；`running → succeeded`（产物核验成功且 Work 创建成功）；`* → cancel_requested → cancelled`。

**Provider 页面显示「完成」≠ ProductionOrder succeeded。** succeeded 必须同时满足：Provider 或人工执行报告完成；候选产物已回传或受控登记；对象存在；文件类型与大小有效；Organization 归属正确；ProductionOrder 追踪关系正确；Work 创建成功。

## 16. ExecutionAttempt

一个 ProductionOrder 可拥有多个 ExecutionAttempt。状态：`created` / `claimed` / `running` / `requires_action` / `succeeded` / `failed` / `cancel_requested` / `cancelled` / `timed_out` / `superseded`。

关键规则：每次技术重试创建新 ExecutionAttempt；执行器切换创建新 ExecutionAttempt；Playwright 切换影刀不得无痕继续原 attempt；每个 attempt 固定记录 Agent、Connector、协议版本和能力快照；**attempt succeeded ≠ ProductionOrder succeeded**；attempt 报告产物后仍需云端核验；重复回调必须幂等；乱序回调不能使状态倒退；同一 ProductionOrder 同一时刻原则上最多一个有效运行 attempt。

**DM-003**：人工执行同样创建 ExecutionAttempt，`executor_type = manual`；人工 attempt 不伪造 Agent 心跳、Adapter、Playwright、影刀、自动化步骤、Provider 技术状态。

**DM-004**：同一个 VideoPlan 可因明确业务目的重复生产，但每次创建新的 ProductionOrder。业务目的示例：`first_production` / `rework` / `supplemental_version` / `reproduction`。具体枚举可在技术规格收敛，但不得由重复点击自动产生新工单。

## 17. ManualHandoffPackage

人工交接包必须：绑定精确 ProductionOrder；绑定精确 VideoPlanVersion；绑定输入快照；具有版本；具有幂等生成边界；保留创建人和时间；不自动代表执行成功。**人工交接包不是绕过 ProductionOrder 的独立业务路径。**

包格式、字段合同、生命周期、素材引用、manual ExecutionAttempt 开始条件、候选产物核验与 Work 创建门禁、证据/幂等/安全边界由 **D-029** 正式固化，权威 Specification 为 [MANUAL_HANDOFF_PACKAGE_CONTRACT.md](MANUAL_HANDOFF_PACKAGE_CONTRACT.md)。关键口径（D-029）：ZIP 含权威 `manifest.json` + 派生 `README.md` + 可选 `assets/`；区分合同 Schema 版本与业务 `package_version`（不可变，manual ExecutionAttempt 绑定 package_id+package_version+manifest_hash）；生成/下载包 ≠ 开始执行；执行者领取并确认开始时创建 `executor_type=manual` 的 ExecutionAttempt；人工结果用不可变 ManualExecutionReport（见 §17b）；候选产物核验通过且 Work 创建成功后 ProductionOrder 才能 succeeded。

### 17b. ManualExecutionReport（D-029）

ManualExecutionReport 是绑定一个 ExecutionAttempt 的**不可变**人工结果记录：不覆盖 ExecutionAttempt；不直接设置 ProductionOrder 最终状态；可通过新 report_version 或 `supersedes_report_id` 修正，但旧报告保留。`outcome`：`completed` / `requires_action` / `failed` / `cancelled`；**禁止人工提交 `production_order_succeeded` / `work_created` / `provider_verified`**。`deviations` 记录执行偏差，核心输入偏差不得自动创建 Work。输出引用含 `checksum`，本地绝对路径不得成为云端权威引用。

结果转换：`completed` → ExecutionAttempt succeeded → 候选产物核验 → 创建 Work → ProductionOrder succeeded（**ExecutionAttempt succeeded ≠ ProductionOrder succeeded**）；`requires_action`（≠ failed）需真实恢复检查；`failed` 按错误类别决定工单是否 failed；`cancelled` 配合 `cancel_requested`。

幂等：`report_id + payload_hash` 相同返回原结果；`report_id` 同 payload 不同拒绝并记冲突；修正用新 report_version 或 supersedes_report_id，不覆盖旧报告。详见 [MANUAL_HANDOFF_PACKAGE_CONTRACT.md](MANUAL_HANDOFF_PACKAGE_CONTRACT.md)（D-029）。

## 18. AsyncJob

AsyncJob 用于文案生成、AI 改写、自动质检、Preflight、素材核验、产物核验等云端异步工作。状态：`queued` / `running` / `succeeded` / `failed` / `cancelled` / `timed_out`。建议技术属性：`attempt_count`、`max_attempts`、`available_at`、`lease_owner`、`lease_expires_at`、`last_error_category`、`idempotency_key`。

关键规则：AsyncJob 状态 ≠ 业务结论；QualityRun succeeded 可产生 QualityResult blocked；PreflightRun succeeded 可产生 PreflightResult blocked；业务阻断不进行无限技术重试；重试次数有限；Worker 重启后可恢复；领取通过 lease 和幂等保护。AsyncJob 不进入全局视频「生产任务」主表。

## 19. Work

Work 表示已正式核验并登记的作品。状态：`available` / `unavailable` / `withdrawn`（创建时通常 `available`）。固定引用：ProductionOrder、成功 ExecutionAttempt、VideoPlanVersion、CopyVersion、Avatar AssetVersion、文件 AssetVersion、生产配置快照、创建时间。Work 不因后续商品/文案/人物/方案变化而被改写。Work 不直接使用「待检查/可交付/需要返工/已交付」——这些属于 WorkInspection 和 DeliveryRecord。

## 20. WorkInspection

| 状态 | 含义 |
|---|---|
| `pending` | 待检查 |
| `passed` | 标记可交付（MarkWorkDeliverable） |
| `rework_required` | 要求返工（RequestRework） |
| `superseded` | 后续检查取代 |

要求返工必须记录：分类、具体原因、检查人、检查时间、返回哪个上游阶段、后续 ProductionOrder 或 Work 关系。原检查记录不可覆盖；如同一 Work 需重新检查，应创建新 WorkInspection，不删除/改写原记录。

## 21. DeliveryRecord

DeliveryRecord 是交付业务事件，不是 Work 状态。每条记录至少包含：`delivery_id`、`work_id`、`delivered_by`、`delivered_at`、`delivery_method`、`note`、`recipient_reference`（可选）。

**DM-002**：一个 Work 可以有多条 DeliveryRecord；页面「已交付」根据「存在至少一条有效 DeliveryRecord」计算。重新交付或补发必须创建新 DeliveryRecord，不覆盖原交付记录。**Work ≠ DeliveryRecord。**

## 22. LocalAgent

必须区分连接状态与业务可用状态。

- 连接状态：`pairing` / `online` / `offline` / `revoked`
- 业务可用状态：`unconfigured` / `available` / `busy` / `requires_action` / `incompatible` / `disabled`

示例组合：`online + available`、`online + busy`、`online + requires_action`、`online + incompatible`、`offline + disabled`、`revoked + disabled`。状态依据：online/offline 真实心跳和超时；available/busy 当前租约和能力；requires_action 来自 ProviderConnection 或运行任务报告；incompatible 协议或能力不兼容；disabled 管理员禁止新任务分配；revoked 设备凭据已撤销。**前端不得直接将 Agent 修改为 online。**

## 23. ProviderConnection

继续遵守 Q-018 工作基线。**ProviderConnection 不保存 Hifly 网页 Secret。** 状态：`not_configured` / `unknown` / `available` / `requires_login` / `requires_verification` / `unavailable` / `revoked`。

ProviderConnection 只保存：Organization、LocalAgent、Provider 类型、连接状态摘要、最近验证时间、已验证能力摘要、脱敏账号引用、Evidence 版本。**不得保存**：用户名和密码、Cookie、LocalStorage、浏览器 Profile、Hifly Token 明文、验证码、未脱敏页面数据。

**Q-018 继续保持 Pending Evidence / Open。D-028 不关闭 Q-018，也不声称 SPK-018 已完成。**

## 24. 失效传播矩阵

核心原则：**只有与当前生成、质检、审核、方案预检或生产输入有关的权威快照变化，才传播失效。**

| 变化 | 失效传播 |
|---|---|
| 商品名称/已确认核心卖点相关变化 | 文案 QC 失效；文案批准 revoked；VideoPlan 需新版本；PlanReview revoked；已有 ProductionOrder 保留原快照 |
| 商品图片变化 | 仅当图片参与当前生成/审核/方案输入时才触发相关失效；不得无条件级联全部撤销 |
| ContentBrief 变化 | 当前文案 QC 失效；文案批准 revoked；相关 VideoPlan 和 PlanReview 需重新确认 |
| QC Profile 或规则版本变化 | 仅适用于当前文案的相关规则变化才触发失效；不得因无关规则更新撤销全部批准 |
| 创建新 CopyVersion | 新版本需新 QC 和 Review；旧批准不继承；VideoPlan 必须引用明确 CopyVersion |
| 更换人物或人物版本 | 不影响文案 QC；创建新 VideoPlanVersion；原 PlanReview revoked；已有 ProductionOrder 保留原快照 |
| 人物授权失效 | 不修改历史文案；当前 VideoPlan 失效；原 PlanReview revoked；历史工单和作品保留；不允许创建新 ProductionOrder |
| Local Agent 离线 | 不影响文案；不影响 VideoPlan；不撤销 PlanReview；ProductionOrder 保持 waiting_for_executor |
| Provider 登录失效 | 不影响文案和 PlanReview；自动执行进入 requires_action；不应直接把 VideoPlan 设为无效 |
| 展示名称/排序/普通备注等非生产元数据变化 | 不触发 QC、Review 或 VideoPlan 失效 |

已有 ProductionOrder、ExecutionAttempt 和 Work 永远保留生产时快照，不被后续版本静默改写。

## 25. 并发与幂等

**并发控制**：可编辑对象需要乐观并发控制（如 `revision_number` / `row_version` / ETag）。保存命令必须提交其基于的版本。检测到冲突时服务端拒绝静默覆盖，返回版本冲突；页面提供查看最新版本、复制当前内容、放弃当前修改等选择。不得建设「最后保存者自动覆盖」行为。已进入审核或 frozen 的版本不允许继续覆盖编辑。

**幂等规则**：至少以下操作需要幂等键或等价唯一约束——创建文案生成任务、AI 改写、启动 QC、提交文案审核、批准或要求修改文案、创建 VideoPlan、运行 Preflight、提交和批准方案、创建 ProductionOrder、创建 ExecutionAttempt、生成人工交接包、上传完成回调、产物登记、创建 Work、创建 DeliveryRecord。

约束语义：同一 CopyVersion + QC Profile + 规则版本不得并发产生多个「当前有效」QualityRun；同一 VideoPlanVersion 不得有多个并行 pending PlanReview；同一 VideoPlanVersion + 业务目的 + idempotency key 不得重复创建等价 ProductionOrder；同一 ProductionOrder 同一时刻最多一个有效运行 ExecutionAttempt；同一候选产物不得重复创建多个 Work。不在产品文档中固定具体数据库索引名称。

## 26. 事务边界

以下操作应在单一数据库事务中完成：

- **创建异步任务**：保存业务对象 + 创建 AsyncJob 或 Outbox。
- **批准文案**：重新验证 QC 和上游版本 + 创建 approved HumanReview + 创建 AuditEvent。
- **批准 VideoPlan**：重新验证 Preflight 和所有上游引用 + 创建 approved PlanReview + 创建 AuditEvent。
- **创建 ProductionOrder**：重新验证 VideoPlanVersion 和 PlanReview + 固定输入快照 + 创建 ProductionOrder + 写入幂等记录 + 创建调度事件或 Outbox + 创建 AuditEvent。
- **创建 Work**：核验候选产物 + 创建 Work + 关联 ExecutionAttempt + 推进 ProductionOrder 为 succeeded + 创建 AuditEvent。

**禁止先将 ProductionOrder 标记为 succeeded，再尝试创建 Work。**

## 27. Phase 1 / Phase 2 边界

**Phase 1** 必须实现或形成明确合同：ProductRevision；AssetVersion 与服务端核验；CopyVersion；QualityResult；HumanReview；AvatarSelection；VideoPlanVersion；PreflightResult；PlanReview；ProductionOrder；ExecutionAttempt 数据边界；ManualHandoffPackage；受控人工结果登记；Work；WorkInspection；DeliveryRecord；AsyncJob；AuditEvent；乐观并发；幂等边界。

**Phase 2** 再实现：真实 Local Agent 配对；ProviderConnection 真实验证；自动领取；真实 ExecutionAttempt；ProviderTaskReference；登录失效恢复；状态和产物自动回传；多 Agent 调度；Playwright/影刀 Adapter。

Phase 1 应提前把 ProductionOrder 和 ExecutionAttempt 领域边界设计正确，但**不得声称 Phase 2 已实现**。

## 28. DM-001 ～ DM-005

| 编号 | 已确认决策 |
|---|---|
| **DM-001** | ProductRevision 使用相关商品事实变化后的完整不可变快照，不采用逐字段事件回放作为 MVP 权威模型 |
| **DM-002** | 一个 Work 可拥有多条 DeliveryRecord；界面「已交付」由至少一条有效 DeliveryRecord 计算 |
| **DM-003** | 人工执行也创建 ExecutionAttempt，`executor_type = manual`；不得伪造自动化执行信息 |
| **DM-004** | 同一 VideoPlan 可因明确业务目的创建多个 ProductionOrder，但每次都必须是新工单，且不得由重复点击产生 |
| **DM-005** | revoked Review 不得恢复为 approved；再次批准必须创建新 Review，并重新验证所有门禁 |

## 29. 非目标

D-028 不固定：数据库表名/字段名；ORM；API 路径；JSON Schema；事件总线产品；前端状态管理实现；状态机代码库；密码策略；文件大小限制；Hifly 页面状态映射；Playwright 与影刀最终职责；Provider 官方 API；Hifly Token 保管实现；ManualHandoffPackage 文件格式；完整 RBAC；高保真 UI。不得在文档中创造这些已经实现或已经确认的假象。

## 30. 后续待完成事项

- ProductionOrder 人工交接包合同（ManualHandoffPackage 字段/格式/回传协议）；
- Vertical Slice A Issue 拆分原则与 Definition of Done；
- HIFLY-001 与 SPK-018-01～06 并行 Evidence；
- Q-018（飞影 API Token 保管与调用位置）保持 Pending Evidence / Open。
