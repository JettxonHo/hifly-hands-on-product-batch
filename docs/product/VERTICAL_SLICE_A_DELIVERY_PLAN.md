# Vertical Slice A 交付计划与完成定义

> 状态：Accepted at product specification level
> Owner：owner（JettxonHo）
> 最后更新：2026-08-05
> 关联 Decision：[D-030](DECISION_LOG.md)
> 解决范围：Vertical Slice A 交付目标、Issue 拆分原则、VSA-A01～A14 边界、依赖波次、Issue 模板、单 Issue DoD、Slice 级 DoD
> 非目标：不创建 GitHub Development Issues；不实现代码/DB/Schema/Migration/API/前端/测试；不接入 Hifly；不关闭 Q-018；不声称 HIFLY-001/SPK-018 已执行；不代表开发已经开始

本文件是 D-030 的详细 Specification。它是**交付规划与验收合同**，不代表 GitHub Development Issues 已创建、A01～A14 已进入开发、数据库/API/前端/测试已实现，或 Vertical Slice A 已完成。A01～A14 是规划标识，**不是当前 GitHub Issue 编号**（specification completed ≠ implementation completed；issue planned ≠ issue created；issue created ≠ development started）。

---

## 1. 目的与范围

定义 Vertical Slice A 的真实业务交付终点、开发 Issue 拆分方式、A01～A14 业务边界、依赖与并行关系、统一 Issue 正文结构、单 Issue Definition of Done、Slice 级 Definition of Done、主路径与关键反向验收场景，以及哪些能力必须等待 HIFLY-001/Q-018/SPK-018。为后续创建 GitHub Development Issues 提供权威依据。

## 2. Vertical Slice A 交付目标

Vertical Slice A 的真实可操作 Phase 1 闭环：

```text
企业成员登录
→ 创建空白项目 → 录入商品信息 → 上传并核验商品图片 → 逐条确认核心卖点
→ 形成 ProductRevision ready
→ 生成 CopyVersion → 执行自动 QC → 处理 QualityFinding → 人工批准文案
→ 选择已有数字人物 → 创建 VideoPlan → 执行 Preflight → 人工批准 VideoPlan
→ 创建 ProductionOrder → 生成 ManualHandoffPackage
→ 人工执行者领取任务 → 创建 manual ExecutionAttempt
→ 上传候选视频 → 提交 ManualExecutionReport
→ 服务端核验候选产物 → 创建 Work → 完成 WorkInspection → 创建 DeliveryRecord
```

**Vertical Slice A 的生产终点**：ProductionOrder → ManualHandoffPackage → `executor_type=manual` 的 ExecutionAttempt → ManualExecutionReport → 候选产物核验 → Work → DeliveryRecord。**Vertical Slice A 不以 Hifly 自动化为完成条件**（manual execution ≠ Local Agent execution；test double ≠ verified Provider integration）。

## 3. VS-001 ～ VS-010

| 编号 | 已确认结论 |
|---|---|
| **VS-001** | Vertical Slice A 以「空白项目到正式 Work 和 DeliveryRecord」的人工生产闭环为交付目标 |
| **VS-002** | 开发 Issue 按用户结果和主要状态转换拆分，不按数据库/后端/前端/测试等技术层横向拆分 |
| **VS-003** | 采用 VSA-A01～VSA-A14 的建议 Issue 边界 |
| **VS-004** | 每个业务 Issue 默认对应 1 Issue → 1 实现分支 → 1 主要 PR；合并后仓库可构建可测试，不依赖另一条未合并分支 |
| **VS-005** | 不可变版本、失效传播、权限、Organization 隔离、幂等和并发控制必须与首次功能同时交付，不作为后续优化补充 |
| **VS-006** | Hifly 真实网页登录、Cookie/LocalStorage/浏览器 Profile 管理、Local Agent 真实配对、Playwright/影刀自动执行、Provider 自动领取/状态回传/产物下载、多 Agent 调度——不进入 Vertical Slice A |
| **VS-007** | 所有 A01～A14 Issue 使用统一正文结构和统一单 Issue Definition of Done |
| **VS-008** | VSA-A14 只负责端到端集成验收、回归和加固，不负责首次实现主要业务对象 |
| **VS-009** | Vertical Slice A 完成必须通过完整主路径和关键反向测试，不能只证明 happy path |
| **VS-010** | D-030 合并后，必须由产品负责人单独授权，才允许创建 A01～A14 GitHub Development Issues |

## 4. Issue 拆分原则

1. **按用户结果拆分**：每个 Issue 交付一个用户/业务人员可观察验收的结果（例：用户可上传商品图片，服务端核验后用于 ProductRevision）。不得单纯按「建表/API/页面/补测试」横向拆。数据库/领域/服务/最低可用 UI/权限/测试应尽量在一个业务 Issue 内闭环。
2. **一个 Issue 对应一个主要状态转换**：如 CopyVersion→QualityResult 与 pending HumanReview→approved HumanReview 应拆成不同 Issue（不同角色/门禁/权限/失败语义/审计要求）。
3. **Issue 必须独立可合并**：合并后仓库继续构建、测试继续通过、未完成能力有明确门禁、不需另一未合并 PR 即可运行、不引入长期不可用公开入口。
4. **避免纯前端/纯后端尾部任务**：每个业务 Issue 原则同时包含领域规则/持久化/服务端命令/最低可用交互/权限/错误空状态阻断状态/自动测试/必要文档。真正被多 Slice 复用的能力才单独作为 Enabler。D-030 不预先创建额外 Enabler Issue。
5. **业务正确性与首次功能同时交付**：不得先只实现成功路径再后补不可变版本/revoked/superseded/requires_action/幂等/乐观并发/Organization 隔离/AuditEvent/服务端权限门禁。
6. **Issue 明确权威输入和输出**：写明输入对象及版本、前置状态、创建对象、状态转换、下游依赖。禁止模糊表达（「当前商品信息」「最新文案」「当前方案」「当前素材」），应明确引用 ProductRevision/CopyVersion/VideoPlanVersion/AssetVersion/ProductionOrder/ExecutionAttempt。
7. **Evidence 阻塞能力不进入 Slice A**：依赖 HIFLY-001/Q-018/SPK-018 的真实自动执行能力不作为 A01～A14 隐含范围；测试替身或受控种子数据必须标识为 Phase 1 受控实现、非真实 Hifly 集成、非 Provider 能力 Evidence。
8. **安全属于每个 Issue**：每个涉及数据的 Issue 必须验证 Organization 隔离、成员权限、服务端重新验证对象归属、不信任前端提交的所属关系、不泄露 Secret 或永久 URL、关键命令有 AuditEvent 或等价审计。
9. **一个 Issue 对应一个主要 PR**：当一个 PR 含多个独立用户结果/跨多个主要状态转换/Reviewer 无法一次理解/需依赖另一未合并分支/修改大量不相关领域，应继续拆分。
10. **最终集成 Issue 不收容遗漏功能**：VSA-A14 只负责串联已实现能力、端到端自动测试、权限与失效回归、统一交互加固、AuditEvent 与可观测性核对、小型集成缺陷修复；不得在 A14 首次建设主要领域对象。

## 5. VSA-A01 ～ VSA-A14 总览

A01～A14 是规划标识，**不是现有 GitHub Issue 编号**。D-030 归档阶段不创建真实 Issue。

| ID | 主题 | 主要用户结果 |
|---|---|---|
| VSA-A01 | 企业身份与组织上下文 | 工作邮箱密码登录、首次改密、单一 Organization 自动进入 |
| VSA-A02 | 空白项目与商品权威快照 | 创建空白项目、录入商品、确认卖点、形成 ProductRevision ready |
| VSA-A03 | 素材上传与服务端核验 | 上传商品图片经服务端核验形成 AssetVersion available |
| VSA-A04 | 文案生成与不可变 CopyVersion | 基于明确 ProductRevision 异步生成可编辑 CopyVersion |
| VSA-A05 | 文案 QC 与 Finding 处理 | 运行 QC 查看 invalid/blocked/needs_review/passed 并逐项处理 Finding |
| VSA-A06 | 文案人工审核与失效传播 | 提交/批准/要求修改文案；上游变化撤销批准并保留历史 |
| VSA-A07 | 已有数字人物目录与选择 | 浏览并确认一个已有公共/企业人物 |
| VSA-A08 | VideoPlan、Preflight 与方案审核 | 基于 approved 文案 + confirmed 人物创建方案、Preflight、人工审核 |
| VSA-A09 | ProductionOrder 创建与等待执行 | 从 approved VideoPlan 创建有明确目的的工单 |
| VSA-A10 | ManualHandoffPackage 生成与下载 | 为工单生成并下载符合 D-029 的交接包 |
| VSA-A11 | 人工 ExecutionAttempt 与结果回传 | 领取任务、开始执行、提交不可变 ManualExecutionReport |
| VSA-A12 | 候选产物核验与 Work 创建 | 核验候选视频通过后创建正式 Work |
| VSA-A13 | 作品检查与交付登记 | 检查 Work、要求返工、标记可交付、记录 DeliveryRecord |
| VSA-A14 | Slice A 端到端验收与加固 | 串联 A01～A13 为稳定业务闭环（不首次实现主要对象） |

## 6. VSA-A01 ～ VSA-A14 详细边界

### VSA-A01 企业身份与组织上下文
- **用户结果**：企业成员用工作邮箱密码登录；首次登录改临时密码；单一 Organization 自动进入。
- **主要对象**：Organization、Member、Membership、Session、AuditEvent。
- **范围**：登录；首次密码修改；退出登录；成员禁用后访问拒绝；Organization 上下文；最低权限检查。
- **非目标**：公开注册；SSO；手机验证码；多 Organization 切换；完整 RBAC。

### VSA-A02 空白项目与商品权威快照
- **用户结果**：创建空白项目、录入商品信息、逐条确认核心卖点、形成 ProductRevision ready。
- **主要对象**：Project、Product、ProductRevision、ProductFact、ContentBrief。
- **最低 ready 门禁**：商品名称非空；至少一张核验成功的商品图片；至少一条由用户确认的核心卖点。
- **遵守 D-028**：ProductRevision 使用不可变完整快照；修改相关商品事实创建新 revision；不覆盖历史生产使用的 revision。

### VSA-A03 素材上传与服务端核验
- **用户结果**：上传商品图片后服务端核验形成可引用的 AssetVersion available。
- **主要对象**：Asset、AssetVersion、AssetReference、AsyncJob。
- **必须包括**：受控直传流程；上传完成 ≠ available；文件存在/类型/大小/Organization 归属核验；available/verification_failed/unavailable；disabled 与 deleted 区别；短时访问授权；重复上传完成回调幂等；被历史业务引用的素材不被静默删除。
- **并行**：A02 与 A03 可并行开发，但 A02 的 ProductRevision ready 验收依赖 A03。

### VSA-A04 文案生成与不可变 CopyVersion
- **用户结果**：基于明确 ProductRevision 发起文案生成，异步完成后获得可编辑的 CopyVersion。
- **主要对象**：CopyVersion、AsyncJob、generation abstraction。
- **必须包括**：异步生成；生成请求幂等；生成失败和安全重试；draft/frozen/superseded；编辑 frozen 文案创建新版本；不向普通用户暴露 Provider 或模型选择；不让技术任务状态代替文案业务状态。
- **Provider 边界**：可用受控 Provider 实现或测试替身，但领域合同不得绑定具体 Provider。

### VSA-A05 文案 QC 与 Finding 处理
- **用户结果**：运行 QC，查看 invalid/blocked/needs_review/passed，并逐项处理 QualityFinding。
- **主要对象**：QualityRun、QualityResult、QualityFinding。
- **必须包括**：D-025 权威顺序；QualityRun 与 QualityResult 分离；invalid 和 blocked 不可绕过；needs_review Finding 逐项处理；accepted_with_reason 必须填原因；规则版本快照；QualityResult 和 Finding 不可变；技术失败与业务阻断分离；AI rewrite 创建新 CopyVersion 并重新 QC。

### VSA-A06 文案人工审核与失效传播
- **用户结果**：有权限成员可提交/批准/要求修改文案；相关上游变化撤销当前批准并保留全部历史。
- **主要对象**：HumanReview、CopyVersion、ProductRevision、AuditEvent。
- **必须包括**：pending/approved/changes_requested/revoked；self_review 允许但明确记录；revoked 不恢复；再次批准创建新 HumanReview；批准前服务端重新验证 QC；上游相关事实变化触发批准撤销；并发冲突；重复批准幂等；无权限和跨组织访问拒绝。

### VSA-A07 已有数字人物目录与选择
- **用户结果**：浏览并确认一个已有公共/企业人物用于当前项目。
- **主要对象**：AvatarAsset、AssetVersion、AvatarSelection。
- **必须包括**：仅已有数字人物；授权状态；授权有效期；已验证能力摘要；未知能力不得显示为已支持；用户显式确认；更换人物创建新 AvatarSelection；Organization 使用范围；受控种子数据或预置人物。
- **非目标**：创建新人物；声音克隆；背景和场景编辑；Hifly 实时人物查询；未经 Evidence 的能力承诺。

### VSA-A08 VideoPlan、Preflight 与方案审核
- **用户结果**：基于有效 approved CopyVersion 和 confirmed AvatarSelection 创建 VideoPlan、执行 Preflight 并完成人工方案审核。
- **主要对象**：VideoPlanVersion、PreflightRun、PreflightResult、PlanReview。
- **必须包括**：VideoPlanVersion 不可变；上游对象只读引用；upstream_validity/plan_completeness/production_readiness；PreflightRun 与 PreflightResult 分离；Preflight passed ≠ PlanReview approved；Local Agent 离线只属生产准备提醒；上游变化撤销相关 PlanReview；revoked Review 不恢复；创建 ProductionOrder 前服务端重新验证批准。

### VSA-A09 ProductionOrder 创建与等待执行
- **用户结果**：从当前有效 approved VideoPlan 创建具有明确业务目的的 ProductionOrder。
- **主要对象**：ProductionOrder、AuditEvent、Outbox。
- **必须包括**：execution purpose；输入快照；服务端重新验证 VideoPlan 和 PlanReview；创建幂等；重复点击不产生新工单；ready；waiting_for_executor；Local Agent 离线不阻止人工工单创建；不允许绕过方案批准；不实现真实自动调度。

### VSA-A10 ManualHandoffPackage 生成与下载
- **用户结果**：为 ProductionOrder 生成并下载符合 D-029 的人工交接包。
- **主要对象**：ManualHandoffPackage、AssetReference、AsyncJob。
- **必须包括**：ZIP；权威 manifest.json；派生 README.md；可选受控 assets/；contract_version/package_version；manifest hash/package hash；embedded/short_lived_fetch/provider_existing；generating/ready/generation_failed/expired/revoked/superseded；生成或下载 ≠ 开始执行；不含 Secret/Cookie/Profile/永久 URL/跨组织数据；生成和下载幂等。

### VSA-A11 人工 ExecutionAttempt 与结果回传
- **用户结果**：执行者领取人工任务、开始执行并提交不可变 ManualExecutionReport。
- **主要对象**：ExecutionAttempt、ManualExecutionReport、candidate output。
- **必须包括**：executor_type=manual；绑定精确 package_id/package_version/manifest hash；同一工单同一时刻最多一个有效运行 attempt；completed/requires_action/failed/cancelled；deviations；报告修正通过 superseding 记录；候选产物上传；ManualExecutionReport 不得直接设置 ProductionOrder succeeded；不伪造 Local Agent/Playwright/影刀/Provider 自动回调。

### VSA-A12 候选产物核验与 Work 创建
- **用户结果**：系统核验人工上传的候选视频，通过后创建正式 Work。
- **主要对象**：AssetVersion、artifact verification AsyncJob、Work、ProductionOrder。
- **必须包括**：对象存在；Organization 归属；Order/Attempt/Report/Package 关联；文件类型/大小/checksum；主要产物唯一；Work 创建幂等；Work 创建和 ProductionOrder succeeded 在同一事务边界；核验失败不创建 Work；一个 ProductionOrder 最多一个主要视频 Work；ExecutionAttempt succeeded ≠ ProductionOrder succeeded。

### VSA-A13 作品检查与交付登记
- **用户结果**：检查 Work、要求返工、标记可交付并记录一次或多次 DeliveryRecord。
- **主要对象**：Work、WorkInspection、DeliveryRecord。
- **必须包括**：pending/passed/rework_required；返工原因；返回的上游阶段；原 Work 和检查历史保留；一个 Work 可以有多个 DeliveryRecord；重复网络请求不产生重复交付事件；Work 与 DeliveryRecord 分离；不含视频编辑或自动发布。

### VSA-A14 Vertical Slice A 端到端验收与加固
- **目标**：将 A01～A13 串联成稳定业务闭环。
- **只允许包括**：端到端主路径自动测试；跨页面导航；权限和 Organization 隔离回归；失效传播回归；错误/空状态/并发体验加固；AuditEvent 和日志核对；文档与验收 Evidence；小型集成缺陷修复。
- **不得首次实现**：ProductRevision、CopyVersion、QualityResult、HumanReview、VideoPlanVersion、ProductionOrder、ManualHandoffPackage、ExecutionAttempt、ManualExecutionReport、Work、DeliveryRecord。

## 7. 依赖关系与开发波次

```text
Wave 1  → A01 企业身份与组织上下文（确认现有测试/CI/Migration 能力足够；如需新通用 Enabler 不在 D-030 自动增 Issue，单独提出待确认）
Wave 2  → A02 商品权威快照 ‖ A03 素材上传核验（可并行；A02 的 ready 完整验收依赖 A03）
Wave 3  → A04 文案生成 ‖ A07 已有人物目录基础
Wave 4  → A05 文案 QC ‖ A07 人物确认能力完成
Wave 5  → A06 文案人工审核
Wave 6  → A08 VideoPlan / Preflight / PlanReview
Wave 7  → A09 ProductionOrder
Wave 8  → A10 ManualHandoffPackage
Wave 9  → A11 manual ExecutionAttempt / ManualExecutionReport
Wave 10 → A12 候选产物核验 / Work
Wave 11 → A13 WorkInspection / DeliveryRecord
Wave 12 → A14 端到端验收与加固
```

波次表示依赖关系，不要求所有 Wave 内任务必须由不同人员并行；Issue 是否真正并行还需创建开发 Issue 时根据代码重叠重新检查；**不允许两个并行 Issue 同时无协调地修改同一权威领域状态机**。

## 8. Issue 固定正文结构（模板）

后续 A01～A14 GitHub Issue 必须使用以下统一结构：

- **User outcome**：完成后用户/业务角色能完成什么。
- **Scope**：本 Issue 必须实现的业务能力。
- **Out of scope**：明确排除的能力，尤其 Phase 2 和 Evidence 阻塞项。
- **Preconditions**：依赖哪些已完成对象/版本/状态/Issue。
- **Domain contract**：读取/创建/转换哪些领域对象（权威输入、对象版本、前置状态、状态转换、下游输出）。
- **UX states**：加载、空状态、成功、校验失败、业务阻断、技术失败、无权限、并发冲突、异步运行、刷新和重新进入页面。
- **Authorization and isolation**：哪些角色可执行；Organization 如何验证；服务端如何拒绝越权对象 ID；哪些诊断只对授权角色可见。
- **Idempotency and concurrency**：幂等键范围；重复请求行为；唯一性约束；乐观锁；冲突处理；异步回调和重试行为。
- **Acceptance scenarios**：可执行 Given/When/Then 描述关键成功和失败场景。
- **Tests**：领域单元测试；服务或 API 集成测试；权限与隔离测试；幂等测试；失败路径测试；必要用户流程测试。
- **Evidence**：自动测试结果；CI；页面或接口证据；状态转换证据；权限或安全验证证据。
- **Dependencies**：阻塞本 Issue 的 Issue；被本 Issue 阻塞的 Issue；Evidence 依赖；非依赖但可能代码重叠的任务。
- **Definition of Done**：统一单 Issue DoD + Issue 特有 DoD。

## 9. 统一单 Issue Definition of Done

每个 A01～A14 Issue 必须同时满足以下十类：

1. **业务结果**：用户结果可通过界面或正式服务接口完成；不依赖直接改数据库；状态转换由服务端验证；合并后不依赖未合并分支；未完成下游能力有明确门禁或隐藏策略。
2. **领域正确性**：使用 D-028/D-029 领域对象与状态；不可变对象不原地覆盖；历史完整保留；QualityRun/QualityResult/Review/Order/Attempt/Work 语义不混用；passed ≠ approved；Attempt succeeded ≠ Order succeeded；上游相关变化按规则传播失效；无关展示元数据变化不触发错误级联失效。
3. **权限与隔离**：未认证访问拒绝；无权限操作拒绝；跨 Organization 读/写拒绝；服务端不信任前端提交的归属关系；敏感诊断只对授权角色可见；关键越权场景有自动测试。
4. **幂等与并发**：重复提交不产生重复业务对象；相同幂等键+相同 payload 返回原结果；相同幂等键+冲突 payload 拒绝；可编辑对象用乐观并发；不静默覆盖他人修改；异步任务/上传回调/状态回调可安全重试；乱序回调不使状态倒退。
5. **UX 完整性**：覆盖初始加载/空状态/成功/表单校验失败/业务阻断/技术失败/无权限/并发冲突/异步运行/离开页面后重新查看；禁用操作必须解释为何不能执行、下一步去哪里、谁可处理。
6. **数据与 Migration**：Migration 可从干净数据库执行；现有数据兼容策略明确；必要外键/唯一约束/等价服务约束存在；失败恢复或回滚行为明确；测试 Seed 不含真实凭据；不通过删除历史数据简化状态机。
7. **测试**：核心领域规则单元测试；服务或 API 集成测试；权限测试；Organization 隔离测试；幂等测试；关键失败路径测试；用户可观察流程测试。核心业务门禁不得只依赖前端测试。
8. **可观测性与审计**：关键业务命令写 AuditEvent 或等价记录；异步任务有可追踪 ID；日志经脱敏；不记录 Cookie/Token/密码/永久 URL/敏感页面内容；普通用户看业务语言；授权人员可查必要脱敏诊断；错误信息不暴露其他 Organization 对象。
9. **文档**：链接到对应产品规范；新增/变化的状态、命令和限制有说明；README 或开发文档一致；不把测试替身描述为真实 Provider 集成；不把未完成能力标记为完成；不关闭未解决 Evidence 问题。
10. **工程质量**：`git diff --check`；lint；类型检查；自动测试；validate；CI；Secret 扫描；无无关文件；PR 描述含范围/非目标/测试/风险/Evidence；CI rerun 必须有准确原因，不把重跑掩盖为首次成功。

## 10. Vertical Slice A 整体 Definition of Done

A01～A14 全部完成后，还必须满足 Slice 级验收：

### 10.1 完整主路径
使用全新测试 Organization，从正式界面或正式服务入口完成：管理员创建/启用成员 → 成员首次登录改密 → 创建空白项目 → 创建商品 → 上传商品图片 → 服务端核验 AssetVersion → 确认核心卖点 → ProductRevision ready → 生成 CopyVersion → 执行 QC → 处理 QualityFinding → 批准文案 → 选择已有数字人物 → 创建 VideoPlan → 执行 Preflight → 批准 VideoPlan → 创建 ProductionOrder → 生成并下载 ManualHandoffPackage → 领取人工任务并创建 manual ExecutionAttempt → 上传候选视频 → 提交 ManualExecutionReport → 服务端核验候选产物 → 创建 Work → 完成 WorkInspection → 创建 DeliveryRecord。**整个流程不得依赖**：手工改数据库；本地临时脚本篡改状态；未合并分支；Hifly 真实自动化；未记录的管理员绕过。

### 10.2 关键反向测试
必须自动或可重复地证明：QualityResult blocked 的 CopyVersion 不能批准；QC passed 但未人工 approved 的文案不能成为有效生产输入；revoked HumanReview 不能恢复为 approved；相关 ProductRevision 变化撤销文案和方案的相关批准；无关展示名称变化不撤销批准；Local Agent 离线不阻止 VideoPlan 审核；Local Agent 离线不阻止 waiting_for_executor 工单；重复点击不创建重复 ProductionOrder；生成交接包不创建 ExecutionAttempt；下载交接包不创建 ExecutionAttempt；ManualExecutionReport completed 不直接使 ProductionOrder succeeded；候选产物上传完成 ≠ Work 创建；产物核验失败不创建 Work；同一候选产物不能创建两个 Work；一个 ProductionOrder 最多一个主要视频 Work；跨 Organization 对象 ID 全部被拒绝；Secret/Cookie/密码/Profile/永久 URL 不出现在交接包/报告/Evidence/日志中；重复 DeliveryRecord 请求不产生重复交付事件。

### 10.3 稳定性与恢复
必须证明：Worker 或服务重启后必要异步任务可恢复；重复回调不重复创建业务对象；乱序回调不使状态倒退；页面刷新后从服务端恢复真实状态；异步任务允许用户离开页面；并发编辑不静默覆盖；关键状态可通过 AuditEvent 追踪；主路径至少有一条完整自动化 E2E 测试；关键安全和阻断路径有自动测试。

### 10.4 交付质量
必须确认：A01～A13 没有主要功能被推迟到 A14；没有用测试替身冒充 Hifly 实际能力；产品文档和实现状态一致；Q-018 按最新 Owner Decision 管理（现由 D-032 关闭）；HIFLY-001 未执行时不声称 Provider 已验证；所有关键 CI 通过；没有真实 Secret 进入代码/测试/文档/日志。

## 11. 明确不属于 Slice A 的完成条件

以下内容**不阻止** Vertical Slice A 完成：Hifly 真实账号接入；Playwright 自动执行；影刀自动执行；Local Agent 配对；ProviderConnection 真实登录恢复；Hifly ProviderTaskReference 强制获取；自动下载 Hifly 产物；多 Agent 调度；新数字人物创建；声音克隆；背景或场景编辑器；视频编辑器；自动发布；完整 RBAC；多 Organization 切换；高保真视觉系统；客户交付门户；多 Provider 生产；大规模批量生产。测试替身、种子人物和受控人工结果**不得被描述为上述能力已经真实实现**。

## 12. Evidence 阻塞能力（不进入 Slice A）

依赖 HIFLY-001、Q-018 或 SPK-018 的真实自动执行能力不作为 A01～A14 隐含范围：Hifly 真实网页登录；Cookie/LocalStorage/浏览器 Profile 管理；Local Agent 真实配对；Playwright/影刀自动执行；Provider 自动领取任务/状态回传/产物下载；多 Agent 调度。测试替身或受控种子数据必须明确标识为 Phase 1 受控实现、非真实 Hifly 集成、非 Provider 能力 Evidence。

## 13. 后续 Issue 创建流程

1. D-030 PR 合并后；
2. 产品负责人单独授权；
3. 才允许创建 A01～A14 GitHub Development Issues；
4. Issue 创建阶段只创建任务，不自动开始代码开发；
5. 每个 Issue 的开发和 PR 仍需遵守仓库后续授权与工作区安全边界。

**不得在当前 D-030 归档任务中**：创建 Issue；预留 Issue 编号；修改现有 Issue；自动创建 Milestone；自动创建 GitHub Project；自动分配负责人；添加标签；开始 A01 开发。

## 14. 非目标

D-030 不代表：GitHub Development Issues 已创建；A01～A14 已进入开发；数据库/API/前端/自动测试已实现；Vertical Slice A 已完成；Hifly 已接入；Local Agent 已实现；HIFLY-001 已执行；Q-018 已关闭。不创建任何 Issue、Milestone、Project、Discussion 或 Release。
