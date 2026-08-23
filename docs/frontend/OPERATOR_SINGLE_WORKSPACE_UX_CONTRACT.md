# 运营单任务工作区 UX 合同

> Lifecycle gate: Owner 已接受“方案 A：单任务工作区”方向；Issue #236 / 对应 PR 是 acceptance gate，本合同只有随该 PR 合并进入
> `main` 后才计为 `designed`。合并不等于实现、部署、客户采用或 Provider 验收。

## 1. 权威范围

本合同在不改变领域真值与生产安全合同的前提下，定义下一代企业运营工作台的页面组织、信息层级、交互语义和
实施顺序。它承接以下已合并合同与审计：

- [运营任务流 UX V1](./OPERATOR_TASK_FLOW_UX_V1.md)
- [运营工作台 UX V2](./OPERATOR_WORKBENCH_UX_V2_CONTRACT.md)
- [内部 UX 审计](./OPERATOR_UX_INTERNAL_AUDIT.md)
- [定向外部研究](./OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md)
- [单工作区 Product/API 门禁](./OPERATOR_SINGLE_WORKSPACE_PRODUCT_API_GATE.md)

Owner 评审过的移动工作流研究和 throwaway HTML 原型只是方向证据。它们不是生产实现、部署或验收证据，也不是
可直接合并的代码来源。本合同取代原型成为持久化实施依据。

## 2. 用户与任务原则

主要用户是反复处理商品内容和生产状态的企业运营人员；管理员额外维护成员、企业人物和素材。高频任务是继续当前
商品、处理一个明确阻断、保存或提交当前阶段。高代价错误包括丢失编辑、错商品提交、把自动检查当人工批准、错误
激活生产、重复交付和跨组织数据泄露。

因此工作区必须遵守：

1. 一个商品、一个稳定工作区、一个当前阶段、最多一个推荐动作。
2. 不把五阶段内容同时展开成长页面；已完成阶段只显示摘要，修改必须显式进入该阶段。
3. 首屏持续回答：当前项目/商品、当前阶段、业务状态、阻断、唯一下一步。
4. 业务中文是主层；内部 ID、原始状态码、Evidence、Worker、attempt、handoff 和 checksum 进入折叠技术详情。
5. 服务端真值未知或读取失败时显示未知/失败，不由前端推断成功、完成或可执行。
6. 页面结构变化不得改变组织授权、状态机、人工审核、幂等、乐观锁或生产 fail-closed 语义。

## 3. 信息架构与 URL

企业一级导航继续是：项目 / 作品库 / 素材中心 / 成员管理（admin）。组织级“生产任务”仍因缺少真实索引而隐藏，
不得由浏览器拼接队列或创建死链。显式 `/index.html` 继续作为 local/ops legacy fallback，不进入企业一级导航。

单工作区使用一个稳定入口：

```text
/workspace.html?project=<projectId>&product=<productId>&stage=<stageCode>
```

`stageCode` 固定为 `product_content`、`copy`、`avatar`、`video_plan`、`production`。需要恢复历史对象时继续使用已有
具名深链参数，如 `revision`、`copy`、`plan`、`orderId`；禁止使用含义不明的通用 `object` 参数。

旧 `/project.html`、`/copy.html`、`/avatar.html`、`/plan.html`、`/production.html` 在对应阶段完成等价迁移前保持可用。
任何 redirect 或入口切换必须在该阶段的深链、返回、dirty、409、刷新与浏览器矩阵通过后另行接受。

## 4. 稳定工作区骨架

### 4.1 1440

- 左栏：当前项目内商品列表；显示商品名、当前阶段和需要处理状态，不显示技术 ID。
- 中栏：唯一当前任务面；包含对象、状态、阻断、主内容和当前阶段命令。
- 右栏：只放有助当前决定的素材预览、上游摘要、审核历史或技术详情，不与主任务争夺动作。
- 底部操作区：持续可见；最多一个实心品牌主动作，次级、危险与禁用动作语义分离。

### 4.2 768

商品列表与当前任务形成两栏；辅助上下文进入当前任务下方或可关闭抽屉。不得保留三个狭窄并列栏，也不得让底部
操作遮挡表单、错误或键盘焦点。

### 4.3 390

一次只显示商品列表或任务详情。进入商品后显示紧凑阶段入口、当前任务和底部主操作；返回恢复对应商品列表项焦点与
滚动上下文。人物目录和其他列表/详情交互同样采用“列表 -> 详情 -> 返回”，不把两层内容纵向堆叠。

三个视口均不得出现页面级横向滚动；长中文名、状态、阻断和按钮必须换行或截断并可访问完整内容。

### 4.4 后续作品库密度合同

作品库继续是企业一级导航中的独立业务页面，不塞入商品五阶段工作区。后续 Works Goal 必须保留桌面可扫描列表与明确
详情上下文：对 Owner 已评审的 9 项原型数据，1440 首屏分页固定为第 1 页 6 项、第 2 页 3 项；分页、总数和筛选必须
来自服务端可观察真值或既有分页合同，不得由前端伪造生产集合。390 继续使用作品列表 -> 详情 -> 返回，进入详情和返回
时分别转移、恢复焦点。该密度结论是后续 Works Goal 的验收输入，不表示 Stage 0 已实现作品库分页。

## 5. 五阶段状态映射

| 阶段 | 主对象 | 业务状态来源 | 首屏阻断 | 唯一推荐动作 | 技术详情 |
|---|---|---|---|---|---|
| 商品资料 | current ProductRevision | draft / Ready / history | 必填商品名、确认卖点、可引用商品图、冲突或历史只读 | 保存、解决阻断、进入文案或回到当前版本之一 | revision ID、row version、素材版本 ID |
| 文案 | exact CopyVersion | 生成、自动质检、人工审核分别投影 | 未保存、provider 失败、QC 未通过、人工未批准、上游失效 | 保存、开始质检、提交人工审核或进入人物之一 | job、QualityResult、review、CopyVersion ID |
| 人物 | exact AvatarSelection + catalog entry | 人物选择、授权、素材与能力依据分别投影 | approved copy 缺失、人物素材不可用、授权/能力/组织范围失效 | 选择、确认或进入视频方案之一 | selection/version ID、Evidence、原始状态码 |
| 视频方案 | exact frozen VideoPlan | preflight 与人工批准分别投影 | copy/avatar 上游失效、未保存、preflight 阻断、人工未批准 | 保存、运行预检、提交审核或进入生产之一 | plan/version、preflight、review、size code |
| 生产 | selected ProductionOrder | order/package/execution/A12/Work/delivery 持久真值 | 激活门禁、读取失败、需处理、失败或验收未完成 | 仅使用 V2 状态矩阵允许的一个安全动作 | eligible、attempt、Worker、handoff、hash、审计时间线 |

`QC passed` 不等于人工审核通过；`preflight passed/warning` 不等于方案批准。阶段入口可访问也不等于已完成。阶段导航
必须显式区分 completed、current、available、blocked；读取失败时以独立 `read_status=error` 呈现中性错误，不能伪造
四态之一。

## 6. 控件与操作语义

- 导航用链接；改变当前面板的阶段入口使用 Tab/链接语义并保持 URL；服务端写入使用按钮。
- 商品、版本和人物选择使用明确选择器或列表；选择本身不自动提交。
- 创建、批准、拒绝、交付和其他有后果的命令使用 Dialog，进入后聚焦标题/首个字段，关闭后恢复触发控件。
- 同一业务状态最多一个 `data-recommended-action=true`。刷新只恢复标注的作用域，不得覆盖 dirty 输入或其他阶段状态。
- 危险动作与主动作不竞争；禁用控件必须有业务原因，不能只改变颜色或移除点击处理。
- 技术详情使用原生 `details/summary`；折叠只改变信息层级，不删除审计值。

## 7. 通用状态与恢复

| 状态 | 页面行为 |
|---|---|
| loading | 保留骨架尺寸；不展示可执行主动作 |
| empty | 说明当前对象为空及唯一可行起点 |
| error | 清除 loading；显示错误作用域和一个安全重试/返回动作 |
| no_permission | 不泄露对象存在性；返回企业 Projects 或上一级可见对象 |
| dirty | 商品/阶段切换、刷新、历史载入和离开前显式保护 |
| saving / saved | 保存中禁重复提交；已保存反馈不覆盖后续业务状态 |
| conflict | 409 保留输入；载入服务端最新真值后由用户决定重提，不静默覆盖 |
| history | 非 current 对象只读；显示回到 current，不提供写动作 |
| async | 轮询只跟踪当前权威对象；终态停止；读取失败可恢复且不使用 stale 值 |
| terminal | 收敛为查看、检查、返工、交付记录或返回上游；禁止隐式重跑 |

浏览器 Back/Forward 和刷新必须恢复项目、商品、阶段和具名对象。恢复失败时保留可理解的请求上下文，并提供返回项目或
重试当前作用域；不得回落到另一个商品后继续打开原商品的写 Dialog。

## 8. 人物真实预览合同

人物目录必须显示组织内真实 `avatar_image` 缩略图；选中后可查看同一受控版本的大图。只有人物目录条目与当前组织
可见、绑定素材 Asset 为 `active`、AssetVersion 为 `available`，且短时预览授权成功时，才显示真实图片。

- 缩略图和大图必须来自同一受控版本与短时授权，不得使用虚构头像、远程 Provider URL 或按人物名拼图。
- 首字 fallback 仅用于未登记受控图片、素材不可用、授权失败或图片解码失败，并显示自然中文原因。
- 图片使用业务名称作为替代文本；完整素材版本 ID、checksum 和授权时间只放技术详情。
- 390 使用人物列表 -> 人物详情 -> 返回；进入详情后焦点到详情标题，返回恢复对应人物项。
- 预览失败只允许“重试人物图片”或继续以解释过的占位查看；不得阻断审计信息，也不得把图片失败误写为人物授权失效。

具体接口、安全与错误合同见 [Product/API 门禁](./OPERATOR_SINGLE_WORKSPACE_PRODUCT_API_GATE.md)。

## 9. Production 不可破坏时序

单工作区只能重新组织现有 Production 真值，不能增加 Worker 启停或放宽门禁：

1. 每轮激活前 Worker off；只为当前 SKU 创建一个 order 和 ready handoff。
2. 全组织 eligible 必须严格等于 `[currentOrderId]`，当前 order `attempts=[]`，active attempts=0，之后才由获授权运维在
   既有部署控制面启用 Worker。
3. claimed/running 只显示运行状态；terminal 后立即关闭 Worker并保留 attempt 历史。
4. failed/requires_action 必须停批，不创建下一单，不自动重试、重新领取或再次生产。
5. succeeded 后只有 A12 passed、Work 已登记可用且鉴权下载返回真实 bytes，才可在 Worker off 下准备下一单。
6. 企业 Web 不提供 Worker 命令；组织级 eligible/active-attempt 无可信投影时继续阻断，不能由浏览器推断。

Production 的迁移必须是独立高风险切片；既有 V2 Production/Works 浏览器和 API 回归必须全部保留。

## 10. 可访问性与动效

- 每页只有一个 `main`，标题层级连续，表单有可见 label，状态使用恰当的 `role=status`/`alert` 与 `aria-live`。
- 阶段控件、列表/详情、Dialog、折叠详情和底部操作可完全键盘操作；可见焦点不被 sticky 区域遮挡。
- 390 列表进入详情后转移焦点，返回恢复来源项；刷新后不得把焦点丢到 `body`。
- `prefers-reduced-motion: reduce` 下取消非必要过渡；任何动画不承担状态真值。

## 11. 公开浏览器验收

每个 Goal 都必须用真实 Chrome、同一 full-feature runtime 与同一角色验证以下共同回归：

- 1440x900、768x900、390x844 均无页面级横向滚动；可见焦点、Dialog 焦点恢复与 reduced-motion 保持；
- `/`、登录/改密/会话恢复、Projects、当前已迁移 workspace 深链和显式 `/index.html` 边界；
- project/product/current stage、刷新、Back/Forward，以及当前 Goal 涉及的 loading/empty/error/no_permission/dirty/saving/
  conflict/history/async/terminal；
- 当前面板 `data-recommended-action` 最多一个；未知、错阶段或不受支持的 action code 不显示、不执行；
- 尚未迁移的阶段保持中性导航到既有页面，既有 URL、DOM/ARIA、业务状态和写命令无回归；不得在新 workspace 伪造其
  阶段状态、阻断、对象或推荐动作。

阶段专项验收只在对应 Goal 到达后启用：

| Goal | 新增专项浏览器验收 |
|---|---|
| Stage 1 商品资料 | 商品切换、current/history、dirty、保存、409、素材阻断；四个未迁移阶段的 workspace 深链安全回到既有页 |
| Stage 2 文案 | 保存/派生、QC 与人工审核分离、上游失效、Tab/刷新/冲突恢复 |
| Stage 3 人物 | 真实缩略图/大图、授权失败 fallback、选择/授权、390 列表/详情/返回与焦点恢复 |
| Stage 4 视频方案 | 保存、preflight 与人工批准分离、上游失效、Tab/历史/冲突恢复 |
| Stage 5 生产 | 激活前、运行中、失败/需处理、取消、A12、四种 Work/交付状态与读取失败 |
| Post-stage 作品库 | 四种 Work 状态、深链、分页、详情/返回、交付冲突与下载真值 |
| Post-stage 素材中心与移动收口 | Assets 三类与权限/冲突、全链路 768/390、旧 URL 和恢复回归 |

截图只写入 Git 忽略的临时目录，文件名与 PNG 像素头必须一致；截图不是部署或 Provider 证据。

## 12. 严格串行 Stage Goals

| Goal | 最小范围类别 | 公共 seam | 停止条件 |
|---|---|---|---|
| Stage 1 商品资料 | shared opt-in workspace foundation、Stage 1 所需最小只读投影、商品资料 panel/routing、browser/API tests | 新 URL、project/product/current revision、商品列表、五阶段导航、current/history、dirty/409、三视口；未迁移阶段稳定回旧页 | 只读投影需要新领域状态、写聚合、组织级队列，或无法保持旧深链/角色导航时停止 |
| Stage 2 文案 | 文案 panel/routing、既有 Copy API、browser tests | 保存/派生、QC 与人工审核分离、冲突/上游失效、Back/Forward 与刷新恢复 | 需要改变 CopyVersion、QC 或人工审核语义时停止 |
| Stage 3 人物 | 人物 panel/routing、人物专用预览授权、底层 Asset 授权复用、browser/API tests | 同组织真实缩略图/大图、选择/授权、fallback、390 列表详情、过期/失败恢复 | 无法原子验证目录绑定、`avatar_image`、父 Asset `active` 与版本 `available` 时停止 |
| Stage 4 视频方案 | 视频方案 panel/routing、既有 Plan API、browser tests | 保存、preflight/人工批准分离、上游失效、历史/冲突/恢复 | workspace API 缺少业务真值或需要改变 VideoPlan 状态机时停止 |
| Stage 5 生产 | Production panel/routing、既有 API、完整安全回归 | 激活前/运行/terminal/A12/Work/交付及读取失败 | 任何 Worker 命令、门禁弱化、自动重试/下一单或前端推断时停止 |
| Post-stage 作品库 | Works 列表/详情/分页、既有 Works API、browser tests | 1440 的 9 项 fixture 为 6+3 分页，768 非双窄栏，390 列表/详情/返回，四种 Work 状态 | 服务端无法提供分页/总数/深链真值或需要前端伪造集合时停止 |
| Post-stage 素材中心与移动收口 | Assets 业务页、workspace/entry/legacy compatibility、跨页 browser tests | Assets 三类真值、390/768 收敛、focus/Back/Refresh/错误恢复、旧 URL 兼容 | 任一旧深链、未迁移页、素材权限或生产合同回归时停止 |

每个 Goal 都使用独立 Issue、Draft PR、RED -> GREEN、真实浏览器回归和 fixed-head CI。只有前一 Goal 经独立 Review
并合并后才开始下一 Goal；任何 Goal 均不自动部署。Stage 1 只建立商品资料所需的最小共享壳层和只读投影，后续阶段
按需 additive 扩展，不得先横向实现全部阶段。Stage 3 必须完成 Owner 已确认的人物真实预览门禁，Stage 5 Production
保持独立高风险 Review。作品库及素材中心/移动收口只能在五阶段完成后按表中顺序另行开始。

## 13. 非目标

- 不创建超长单页，不一次重写五阶段，不引入框架、外部字体、图片 CDN 或新视觉依赖。
- 不改变 Copy/QC/review、Avatar authorization、VideoPlan、ProductionOrder、attempt、A12、Work 或 delivery 领域合同。
- 不创建组织级生产任务队列，不把 Works/Assets/Members 塞入商品工作区。
- 不把原型、假数据浏览器或截图写成部署、Provider、生产数据或客户验收。
- 不自动部署，不访问 Hifly，不启动 Worker/Local Agent，不生成视频或消耗积分。
