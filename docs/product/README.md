# 产品文档入口

> 状态：Accepted
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
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
```

| 文档 | 内容 |
|------|------|
| [SAAS_PRODUCT_BLUEPRINT.md](SAAS_PRODUCT_BLUEPRINT.md) | 产品方向主文档：正式定位、目标用户、产品原则、五阶段流程、企业内部平台体验、MVP 与长期愿景、非目标 |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | 领域模型：实体与关系、多状态域分离、生命周期、VideoPlan→batch/task 映射、资产/审核/用量/授权模型 |
| [USER_FLOWS.md](USER_FLOWS.md) | 关键用户流程（角色/前置条件/主路径/异常路径/完成标准） |
| [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) | 导航结构、页面职责、运营与技术页面隔离、设置区、首页/新手引导/模板中心/作品库 |
| [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md) | 云端 Control Plane、Local Agent、Provider Adapter、LLM Adapter、capability 模型、登录态与安全边界、跨平台约束 |
| [DELIVERY_ROADMAP.md](DELIVERY_ROADMAP.md) | 产品 Epic（SAAS-001 及子项）、Phase 0～4、优先级、依赖与验收标准 |
| [DECISION_LOG.md](DECISION_LOG.md) | 正式产品决策记录（D-001 ～ D-022）；最新：D-022 MVP ContentBrief 可选输入与默认生成行为 |
| [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) | 开放问题记录（已关闭问题保留结论；未关闭问题任何角色不得擅自代替 owner 决定） |
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
