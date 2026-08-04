# 交付路线

> 状态：Accepted（Epic 划分与阶段结构已由 owner 确认；优先级可按 owner 决策调整）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
> 适用范围：开发优先级、Issue 拆分与排期讨论
> 非目标：本文档不承诺日期；不得把尚未开发的功能标记完成

---

## 一、产品 Epic

正式产品 Epic：

```text
SAAS-001：运营内容生产工作台重构
```

子项：

```text
SAAS-001A：项目模型与五阶段导航
SAAS-001B：文案生成、版本管理与质检
SAAS-001C：数字人、声音、背景与素材中心
SAAS-001D：视频方案、审核与生成前预检
SAAS-001E：生产看板、成片质检与作品交付
```

配套 Epic：

```text
AGENT-001：云端控制台与 Local Agent 协议
HIFLY-001：飞影多能力 Provider Adapter
ENTERPRISE-001：企业权限、治理、内部用量与审计
PUBLISH-001：发布管理与数据复盘
```

说明（D-016）：原 COMMERCIAL-001 统一调整为 **ENTERPRISE-001**；产品不建设面向客户的支付/套餐/账单，ENTERPRISE-001 聚焦企业权限、治理、内部用量与审计。

**明确不允许一次性开发所有功能**：Epic 与 Issue 拆分必须逐阶段推进，每个 PR 独立可审查。

---

## 二、开发阶段（Phase 0 ～ 4）

**命名约定**：Vertical Slice A / Vertical Slice B 是垂直切片标签（D-017），不是本节 Phase 1 / Phase 2 的编号。

### Phase 0：DSE、低保真原型与证据

内容：

- Owner decisions 固化（DSE 的 Decision 部分）
- DSE 文档体系（Decision / Specification / Evidence 三类，见 [README.md](README.md)）
- 低保真页面结构
- Provider Evidence（飞影能力证据台账 [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md)）
- 第一条垂直切片
- Issue 拆分
- 腾讯云选型问题清单（Q-021）
- 默认 LLM 问题清单（Q-019，已由 D-023 解决）
- 第一版企业登录方式问题清单（Q-022，已由 D-024 解决）

验收标准：

- `docs/product/` DSE 文档经 owner 审查接受；
- Provider Evidence 台账按五层状态记录，不夸大、不编造；
- Issue 拆分建议经 owner 确认后进入 Phase 1。

**重要：PR #43（Phase 0 owner decisions）完成了决策和 Evidence 文档，但不代表 Phase 0 已全部完成。** Phase 0 在进入代码开发前仍需完成以下门禁：

- 产品蓝图：已完成并通过 PR #42 合并
- Phase 0 owner decisions：已完成并通过 PR #43 squash merge（squash commit：b767b902c4ebecd290efe1767a3e9ae1134cc24b）
- MVP 商品事实与 AI 文案生成门禁：决策已由 D-021 固化（商品事实最低输入、文案可为空、AI 文案生成前置门禁、质检与人工确认要求）
- MVP ContentBrief 可选输入与默认生成行为：已由 D-022 决定（ContentBrief 无必填字段、可完全缺失、为空不阻止文案生成；目标平台和目标人群不进入 MVP 独立字段；默认表达风格「自然口语化种草」、默认种草角度策略（AI 基于已确认卖点选择）、默认收尾方式「自然收尾」已决定；期望口播长度仅为文案篇幅提示，不承诺成片时长）；Q-004 仍保持开放；Q-019 其后已由 D-023 解决并关闭
- 默认 LLM Provider 与模型（Q-019）：已由 D-023 决定——MVP 使用 DeepSeek 官方开放平台（官方 API Key、服务端管理、不使用第三方中转）；默认模型 `deepseek-v4-flash`；显式非思考模式；JSON Output 与服务端 Schema/事实校验；输出形态失败最多一次同模型受控重试，仍失败则任务失败、由用户手动重试；无自动模型或 Provider fallback；MVP 不启用 BYOK；Q-019 已关闭
- 低保真页面结构（未完成）
- 第一条垂直切片落地为开发范围（Vertical Slice A 已由 D-017 定型，具体 Issue 拆分未完成）
- Issue 拆分（未完成）
- 腾讯云具体基础设施选型（Q-021，未决定）
- 第一版企业登录方式（Q-022）：已由 D-024 决定——管理员预创建账号、工作邮箱和密码登录、首次登录强制修改临时密码、登录后自动进入唯一组织；无公众注册、无组织选择、无手机号或企业微信登录；Q-022 已关闭
- Hifly 账号权限与真实调用调研（HIFLY-001，未完成）

已在本轮关闭的 Phase 0 决策门禁：第一批目标用户（Q-001，D-014）、云端 Web 登录形态（Q-002，D-015）、单企业/单组织 MVP（Q-013，D-014/D-015）、垂直切片两层拆分（Q-016，D-017）。

### Phase 1：Cloud Web MVP 骨架

目标：**第一版是 Cloud-first 的云端 Web 产品（默认部署腾讯云，单企业/单组织）。Phase 1 搭好云端 MVP 骨架：用户在云端完成项目、商品、文案、人物选择、VideoPlan 审核与云端持久化，并产出待执行的生产工单或明确的人工交接包；不要求云端自动完成真实视频生产（真实执行闭环属于 Phase 2）。**

内容：

- 云端 Web 应用壳
- 第一版登录（D-024：管理员预创建账号、工作邮箱和密码登录；规划含登录页、初始 Owner/Admin 部署初始化（bootstrap）、管理员预创建成员、临时密码与首次登录强制修改密码、单组织自动进入、成员停用与管理员密码重置；本轮不实现）
- 单企业/单组织
- Project 模型
- 五阶段导航
- 商品和文案（规划含商品草稿、商品名称/图片/卖点录入、可选商品描述、可选已有文案；文案可以为空，D-021）
- 文案生成入口与 CopyVariant 草稿、质检与人工确认状态（规划，D-021；AI 文案必须经质检和人工确认才能进入 VideoPlan）
- 可选内容偏好（表达风格、种草角度、期望口播长度、收尾方式、补充要求）与默认表达行为（规划，D-022；无必填字段，目标平台与目标人群不进入 MVP 独立字段，期望口播长度不承诺成片时长）
- 平台默认 LLM 凭证（MVP 零配置，D-020）
- CopyGenerationService 经 DeepSeek Provider Adapter 生成文案：服务端 Secret 注入、JSON Output 解析、业务 Schema 校验、D-021 事实安全校验、输出形态失败一次受控重试、文案草稿状态与用户手动重试（规划，D-023；本轮不实现）
- 基础素材引用
- VideoPlan
- 云端数据持久化
- 待执行的生产工单或明确的人工交接包
- 内部作品记录

Phase 1 不要求：

- 完整商业多租户
- 支付套餐
- 完整 RBAC
- SSO、企业微信登录或多组织
- 企业 BYOK
- 所有飞影能力
- 云端自动完成真实视频生产

验收标准：

- 用户登录云端 Web；
- 创建项目和商品；
- 生成、编辑、质检并确认文案；
- 选择公共或企业已有人物；
- 创建并审核 VideoPlan；
- 云端持久化；
- 创建待执行的生产工单或明确的人工交接包；
- VideoPlan → batch 编译契约可以建立和测试（编译边界双向 ID 可追踪）；
- 不要求云端自动完成真实视频生产；
- 看板使用运营语言，技术状态收敛到任务详情；
- 现有安全、幂等、原子写、路径与 CI 标准不降低。

### Phase 2：执行闭环

目标：**打通真实执行闭环，使 Vertical Slice A 端到端黄金路径（选择已有/公共人物）真实成立。真实端到端黄金路径只在 Phase 2 完成后成立。**

内容：

- Local Agent 最小协议
- 云端任务下发
- 当前手里有货 Playwright
- 状态回传
- 人工接管
- VideoPlan → batch
- 作品登记
- Vertical Slice A 端到端黄金路径

验收标准（执行闭环链路）：

```text
云端生产工单
→ Local Agent 领取
→ VideoPlan/batch 执行
→ 手里有货 Playwright
→ 状态和证据回传
→ 作品登记
→ 云端作品库交付
```

- 上述链路完整闭环；
- 长 Playwright 任务不出现在 Serverless/Workers 请求生命周期；
- 云端不保存不必要的飞影 Cookie。

Vertical Slice B（图片数字人创建子切片）独立排期，不与 Phase 2 黄金路径塞进同一个大 PR（D-017）；真实调用前须 owner 单独授权。

### Phase 3：Hifly API 多能力

按 D-018 顺序逐项推进：

0. 保留当前手里有货 Playwright 能力
1. 公共数字人
2. 公共/自有声音
3. 普通文本口播
4. 音频驱动口播
5. 图片数字人
6. 声音克隆
7. 视频数字人复刻
8. 通用对口型
9. 背景替换
10. 手里有货背景和场景来源

要求：**每项先 Evidence，再 Issue，再实现**（见 [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md) 与 [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md) 的五层确认状态）。这个顺序是当前规划优先级，不代表账号权限和真实调用已验证。

验收标准：

- 每项能力接入前有 Evidence 记录与 capability 声明；
- 接入后有确定性测试与证据；
- 不引入对飞影页面结构的上层耦合；
- 未经五层确认不得宣布能力已支持。

### Phase 4：企业治理与规模化

由 ENTERPRISE-001 承担（原 COMMERCIAL-001 调整，D-016）。

内容：

- 企业成员
- 角色与权限
- 授权治理
- 审计
- 企业 BYOK（组织级配置，D-020）
- 内部用量
- 内部成本
- 配额和预算
- 部署加固
- 多组织能力（只有实际需要时）

明确非目标（D-016）：

- 支付
- 套餐
- 账单
- 充值
- 续费

验收标准：

- 用户可见术语为任务数/预计用量/内部额度/成本提示（不暴露内部 pointBudget）；
- 内部成本与 Provider 成本口径明确（见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) Q-009）；
- 审计留痕完整。

PUBLISH-001 保留为后续发布管理和效果复盘方向。

---

## 三、优先级原则

1. Phase 顺序不跳级：未完成 Phase 0 审查不开始 Phase 1 开发；
2. 产品化与底层稳定性工作可以并行（见 [DECISION_LOG.md](DECISION_LOG.md) D-010），但互不搭车：稳定性 PR 与产品 PR 独立；
3. 每个能力接入先调研后开发；
4. 企业治理（ENTERPRISE-001）与发布复盘（PUBLISH-001）最后做，不提前；支付/套餐/账单不建设（D-016）。

## 四、依赖关系

```text
Phase 0（DSE/低保真原型/证据）
   ├──→ SAAS-001A（项目模型/五阶段）
   │       ├──→ SAAS-001B（文案）
   │       ├──→ SAAS-001C（素材中心）
   │       └──→ SAAS-001D（视频方案）──→ SAAS-001E（生产/交付）
   ├──→ HIFLY-001（能力调研先行，逐项接入，Phase 3）
   └──→ AGENT-001（依赖 Phase 1/2 的任务模型）
              └──→ ENTERPRISE-001（Phase 4）
                     └──→ PUBLISH-001（Phase 4）
```

- SAAS-001D 依赖 B/C（文案与资产就绪才能组方案）；
- SAAS-001E 依赖 D（方案批准后排产）与现有执行内核；
- HIFLY-001 各能力相互独立，可并行调研，但共享 capability 模型；
- AGENT-001 依赖 Phase 1/2 的任务/状态模型定型。

## 五、与既有技术债的关系

- CORE-001（batch schema）等稳定性工作属于执行内核演进，独立于产品 Epic 推进；
- 产品层重构（SAAS-001）不得因重构降低现有安全、幂等、原子写、路径和 CI 标准；
- batch/task 执行层保留并下沉，不被产品层替换或删除（映射见 [DOMAIN_MODEL.md](DOMAIN_MODEL.md)）。
