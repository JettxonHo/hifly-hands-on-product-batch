# 运营工作台 UX V2 独立设计合同

> Owner 已确认方向：运营任务流优先
> Lifecycle gate：本合同随 acceptance PR 合并进入 `main` 后计为 `designed`；代码实现仍为 `pending`
> 基线：`origin/main@db6b4ad22f8870579393880046a42057ea27979c`
> 跟踪：Issue #174

## 1. 目的与证据边界

本合同把内部问题审计和定向外部研究转化为 Hifly 自己的产品决策。它决定信息架构、业务语言、
控件语义、生产安全状态矩阵和严格串行实施顺序，但不代表页面已经实现、部署、客户采用或经过真实
Provider 验收。

决策优先级如下：

1. 本项目的角色、任务频率、错误代价、组织授权、API 与领域状态；
2. 已验证的 Cloud Executor 严格串行生产合同；
3. `OPERATOR_TASK_FLOW_UX_V1.md` 已合并的首屏五问和唯一推荐下一步；
4. `OPERATOR_UX_INTERNAL_AUDIT.md` 的逐页 P1/P2 证据；
5. `OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md` 的 Adopt / Adapt / Reject 输入。

外部产品只提供模式证据，不决定本项目 IA。本合同中的 390px 排序、错误恢复、全局生产任务入口和
终态动作收敛均是结合项目事实作出的 Hifly 判断，不是外部来源原话。

## 2. 第一性原理任务模型

| 角色 | 高频目标 | 主要错误代价 | 默认界面必须优先回答 |
|---|---|---|---|
| 内容运营 | 让一个商品按顺序完成资料、文案、人物和方案 | 改错商品、覆盖草稿、使用失效上游 | 当前对象、当前阶段、阻断、唯一下一步 |
| 审核人员 | 对明确版本执行质检处理或人工决策 | 把自动通过当人工批准、批准旧版本 | 审核对象版本、依据、影响和决策结果 |
| 生产运营 | 严格逐单执行、处理异常、核验并交付 | 重复出片、积分浪费、错误作品交付 | 当前工单是否可执行、运行、需处理或完成 |
| 组织管理员 | 管理成员和企业人物目录 | 错授权限、停用错误对象 | 对象、权限影响、危险确认和审计结果 |
| 技术排障人员 | 查看执行器、attempt、handoff 和 hash | 把基础设施异常误判为业务失败 | 可展开证据，不抢占业务主叙事 |

因此，运营工作台必须围绕“项目中的商品如何到达可交付作品”组织，不以 HTML 文件、技术模块或
执行器组件组织一级信息架构。

## 3. 信息架构决策

### 3.1 稳定一级导航

一级导航只承载跨项目、跨商品且长期稳定的对象：

1. **项目**：进入项目和商品阶段流程；所有普通运营的权威入口。
2. **生产任务**：跨项目查看当前用户可见的生产待办、执行中、需处理和已完成工单。
3. **作品库**：检查、返工、交付和鉴权下载已登记作品。
4. **素材中心**：按服务端真实类型管理组织素材和系统产物。
5. **成员管理**：仅管理员可见。

“生产任务”是目标 IA 决策，但当前仓库没有已确认的组织级任务索引页面和服务端投影。实施前必须先
通过独立 Product/API gate，证明可从服务端获得组织隔离、权限过滤的任务集合、业务状态、阻断和分页。
门禁未通过时不得显示空链接、用浏览器遍历项目拼队列或伪造待办数量；当前商品仍通过项目内“生产”
阶段进入。

一级导航不新增“设置”。成员管理保持独立管理员能力，不以不存在的设置层级包装。

### 3.2 项目内五阶段导航

项目阶段导航只服务当前项目和当前商品：

1. 商品资料
2. 文案
3. 人物
4. 视频方案
5. 生产

阶段导航必须持续显示项目与商品上下文、当前阶段和上游阻断。它不是一级导航的重复，也不包含成员、
素材目录管理或作品库。作品是生产后的跨项目结果上下文，不作为第六阶段。

### 3.3 入口与 legacy 边界

- `projectContentEnabled=true` 时，`/`、登录成功、首次改密和会话恢复进入企业 Projects。
- 非管理员访问成员页继续安全回到 Projects，不得回 legacy 工作台。
- 显式 `/index.html` 保留本地/运维批量工作台，首屏标明企业流程进入项目；不加入企业一级导航。
- feature-off 或 runtime/auth 初始化失败继续使用既有 fail-safe 行为，不产生空白页、循环跳转或权限绕过。
- legacy 的批次、抓包、重试和真实执行确认门禁不得因企业 IA 升级而改变。

## 4. 全局页面骨架

```text
┌─ 一级导航 ─┬─ 组织 / 账号 ─────────────────────────────────────┐
│ 项目       │ 项目 / 商品 / 阶段                               │
│ 生产任务*  ├─────────────────────────────────────────────────┤
│ 作品库     │ 业务状态 · 阻断摘要 · 唯一推荐下一步 [主操作]     │
│ 素材中心   ├─────────────────────────────────────────────────┤
│ 成员管理** │ 当前对象列表 + 详情 / 编辑 / 审核                 │
│            ├─────────────────────────────────────────────────┤
│            │ ▸ 技术与审计详情：ID、attempt、handoff、hash、时间 │
└────────────┴─────────────────────────────────────────────────┘

*  仅在组织级生产任务 API/Product gate 通过并有真实页面后显示。
** 仅管理员显示。
```

每个业务页面首个内容区必须回答：当前项目/商品、所处步骤、业务状态、唯一推荐下一步和必须先解决的
阻断。没有可执行命令时，推荐下一步明确为等待、选择、返回或查看结果，不留空，也不由前端模拟终态。

## 5. 页面职责与首屏合同

| 页面 | 当前对象 | 业务状态主叙事 | 唯一下一步规则 | 关键阻断 | 默认折叠的技术详情 |
|---|---|---|---|---|---|
| Entry / Login | 组织与会话 | 需要登录、需要改密、正在恢复或企业入口不可用 | 登录、修改密码、继续项目或安全重试 | 身份、runtime、会话恢复 | feature flags、会话诊断 |
| Projects | 组织内项目 | 继续已有项目、空、加载失败 | 继续最近项目；空态创建；失败重试 | 权限、加载失败、快照不足 | project ID、时间戳 |
| Project | 当前项目与商品版本 | 草稿、资料已就绪、历史只读、冲突 | 保存、设为已就绪、回当前版本或进入文案 | 名称、confirmed 卖点、可引用图片、dirty、409 | revision / asset version ID |
| Copy | 当前商品与文案版本 | 待生成、生成中、待质检、待人工审核、已批准、需修改 | 生成、保存、质检、处理 Finding、人工审核或进入人物 | 商品未就绪、dirty、冲突、生成/QC 失败 | Job、QualityRun、Review、版本 ID |
| Avatar | 当前商品与人物选择 | 未选择、待确认、已确认、已失效 | 选择并确认人物或进入方案 | 文案未批准、人物版本/授权/素材不可用 | AssetVersion、授权和选择记录 |
| Plan | 当前商品与方案版本 | 草稿、预检中、预检未通过、待人工审核、已批准、上游失效 | 保存/冻结、预检、修复、人工审核或进入生产 | 文案/人物失效、warning 后果、冲突 | PlanVersion、Preflight、Review |
| Production | 当前商品与生产工单 | 不可执行、可执行、等待、执行中、需处理、核验中、已完成 | 按第 9 节状态矩阵确定 | 严格串行时序、审批链、交接包、核验 | Worker、eligible、attempt、lease、handoff、hash |
| Works | 当前作品 | 待检查、需返工、可交付、已交付、不可用 | 检查、返工、交付、查看交付记录或下载 | A12、组织权限、下载授权、终态 | candidate/check/delivery ID、checksum |
| Assets | 当前素材类型与版本 | 可用、处理中、不可用、加载失败 | 上传受支持素材、选择类型、修复或查看产物 | 服务端类型/状态、上传权限、缺失关联数据 | Asset/Version、媒体类型、checksum |
| Members | 当前成员 | 正常、已停用、需改密、加载失败 | 创建、重置、停用或重试 | admin 权限、冲突、危险影响 | member ID、审计时间 |

## 6. 控件语义与操作层级

| 行为 | 控件 | 约束 |
|---|---|---|
| 跨页或进入对象详情 | 链接 | 必须有可恢复 URL；不伪装成提交按钮 |
| 提交当前业务命令 | 按钮 | 同一状态最多一个实心品牌主按钮；提交中禁用并显示真实状态 |
| 在有限集合中选择一个对象 | 单选、select 或可访问列表选择 | 选择本身不产生人工批准或生产终态 |
| 同一对象的互斥视图 | Tab | 不用于跨业务阶段导航，不把状态伪装成 Tab |
| 不可逆、成本或正式业务记录 | Dialog | 明确对象、影响和结果；关闭后焦点回触发器 |
| 普通说明或持久阻断 | Notice | 阻断必须有责任、后果和恢复入口；不能只用 toast |
| 业务状态 | State Badge | 只显示影响理解或行动的状态；技术码不进入 badge |
| 同类对象集合 | Table/List | 小屏转语义列表，不压缩成无字段名横向表格 |

### 6.1 刷新作用域

- 正常态的刷新是次级动作，不与推荐下一步竞争。
- “重试加载页面”重新执行完整 bootstrap；“刷新当前商品/工单/作品”只刷新命名对象；“刷新技术状态”只更新技术详情。
- dirty 编辑器刷新前必须阻止或确认；409 保留本地输入并提供加载服务端最新版本的显式入口。
- error 恢复成功后才清错误；业务 terminal、not-ready 或 requires_action 提示不得被 bootstrap 清空。

### 6.2 搜索、筛选与批量操作

- 搜索/筛选只在同类集合的数量或定位成本已由数据证明时加入；默认先用现有项目、状态和类型筛选。
- 批量工具只在用户选择对象后出现，并只允许同权限、状态兼容、结果可预览且不会触发生产重试的动作。
- V2 不新增批量批准、批量出片、批量重试、跨状态交付或批量删除。若未来需要，必须有独立服务端合同、数量上限、确认和逐项结果报告。
- 结果报告必须逐项区分成功、失败、未执行；不能用一个成功 toast 覆盖部分失败。

## 7. 中文业务词典

| 领域/技术词 | 默认业务展示 | 仅在技术详情保留 | 不得误写为 |
|---|---|---|---|
| Ready | 商品资料已就绪 | `ready` | 已批准 / 已生产 |
| CopyVersion | 文案版本 | version ID / revision | 最终文案 |
| QC | 文案质检 | QualityRun、规则码 | 人工审核 |
| QC passed | 质检通过 | `passed` | 文案已批准 |
| HumanReview | 人工审核 | Review ID、decision | 自动质检 |
| approved | 已批准 | `approved` | 生成成功 |
| Preflight | 生产预检 | Preflight result | 方案批准 |
| warning / passed | 有提醒 / 预检通过 | 原始枚举、检查项 | 可以自动生产 |
| VideoPlan | 视频方案 | PlanVersion ID | 视频成片 |
| ProductionOrder | 生产工单 | order ID | 执行器任务 |
| handoff package | 生产交接包 | manifest/package hash | 已开始生成 |
| Cloud Executor | 云端执行器 | mode、heartbeat、readiness | 业务完成状态 |
| eligible | 可被执行器领取 | eligible order ID | 已批准 |
| attempt | 执行尝试 | attempt/lease/heartbeat | 工单 |
| Worker off | 执行器已关闭 | process/container state | 永久安全状态 |
| A12 | 作品文件核验 | verification job/evidence | 人工内容检查 |
| Work | 作品 | Work/candidate ID | 交付记录 |
| delivered | 已交付 | delivery ID、时间、备注 | 不允许查看或追加交付 |

业务文案优先用“待处理、需修改、可交付、已完成、请重新选择”等自然中文。错误码、内部 ID、hash、
服务器时间和执行证据保留在可展开详情中，不删除审计能力，也不暴露 secret、Cookie、对象存储 key 或未投影异常正文。

## 8. 通用状态与恢复合同

| 状态 | 首屏表现 | 推荐下一步 | 禁止行为 |
|---|---|---|---|
| loading | 只显示正在加载当前上下文 | 等待 | 同时显示陈旧可执行内容 |
| empty | 解释缺少的对象和影响 | 创建、上传或返回选择 | 伪造默认对象 |
| error | 替换 loading；说明提交是否发生 | 作用域明确的重试或返回 | 仅 toast、静默 fallback 5xx |
| no_permission | 不展示对象内容或存在性 | 返回 Projects | 前端猜测权限、回 legacy |
| dirty | 显示未保存并保护输入 | 保存或放弃修改 | 切换/刷新静默覆盖 |
| saving / saved | 禁用重复提交；成功以服务端响应为准 | 等待或进入下一阶段 | 前端提前宣称成功 |
| conflict | 保留本地输入和冲突对象 | 比较/加载最新或继续编辑副本 | 自动覆盖本地内容 |
| history | 只读并标明非 current | 回当前版本 | 对历史版本启用写动作 |
| async processing | 显示服务端阶段，可离页恢复 | 等待或查看状态 | 虚假进度和自动终态 |
| failed / requires_action | 持久显示原因、责任和恢复入口 | 处理阻断 | 通用自动重试 |
| terminal success | 收敛为结果与后续业务动作 | 查看、核验或交付 | 继续突出上游提交动作 |

## 9. Production 完整状态与动作矩阵

### 9.1 不可破坏的逐单时序

1. **每轮激活前**：Worker 关闭；只为当前 SKU 创建一个 ProductionOrder 和 `ready` handoff；全组织
   eligible 必须严格等于 `[currentOrderId]`；当前工单 `attempts=[]` 且 active attempts=0。全部满足后才允许
   启动 Worker，concurrency 保持 1。
2. **执行期间**：不得创建或暴露下一条 eligible 工单，不显示虚假百分比或预计完成时间。
3. **terminal 后**：立即关闭 Worker并恢复 fail-closed；attempt 历史必须保留。
4. **failed / requires_action**：停止整批，不创建下一条，不自动重试、重新领取或再次生产。
5. **succeeded**：必须 A12 `passed`、Work `available`，且鉴权下载返回真实 bytes，才可在 Worker off 下准备下一条。

### 9.2 业务状态矩阵

| 服务端可观察条件 | 业务状态 | 唯一推荐下一步 | 次级/详情 | 明确禁止 |
|---|---|---|---|---|
| 无当前 approved Plan | 不可执行 | 返回视频方案处理阻断 | 查看上游版本 | 创建工单 |
| approved Plan、无工单 | 可准备生产 | 创建生产工单 | 查看方案摘要 | 自动创建或启动 Worker |
| 工单 draft、无 ready package | 交接资料未就绪 | 生成/准备交接包 | 查看 package 证据 | 暴露 eligible |
| package generating | 正在准备交接资料 | 等待 | 刷新该 package | 重复生成 package |
| package generation_failed | 交接资料准备失败 | 处理失败并按既有合同重试 | 查看安全错误详情 | 自动重试、启动 Worker |
| package ready、激活前门禁未全绿 | 生产门禁未通过 | 查看并处理门禁 | 展开 Worker/eligible/attempt 证据 | 显示“可执行” |
| 全部激活前门禁已证明 | 可执行 | 由获授权管理员启动当前单 | 查看门禁快照 | 同时准备下一单 |
| waiting_for_executor | 等待执行器领取 | 等待 | 查看技术状态 | 重复领取/重建工单 |
| claimed / running | 正在生成 | 等待 | 展开 attempt/heartbeat | 自动重试、创建下一单 |
| cancel_requested | 正在取消 | 等待终态 | 查看取消证据 | 当作已取消 |
| cancelled | 已取消 | 查看结果或按新授权重新规划 | 查看历史 attempt | 复用旧 attempt 自动重跑 |
| failed / requires_action | 需人工处理，整批已停 | 处理当前阻断 | 查看安全错误和 attempt | 下一单、自动重试/重领/再生产 |
| succeeded、无 A12 | 生成完成，待文件核验 | 开始/等待作品文件核验 | 查看 artifact 证据 | 宣称可交付 |
| A12 queued / running | 正在核验作品文件 | 等待 | 查看核验任务 | 创建下一单 |
| A12 failed / requires_action | 文件核验需处理 | 处理核验问题 | 查看核验证据 | 自动重新生产 |
| A12 passed、Work 未 available | 正在登记作品 | 等待或完成既有登记步骤 | 查看登记证据 | 宣称已完成 |
| Work available、未验证真实下载 | 待下载验收 | 执行获授权字节下载核验 | 查看 checksum | 创建下一单 |
| Work available 且真实下载匹配 | 本单已完成 | 查看作品 | 查看完整审计链 | Worker 未关闭时准备下一单 |

Cloud Executor、eligible、attempt 和 heartbeat 在门禁异常时可提升到阻断区域，其余时候进入技术详情。
普通运营不通过基础设施卡片启动生产；执行授权和角色继续服从既有服务端合同。

## 10. Works 合同

- 桌面使用“可扫描列表 + 大预览/详情”，390px 使用列表与详情两个层级并提供明确返回。
- `/works.html?work=<id>` 首次选择组织内可见目标；缺失、不可见或非本组织 ID 安全回落，不泄露存在性。
- 作品状态决定唯一动作：待检查推荐检查；需返工推荐查看返工要求；可交付推荐登记交付；已交付推荐查看交付记录。
- `delivered` 是当前交付终态。检查和返工不再作为同等主操作；已有 delivery history 必须保留。
- “新增一次交付”若当前 API 与权限允许，只能是明确的次级上下文动作：说明会新增审计记录，Dialog 确认，提交中禁用，
  返回服务端 delivery 结果。不得把它显示成默认“再次交付”，也不得覆盖上一条记录。
- 返工只记录既有 inspection/rework 决策；若需要自动创建新方案、工单或生产周期，必须进入独立 Product/API gate，
  前端不得串联伪造。
- 下载继续通过鉴权授权接口返回真实 bytes；文件名、媒体类型和 checksum 来自服务端真值。

## 11. Assets 合同与 API 缺口

当前服务端真实类型为 `product_image`、`avatar_image`、`work_video`。V2 可直接据此展示“商品图片、人物图片、
作品视频”分组；`work_video` 是系统登记产物，不显示上传入口。上传仅沿用当前 API 支持的商品图片和人物图片。

当前可直接展示的事实包括 Asset/Version、display name、kind、状态、content type、size、checksum 和版本时间。
以下内容在现有列表投影中没有足够真值，必须经过独立 API/Product gate：

- 资产正在被哪些项目、商品、人物选择或作品引用；
- 可用于筛选的业务用途、授权范围或品类标签；
- 服务端缩略图/预览投影、全局搜索和分页所需字段；
- 禁用资产对所有上游对象的影响汇总。

门禁未通过时不得按扩展名猜用途、伪造关联数量、显示空的“关联项目”Tab 或由前端扫描项目拼关联。可以明确写
“关联信息当前未提供”，但不能把未知显示成“未使用”。

## 12. 视口信息预算与无障碍

| 视口 | 信息预算与布局决策 |
|---|---|
| 1440px | 保留应用导航；任务摘要占一个紧凑区；列表与详情双栏，主详情优先；技术详情默认折叠 |
| 768px | 导航和阶段条紧凑；列表/详情采用顺序视图或抽屉，不能把两个窄栏硬挤；主操作与阻断始终同屏可理解 |
| 390px | 当前对象、业务状态、阻断和唯一下一步先出现；列表与详情分层；历史、筛选、技术证据进入折叠或抽屉 |

移动端排序是基于内部审计与外部响应式模式作出的 Hifly `Inference / Adapt`。它不是把桌面简单改为单列，也不允许
sticky 操作遮挡内容。所有视口必须满足：

- 无页面级横向滚动；长中文名、文件名、状态和 ID 可换行/截断并保留可访问完整值；
- 语义 landmarks、标题层级、label、aria-live、skip link 和可见键盘焦点；
- Dialog/抽屉打开后焦点进入，关闭后返回触发元素；列表与详情可用键盘切换；
- `prefers-reduced-motion` 下关闭非必要 transition/transform，状态仍用文字表达；
- loading、empty、error、permission、dirty、saving、conflict、history、async 和 terminal 均有公开浏览器验收；
- 临时截图必须按 PNG 像素头核对 1440/768/390，且不提交仓库。

## 13. 研究输入转化为 Hifly 决策

| 研究输入 | Hifly 决策 | 边界 |
|---|---|---|
| Adopt：全局与项目内导航分层 | 固定一级跨项目对象 + 项目五阶段 | 不照搬竞品导航项，不新增设置 |
| Adapt：个人工作聚合 | 目标 IA 增加“生产任务” | 必须由组织隔离服务端索引支持，未通过 gate 不显示 |
| Adapt：审核上下文与终态收敛 | Works 按检查/返工/交付状态只推荐一个动作 | 不把再次执行或再次交付作为默认主动作 |
| Adopt：选择后才出现批量工具 | 批量动作渐进出现并给逐项结果 | 当前不新增生产、审核、重试或删除批量命令 |
| Adapt：资源索引与媒体上下文 | Assets 按真实 kind 分组，Asset/Version 分层 | 用途和关联缺口不由前端推断 |
| Adopt：自然中文任务语言 | 首屏使用本合同词典 | 英文枚举与技术证据保留在详情 |
| Inference / Adapt：错误恢复 | error 替换 loading，并给作用域明确的恢复动作 | 不把 5xx 静默当 404，不覆盖 dirty/terminal |
| Inference / Adapt：390px 任务优先 | 对象、状态、阻断、下一步先于详情 | 不是外部产品直接规范，须逐页浏览器验收 |
| Reject：复杂可配置首页 | 不在当前阶段新建仪表盘 | 先完成稳定 IA 与任务真值 |
| Reject：默认高级搜索/批量 | 仅在规模、权限和 API 真值成立时新增 | 不以“企业感”为理由造功能 |
| Reject：复制品牌视觉 | 继续现有 tokens 和克制企业工作台 | 不引外部字体、CDN、渐变、重阴影 |

## 14. 严格串行实施切片

原 Slice C 不再照旧实施，正式被以下切片吸收。每片独立 Issue、独立 Draft PR、独立公开浏览器回归和独立 Review；
只有前一片合并后才开始下一片，且不自动部署。

### V2-A：Shared IA / Content / Control Foundation

- **范围**：统一导航职责、项目五阶段标签、中文词典、控件层级、刷新作用域、通用状态与技术详情原语；仍采用 opt-in，
  未迁移页面不受共享 CSS/JS 意外影响。
- **allowlist 类别**：现有 shell/tokens/opt-in shared CSS/JS、必要页面标签、对应 browser tests、最小状态文档。
- **公开 seam**：同一 runtime/角色跨企业页导航；Entry/Login/legacy 边界；推荐动作数量；中文词典；1440/768/390；
  focus/reduced-motion；代表性未迁移页无视觉/DOM 回归。
- **API gate**：全局生产任务入口若无组织级真实索引则保持隐藏；不得在本片新增空页面或客户端聚合。
- **停止条件**：导航、词典和控件基础通过且未改变领域/API；停在 Draft PR，不顺带改 Production。

### V2-B：Production Task Flow

- **范围**：把 Production 首屏改为业务工单叙事，完整实现第 9 节动作矩阵与技术详情分层。
- **allowlist 类别**：Production HTML/CSS/JS、共享 opt-in 样式的必要增量、Production/Cloud Executor browser tests、状态文档。
- **公开 seam**：每个 order/package/verification/Work 条件的唯一推荐动作；激活前、运行中、terminal、失败、成功验收；
  1440/768/390；刷新与恢复。
- **API gate**：若现有 API 无法证明某门禁或组织级任务集合，停止并提交最小事实缺口，不由前端计算或扩 backend。
- **停止条件**：Production 页面与既有安全语义、Cloud Executor、人工路径回归全绿；不得开始 Works。

### V2-C：Works Review and Delivery

- **范围**：列表+预览层级、终态动作收敛、交付记录与显式追加交付、防重复提交、移动端列表/详情。
- **allowlist 类别**：Works HTML/CSS/JS、共享样式必要增量、Works browser/API compatibility tests、状态文档。
- **公开 seam**：深链与组织隔离、404 安全 fallback、检查/返工/可交付/已交付矩阵、下载真实响应合同、重复提交保护、
  1440/768/390。
- **API gate**：自动创建返工生产周期、复杂搜索或批量交付需要独立服务端合同；本片不得伪造。
- **停止条件**：终态只突出一个推荐动作且历史不丢失；不得开始 Assets。

### V2-D：Assets by Real Type

- **范围**：按真实 kind 分组、Asset/Version 层级、可用状态、受支持上传、系统作品视频只读呈现、错误恢复。
- **allowlist 类别**：Assets HTML/CSS/JS、共享样式必要增量、Assets browser/API compatibility tests、状态文档。
- **公开 seam**：三种真实 kind、上传类型门禁、active/available 与禁用状态、loading/error/empty、1440/768/390。
- **API gate**：用途、关联、缩略图、全局搜索/分页缺口先做独立 Product/API 决策；未知不显示为零。
- **停止条件**：只展示可证明事实且未改上传/资产领域语义；不得顺带扩 API。

### V2-E：必要的 Slice A/B 回补

- **触发条件**：前四片完成后的跨页审计证明 Projects/Project 或 Copy/Avatar/Plan 仍存在词典、导航、刷新或控件漂移。
- **范围**：只回补已验证差异；每个页面组独立 Issue/PR，不默认执行全站重构。
- **公开 seam**：既有 Slice A/B browser suites + 同 runtime 跨页一致性 + 1440/768/390。
- **API gate**：现有数据不足时记录缺口，不为一致性增加字段。
- **停止条件**：目标差异关闭即停，不把回补变成新功能波次。

## 15. 非目标与不可破坏合同

- 不修改领域状态、组织授权、Cookie/CSRF/CSP、数据库、Provider、Cloud Executor 或 Local Agent 合同。
- 不把生成成功、QC passed、preflight passed 写成人工批准。
- 不弱化 fail-closed、concurrency=1、激活前唯一 eligible/零 attempt、terminal 关 Worker、失败停批和无自动重试。
- 不删除 attempt、handoff、hash、深链、下载授权或审计历史；只改变默认信息层级。
- 不在前端创建全局队列、素材关联、返工周期、审批或生产终态。
- 不做框架重写、全站大爆炸、外部字体/CDN、新依赖、营销首页或纯视觉换肤。
- 不自动部署，不访问 Hifly，不启动 Worker，不写生产数据，不生成视频或消耗积分。

## 16. 合同 Acceptance Gate

本合同进入 `designed` 必须同时满足：

1. Issue #174 范围与四份文档 allowlist 一致；
2. 导航、页面职责、中文词典、控件语义、Production/Works/Assets 决策无互相冲突；
3. 所有外部输入都已转为 Adopt/Adapt/Reject 或 Inference/Adapt 的 Hifly 判断；
4. Production 时序合同逐项保留，Works 深链/授权与 Assets API 真值边界明确；
5. 严格串行切片包含 allowlist 类别、公开 seam、API gate 和停止条件；
6. CURRENT/ROADMAP 使用合并前后都准确的 lifecycle wording；
7. `npm run check`、链接/术语/stale wording、`git diff --check`、strict allowlist 和 fixed-head CI 全绿；
8. acceptance PR 合并进入 `main`。

合并只证明设计合同获批。任何实现、部署、真实 Hifly、客户采用或生产稳定性仍需各自独立证据。
