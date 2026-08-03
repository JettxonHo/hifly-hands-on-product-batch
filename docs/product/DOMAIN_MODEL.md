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
Membership
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
PublishingRecord
PerformanceMetric
```

### 关系骨架

```text
Organization ──< User（经 Membership + Role）
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

## 六、用量模型

- UsageRecord：每次生产动作的用量登记（任务数、Provider、能力类型）；
- CostEstimate：生产前的预计 Provider 消耗与成本提示；
- 面向 SaaS 用户的表达是**任务数、预计用量、套餐余量、Provider 成本提示**；
- **内部 pointBudget 不作为用户术语**（技术实现细节留在执行层与诊断页面）。
