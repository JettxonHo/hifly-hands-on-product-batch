# 产品文档入口

> 状态：Accepted
> Owner：owner（JettxonHo）
> 最后更新：2026-08-20
> 适用范围：本项目全部产品设计、Issue 拆分、PR 审查与技术架构决策
> 非目标：本目录不包含任何代码、测试、配置或运行时行为变更

本目录（`docs/product/`）是「从飞影批量自动化工具升级为面向运营人员的 AI 数字人内容生产 SaaS」这一产品方向的**唯一正式固化**。后续 Claude Code、ChatGPT、Codex 与人工开发共同以本目录为产品上下文依据。

---

## DSE 文档体系

本项目内部将产品文档组织为 **DSE** 三类（D—Decision、S—Specification、E—Evidence）。这只是本项目内部文档组织方式，不得写成外部行业通用标准。

- **Decision 决定方向**：记录 owner 已决定什么、为什么决定、影响范围、被否决方案和重新评估条件。
- **Specification 说明如何表现**：记录产品流程、页面结构、领域模型、架构边界、阶段路线和验收标准。
- **Evidence 说明当前实际确认到哪一层**：记录 Provider 官方文档、当前仓库已有证据、账号权限、真实调用、Adapter 实现和产品完成状态。**Evidence 不得把「产品目标」误写为「已经实现」。**

### Decision

- [DECISION_LOG.md](DECISION_LOG.md)
- [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

### Specification

- [SAAS_PRODUCT_BLUEPRINT.md](SAAS_PRODUCT_BLUEPRINT.md)
- [USER_FLOWS.md](USER_FLOWS.md)
- [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md)
- [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md)
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md)
- [DELIVERY_ROADMAP.md](DELIVERY_ROADMAP.md)
- [CLOUD_INFRASTRUCTURE.md](CLOUD_INFRASTRUCTURE.md)
- [LOW_FIDELITY_PAGE_STRUCTURE.md](LOW_FIDELITY_PAGE_STRUCTURE.md)
- [DOMAIN_MODEL_AND_STATE_MACHINES.md](DOMAIN_MODEL_AND_STATE_MACHINES.md)
- [MANUAL_HANDOFF_PACKAGE_CONTRACT.md](MANUAL_HANDOFF_PACKAGE_CONTRACT.md)
- [VERTICAL_SLICE_A_DELIVERY_PLAN.md](VERTICAL_SLICE_A_DELIVERY_PLAN.md)
- [PRODUCTIONIZATION_UPGRADE_PLAN.md](PRODUCTIONIZATION_UPGRADE_PLAN.md)
- [CLOUD_EXECUTOR_P0.md](CLOUD_EXECUTOR_P0.md)
- [PRODUCT_APPEARANCE_FIDELITY_GATE.md](PRODUCT_APPEARANCE_FIDELITY_GATE.md)
- [PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md](PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md)
- [PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md](PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md)
- [PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md](PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md)

### Evidence

- [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md)

---

## 阅读顺序

```text
1. SAAS_PRODUCT_BLUEPRINT.md
2. DOMAIN_MODEL.md
3. USER_FLOWS.md
4. INFORMATION_ARCHITECTURE.md
5. PROVIDER_AND_AGENT_ARCHITECTURE.md
6. DELIVERY_ROADMAP.md
7. DECISION_LOG.md
8. OPEN_QUESTIONS.md
9. HIFLY_CAPABILITY_EVIDENCE.md
10. PRODUCT_APPEARANCE_FIDELITY_GATE.md
11. PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md
12. PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md
13. PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md
14. PRODUCT_APPEARANCE_CHECK_LOCAL_BENCHMARK_GATE.md
```

| 文档 | 内容 |
|------|------|
| [SAAS_PRODUCT_BLUEPRINT.md](SAAS_PRODUCT_BLUEPRINT.md) | 产品方向主文档：正式定位、目标用户、产品原则、五阶段流程、企业内部平台体验、MVP 与长期愿景、非目标 |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | 领域模型：实体与关系、多状态域分离、生命周期、VideoPlan→batch/task 映射、资产/审核/用量/授权模型 |
| [USER_FLOWS.md](USER_FLOWS.md) | 关键用户流程（角色/前置条件/主路径/异常路径/完成标准） |
| [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) | 导航结构、页面职责、运营与技术页面隔离、设置区、首页/新手引导/模板中心/作品库 |
| [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md) | 云端 Control Plane、Local Agent、Provider Adapter、LLM Adapter、capability 模型、登录态与安全边界、跨平台约束 |
| [DELIVERY_ROADMAP.md](DELIVERY_ROADMAP.md) | 产品 Epic（SAAS-001 及子项）、Phase 0～4、优先级、依赖与验收标准 |
| [CLOUD_INFRASTRUCTURE.md](CLOUD_INFRASTRUCTURE.md) | D-026 的基础设施 Specification：个人验证环境与企业正式环境；计算、数据库、存储、任务、Secret、观测与灾备；不代表云资源已经部署 |
| [LOW_FIDELITY_PAGE_STRUCTURE.md](LOW_FIDELITY_PAGE_STRUCTURE.md) | D-027 的页面结构 Specification：Phase 1 六项导航与五阶段工作台、Vertical Slice A 完整页面流、状态/版本/失效/历史保留规则、业务界面与技术诊断边界、Phase 1/Phase 2 验收分界；不代表页面已实现 |
| [DOMAIN_MODEL_AND_STATE_MACHINES.md](DOMAIN_MODEL_AND_STATE_MACHINES.md) | D-028 的领域合同 Specification：核心领域对象关系、不可变版本、状态机、失效传播矩阵、并发/幂等/事务边界、DM-001～DM-005；不代表数据库或代码已实现 |
| [MANUAL_HANDOFF_PACKAGE_CONTRACT.md](MANUAL_HANDOFF_PACKAGE_CONTRACT.md) | D-029 的人工交接包合同 Specification：ZIP/manifest/README/素材引用、版本与生命周期、manual ExecutionAttempt、ManualExecutionReport、候选产物核验与 Work 创建门禁、证据/幂等/安全；不代表包生成或上传已实现 |
| [VERTICAL_SLICE_A_DELIVERY_PLAN.md](VERTICAL_SLICE_A_DELIVERY_PLAN.md) | D-030 的交付计划 Specification：Vertical Slice A 交付目标、Issue 拆分原则、VSA-A01～A14 边界、依赖波次、Issue 模板、单 Issue DoD、Slice 级 DoD。Development Issues #57～#70 已创建；当前实施状态见 `docs/status/CURRENT.md` |
| [PRODUCTIONIZATION_UPGRADE_PLAN.md](PRODUCTIONIZATION_UPGRADE_PLAN.md) | D-033 的生产化升级 Specification：真实 DeepSeek、人物目录、小批量验收、声音/场景 Evidence、常驻 Local Agent 与生产基础设施的顺序、门禁和完成标准 |
| [CLOUD_EXECUTOR_P0.md](CLOUD_EXECUTOR_P0.md) | D-034 的当前 P0 产品合同：纯云端 Cloud Executor、持久 Profile/素材/视频、串行积分安全、云端登录与真实出片完成定义；取代 D-033 中以 Local Agent 作为 P0 生产验收主路径的部分 |
| [PRODUCT_APPEARANCE_FIDELITY_GATE.md](PRODUCT_APPEARANCE_FIDELITY_GATE.md) | D-035 的通用商品身份一致性 Specification：Provider evidence-first、精确源图绑定、自动检查/人工候选批准/最终 Works 验收分离、费用与失败关闭边界；不代表能力已实现 |
| [PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md](PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md) | D-036 / Fidelity-A 的领域与 additive API Specification：生产前独立候选门禁、不可变候选与可变状态头、有时效的 Provider Observation、精确检查结果/人工审核、Production 硬门禁、恢复/费用/兼容与 TDD 切片；不代表实现或部署 |
| [PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md](PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md) | Issue #216 / Fidelity-C0 的 Product/Model/Evidence gate：定义模型或规则能力在实现前必须提交的逐维基准、误放行/误阻断/unknown、费用、隐私和版本证据；不选择模型，也不代表自动检查已实现 |
| [PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md](PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md) | Issue #218 / Fidelity-C1 的官方来源研究：当前仅本地 OCR/CV 基线具备可执行 benchmark 资格；OpenAI/Google 保持 reserve、混合方案 deferred，并保留未来预算公式；不选择模型、不运行 benchmark，也不代表准确率或产品能力已验证 |
| [PRODUCT_APPEARANCE_CHECK_LOCAL_BENCHMARK_GATE.md](PRODUCT_APPEARANCE_CHECK_LOCAL_BENCHMARK_GATE.md) | Issue #220 / Fidelity-C2 的本地数据与标注 readiness gate：当前因无合格多商品 source/candidate 数据集和独立七维人工真值而阻断；未实现或运行 benchmark |
| [DECISION_LOG.md](DECISION_LOG.md) | 正式产品决策记录；最新：D-036 外观保真采用 ProductionOrder 前独立候选门禁 |
| [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) | 开放问题记录（已关闭问题保留结论，Q-019 已由 D-023 解决，Q-022 已由 D-024 解决，Q-004 已由 D-025 解决，Q-021 已由 D-026 解决，Q-018 已由 D-032 解决；未关闭问题任何角色不得擅自代替 owner 决定） |
| [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md) | 飞影能力证据台账（五层确认状态，按证据记录，不夸大不编造） |

---

## 文档权威性规则

1. **后续任务开始前必须先读取产品文档**（见下方上下文一致性协议）。
2. **聊天记录不是长期权威来源**：聊天中形成的共识必须固化到本目录后才算正式方向。
3. **产品方向变更必须同步更新文档和 decision log**：任何方向调整都要在对应文档与 `DECISION_LOG.md` 中留下记录。
4. **文档冲突时的裁决顺序**：
   1. owner 最新明确决定；
   2. `DECISION_LOG.md`；
   3. `OPEN_QUESTIONS.md` 中已关闭问题的结论；
   4. 其他 Specification 文档；
   5. Evidence 文档。

   Evidence 证明当前实际确认状态，但**不能自行改变产品决策**。

---

## 上下文一致性协议

后续任何 Claude Code、Codex、ChatGPT 或人工开发任务开始前，必须先阅读：

```text
docs/product/README.md
docs/product/SAAS_PRODUCT_BLUEPRINT.md
docs/product/DECISION_LOG.md
docs/status/CURRENT.md
docs/ROADMAP.md
AGENTS.md
```

涉及领域模型时额外读取：

```text
docs/product/DOMAIN_MODEL.md
```

涉及页面和交互时额外读取：

```text
docs/product/USER_FLOWS.md
docs/product/INFORMATION_ARCHITECTURE.md
```

涉及飞影、影刀、Playwright 或云端执行时额外读取：

```text
docs/product/PROVIDER_AND_AGENT_ARCHITECTURE.md
docs/product/HIFLY_CAPABILITY_EVIDENCE.md
```

涉及开发优先级和 Issue 拆分时额外读取：

```text
docs/product/DELIVERY_ROADMAP.md
docs/product/OPEN_QUESTIONS.md
```

### 新需求与已接受决策冲突时

- 不得静默覆盖已接受决策；
- 先指出冲突；
- 请求 owner 决策；
- 更新 `DECISION_LOG.md`；
- 再开始实现。
