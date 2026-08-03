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
COMMERCIAL-001：组织、权限、用量与商业化基础
PUBLISH-001：发布管理与数据复盘
```

**明确不允许一次性开发所有功能**：Epic 与 Issue 拆分必须逐阶段推进，每个 PR 独立可审查。

---

## 二、开发阶段（Phase 0 ～ 4）

### Phase 0：文档和产品原型

内容：

- 产品蓝图
- 领域模型
- 五阶段用户流程
- 页面信息架构
- 低保真页面结构
- Epic 与 Issue 拆分
- Provider 能力调研表

验收标准：

- `docs/product/` 文档经 owner 审查接受；
- Provider 能力调研表区分「已确认/待调研/待权限」；
- Issue 拆分建议经 owner 确认后进入 Phase 1。

**重要：PR #42（产品蓝图文档）只固化产品方向，不代表 Phase 0 全部完成。** Phase 0 在进入代码开发前仍需完成以下门禁：

- owner 审查并合并产品蓝图
- 第一批目标客户决策（Q-001）
- 第一版本地/云端范围决策（Q-002）
- 第一版 LLM 与文案质检方案（Q-003 / Q-004）
- 第一批飞影 capability 选择（Q-005）
- macOS/Windows 首发范围（Q-012）
- 低保真页面结构
- 首个垂直切片（Q-016，由 owner 决定）
- Epic/Issue 拆分
- Provider 能力调研证据表

### Phase 1：完整 SaaS 流程骨架

目标：**即使部分步骤仍需人工，也能完整走完产品链路。**

内容：

- Project 模型
- 五阶段导航
- 商品管理
- 内容方案
- 文案生成与质检
- 基础素材中心
- 视频方案
- 方案转 batch（编译边界）
- 生产看板重包装
- 作品库和交付页

验收标准：

- 一个新用户能按五阶段完成一次真实（本地）生产并交付作品；
- VideoPlan → batch 编译边界可追踪（双向 ID）；
- 看板使用运营语言，技术状态收敛到任务详情；
- 现有安全、幂等、原子写、路径与 CI 标准不降低。

### Phase 2：飞影多能力接入

优先级：

1. 公共数字人
2. 照片数字人
3. 对口型
4. 背景替换
5. 视频数字人复刻
6. 声音克隆
7. AI 生成人物
8. 双人播客

要求：**每项必须先做能力调研和 Provider capability 设计，再开发自动化**（见 [PROVIDER_AND_AGENT_ARCHITECTURE.md](PROVIDER_AND_AGENT_ARCHITECTURE.md) 的能力确认状态表）。

验收标准：

- 每项能力接入前有调研记录与 capability 声明；
- 接入后有确定性测试与证据；
- 不引入对飞影页面结构的上层耦合。

### Phase 3：云端 SaaS 与 Local Agent

内容：

- 登录
- 组织
- 云端项目存储
- Local Agent 配对
- 心跳与任务领取
- 状态同步
- 人工接管
- 多租户隔离

验收标准：

- Agent 协议（规划见架构文档）落地最小闭环：注册/心跳/领取/回传；
- 云端不保存不必要的飞影 Cookie；
- 长 Playwright 任务不出现在 Serverless/Workers 请求生命周期；
- 多租户数据隔离可验证。

### Phase 4：商业化

内容：

- 角色权限
- 用量
- 套餐
- 账单
- 模板市场
- 发布管理
- 数据复盘

验收标准：

- 用户可见术语为任务数/预计用量/套餐余量/成本提示（不暴露内部 pointBudget）；
- 计费与 Provider 成本关系明确（见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)）；
- 发布与表现数据闭环（PUBLISH-001）。

---

## 三、优先级原则

1. Phase 顺序不跳级：未完成 Phase 0 审查不开始 Phase 1 开发；
2. 产品化与底层稳定性工作可以并行（见 [DECISION_LOG.md](DECISION_LOG.md) D-010），但互不搭车：稳定性 PR 与产品 PR 独立；
3. 每个能力接入先调研后开发；
4. 商业化与支付系统最后做，不提前。

## 四、依赖关系

```text
Phase 0（文档/原型）
   ├──→ SAAS-001A（项目模型/五阶段）
   │       ├──→ SAAS-001B（文案）
   │       ├──→ SAAS-001C（素材中心）
   │       └──→ SAAS-001D（视频方案）──→ SAAS-001E（生产/交付）
   ├──→ HIFLY-001（能力调研先行，逐项接入，Phase 2）
   └──→ AGENT-001（依赖 Phase 1 的任务模型，Phase 3）
              └──→ COMMERCIAL-001（Phase 4）
                     └──→ PUBLISH-001（Phase 4）
```

- SAAS-001D 依赖 B/C（文案与资产就绪才能组方案）；
- SAAS-001E 依赖 D（方案批准后排产）与现有执行内核；
- HIFLY-001 各能力相互独立，可并行调研，但共享 capability 模型；
- AGENT-001 依赖 Phase 1 的任务/状态模型定型。

## 五、与既有技术债的关系

- CORE-001（batch schema）等稳定性工作属于执行内核演进，独立于产品 Epic 推进；
- 产品层重构（SAAS-001）不得因重构降低现有安全、幂等、原子写、路径和 CI 标准；
- batch/task 执行层保留并下沉，不被产品层替换或删除（映射见 [DOMAIN_MODEL.md](DOMAIN_MODEL.md)）。
