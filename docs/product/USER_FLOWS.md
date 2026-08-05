# 用户流程

> 状态：Accepted（主流程结构已固化；页面细节实现阶段再细化）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-05
> 适用范围：页面与交互设计、验收用例编写
> 非目标：本文档不定义接口、字段与页面实现

每个流程按统一格式描述：**角色 / 前置条件 / 主路径 / 异常路径 / 完成标准**。

---

## 1. 新用户第一次生成视频

> **D-027 对齐说明（2026-08-05）**：本流程的权威页面结构与状态边界以 [LOW_FIDELITY_PAGE_STRUCTURE.md](LOW_FIDELITY_PAGE_STRUCTURE.md)（D-027）为准。Vertical Slice A 只创建空白项目（不提供模板选择）；人物只选择公共或企业已有人物；Phase 1 结束于可追踪的 `ProductionOrder` 和绑定该工单的人工交接包，真实自动生产（Local Agent 领取/Provider 执行/产物回传/服务端核验/创建 Work）属 Phase 2。

- **角色**：电商运营
- **前置条件**：企业用户进入云端 Web 产品并完成登录（第一版提供云端 Web Control Plane 与登录，D-015；第一版登录方式已由 D-024 决定：管理员预创建账号、工作邮箱和密码登录、首次登录强制修改临时密码、登录后自动进入唯一组织）；进入所属企业组织；有至少一件商品素材。Local Agent 是否在线不影响 Phase 1 走通到 `ProductionOrder`/人工交接包（D-027）；Local Agent 离线只影响 Phase 2 的真实自动生产。
- **主路径（Vertical Slice A，D-027）**：
  1. 创建第一个项目（**只创建空白项目**，必填项目名称，不在创建时选择模板/平台/受众/视频类型/Provider/人物/声音/背景）；
  2. 添加商品（上传图片 + 卖点）并确认商品事实（D-021）；
  3. 异步生成文案 → 自动质检 → 人工批准文案（QC passed ≠ 文案 approved，D-025）；
  4. 选择数字人：Vertical Slice A 人物步骤为「**选择公共或企业已有人物**」，必须明确「确认人物选择」（见 Flow A）。不提供独立声音/背景/场景选择，不提供创建新人物（属 Vertical Slice B）；
  5. 创建 VideoPlan → 方案预检（Preflight）→ 人工批准方案（Preflight passed ≠ VideoPlan approved，D-027）；
  6. 从 approved VideoPlan 创建 `ProductionOrder`；
  7. Phase 1：工单可为 `waiting_for_executor`，或生成**绑定该 ProductionOrder** 的人工交接包；
  8. Phase 2：Local Agent 领取 → Provider 执行 → 状态与产物回传 → 服务端产物核验 → 创建 Work；
  9. 作品库人工检查 → 下载或创建 DeliveryRecord。
- **异常路径**：商品事实不足 → 返回「商品与目标」；文案质检 `blocked` → 修改文案或补充事实后完整重检（不可人工/管理员绕过，D-025）；人物授权无效 → 不能用于新方案；Local Agent 离线 → 工单保持 `waiting_for_executor`（**不标记为失败**），可查看人工交接包；执行 `requires_action` → 进入人工处理（`requires_action ≠ failed`）；执行失败 → 任务进入「需人工处理」，展示失败原因与脱敏证据，可有限重试。异常必须返回对应权威页面（D-027）。
- **完成标准（Phase 1）**：用户在无技术背景支持下独立走完五阶段，产出可追踪的 `ProductionOrder` 和绑定该工单的人工交接包；真实成片下载属 Phase 2。

**云端入口主流程（D-015 / D-024 / D-027）**：

```text
企业用户进入云端 Web 产品
→ 工作邮箱和密码登录（D-024）
→ 首次登录强制修改临时密码（D-024）
→ 自动进入唯一组织（D-024）
→ 创建空白项目（D-027，不选模板）
→ 五阶段生产（商品与目标 → 文案与质检 → 人物与素材 → 视频方案 → 生成与交付）
→ approved VideoPlan → ProductionOrder → 人工交接包（Phase 1）/ Local Agent 执行（Phase 2）
→ 作品交付（Work → DeliveryRecord）
```

**人物阶段入口（D-017 / D-027）**：

```text
人物与素材
├── 选择公共数字人        ← Vertical Slice A
├── 选择企业已有人物      ← Vertical Slice A
└── 创建新人物            ← Vertical Slice B（独立子切片，不在 A 内）
```

**Flow A：选择已有/公共人物完成黄金路径（Vertical Slice A，D-027）**：

```text
云端登录
→ 创建空白项目
→ 添加商品并确认商品事实
→ 异步生成文案 → 自动质检 → 人工批准文案
→ 选择公共或企业已有人物 → 确认人物选择
→ 创建 VideoPlan → 方案预检 → 人工批准方案
→ 创建 ProductionOrder
→ Phase 1：waiting_for_executor 或绑定工单的人工交接包
→ Phase 2：Local Agent 领取 → Provider 执行 → 产物回传 → 服务端核验 → 创建 Work
→ 作品库人工检查 → 下载 / DeliveryRecord
```

**Flow B：创建图片数字人（Vertical Slice B 独立子切片）**：

```text
上传人物图片
→ 检查有效授权
→ 创建飞影图片数字人异步任务
→ 查询或接收任务状态
→ 获取 Provider avatar 标识
→ 登记 AvatarAsset
→ 回到统一人物选择流程
→ 用于 VideoPlan
```

Flow B 要求：必须遵守 D-011（未记录有效授权不得上传 Provider 或创建数字人）；可能产生 Provider 消耗，开发前必须获得 owner 对真实调用的单独授权；不与 Flow A 的黄金路径塞进同一个大 PR。

**LLM 文案流程（D-019 / D-020 / D-023）**：

- **MVP**：普通用户直接使用平台默认模型完成文案生成与质检，无需配置 API Key；MVP 平台默认 Provider 为 DeepSeek 官方开放平台，默认模型 `deepseek-v4-flash`，显式非思考模式（D-023）；
- **后续**：企业管理员在高级设置配置企业 BYOK（组织级配置）；
- **普通运营用户不得看到完整 API Key**（页面只显示掩码，真实 Key 遵守 D-020 安全底线）；用户不需要理解 Provider 配置。

## 2. 批量商品项目

- **角色**：电商运营
- **前置条件**：商品清单与素材齐备；项目信息（平台/风格/时长/比例）已确定
- **主路径**：
  1. 创建项目并填写目标（平台、内容形式、每商品方案数、交付日期等）；
  2. 批量上传商品（表格 + 图片）；
  3. 按商品批量生成多角度的文案并批量审核确认；
  4. 批量创建视频方案（人物/声音/背景可批量应用；声音/背景字段是否展示和可用由当前视频类型的 Provider capability 决定）；
  5. Preflight 通过后批量发起生产；
  6. 看板跟踪全部任务，处理失败项；
  7. 按商品打包下载交付。
- **异常路径**：部分商品素材缺失 → Preflight 阻断并列明缺口；批量中部分任务失败 → 仅失败项进入人工处理，不影响其他任务。
- **完成标准**：一个含 N 件商品的项目全部方案进入生产，产物按计划交付，失败项均有明确状态与证据。

## 3. 文案生成和审核

- **角色**：电商运营（生成）、内容审核人（审核）
- **前置条件**：商品与品牌规范（禁用词、表达规则）已录入；**商品文案允许为空**（D-021）；AI 生成文案需通过最低商品输入门禁（商品名称、至少一张商品图片、至少一条经用户确认的核心卖点）
- **主路径**：
  1. 为商品选择多个内容角度（痛点/场景/测评/好物分享等）；
  2. 生成多版文案草稿，系统运行**确定性规则质检 + LLM 语义质检**，由 Quality Result Aggregator 聚合决定自动质检结果 `invalid` / `blocked` / `needs_review` / `passed`，并给出结构化 finding（命中片段、原因、证据、规则来源、修复建议）（D-025）；
  3. 按**质检结果分支**处置：
     - `invalid` / `blocked`：不可提交批准；修复文案、补充并确认商品事实或修正规则输入，创建新版本或产生新质检记录后**完整重新质检**（`invalid`/`blocked` 不能被人工或管理员覆盖）；
     - `needs_review`：**提交人工审核**，审核人**逐项查看 finding**，对允许人工判断的提醒记录接受理由后接受、要求修改或退回补充事实，最终 `approved` / `changes_requested`（不能「忽略全部」；实际属于未确认事实的问题不能通过人工接受来放行）；
     - `passed`：**直接提交人工批准**，审核人批准或要求修改，最终 `approved` / `changes_requested`（`passed ≠ approved`）；
  4. 运营修改、局部重写或请求 AI 改写（只改开头/某句/口语化/平台风格）——任一正文变化**创建新 CopyVariant/版本并完整重新质检**，对比版本后固定；
  5. 当前有效 `approved` 文案进入视频方案候选。
- **质检结果处置（D-025）**：
  - `invalid`：重新质检（LLM 技术失败最多一次受控重试，重试只处理技术/结构失败，不因首次发现内容问题而寻求更宽松结果）；
  - `blocked`：不可被人工或管理员覆盖；必须修改文案或返回补充/修正商品事实后完整重检；
  - `needs_review`：必须逐项记录接受理由，**禁止「忽略全部」批量处理**；
  - `passed`：可提交人工审核（`passed ≠ approved`）。
- **失效与重检（D-025）**：文案正文变化，或商品事实/核心卖点/ContentBrief/主要品类/任一规则版本变化，即使正文不变，也使旧质检与旧批准失效（superseded / revoked），必须完整重新质检与重新人工审核；不得只检查修改句子或沿用旧 approval。本人审核允许但必须标记 `self_review`；强制双人审核为后续组织策略，不是 MVP 门禁。
- **批量操作（D-025）**：可批量发起质检、批量查看状态、批量重新检查 `invalid`、批量提交 `passed` 文案审核、批量批准无提醒且版本完全有效的 `passed` 文案；**禁止批量忽略 `needs_review`、批量覆盖 `blocked`、批量批准未经确认事实、批量沿用失效 approval、一键接受所有 finding**。
- **异常路径**：质检命中禁用词/敏感表达或高风险事实 → `blocked`/`needs_review`，提供修复建议；审核退回 → `changes_requested` 回到草稿并保留版本历史。
- **完成标准**：每件商品至少一版当前有效 `approved` 文案；全部版本、质检 finding 与审核意见留痕；进入 VideoPlan 前再次确认 copy/事实/ContentBrief/品类/规则版本有效、最新质检有效、无 `invalid`/`blocked`、`needs_review` 已逐项处理、存在当前有效 `approved`。

> 文案生成失败（D-023 输出形态失败）与文案质检失败（D-025 内容 finding）是两类不同状态，不混为同一状态。D-021 / D-022 / D-023 的生成流程继续有效。详见 [DECISION_LOG.md](DECISION_LOG.md) D-025。

### 文案入口 A：无已有文案（D-021 / D-022 / D-023）

```text
云端登录
→ 创建或选择项目
→ 创建商品
→ 上传至少一张商品图片
→ 填写商品名称
→ 填写并确认至少一条核心卖点
→ 可选填写商品描述
→ 满足 D-021 最低商品事实
→ 可选展开「内容偏好」
→ 可选设置表达风格
→ 可选指定种草角度
→ 可选填写期望口播长度
→ 可选选择收尾方式
→ 可选填写补充要求
→ 点击生成文案
→ 服务端执行事实预检（只检查 D-021 商品事实）
→ 规范化 ContentBrief（D-022 默认行为）
→ 调用平台默认 DeepSeek Adapter（deepseek-v4-flash，显式非思考模式，D-023）
→ 获取 JSON Output
→ 服务端解析和校验（业务 Schema + D-021 事实安全）
→ 创建 CopyVariant 草稿（AI 文案）
→ 质检
→ 人工选择、修改和确认
→ approved CopyVariant
→ 进入人物与素材
→ 创建 VideoPlan
```

内容偏好全部可选（D-022）：不展开「内容偏好」也可以直接生成文案；「生成文案」按钮只检查 D-021 最低商品事实，不把任何 ContentBrief 字段加入启用条件。

### 文案生成失败流程（D-023）

```text
DeepSeek 返回空内容 / 非法 JSON / 截断 / Schema 不符
→ 不创建有效 CopyVariant
→ 最多一次同模型受控重试
→ 再次失败
→ 任务失败
→ 用户手动重试
```

失败流程边界：

- 不自动切换 V4-Pro；
- 不自动切换其他 Provider；
- 不把部分内容显示为成功；
- 用户看不到 API Key；
- 用户不需要理解 Provider 配置；
- 文案生成失败不改变已确认商品事实。

### ContentBrief 为空流程（D-022）

```text
满足 D-021 商品事实
→ 不填写任何内容偏好
→ 系统使用默认表达行为
→ 生成文案草稿
→ 质检
→ 人工确认
```

默认表达行为：

- 表达风格：自然口语化种草；
- 种草角度：AI 根据已确认卖点选择；
- 收尾方式：自然收尾；
- 不添加明确的时长约束；
- 不编造商品事实。

ContentBrief 为空不属于错误，不得阻止文案生成。

### 补充要求流程（D-022）

```text
用户填写特殊受众、发布渠道或表达限制
→ 作为创作说明（可选自由文本）
→ 事实性内容仍需经过 D-021 约束
→ 质检
→ 人工确认
```

补充要求中的事实性声明（价格、优惠、库存、活动期限、试用装、赠品、销量、排名、功效、参数、认证、医疗或健康结论等）不能自动成为已确认商品事实，也不能绕过 D-021 事实安全门禁。

### 期望口播长度说明（D-022）

```text
期望口播长度
→ 影响文案篇幅
→ 不保证最终成片精确时长
```

期望口播长度只是可选提示：不承诺最终视频时长；不保证「输入多少秒就一定生成多少秒成片」；当前不得声称手里有货能力支持精确时长控制；用户不填写时不得阻止文案生成。

### 文案入口 B：已有文案（D-021）

```text
创建商品
→ 完成最低商品事实输入
→ 可选粘贴已有文案
→ 选择直接使用或 AI 优化
→ 形成 CopyVariant 草稿
→ 质检
→ 人工确认
→ 进入 VideoPlan
```

### 缺少信息流程（D-021）

缺少商品名称、商品图片或已确认卖点时：

- 禁止调用 LLM；
- 禁止进入 AI 文案生成；
- 明确指出缺失字段；
- 保存商品草稿可以允许；
- 不得由模型自行补齐商品事实。

### 图片识别候选流程（未来规划，MVP 不实现）

```text
商品图片
→ AI/OCR/视觉识别候选
→ 标记为待确认
→ 用户确认或修改
→ 转为正式商品事实
→ 才能用于文案生成
```

图片识别结果不得直接成为正式商品事实；未经用户确认的候选信息不得进入 LLM 输入。

## 4. 创建照片数字人（Flow B，Vertical Slice B 子切片）

- **角色**：电商运营（发起）、团队管理员（授权，如需）
- **前置条件**：合规的人物照片；**已记录有效授权**（D-011，未记录有效授权不得上传 Provider 或创建数字人）；照片数字人能力通过五层确认（当前仅 API 文档层确认，账号权限待确认、真实调用未验证，见 [HIFLY_CAPABILITY_EVIDENCE.md](HIFLY_CAPABILITY_EVIDENCE.md)）
- **主路径**：
  1. 在素材中心发起「创建新人物」→ 照片数字人；
  2. 检查有效授权（Authorization Preflight）；
  3. 上传照片并填写资产信息（风格/适用品类/标签）；
  4. 创建飞影图片数字人异步任务；
  5. 查询或接收任务状态（回调 + 轮询对账）；
  6. 获取 Provider avatar 标识，登记 AvatarAsset；
  7. 回到统一人物选择流程，用于 VideoPlan。
- **异常路径**：照片不合规或 Provider 创建失败 → 资产状态 failed 并展示原因；授权材料缺失 → 阻断并提示补齐；任务状态丢失 → 主动对账。
- **消耗声明**：本流程可能产生 Provider 消耗，开发前必须获得 owner 对真实调用的单独授权；不得承诺当前账号已可调用。
- **完成标准**：数字人资产状态 ready 且授权完整，可被视频方案引用。

## 5. 选择公共数字人

- **角色**：电商运营
- **前置条件**：公共数字人目录已同步（同步方式见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)）
- **主路径**：
  1. 在素材中心按品类/风格/坐姿站姿/横竖屏筛选公共数字人；
  2. 预览形象与试听搭配声音；
  3. 将数字人加入视频方案。
- **异常路径**：目录未同步或 Provider 引用失效 → 明确提示不可用，不展示误导性可选状态。
- **完成标准**：所选公共数字人成功进入视频方案且 Preflight 不报可用性错误。

## 6. 对口型视频

- **角色**：电商运营
- **前置条件**：人物图片或视频素材；文案或音频；对口型能力通过五层确认。**能力边界（D-018）**：`video.avatar_audio_driven`（飞影 avatar + audio）API 文档已确认；`video.generic_lip_sync`（任意用户图片/视频 + audio）当前 API 文档未确认，待网页/API 调研——**不得承诺通用对口型 API 已支持**。
- **主路径**：
  1. 在视频方案中选择「对口型」视频类型；
  2. 配置输入：人物图片/视频、文案或音频、声音、背景、输出比例、字幕、是否保留原背景；
  3. 审核方案并通过 Preflight；
  4. 生产：生成 Provider 任务 → 对口型视频 → 成片质检 → 作品资产。
- **异常路径**：素材不符合对口型要求（分辨率/时长/人脸） → Preflight 或质检拦截并提示；Provider 任务失败 → 任务进入需人工处理，可重试或换素材；所请求的对口型能力未通过确认 → capability 拦截并提示，不进入生产。
- **完成标准**：产出一条通过基础质检的对口型视频并进入作品库。

## 7. 背景替换

- **角色**：电商运营
- **前置条件**：原视频或方案内视频；目标背景资产；背景替换能力通过五层确认。**能力边界（D-018）**：`video.background_replace` 当前 API 文档未确认——**不得承诺背景替换 API 已支持**。手里有货的独立背景选择受 Q-017 约束，**不得承诺手里有货支持独立背景选择**。
- **主路径**：
  1. 选择需要替换背景的视频/方案；
  2. 选择背景资产（场景库/用户上传/AI 生成）；
  3. 生成替换任务并预览结果；
  4. 确认后作为成片或进入下一环节。
- **异常路径**：人物边缘/遮挡处理不佳 → 质检标记并可退回换背景；Provider 不支持当前输入 → capability 拦截并提示；能力未通过确认 → 不进入生产。
- **完成标准**：替换后的视频通过质检并可交付。

## 8. 视频方案审核

> **D-028 对齐**：approved VideoPlan 依赖有效 Preflight（PreflightResult 为 passed 或允许审核的 warning）与独立 PlanReview 记录；**Preflight passed ≠ VideoPlan approved**。详见 [DOMAIN_MODEL_AND_STATE_MACHINES.md](DOMAIN_MODEL_AND_STATE_MACHINES.md)（D-028）。

- **角色**：内容审核人（审核）、电商运营（修改）
- **前置条件**：VideoPlanVersion 已 frozen，PreflightResult 允许审核，CopyVersion approved 仍有效，Avatar 授权与能力有效
- **主路径**：
  1. 审核人预览方案全部输入（文案/人物/声音/背景/比例/时长）与 PreflightResult；
  2. ApprovePlan → PlanReview approved；或 RequestPlanChanges → changes_requested 并附意见；
  3. 运营按意见修改（换人物/文案；声音/背景仅在对应视频类型的 Provider capability 已验证支持时可换）→ 创建新 VideoPlanVersion → 重新 Preflight → 重新提交审核（旧 PlanReview 不恢复）；
  4. 当前有效 approved VideoPlan 才能创建 ProductionOrder。
- **异常路径**：资产授权缺失或不可用 → hard block，不允许批准；方案版本变更 → 保留版本记录，审核针对具体 VideoPlanVersion；上游变化 → PlanReview revoked。
- **完成标准**：方案达到当前有效 approved PlanReview，全部输入满足门禁。

## 9. 生产失败人工处理

> **D-028 对齐**：ProductionOrder 与 ExecutionAttempt 分离；`requires_action ≠ failed`，`waiting_for_executor ≠ failed`；人工执行同样创建 `executor_type = manual` 的 ExecutionAttempt（DM-003）；`ProductionOrder succeeded` 仅在产物核验与 Work 创建成功后成立。详见 [DOMAIN_MODEL_AND_STATE_MACHINES.md](DOMAIN_MODEL_AND_STATE_MACHINES.md)（D-028）。

- **角色**：电商运营（处理）、技术/本地执行器管理员（执行器问题）
- **前置条件**：存在 requires_action/failed 的 ProductionOrder 或 ExecutionAttempt
- **主路径**：
  1. 在任务详情查看失败原因、重试次数、ExecutionAttempt 历史、脱敏证据、Provider 任务 ID；
  2. 按原因处理：素材问题 → 修复素材后重试（创建新 ExecutionAttempt）；方案问题 → 退回上一阶段创建新版本/新工单；执行器问题 → 交给执行器管理员；需人工接管（验证码/弹窗）→ 人工处理，manual ExecutionAttempt 不伪造自动化信息；
  3. MarkHumanActionCompleted 必须触发真实恢复或重新检查，不能直接把任务改为成功；
  4. 处理结果回写看板，每个 ExecutionAttempt 保留。
- **异常路径**：需要人工接管 → 系统发出人工接管请求；证据缺失 → 明确标注证据不足，不臆断原因。
- **完成标准**：每个失败/requires_action 工单要么恢复生产、要么取消并留痕，不遗留无状态任务；requires_action 与 failed 严格分开。

## 10. 作品交付

> **D-028 对齐**：界面「作品」对应领域对象 Work；交付是独立 DeliveryRecord 事件，**Work ≠ DeliveryRecord**；一个 Work 可有多条 DeliveryRecord（DM-002）；要求返工创建新版本/新工单/新 Work 并保留新旧关系；重新交付创建新 DeliveryRecord 不覆盖原记录。详见 [DOMAIN_MODEL_AND_STATE_MACHINES.md](DOMAIN_MODEL_AND_STATE_MACHINES.md)（D-028）。

- **角色**：电商运营、内容审核人
- **前置条件**：存在正式 Work（产物核验通过、来源版本完整、Work 创建成功）
- **主路径**：
  1. 在作品库预览 Work（固定引用 ProductionOrder/ExecutionAttempt/VideoPlanVersion/CopyVersion/Avatar/配置快照）；
  2. 审核人 WorkInspection：MarkWorkDeliverable → passed；或 RequestRework → rework_required（记录分类/原因/检查人/返回上游阶段）；
  3. 运营安全下载，或按商品打包；
  4. 创建 DeliveryRecord（交付时间/交付人/交付方式/备注）；页面「已交付」由至少一条有效 DeliveryRecord 计算；
  5. 重新交付/补发 → 创建新 DeliveryRecord，不覆盖原记录。
- **异常路径**：要求返工 → 返回上游创建新版本/新 ProductionOrder/新 Work，建立新旧作品关系，不替换旧作品文件。
- **完成标准**：项目产物完整交付并登记 DeliveryRecord；WorkInspection 与 DeliveryRecord 记录完整留痕。

## 11. 审核人流程

- **角色**：内容审核人
- **前置条件**：有待审核的文案/方案/成片
- **主路径**：
  1. 从待审核列表进入（文案 → 方案 → 成片三类队列）；
  2. 对照品牌规范审核（禁用词、表达规则、品牌形象）；
  3. 批准或退回并附意见；
  4. 批量审核同质内容。
- **异常路径**：规范缺位 → 提示管理员补充品牌规范，不以个人标准代替；审核对象版本更新 → 重新审核新版本。
- **完成标准**：审核队列清空或全部有明确结论，动作全部留痕。

## 12. Local Agent 离线流程

- **角色**：电商运营（受影响方）、技术/本地执行器管理员（处理方）
- **前置条件**：已配对的 Local Agent 心跳丢失
- **主路径**：
  1. 控制面检测到 Agent 离线，生产看板与 Preflight 明确提示「无可用执行器」；
  2. 新任务不被下发；已下发未完成任务标记为等待执行器；
  3. 管理员恢复 Agent（重启/重新配对/检查网络与登录态）；
  4. Agent 上线后心跳恢复，任务按策略续跑或重领；
  5. 状态同步回控制面，看板恢复。
- **异常路径**：登录态失效 → 引导重新登录（飞影登录态只保存在本地）；任务状态不一致 → 以证据与 Provider 状态对账，必要时人工接管。
- **完成标准**：Agent 恢复在线，积压任务有明确去向（续跑/重试/取消），无任务静默丢失。

## 13. 企业登录与成员管理（D-024）

第一版登录方式已由 D-024 决定：管理员预创建账号、工作邮箱和密码登录、首次登录强制修改临时密码、登录后自动进入唯一 Organization。本节只记录概念流程，不固定初始化命令、认证框架、密码哈希、Session 实现或数据库 Schema。

### 初始管理员初始化

```text
部署初始化
→ 创建唯一 Organization
→ 创建初始 Owner/Admin User
→ 创建 Owner/Admin OrganizationMember
→ 管理员登录
```

只记录概念流程，不固定初始化命令；允许未来实现为部署初始化命令、一次性 bootstrap 脚本、管理后台初始化流程或其他经过安全评审的部署方式。

### 管理员预创建成员

```text
Owner/Admin 进入成员管理
→ 输入成员工作邮箱
→ 创建 User
→ 创建唯一 OrganizationMember
→ 状态 pending_activation
→ 生成临时密码
→ 管理员安全传递
```

管理员预创建成员时不要求成员先完成公开注册；普通成员不得预创建其他成员。

### 首次登录

```text
输入工作邮箱和临时密码
→ 身份验证成功
→ 检测 pending_activation
→ 强制设置新密码
→ 设置成功
→ 状态 active
→ 自动进入唯一 Organization
→ 首页或项目列表
```

完成首次密码修改前，不得访问组织业务数据。

### 正常登录

```text
输入工作邮箱和密码
→ 身份验证
→ 检查有效 OrganizationMember
→ 检查成员未被 disabled
→ 自动进入唯一 Organization
→ 首页或项目列表
```

### 忘记密码

```text
用户联系管理员
→ 管理员重置
→ 生成新的临时密码
→ 用户登录
→ 强制设置新密码
```

MVP 不提供自助邮件找回密码、邮件重置链接、短信验证码找回密码或客服人工身份验证系统；管理员不得查看或恢复用户原密码，只能产生新的临时密码。

### 停用成员

```text
管理员停用成员
→ OrganizationMember 不再有效
→ 后续访问被拒绝
→ 用户不能继续访问组织数据
```

### 异常成员关系

```text
零个有效 OrganizationMember
→ 拒绝进入
→ 联系管理员

多个有效 OrganizationMember
→ 视为 MVP 配置错误
→ 不静默选择
→ 拒绝进入
→ 联系管理员
```

本节不得添加：公开注册、自助创建组织、邀请链接注册、手机验证码、企业微信 OAuth、邮件找回密码或多组织选择。
