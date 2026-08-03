# Provider 与 Local Agent 架构

> 状态：Draft（架构方向已按产品决策固化；具体协议、能力清单与 API 假设待技术调研）
> Owner：owner（JettxonHo）
> 最后更新：2026-08-04
> 适用范围：涉及飞影、影刀、Playwright 或云端执行的设计与开发
> 非目标：本文档不实现通信协议，不把营销页面当作 API 合约，不开始功能开发

---

## 一、总体分层

```text
云端 SaaS Control Plane
├── 用户、组织、权限
├── 项目与商品
├── 文案与审核
├── 数字人/声音/背景资产
├── 视频方案
├── 生产任务编排
├── 用量与商业信息
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

**不得把长时间 Playwright 任务直接塞入不适合长任务的 Serverless/Workers 请求生命周期。** 长时执行只发生在 Local Agent（本地或 VPS）；云端控制面负责编排、状态与商业信息，不承担浏览器执行。

---

## 二、云端 Control Plane

职责边界：

- 组织、用户与权限（第一版不要求完整 RBAC，但模型预留）；
- 项目、商品、文案与审核、资产、视频方案等领域数据；
- 生产任务编排：下发、排队、状态同步；
- 用量与商业信息：任务数、预计用量、套餐余量、成本提示（内部 pointBudget 不作为用户术语）；
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

## 四、Provider Adapter

产品上层必须避免和飞影页面结构永久绑定：

```text
标准化视频方案与生产任务
        ↓
Provider Adapter
├── Hifly Playwright Adapter
├── Hifly API Adapter（如未来正式开放并获得权限）
├── 影刀 RPA Adapter（可选）
├── 其他数字人平台 Adapter
└── 其他视频模型 API Adapter
```

**不得在上层产品模型中直接使用飞影按钮文案、页面 selector 或具体网页步骤作为领域概念。** 这些属于 Adapter 内部实现细节。

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
video.lip_sync
video.background_replace
video.product_holding
video.talking
video.podcast
```

无正式 API 的能力可以由 Playwright Adapter 实现；capability 声明决定上层功能可见性与 Preflight 检查项。

---

## 五、Hifly Playwright Adapter

- 由现有 Playwright 自动化内核演化而来，是第一阶段的主 Adapter；
- 承担：飞影登录态维护、页面操作、上传/下载、证据采集；
- 页面结构、按钮文案、selector 全部封装在 Adapter 内部，不进入上层领域模型；
- 自动化范围必须按能力逐项调研与验证（见第六节），不假设全部能力可自动化。

## 六、Hifly API Adapter（条件性）

- 仅当飞影正式开放 API 且我们获得相应权限时启用；
- **不得把公开营销页面当作已经获得的 API 契约**；
- 启用前必须完成：能力清单核对、账号权限确认、配额与成本确认。

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

---

## 九、飞影能力确认表（按证据记录）

能力按「当前确认状态 + 已验证范围 + 证据来源 + 剩余调研 + 权限依赖」记录。记录规则：

- 证据只能来自本仓库**真实存在**的记录（文档、测试、运行记录），不得把营销页面当作证据；
- 「部分已验证」不得扩张为「完整能力已完成」——它只代表表中写明的已验证范围；
- 表格更新必须伴随调研记录，不允许凭空改状态；
- 未验证能力一律保持未验证，除非仓库已有明确证据。

| 能力 | 当前确认状态 | 已验证范围 | 证据来源 | 剩余技术调研 | 账号或权限依赖 |
|------|--------------|------------|----------|--------------|----------------|
| 手里有货 | **部分已验证** | 当前仓库的本地 Playwright 主链路：商品和人物素材上传、弹窗素材生成、素材确认、外层视频生成、下载、batch/task 状态、证据与失败处理 | `README.md`（主链路与工作台能力描述）、`AGENTS.md`（GUI 跑通最低标准）、`docs/status/CURRENT.md`（当前生产路径与关键批次 MULTI-001 单条真实执行记录）、`docs/SOP.md`（手里有货标准生产 SOP）、`test/` 现有确定性测试 | 封装为 `video.product_holding` capability；与 VideoPlan 的参数映射；人物、声音、背景组合范围；Provider 可用性与 Preflight；SaaS 资产引用和状态同步 | 当前未验证的扩展能力继续标记待确认 |
| 公共数字人选择 | 未验证 | — | — | 完整调研 | 待确认 |
| 照片数字人 | 未验证 | — | — | 完整调研 | 待确认 |
| 视频数字人复刻 | 未验证 | — | — | 完整调研 | 待确认 |
| AI 生成人物 | 未验证 | — | — | 完整调研 | 待确认 |
| 声音克隆 | 未验证 | — | — | 完整调研 | 待确认 |
| 文本转语音 | 未验证 | — | — | 完整调研 | 待确认 |
| 对口型 | 未验证 | — | — | 完整调研 | 待确认 |
| 视频换背景 | 未验证 | — | — | 完整调研 | 待确认 |
| 实景口播 | 未验证 | — | — | 完整调研 | 待确认 |
| 双人播客 | 未验证 | — | — | 完整调研 | 待确认 |

重要边界说明：

- 「手里有货」的已验证范围**仅限当前仓库的单机本地 Playwright 主链路**（现有上传、确认、生成和下载流程），不代表完整 SaaS Provider capability（capability 封装、VideoPlan 参数映射、资产引用与状态同步、多账号权限）已经完成；
- 现有单机自动化链路向 capability 模型的封装属于 HIFLY-001 范围，封装完成并验证前，上层功能不得以该 capability 可用为前提排期。

---

## 十、未确认的 API 假设

以下均为**未确认假设**，不得在设计与排期中当作事实：

- 飞影存在正式开放 API；
- 飞影 API 覆盖上表全部能力；
- 我们账号具备相应 API/功能权限；
- Provider 配额与成本可程序化查询。

所有假设在确认前停留在 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) 与上表的「待调研/待确认」列。
