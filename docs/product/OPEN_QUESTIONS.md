# 开放问题

> 状态：Accepted（本清单是开放问题的正式记录；已关闭问题保留结论与对应 Decision；未关闭问题均**未决定**）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
> 适用范围：产品与架构中尚未决定的事项；任何角色（Claude Code、ChatGPT、Codex 或人工）不得擅自代替 owner 决定
> 非目标：本文件不给出结论；问题关闭时在此记录 owner 决策并同步到相应文档与 DECISION_LOG

处理规则：

- 开放问题在 owner 决策前，设计文档只能列选项与影响，不得写成事实；
- 每个问题关闭时：记录决策日期与结论，更新相关文档，并在 [DECISION_LOG.md](DECISION_LOG.md) 追加条目（如属方向性决策）；
- 新增开放问题必须经 owner 确认后加入本清单；
- 历史问题编号保留，不因关闭而删除或重新编号。

---

## Q-001 第一批目标客户画像 —— 已关闭（2026-08-04，D-014）

第一批目标客户是单运营、代运营团队还是品牌内部团队？

影响：默认组织模型、协作深度、模板方向与定价语言。

**结论（owner 决定，2026-08-04）**：第一批目标用户是企业内部的电商运营、内容生产、内容审核和管理团队；产品是企业内部 AI 数字人内容生产平台，不是面向公众自助购买的通用消费者 SaaS。对应 [DECISION_LOG.md](DECISION_LOG.md) D-014。

## Q-002 第一版是否云端登录 —— 已关闭（2026-08-04，D-015）

第一版是否提供云端登录（Control Plane 账号体系），还是先本地单机使用？

影响：Phase 1 与 Phase 3 的边界、首页形态、数据存储位置。

**结论（owner 决定，2026-08-04）**：第一版提供云端 Web Control Plane 与登录（Cloud-first，默认部署腾讯云）。具体登录方式进入 Q-022。对应 [DECISION_LOG.md](DECISION_LOG.md) D-015。

## Q-003 LLM Provider 选择 —— 收窄，保持开放

文案生成与质检使用的 LLM Provider 选择（自建网关/第三方 API/多 Provider）？

影响：成本、内容质量、合规与供应商依赖。

**收窄说明（2026-08-04，D-019）**：LLM Adapter 架构已决定（CopyGenerationService → LLM Provider Adapter，预留平台默认模型/企业自有 API Key/可替换 Provider/可配置 base URL 与 model）；默认 Provider 和默认模型原待 Q-019 决定；Q-019 已由 D-023（2026-08-04）解决并关闭：MVP 默认 Provider 为 DeepSeek 官方开放平台，默认模型为 `deepseek-v4-flash`。

## Q-004 文案质检规则来源 —— 已关闭（2026-08-05，D-025）

文案质检规则来自品牌规范配置、平台通用规则还是 LLM 评估？三者权重如何？

影响：CopyQualityCheck 的结构化分数维度与可解释性。

**收窄说明（2026-08-04，D-021）**：以下基础规则已确认：

- 所有 AI 文案必须基于用户确认的商品事实；
- 不得生成无依据的事实性声明；
- 所有 AI 文案先作为草稿；
- 经过质检和人工确认后才能进入 VideoPlan。

**补充说明（2026-08-04，D-022）**：补充要求、自定义表达风格、自定义种草角度和自定义收尾，均需经过相同的事实安全与文案质检；自定义输入不能绕过 D-021 事实门禁。

**补充说明（2026-08-04，D-023）**：D-023 已确定文案生成使用 DeepSeek JSON Output 返回结构化结果，服务端必须执行 JSON 解析与业务 Schema 校验，并继续执行 D-021 事实安全检查；输出形态失败（空内容、非法 JSON、截断、Schema 不符）最多一次同模型受控重试；AI 输出仍需质检与人工确认后才能进入 VideoPlan。

**结论（owner 决定，2026-08-05，D-025）**：Q-004 由 D-025 正式解决并关闭。最终方案要点：

- 采用分层规则体系而非可抵消的百分比权重，权威顺序为：`已确认商品事实 → 平台强制规则 → 企业/品牌规则 → LLM 语义质检 → 人工业务确认`；平台强制规则不可被企业、品牌、LLM、人工或管理员覆盖。
- 自动质检结果为四类：`invalid` / `blocked` / `needs_review` / `passed`；硬阻断不可被其他维度得分抵消。
- 确定性规则引擎和 LLM 语义审查分别产生 finding；Quality Result Aggregator 根据正式平台规则、企业/品牌规则、商品事实证据和品类规则映射 severity，并聚合决定最终质检状态；LLM 只提出语义 finding 与 severity suggestion，不拥有直接放行权，不写入商品事实，也不能覆盖正式规则。
- 人工审核状态独立于自动质检状态（`not_submitted` / `pending` / `approved` / `changes_requested` / `revoked`），`passed ≠ approved`，`invalid` 和 `blocked` 不能被人工直接覆盖。
- MVP 区分文案编辑、文案审核、商品事实管理、品牌规则管理四类业务能力；允许本人审核但必须记录 `self_review`；强制双人审核为后续组织策略，不是 MVP 门禁。
- 支持版本化品类规则档案，但不建设庞大固定的电商类目树，品类不是文案生成的新必填条件。
- 文案、商品事实、ContentBrief、品类或规则版本变化后旧质检与旧批准失效，必须完整重新质检并重新审核。
- 只有当前有效 `approved` 的 CopyVariant 才能进入 VideoPlan。

D-025 只在产品规格层固化质检与批准门禁，不代表任何质检功能已经开发，也不固定数据库、ORM、API、Migration 或前端组件实现。详见 [DECISION_LOG.md](DECISION_LOG.md) D-025。

## Q-005 第一批真正接入的飞影能力 —— 收窄，保持开放

第一批真正接入的飞影能力是哪几项（对照 D-018 的 HIFLY-001 推荐调研/接入顺序，即 DELIVERY_ROADMAP Phase 3）？

影响：HIFLY-001 调研排期与 Phase 1 可执行的视频类型。

**收窄说明（2026-08-04，D-018）**：飞影目标能力和优先级已决定（正式产品路线 + HIFLY-001 推荐调研/接入顺序）；第一批实际实现范围仍需结合账号权限与 HIFLY-001 Evidence（见 [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md)）决定。

## Q-006 公共数字人数据如何同步

公共数字人目录**优先通过已记录的公共数字人 API 同步**（飞影数字人 API V2 文档已确认「公共数字人列表」存在，见 `PROVIDER_AND_AGENT_ARCHITECTURE.md` 第六节）。

仍待确认：

- 当前账号权限（是否拥有该 API 的 Token 与调用权限）
- 分页策略
- 更新频率
- 预览字段
- 下架处理
- Provider ID 稳定性

影响：素材中心数据新鲜度与合规边界。

## Q-007 用户上传数字人的授权和隐私

用户上传照片/视频创建数字人的授权流程、隐私保护与留存策略？

影响：AvatarAsset 授权状态字段、合规材料与删除流程。

## Q-008 声音克隆授权

声音克隆的授权凭证与合规要求（本人授权/企业授权）如何登记与校验？

影响：VoiceAsset 授权状态与生产 Preflight 检查项。

## Q-009 Provider 成本与内部成本治理关系

Provider 实际消耗成本与企业内部成本治理（任务用量/成本估算/预算限额）之间的映射与口径？

影响：CostEstimate、UsageRecord 与 ENTERPRISE-001 内部治理设计。

说明（2026-08-04，D-016）：产品不建设面向客户的收费/套餐/账单；本问题仅针对企业内部成本统计与治理口径。

## Q-010 视频质检第一版方案

视频质检第一版采用规则检测还是多模态模型？

影响：QualityCheck 实现复杂度、成本与误报处理流程。

## Q-011 Local Agent 更新机制

Local Agent 的版本分发与更新机制（手动下载/内置更新/渠道包）？

影响：AGENT-001 范围与跨平台打包策略。

## Q-012 macOS 与 Windows 首发范围

首发版本同时支持 macOS 与 Windows，还是分平台分阶段？

影响：Phase 1 验收范围与测试矩阵。

## Q-013 是否先做单租户云端演示版 —— 已关闭（2026-08-04，D-014 / D-015）

是否在多租户之前先做单租户云端演示版用于验证与演示？

影响：Phase 3 的最小实现路径。

**结论（owner 决定，2026-08-04）**：先做单企业/单组织云端 MVP，不先做完整商业多租户。对应 [DECISION_LOG.md](DECISION_LOG.md) D-014 / D-015。

## Q-014 数据库与对象存储选型 —— 收窄，保持开放

云端数据库与对象存储（视频产物）选型？

影响：Phase 3 架构与成本；在决策前不迁移现有本地数据。

**收窄说明（2026-08-04，D-015）**：云厂商确定为腾讯云；具体数据库、对象存储、队列、SecretStore、备份和环境划分仍待 Q-021。

## Q-015 对标产品研究深度

对标产品只学习流程，还是需要竞品专项研究（功能矩阵/定价/用户反馈）？

影响：Phase 0 调研工作量与产品差异化依据。

## Q-016 第一轮产品改造的垂直切片 —— 已关闭（2026-08-04，D-017）

第一轮端到端垂直切片由 owner 决定，Claude 不得擅自选定。

**结论（owner 决定，2026-08-04）**：正式采用「创建新人物或选择现有人物」；实施拆为两层切片。对应 [DECISION_LOG.md](DECISION_LOG.md) D-017：

- **Vertical Slice A（已有/公共人物黄金路径）**：云端登录 → 创建项目 → 上传商品 → 生成和质检文案 → 选择公共或已有数字人 → 创建并审核 VideoPlan → 编译为现有 batch → 当前手里有货执行 → 作品库交付；
- **Vertical Slice B（图片数字人创建）**：上传人物图片 → 检查有效授权 → 创建飞影图片数字人异步任务 → 查询或接收任务状态 → 获取 Provider avatar 标识 → 登记 AvatarAsset → 回到统一人物选择流程 → 用于 VideoPlan。

Vertical Slice A / Vertical Slice B 是垂直切片标签，不是 DELIVERY_ROADMAP 的 Phase 1 / Phase 2 编号。

背景相关说明（与 Q-017 保持一致）：

- 背景字段仍可存在于通用 VideoPlan；
- 当前手里有货垂直切片**不提供独立背景选择**；
- 场景可暂时表达为跟随人物素材或由 Provider 决定；
- 后续是否开放背景配置取决于 Q-017 实际调研。

## Q-017 手里有货的背景与场景来源

当前飞影「手里有货」链路只确认可以选择商品图和数字人/人物图。背景生成原理尚未确认，可能的情形：

- 人物素材自带背景；
- 由飞影根据人物图自动生成或补全；
- 存在尚未发现的场景配置入口。

在 HIFLY-001 实际页面调研完成前，必须遵守：

1. 不声明手里有货支持独立背景选择；
2. 不把背景资产作为该 capability（`video.product_holding`）的已支持参数；
3. 不在产品设计中承诺用户可以自由更换背景；
4. 可以暂时表达为「场景跟随人物素材或由 Provider 决定」；
5. 通用 VideoPlan 仍可保留背景字段，但 Provider capability 必须决定该字段是否可用；
6. 具体行为必须通过后续实际调研确认，不得推测。

影响：手里有货 capability 的参数边界、阶段三背景资产与手里有货方案的组合规则。

## Q-018 飞影 API Token 的保管位置与调用执行位置 —— 已关闭（2026-08-09，D-032）

**结论（owner 决定，2026-08-09，D-032）**：

- 飞影正式 API 的 Bearer Token 由服务端环境变量或云端 SecretStore 托管；当前配置名为 `HIFLY_API_TOKEN`；
- Token 不进入前端、领域模型、数据库、Git、日志、错误信息、截图、交接包或 Local Agent 任务包；
- 已由公开 API 文档确认并完成真实验证的能力，才允许经 Hifly API asynchronous worker 执行；
- 仅网页支持、依赖浏览器登录态或需要人工接管的能力继续由 Local Agent / Playwright 执行；
- 「手里有货」当前未在公开 API V2 文档中确认，不能因配置 Token 而改走官方 API；现阶段仍保留 Capture HTTP 与 Playwright 路径；
- 当前实现只提供管理员显式触发的账户积分连接检查，不自动请求飞影，不创建任务，也不改变生产 `fail_closed` 默认值。

影响：Provider Task Router 采用云端官方 API Worker + Local Agent 网页执行并存的模式；具体 capability 仍按 Evidence 五层确认，Q-018 关闭不等于 HIFLY-001 已完成。

## Q-019 MVP 默认 LLM Provider 和模型 —— 已关闭（2026-08-04，D-023）

需要决定：

- 默认 Provider
- 默认模型
- 模型网关或直连
- 成本上限
- 超时和重试
- 是否需要结构化输出能力

影响：阶段二文案生成/质检的默认能力与成本口径（见 D-019 / D-020）。

**结论（owner 决定，2026-08-04，D-023）**：

- Provider：DeepSeek 官方开放平台（官方直连）；
- Credential：平台管理的 DeepSeek 官方 API Key（服务端）；
- Third-party relay：不使用第三方中转或聚合平台；
- API format：OpenAI compatible；
- Base URL：`https://api.deepseek.com`；
- Default model：`deepseek-v4-flash`（不使用已停止的 `deepseek-chat` / `deepseek-reasoner`；`deepseek-v4-pro` 不作为默认）；
- Thinking mode：显式 disabled（`thinking.type = disabled`，不依赖 Provider 默认值）；
- JSON Output：使用（`response_format = {"type": "json_object"}`，prompt 含 json 字样，提供结构示例，合理设置 max_tokens）；
- Server validation：必须（JSON 解析、业务 Schema、D-021 事实安全、D-022 ContentBrief 约束）；
- Output retry：输出形态失败最多一次同模型受控重试；仍失败则任务失败，由用户手动重试；
- Automatic model fallback：无；
- Automatic provider fallback：无；
- BYOK：不进入 MVP（企业 BYOK 见 Q-020）；
- 完整 HTTP 错误重试矩阵、timeout、并发与限流不固化为本 Decision，属于后续实现规格；
- resolved by：D-023；resolved date：2026-08-04。

## Q-020 企业 BYOK 上线阶段与允许的 Provider

需要决定：

- 哪个阶段开放 BYOK
- 允许哪些 Provider
- 是否允许自定义 Base URL
- 企业凭证测试和轮换规则
- 默认模型与企业模型的回退策略

影响：LlmProviderConfig 的启用范围与设置区「AI 模型」能力（见 D-020）。

## Q-021 腾讯云具体基础设施选型 —— 已关闭（2026-08-05，D-026）

需要决定：

- Web/API 部署服务
- 数据库
- 对象存储
- 队列
- SecretStore / 密钥管理
- 日志和监控
- 备份
- 环境划分
- 成本预算

影响：Phase 1 云端部署的基础设施实现（见 D-015；领域层不绑定具体云产品）。

**结论（owner 决定，2026-08-05，D-026）**：Q-021 由 D-026 正式解决并关闭。最终方案要点：

- resolved by：D-026；resolved date：2026-08-05；
- 产品采用 Cloud Control Plane 与 Local Agent 分离架构；腾讯云负责云端控制面，领域层不绑定腾讯云；
- 两阶段部署：个人开发与功能验收使用 owner 已有 2C4G 测试服务器 + Docker Compose；企业正式生产另行容量评估；
- production 主地域：腾讯云广州（`ap-guangzhou`）；
- 企业生产架构：CloudBase Run API + Worker（独立部署单元，模块化单体）、TencentDB for PostgreSQL（唯一权威关系型业务库）、Tencent Cloud COS（sensitive + content 私有桶）、PostgreSQL AsyncJob / Transactional Outbox（MVP 不采购 RabbitMQ）、SSM/KMS/CAM/STS、CLS/APM/CloudAudit；
- 个人 2C4G 环境只验证功能闭环与可靠性，不证明生产容量、SLA 或高可用；
- 企业正式预算保持 **Pending Evidence**，企业正式上线前必须重新执行容量与资源评估、盘点企业已有腾讯云资源；
- Q-018 当时未被 D-026 解决；后续已由 D-032 关闭，Hifly 官方 API Token 改由服务端环境变量或云 SecretStore 托管。

详细 Specification 见 [CLOUD_INFRASTRUCTURE.md](CLOUD_INFRASTRUCTURE.md) 与 [DECISION_LOG.md](DECISION_LOG.md) D-026。D-026 只固化架构方向、环境边界和后续部署验收要求，不代表任何云资源已经部署。

## Q-022 第一版企业登录方式 —— 已关闭（2026-08-04，D-024）

候选：

- 管理员预创建账号
- 邀请链接
- 企业邮箱账号
- 手机号
- 企业微信登录

影响：Phase 1 云端 Web 登录实现（见 D-015）。

**结论（owner 决定，2026-08-04，D-024）**：

- Account provisioning：管理员预创建；
- Login identifier：管理员录入的工作邮箱；
- Authentication：邮箱和密码；
- Initial admin：部署初始化；
- First login：临时密码；
- Forced password change：是（完成首次密码修改前不得访问组织业务数据）；
- Organization entry：登录后自动进入唯一 Organization；
- Public registration：无；
- Organization creation：无；
- Organization picker：无；
- Multi-organization switch：无；
- Password recovery：管理员重置新临时密码；
- Self-service email reset：不进入 MVP；
- Invitation link：不作为 MVP 开户方式；
- Phone/SMS：不进入 MVP；
- WeCom login：不进入 MVP；
- Enterprise SSO：不进入 MVP；
- Identity boundary：User 与 OrganizationMember 分离；
- Member lifecycle：pending_activation / active / disabled；
- resolved by：D-024；resolved date：2026-08-04。
