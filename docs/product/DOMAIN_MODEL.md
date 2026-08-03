# 领域模型

> 状态：Accepted（实体清单与多状态域分离原则已固化；具体字段命名可在实现阶段调整）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
> 适用范围：所有涉及领域模型的设计、Issue 拆分与代码评审
> 非目标：本文档不定义数据库表结构、ORM 选型或 API 字段细节

---

## 一、实体清单与关系

至少规划以下实体：

```text
Organization
User
OrganizationMember
Role

Project
ProjectMember
BrandGuideline
Product
ProductAsset

ContentBrief
CopyVariant
CopyVersion
CopyQualityCheck
CopyApproval

Asset
AvatarAsset
VoiceAsset
BackgroundAsset
AudioAsset
VideoSourceAsset
SubtitleTemplate
CoverTemplate
AvatarCreationTask

VideoPlan
VideoPlanVersion
VideoPlanApproval
ProductionPreflight

GenerationTask
ProviderTask
ExecutionAttempt
LocalAgent
ProviderConnection
ExecutionEvidence

Artifact
VideoArtifact
QualityCheck
DeliveryPackage

UsageRecord
CostEstimate
Quota
Budget
PublishingRecord
PerformanceMetric

LlmProviderConfig

AuthorizationRecord
ConsentEvidence
AuthorizationRevocation
DeletionRequest
AuditEvent
```

**商业化收费实体为非目标**（D-016）：Plan、Subscription、Billing、Payment、Package、Balance 等仅服务面向客户收费的实体不纳入领域模型（产品不建设支付/套餐/账单）；UsageRecord、CostEstimate、Quota、Budget 保留，用于企业内部治理，不用于向企业收费。

### 关系骨架

```text
Organization ──< OrganizationMember >── User
OrganizationMember ── Role
Organization ──< Project
Project ──< ProjectMember
Project ── BrandGuideline
Project ──< Product ──< ProductAsset
Product ──< ContentBrief ──< CopyVariant ──< CopyVersion
CopyVariant ──< CopyQualityCheck
CopyVariant ──< CopyApproval
Organization ──< Asset（AvatarAsset / VoiceAsset / BackgroundAsset /
                     AudioAsset / VideoSourceAsset /
                     SubtitleTemplate / CoverTemplate）
AvatarCreationTask ──> AvatarAsset（创建完成后登记）
AvatarCreationTask ── AuthorizationRecord（创建前授权校验）
Project ──< VideoPlan ──< VideoPlanVersion
VideoPlan ──< VideoPlanApproval
VideoPlan ── ProductionPreflight
VideoPlan ──> 编译/下发 ──> Batch ──< Task（现有执行层）
GenerationTask ──< ProviderTask ──< ExecutionAttempt
LocalAgent ──< ExecutionAttempt
ProviderConnection ──< ProviderTask
ExecutionAttempt ──< ExecutionEvidence
GenerationTask ──< Artifact ── VideoArtifact
Artifact ──< QualityCheck
Project ──< DeliveryPackage
GenerationTask ──< UsageRecord / CostEstimate
Organization ──< Quota / Budget
Organization ──< LlmProviderConfig
CopyGenerationService ──> LlmProviderConfig（凭证配置引用，不含明文 Key）
Artifact ──< PublishingRecord ──< PerformanceMetric
```

---

## 二、多状态域分离原则

必须区分以下状态域，**不得让一个 status 字段承载所有语义**：

- 产品领域状态（业务推进到哪一步）
- Provider 状态（供应商任务的真实状态）
- Local Agent 执行状态（本地执行器的运行状态）
- 产物状态（文件/作品是否可用）
- 审核状态（是否通过人工审核）

### CopyVariant 生命周期

```text
draft
quality_check_pending
needs_revision
review_pending
approved
archived
```

### VideoPlan 生命周期

```text
draft
review_pending
needs_revision
approved
queued
generating
completed
failed
cancelled
```

### Asset 生命周期

```text
uploading
processing
ready
failed
disabled
```

### GenerationTask 生命周期

```text
queued
preparing
provider_processing
downloading
quality_checking
completed
needs_attention
failed
cancelled
```

具体命名可以后续调整，但文档必须明确**多状态域分离原则**：各状态域独立建模、独立流转，通过映射层互相投影，不共用单一字段。

---

## 二之一、组织与成员模型（字段规划，本轮不决定完整 RBAC）

成员关系只使用两个实体，**不得新增第二套成员关系实体**：

- **OrganizationMember**：企业级成员关系（组织-成员-角色）；
- **ProjectMember**：项目级参与关系。

Organization（字段规划）：

```text
Organization
- id
- name
- status
- createdAt
```

OrganizationMember（字段规划，承载企业级成员-角色关系）：

```text
OrganizationMember
- organizationId
- userId
- role
- status
```

第一版单企业/单组织 MVP（D-014 / D-015）保留 Organization 边界，但第一版不实现完整 RBAC；角色与权限细化属于 ENTERPRISE-001（Phase 4）。

## 二之二、LLM 凭证配置模型（D-019 / D-020，字段规划）

LlmProviderConfig（字段规划）：

```text
LlmProviderConfig
- organizationId
- provider
- baseUrl
- model
- credentialSource: platform | organization
- encryptedSecretRef
- status
- createdBy
- updatedBy
- lastConnectionTestAt
```

要求：

- `credentialSource` 为 `platform`（平台默认凭证）或 `organization`（企业自有 API Key，BYOK）；
- **不保存明文 API Key**；**不返回明文 API Key**；
- SecretStore 是基础设施实现，不是领域实体（具体 SecretStore 由 Q-021 决定）；
- 任务只记录 credential configuration/version ID，不记录 Key；
- 真实 Key 遵守 D-020 安全底线（见 [DECISION_LOG.md](DECISION_LOG.md)）。

## 二之三、数字人创建任务模型（D-017 Vertical Slice B，字段规划）

AvatarCreationTask（字段规划）：

```text
AvatarCreationTask
- organizationId
- avatarAssetId
- provider
- providerTaskId
- sourceAssetId
- authorizationRecordId
- status
- resultProviderAvatarId
- error
- createdAt
- updatedAt
```

要求：创建前必须有有效授权（authorizationRecordId，D-011）；创建为异步 task，经 task status/callback + 轮询对账跟踪；完成后登记 AvatarAsset；可能产生 Provider 消耗，开发前须 owner 单独授权。

## 二之四、商品事实与文案模型（D-021，字段规划）

概念级建模。本轮不定义数据库类型、ORM、API payload、migration、字段长度或具体枚举实现。

Product（相对稳定的商品事实，字段规划）：

```text
Product
- name（最低输入，必填）
- productImages（最低一张）
- sellingPoints（最低一条，经用户确认）
- description（可选）
- 商品事实的确认状态或确认语义
```

语义约束：

- **Product 可以在没有 CopyVariant 时创建、保存和存在**，不得强制 Product 自身必须拥有已批准文案；
- Product 满足最低商品事实后，可以申请生成 CopyVariant；
- 「文案为空」与「商品资料不满足生成条件」是两个不同状态；
- 图片识别候选不是正式 Product fact；未经确认的候选信息不得进入 LLM 输入。

ContentBrief（可选内容偏好，D-022，字段规划）：

- ContentBrief is **optional**：可以完全不存在（may be absent），可以存在但包含零个或多个用户偏好（may contain zero or more user preferences）；**不拥有 MVP 必填字段**，不是 Product 的必需关联。
- 概念级字段（本轮不固化字段类型、长度限制、枚举代码或默认秒数）：
  - 表达风格偏好（默认：自然口语化种草）；
  - 种草角度偏好（默认：由 AI 根据已确认卖点选择）；
  - 期望口播长度提示（仅文案篇幅提示，不代表 VideoPlan 或 Provider 的精确视频时长）；
  - 收尾方式偏好（默认：自然收尾）；
  - 补充要求（自由文本，不作为结构化平台或人群字段）。

语义约束：

- Product 满足 D-021 最低商品事实后，即可申请生成 CopyVariant；**ContentBrief 缺失或为空不影响生成资格**；
- 目标平台和目标人群**不是 MVP 独立领域字段**；特殊平台或人群要求可以作为补充要求表达；
- 补充要求中的事实性声明**不得自动升级为 Product confirmed fact**，也不得绕过 D-021 事实安全门禁；
- 不得将补充要求直接并入 Product facts；
- CopyVariant 仍必须通过质检和人工确认（approved 后才能被 VideoPlan 引用）。

CopyVariant 来源与门禁：

```text
CopyVariant source
- ai_generated
- user_provided
- ai_rewritten
```

- AI 生成（ai_generated）和 AI 改写（ai_rewritten）结果初始均为草稿；已有文案（user_provided）可直接作为草稿；
- 全部来源的文案均需经过质检与人工确认；
- **只有 approved 状态的 CopyVariant 才能被 VideoPlan 引用**。

---

## 三、VideoPlan 到 batch/task 的映射

不得删除现有 batch、task、artifact 和 execution 能力。映射关系：

```text
Project
└── VideoPlan[]
      ↓ 编译/下发
Batch
└── Task[]
      ↓ 执行
ProviderTask / ExecutionAttempt
      ↓ 生成
Artifact / VideoArtifact
```

- 新产品层中的 **VideoPlan 是业务真相**；
- 现有 batch/task 是**执行层工作单**；
- **不得直接把 batch 暴露为用户项目，也不得让用户修改底层 execution 状态。**

### 编译边界

需要规划一个编译边界，例如：

```text
compileApprovedVideoPlansToBatch()
```

该边界负责：

- 校验已批准方案
- 固化方案版本
- 解析资产引用
- 选择 Provider
- 生成执行参数
- 创建 batch/task
- 建立双向追踪 ID

**本轮只记录设计，不实现。**

---

## 四、资产模型

- 资产统一归属 Organization（或项目范围），按类型细分：数字人（AvatarAsset）、声音（VoiceAsset）、背景与场景（BackgroundAsset）、音频（AudioAsset）、原始视频（VideoSourceAsset）、字幕模板（SubtitleTemplate）、封面模板（CoverTemplate）；
- 每个资产记录来源类型、Provider 与 Provider 内部引用、创建/授权状态；
- **数字人与声音不硬绑定**：同一数字人可搭配多个声音，组合关系在视频方案中确定；
- **普通用户不以本地文件路径为主要信息**：路径属于 Local Agent / 技术诊断域；
- 资产生命周期见上文 Asset 状态。

---

## 五、审核模型

审核贯穿两个边界：

1. **文案审核**（CopyApproval + CopyQualityCheck）：质检结果包含结构化分数、问题位置和修复建议；只有 approved 的文案进入视频方案；
2. **方案审核**（VideoPlanApproval）：草稿 → 待审核 → 需修改 → 已批准 → 已排入生产；未批准方案不得编译为 batch；
3. **成片审核**（QualityCheck + 作品库人工通过/退回）：基础质检 + 后续 AI 质检，结果登记并可退回。

审核动作（批准/退回/需修改）必须留痕：审核人、时间、意见、版本。

---

## 六、用量模型（企业内部治理，D-016）

- UsageRecord：每次生产动作的用量登记（任务数、Provider、能力类型）；
- CostEstimate：生产前的预计 Provider 消耗与成本提示；
- Quota / Budget：企业内部配额与预算限额；
- 面向 SaaS 用户的表达是**任务数、预计用量、内部额度、Provider 成本提示**；
- **内部 pointBudget 不作为用户术语**（技术实现细节留在执行层与诊断页面）。

UsageRecord / CostEstimate / Quota / Budget 用于**企业内部治理**（用量、成本、限额、审计、异常消耗告警），**不用于向企业收费**；产品不建设支付/套餐/账单（D-016）。

---

## 七、授权、同意与审计模型（Accepted 底线，见 DECISION_LOG D-011）

敏感资产（用户照片、视频、声音、数字人复刻源素材）的授权与保护规划以下实体（具体字段和存储方式待实现阶段决定）：

- **AuthorizationRecord**：一项授权记录（授权对象、授权范围、生效/失效状态、时间）；
- **ConsentEvidence**：授权证据（材料引用与核验信息；材料形式见 Q-007/Q-008，不预先决定）；
- **AuthorizationRevocation**：授权撤销事件（撤销人、时间、原因）；
- **DeletionRequest**：敏感资产删除请求（发起、审批、执行与结果）；
- **AuditEvent**：审计事件（创建、使用、撤销、删除等动作的留痕）。

关系骨架：

```text
Asset ──< AuthorizationRecord ── ConsentEvidence
AuthorizationRecord ──< AuthorizationRevocation
Asset ──< DeletionRequest
以上全部动作 ──> AuditEvent
```

### 资产可用状态与授权状态必须分离

```text
asset.status = ready
不等于
authorization.status = valid
```

- `asset.status`（uploading/processing/ready/failed/disabled）描述资产**可用性**；
- `authorization.status` 描述授权**有效性**；
- **只有两者同时满足（资产 ready 且授权 valid），才能通过生产 Preflight**；
- 授权失效、撤销或资产 disabled 后，新任务 Preflight fail-closed，不得创建新的 Provider 任务；
- 普通运营不能通过修改前端字段绕过授权状态；Provider Adapter 在真实上传前必须重新校验授权状态（见 [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md)）。
