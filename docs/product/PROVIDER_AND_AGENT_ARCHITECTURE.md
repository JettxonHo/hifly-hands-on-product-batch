# Provider 与 Local Agent 架构

> 状态：Draft（架构方向已按产品决策固化；具体协议、能力清单与 API 假设待技术调研）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
> 适用范围：涉及飞影、影刀、Playwright 或云端执行的设计与开发
> 非目标：本文档不实现通信协议，不把营销页面当作 API 合约，不开始功能开发

---

## 一、总体分层

第一版是 Cloud-first 的云端 Web Control Plane，默认部署目标为腾讯云（Tencent Cloud first，不是 Tencent Cloud only，D-015）；腾讯云部署**不代表领域层绑定腾讯云**，Database、ObjectStorage、Queue、SecretStore 使用基础设施抽象（具体服务待 Q-021）。

```text
腾讯云部署目标
└── Cloud Web Control Plane
    ├── 登录与单组织
    ├── 项目与业务数据
    ├── CopyGenerationService
    ├── VideoPlan
    ├── Task Router
    ├── 作品库
    └── 内部用量与审计

Local Agent / 常驻执行节点
├── 飞影网页登录态
├── Playwright
├── 本地文件
├── 手里有货执行
├── 下载与证据
└── 人工接管

Provider API asynchronous worker
├── 可部署在云端
├── 可部署在 Local Agent
└── 由 Q-018 决定
```

```text
云端 SaaS Control Plane
├── 用户、组织、权限
├── 项目与商品
├── 文案与审核
├── 数字人/声音/背景资产
├── 视频方案
├── 生产任务编排
├── 内部用量与治理信息
└── 状态同步

本地或 VPS Local Agent
├── Playwright 浏览器执行
├── 飞影登录态
├── 本地文件访问
├── 上传与下载
├── 验证码和人工接管
├── 失败证据
└── Provider Adapter
```

**不得把长时间 Playwright 任务直接塞入不适合长任务的 Serverless/Workers 请求生命周期。** 长时执行只发生在 Local Agent（本地或 VPS）或异步 worker；云端控制面负责编排、状态与内部用量/治理信息，不承担浏览器执行。

---

## 二、云端 Control Plane

职责边界：

- 组织、用户与权限（第一版不要求完整 RBAC，但模型预留）；
- 项目、商品、文案与审核、资产、视频方案等领域数据；
- 生产任务编排：下发、排队、状态同步；
- 内部用量与治理信息：任务数、预计用量、内部额度、成本提示（内部 pointBudget 不作为用户术语；不建设面向客户的套餐/账单，D-016）；
- 状态同步：聚合 Agent 回传与 Provider 状态，投影为业务状态（多状态域分离见 [DOMAIN_MODEL.md](DOMAIN_MODEL.md)）。

约束：

- **云端不得保存不必要的飞影 Cookie**（登录态保存在 Local Agent 本地）；
- 控制面不直连 Provider 网页执行；需要执行时下发任务给 Local Agent。

---

## 三、Local Agent

现有项目应**演化为 Local Agent，而不是被删除**。现有可靠执行内核（批量执行、状态机、原子写、幂等、证据采集、跨平台 CI 标准）是 Local Agent 的执行引擎基础。

Local Agent 责任：

- Provider 登录
- Cookie 和登录态本地保存
- 本地文件读取
- Playwright 执行
- 下载
- 失败截图和证据
- 心跳
- 任务领取
- 任务状态回传
- 人工接管
- 暂停和恢复
- 版本更新

### Agent 协议（规划，本轮不实现）

未来 Agent 协议至少规划：

```text
agent.register
agent.heartbeat
agent.capabilities
task.claim
task.start
task.progress
task.require_human
task.complete
task.fail
artifact.upload
```

### 人工接管

验证码、弹窗、异常页面等无法自动处理的场景，Agent 发出 `task.require_human`，等待人工在本地完成后继续；接管过程留痕（时间、原因、结果）。

### 跨平台要求

核心 Local Agent 优先支持 macOS 与 Windows，后续 Linux/VPS。不得把产品主链路绑定到只有 Windows 能稳定运行的低代码 RPA 工具。

---

## 四、Provider Adapter 与任务路由

产品上层必须避免和飞影页面结构永久绑定：

```text
标准化视频方案与生产任务
        ↓
Provider Adapter
├── Hifly Playwright Adapter
├── Hifly API Adapter（API 文档已确认；启用需账号权限、真实调用和 Adapter 验证）
├── 影刀 RPA Adapter（可选）
├── 其他数字人平台 Adapter
└── 其他视频模型 API Adapter
```

**不得在上层产品模型中直接使用飞影按钮文案、页面 selector 或具体网页步骤作为领域概念。** 这些属于 Adapter 内部实现细节。

### Provider Task Router（长期执行架构）

长期架构**不要求所有任务都经过 Local Agent**：

```text
Provider Task Router
├── Hifly API asynchronous worker
└── Local Agent / Playwright
```

- **Hifly API Worker 是逻辑上的异步执行角色，不默认代表云端部署。** 它可以部署在：云端后台 Worker、Local Agent 内部 Worker、或两种方式并存；具体部署位置由 Q-018 的 Token 保管决策决定。
- **在 Q-018 决定前**：不默认把 Token 上传云端；不默认 API 必须从云端调用；不默认 API 必须经过 Local Agent。
- **API 创作任务必须异步执行**，不放在普通 HTTP 请求生命周期内（与长 Playwright 任务的约束一致）；
- 路由依据 Provider capability 确认状态与任务需求决定：需要登录态、本地文件、人工接管或仅网页支持的能力走 Local Agent / Playwright；已确认 API 能力走 Hifly API asynchronous worker；
- Provider Adapter 仍是统一的能力抽象，底层执行路径对上层透明。

### Hifly-first，不是 Hifly-only（D-013）

在飞影满足以下条件时，优先使用飞影完成数字人、声音、普通数字人口播、音频驱动、对口型、背景处理和相关视频能力：功能覆盖满足产品需求、真实效果质量达标、自动化路径稳定、成本和生成时延可接受、能取得稳定 task ID/状态/结果/失败信息、可安全重试对账和恢复、满足授权与敏感资产要求（D-011）。

执行路径偏好：

```text
1. 飞影正式 API
2. 飞影 Playwright
3. 飞影人工接管的半自动流程
4. 其他 Provider
```

但这不是无条件强制：当其他 Provider 在关键功能、质量、稳定性、成本或合规上明显更优时，可以经相同 Provider Adapter 接入。**未经 capability 实际调研与验证，不得宣布飞影支持该能力。**

第一版普通运营界面**不要求用户选择 Provider**：用户选择的是生产结果类型，Provider Task Router 根据已验证能力路由；Provider 选择只进入高级设置、管理员配置或技术诊断区域。完整决策记录见 [DECISION_LOG.md](DECISION_LOG.md) D-013。

### 统一能力边界（名称可调整）

```text
DigitalHumanProvider
```

能力建议：

```text
listAvatars()
createPhotoAvatar()
cloneVideoAvatar()
generateAvatar()
listVoices()
cloneVoice()
createLipSyncVideo()
replaceBackground()
createTalkingVideo()
createProductHoldingVideo()
createPodcastVideo()
getTaskStatus()
cancelTask()
downloadResult()
```

### Capability 模型

Provider 必须声明 capability，不能假设每个 Provider 支持所有能力：

```text
avatar.photo
avatar.video_clone
avatar.ai_generate
voice.public
voice.clone
video.avatar_audio_driven
video.generic_lip_sync
video.background_replace
video.product_holding
video.talking
video.podcast
```

- 对口型必须拆分为两个 capability，不得使用一个模糊的 lip-sync 表达所有场景：`video.avatar_audio_driven`（使用飞影 avatar + audio）与 `video.generic_lip_sync`(任意用户图片或视频 + audio)；
- capability 声明决定上层功能可见性、Preflight 检查项与 VideoPlan 字段可用性：某能力未声明支持的输入参数（例如手里有货的背景），对应 VideoPlan 字段不得表达为可用。

### LLM Provider Adapter（文案生成能力，D-019 / D-020）

文案生成与质检是 SaaS 自有业务能力，经独立于视频 Provider 的 LLM Provider Adapter 完成：

```text
CopyGenerationService
└── LLM Provider Adapter
    ├── Platform Default Credential（平台默认凭证，MVP）
    └── Organization BYOK Credential（企业自有 API Key，后续）
```

凭证边界（必须明确）：

- **LLM Key 和 Hifly Token 是两类不同凭证**；Q-018 只解决 Hifly Token；LLM BYOK 由 D-020 / Q-019 / Q-020 管理；
- **Secret 值不进入领域模型**；领域模型只保存 encryptedSecretRef 或 credential config ID（见 [DOMAIN_MODEL.md](DOMAIN_MODEL.md) 的 LlmProviderConfig）；
- 具体 SecretStore 由 Q-021 决定；
- 真实 Key 遵守 D-020 安全底线（不进入前端/仓库/Markdown/日志/错误信息/证据截图，页面只显示掩码）；
- 腾讯云部署不代表领域层绑定腾讯云：LLM Provider 同样是可替换 Adapter。

### 图片数字人创建的异步任务边界（Vertical Slice B，D-017）

```text
Authorization Preflight
→ Provider upload
→ create avatar task
→ task status/callback
→ AvatarAsset registration
```

- 必须先 Authorization Preflight（D-011：未记录有效授权不得上传 Provider 或创建数字人）；
- 创建为异步 task，经 task status/callback + 轮询对账跟踪（回调不能作为唯一完成机制）；
- 完成后登记 AvatarAsset，回到统一人物选择流程；
- 可能产生 Provider 消耗，开发前必须获得 owner 对真实调用的单独授权。

---

## 五、Hifly Playwright Adapter

- 由现有 Playwright 自动化内核演化而来，是第一阶段的主 Adapter；
- 承担：飞影登录态维护、页面操作、上传/下载、证据采集；
- 页面结构、按钮文案、selector 全部封装在 Adapter 内部，不进入上层领域模型；
- 自动化范围必须按能力逐项调研与验证（见第六节），不假设全部能力可自动化。

## 六、Hifly API Adapter 与 API 能力调研

### 调研首要来源

HIFLY-001 API 能力调研的首要来源：**飞影数字人 API V2 文档** `https://api.lingverse.co/hifly.html`。

注意区分两个地址，不得混淆：

- **文档托管域名**：`api.lingverse.co`（文档页面所在地址）；
- **文档中的实际 API 请求主机**：`hfw-api.hifly.cc`（API base URL）。

**不得把文档托管地址误写成 API base URL。**

### API 文档层面已确认存在的能力

根据当前飞影数字人 API V2 文档，以下能力可确认为「API 文档层面存在」（共 14 项）：

1. 视频数字人创建
2. 图片数字人创建
3. 数字人任务状态查询
4. 公共数字人列表
5. 声音克隆
6. 声音参数编辑
7. 公共/自有声音列表
8. 声音任务查询
9. 文本驱动数字人视频
10. 音频驱动数字人视频
11. 网感模板视频
12. 文本转语音
13. 创作任务状态查询
14. 任务完成回调

### 五层确认状态分离（必须严格区分）

```text
API 文档已确认
当前账号权限已确认
真实调用已验证
本项目 Adapter 已实现
SaaS 产品能力已完成
```

**文档存在不代表当前账号已经拥有 Token、配额或调用权限。** 每个能力必须按这五层分别记录，不得跨层合并表达、不得把低层状态表述为高层状态。本轮禁止进行任何真实 API 调用和积分消耗；公开营销页面同样不得当作 API 合约证据。

### 能力分层状态（基于当前文档）

一、普通数字人口播（文本驱动/音频驱动数字人视频）：

- API 文档：已确认
- 账号权限：待确认
- 真实调用：未验证
- Adapter：未实现

公开数字人列表、公共/自有声音列表也采用相同分层状态。

二、图片/视频数字人创建：

- API 文档：已确认
- 授权与敏感资产约束：适用 D-011（见 [DECISION_LOG.md](DECISION_LOG.md)）
- 当前账号权限：待确认
- 真实调用：未验证
- Adapter：未实现

三、对口型能力拆分（不得使用一个模糊的 lip-sync 表达所有场景）：

- `video.avatar_audio_driven`：使用飞影 avatar + audio，API 文档已确认（音频驱动数字人视频）；账号权限待确认，真实调用未验证，Adapter 未实现；
- `video.generic_lip_sync`：任意用户图片或视频 + 音频，当前 API 文档未确认，待网页和 API 调研。

四、仍未从该 API 文档确认（保持待调研，**不得因为飞影网页营销功能而标记 API 已支持**）：

- `video.product_holding`
- `video.background_replace`
- `avatar.ai_generate`
- `video.podcast`
- generic lip sync（`video.generic_lip_sync`）
- 手里有货的背景控制

### 回调与状态查询

API 文档提供任务完成回调，但**回调不能作为唯一完成机制**。设计必须同时包含：

- callback notification（回调通知）
- polling reconciliation（主动轮询对账）
- provider task id
- request id
- callback received time
- last poll time
- provider status
- result/error
- 丢失回调后的主动对账

## 七、影刀 RPA Adapter（可选）

- 影刀仅作为**可选 Adapter**，不是产品领域模型和核心执行协议的基础；
- 适用于特定 Windows 场景的补充手段；
- 不作为唯一执行器，不进入主链路依赖。

---

## 八、登录态与安全边界

- 飞影登录态（Cookie/会话）只保存在 Local Agent 本地；云端不保存不必要的飞影 Cookie；
- 登录失效由 Agent 检测并提示重新登录，控制面仅感知「Provider 连接不可用」这一业务事实；
- 失败证据（截图/日志）在上报前按现有脱敏标准处理，不含登录凭据；
- 多租户阶段：不同组织的 Agent、资产、任务严格隔离（Phase 3）。

### 敏感资产与授权校验（Accepted 底线，见 DECISION_LOG D-011）

- 用户照片、视频、声音和数字人复刻源素材属于敏感资产；未记录有效授权，不得创建数字人、克隆声音、上传 Provider、创建对口型任务或生产任务；
- **Provider Adapter 在真实上传前必须重新校验授权状态**（不以控制面缓存或前端字段为准）；授权失效、撤销或资产 disabled 后，新任务 Preflight fail-closed，不得创建新的 Provider 任务；
- 云端和 Local Agent 只处理任务需要的最小数据；敏感源素材的留存与删除遵循授权记录与开放问题（Q-007/Q-008）的后续决策。

### API Token 保管

- 飞影 API Token 的保管位置与调用执行位置待 owner 决策（见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) Q-018）；
- **在决策前不得默认把 Token 上传云端**。

---

## 九、飞影能力确认表（按证据记录）

能力按「当前确认状态 + 已验证范围 + 证据来源 + 剩余调研 + 权限依赖」记录。记录规则：

- 证据只能来自本仓库**真实存在**的记录（文档、测试、运行记录），不得把营销页面当作证据；
- 「部分已验证」不得扩张为「完整能力已完成」——它只代表表中写明的已验证范围；
- 表格更新必须伴随调研记录，不允许凭空改状态；
- 未验证能力一律保持未验证，除非仓库已有明确证据。

| 能力 | 当前确认状态 | 已验证范围 / 已确认输入 | 证据来源 | 剩余技术调研 | 账号或权限依赖 |
|------|--------------|--------------------------|----------|--------------|----------------|
| 手里有货 | **部分已验证**（本地 Playwright 主链路） | 已验证范围：现有上传、确认、生成、下载流程。**已确认输入：product image、avatar/person image；尚未确认：independent background、scene、voice、pose、framing** | `README.md`（主链路与工作台能力描述）、`AGENTS.md`（GUI 跑通最低标准）、`docs/status/CURRENT.md`（当前生产路径与关键批次 MULTI-001 单条真实执行记录）、`docs/SOP.md`（手里有货标准生产 SOP）、`test/` 现有确定性测试 | 封装为 `video.product_holding` capability；与 VideoPlan 的参数映射；背景与场景来源调研（Q-017）；Provider 可用性与 Preflight；SaaS 资产引用和状态同步 | 未确认输入继续标记待确认 |
| 普通数字人口播（video.talking） | API 文档已确认 | 真实调用未验证 | 飞影数字人 API V2 文档（第六节） | 账号权限确认、真实调用验证、Adapter 实现 | 账号权限待确认 |
| 公共数字人选择 | API 文档已确认（公共数字人列表） | 真实调用未验证 | 同上 | Q-006 同步机制（权限/分页/更新频率/预览/下架/ID 稳定性） | 账号权限待确认 |
| 照片数字人（avatar.photo） | API 文档已确认（图片数字人创建）；适用 D-011 | 真实调用未验证 | 同上 | 授权流程、真实调用、Adapter 实现 | 账号权限待确认 |
| 视频数字人复刻（avatar.video_clone） | API 文档已确认（视频数字人创建）；适用 D-011 | 真实调用未验证 | 同上 | 授权流程、真实调用、Adapter 实现 | 账号权限待确认 |
| AI 生成人物（avatar.ai_generate） | API 文档未确认 | — | — | 待网页与 API 调研 | 待确认 |
| 声音克隆（voice.clone） | API 文档已确认；适用 D-011 | 真实调用未验证 | 飞影数字人 API V2 文档 | 授权流程、真实调用、Adapter 实现 | 账号权限待确认 |
| 文本转语音 / 公共声音 | API 文档已确认（文本转语音、公共/自有声音列表） | 真实调用未验证 | 同上 | 真实调用、Adapter 实现 | 账号权限待确认 |
| 对口型（video.avatar_audio_driven） | API 文档已确认（音频驱动数字人视频，飞影 avatar + audio） | 真实调用未验证 | 同上 | 真实调用、Adapter 实现 | 账号权限待确认 |
| 通用对口型（video.generic_lip_sync） | API 文档未确认 | — | — | 待网页和 API 调研 | 待确认 |
| 视频换背景（video.background_replace） | API 文档未确认 | — | — | 待网页和 API 调研 | 待确认 |
| 实景口播 | 未从 API 文档确认 | — | — | 待网页和 API 调研 | 待确认 |
| 双人播客（video.podcast） | API 文档未确认 | — | — | 待网页和 API 调研 | 待确认 |

重要边界说明：

- 「手里有货」的已验证范围**仅限当前仓库的单机本地 Playwright 主链路**（现有上传、确认、生成和下载流程），不代表完整 SaaS Provider capability（capability 封装、VideoPlan 参数映射、资产引用与状态同步、多账号权限）已经完成；
- **背景与场景规则（Q-017 调研完成前）**：不声明手里有货支持独立背景选择；不把背景资产作为该 capability 的已支持参数；不在产品设计中承诺用户可以自由更换背景；可暂时表达为「场景跟随人物素材或由 Provider 决定」；通用 VideoPlan 仍可保留背景字段，但 Provider capability 必须决定该字段是否可用；具体行为必须通过后续 HIFLY-001 实际页面调研确认，不得推测；
- 「API 文档已确认」仅为五层确认状态的第一层（见第六节），不得表述为账号已具备权限或能力已可用；
- 现有单机自动化链路向 capability 模型的封装属于 HIFLY-001 范围，封装完成并验证前，上层功能不得以该 capability 可用为前提排期。

---

## 十、已确认事实与未确认 API 假设

已确认事实（文档层面）：

- 飞影数字人 API V2 文档存在，并覆盖第六节所列 14 项能力（API 文档层面）；
- 文档托管地址（`api.lingverse.co`）与 API 请求主机（`hfw-api.hifly.cc`）是两个不同概念。

以下仍为**未确认假设**，不得在设计与排期中当作事实：

- 我们账号是否拥有 API Token、配额与调用权限；
- 文档能力与实际调用行为是否一致；
- API Token 的保管位置与调用执行位置（见 Q-018）；
- Provider 配额与成本是否可程序化查询。

**在 Q-018 决策前，不得默认把 Token 上传云端。**
