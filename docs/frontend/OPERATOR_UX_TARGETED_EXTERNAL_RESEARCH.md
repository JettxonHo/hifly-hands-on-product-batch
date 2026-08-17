# 运营工作台定向外部研究

> 状态：Issue #172 的研究输入；不是最终 IA、视觉方案、实现合同或部署证据
> 基线：`origin/main@62df1d5ebe4a8f073139454a92a1591d0e411099`
> 访问日期：2026-08-17

## 1. 研究目的与边界

本研究只回答 `OPERATOR_UX_INTERNAL_AUDIT.md` 已确认的 P1/P2 问题。案例选择从本项目的运营角色、任务频率、
错误成本、权限审计和生产安全门禁出发，不以竞品页面或视觉风格反向决定本项目的信息架构。

本轮不输出最终导航、页面线框、组件方案或代码任务。所有结论分为：

- **Adopt**：原则可直接进入后续设计合同，但仍需用本项目数据与业务语言实现。
- **Adapt**：模式有用，但必须按现有 API、领域状态、组织授权或串行生产门禁改造。
- **Reject**：与本项目阶段、错误成本或安全合同冲突，明确不采用。

不可破坏的前提：

1. `QC passed` 不等于人工批准；`preflight passed/warning` 不等于方案批准。
2. Production 每轮激活前 Worker 关闭，只有当前工单 eligible，当前工单零 attempt 且 active attempts 为零；
   terminal 后立即关闭 Worker并保留历史。失败或 `requires_action` 停止，不自动重试，也不创建下一条。
3. Production 成功后必须完成 A12 passed、Work available 与鉴权真实字节下载，才允许在 Worker 关闭时准备下一条。
4. Works 保留深链与组织授权；技术证据、attempt、hash 和审计历史可以折叠，但不能删除或由前端伪造。
5. Assets 只能展示现有 API 能证明的类型、状态、用途和关联；缺失数据要成为设计/接口决策，不能由 UI 猜测。

## 2. 案例为什么被选择

| 案例 | 本项目具体问题 | 选择理由 |
| --- | --- | --- |
| Shopify Admin | Projects/Works/Assets 的列表、详情、搜索筛选、批量动作与响应式 | 官方模式明确区分首页、资源索引、详情和设置，并给出搜索、筛选、排序、批量动作及响应式布局的出现条件 |
| Jira Cloud / Atlassian Design System | 一级导航与项目内阶段导航、状态语义、权限约束下的批量操作 | 官方资料明确区分全局、侧栏、项目导航和主工作区；批量操作具有权限、同工作流、上限与最终确认约束 |
| Adobe Workfront + Frame.io | 全局待办、审核任务、视频版本、评论、批准/返工和交付终态 | Workfront 聚合分配给个人的工作与批准；Frame.io 把媒体、版本、评论和审批决定放在同一审核上下文 |
| 飞书项目 | 中文企业工作台的待办聚合、筛选分组、权限与自然业务语言 | 官方中文资料展示“我的待办/待我处理/我关注”、按角色聚合和权限控制的快捷操作，能校准中文表达而非翻译英文术语 |

没有选取更多产品：四组案例已经覆盖本轮七个研究问题。继续扩充会变成趋势报告，不能增加设计合同的决策质量。

## 3. 一手来源清单

所有来源均为产品官方文档、官方帮助中心或官方设计系统，访问日期均为 2026-08-17。

### 3.1 Shopify Admin

- [App Home patterns](https://shopify.dev/docs/api/app-home/patterns)：首页、索引、详情与设置的页面职责。
- [Index table](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table)：列表搜索、筛选、排序、分页和选择后批量动作。
- [Layout](https://shopify.dev/docs/apps/design/layout)：布局应适配不同屏幕，使用响应式网格和 aside。
- [Homepage](https://shopify.dev/docs/api/app-home/patterns/templates/homepage)：入口呈现关键状态、待处理事项和清晰动作。

### 3.2 Jira Cloud / Atlassian

- [Overview of Jira navigation](https://www.atlassian.com/software/jira/guides/navigation/overview)：全局 top bar、跨项目 sidebar、项目导航和主内容区的职责分工。
- [Edit multiple work items at the same time](https://support.atlassian.com/jira-software-cloud/docs/edit-multiple-issues-at-the-same-time/)：批量操作的权限、数量、工作流限制及最终确认。
- [Edit individual and multiple work items](https://support.atlassian.com/jira-software-cloud/docs/edit-individual-and-multiple-work-items/)：稳定列表 + 详情预览、单项动作和选择后批量动作。
- [Lozenge](https://atlassian.design/components/lozenge)：状态标签用于影响用户理解、优先级或行动的有意义属性。

### 3.3 Adobe Workfront / Frame.io

- [Display items in the Worklist in the Home area](https://experienceleague.adobe.com/en/docs/workfront/using/basics/home/use-home-area/display-items-in-home-work-list)：按分配、状态和权限聚合个人工作，支持筛选、分组和列配置。
- [Approval process overview](https://experienceleague.adobe.com/en/docs/workfront/using/review-and-approve-work/work-approvals/approval-process-in-workfront)：项目、任务、问题、文档和 proof 的明确审批过程。
- [Transitioning from Workfront Proof to the Frame.io Viewer](https://help.frame.io/en/articles/14543173-transitioning-from-workfront-proof-to-the-frame-io-viewer)：视频版本比较、分阶段审批与 `Approve / Needs Work` 决定。
- [Comments Panel Overview](https://help.frame.io/en/articles/9105278-comments-panel-overview)：帧级评论、完成标记、筛选和评论深链。

### 3.4 飞书项目

- [飞书项目工作台](https://www.feishu.cn/content/3c6y1qwl)：我的待办、待我处理、关注、权限控制的快捷流转与操作记录。
- [飞书项目的任务管理](https://www.feishu.cn/content/40gyakm8)：列表/看板/甘特视图、筛选分组排序和父级信息关联。
- [飞书项目全局搜索功能](https://www.feishu.cn/content/4uteveck)：跨空间搜索、按对象类型分组、权限可见范围和高级筛选。
- [飞书项目导航栏介绍](https://www.feishu.cn/content/1zwvmup9)：工作台作为处理与查看本人跟进事务的入口。

## 4. 逐问题证据矩阵

| 本项目问题 | 外部证据 | Adopt / Adapt / Reject | 对本项目的适用边界 | 设计合同必须决定 |
| --- | --- | --- | --- | --- |
| 一级导航与项目阶段导航如何分工 | Jira 将全局工具、跨项目入口、项目内视图和主工作区分层；Shopify 区分入口、索引和详情 | **Adopt** 分层原则；**Reject** 照搬具体导航项 | 一级导航只放跨项目稳定对象；项目内阶段只服务当前项目/商品流程 | 全局是否新增“生产任务”；项目阶段导航在 390px 的呈现；入口与 legacy 边界 |
| 待办/生产任务如何聚合而不暴露基础设施术语 | Workfront 仅把分配给当前用户且符合状态/权限的任务与审批放入 Worklist；飞书使用“我的待办/待我处理” | **Adapt** 为“生产任务”业务队列 | 不能把 Cloud Executor、Worker 或 attempt 作为一级叙事；列表资格必须来自服务端真值 | 队列的最小字段、状态分组、默认筛选、技术详情入口及无权限/空态 |
| 终态如何收敛动作并避免重复交付或危险重试 | Frame.io 将审核决定收敛为批准或需修改，并保留版本和评论；Workfront 把审批当独立过程 | **Adapt** 审核上下文；**Reject** 通用的一键再次执行 | Works 的检查、返工和交付不是同义动作；已交付不能继续突出“再次交付” | 每种终态唯一推荐动作、返工新对象/新版本关系、重复交付的确认与审计 |
| 搜索、筛选、批量动作何时出现 | Shopify 在同类资源集合中提供搜索/筛选/排序，选择后才出现批量动作；Jira 要求权限、同工作流约束、上限和最终确认 | **Adopt** 渐进出现；**Reject** 默认常驻批量生产 | 搜索要等数量/查找成本成立；批量动作只能用于同状态、同权限、可逆或可预览操作 | 数量阈值、允许批量的对象/动作、跨状态禁用原因、确认和结果报告 |
| 素材如何按类型、用途和关联组织 | Shopify 资源索引/详情保持对象类型一致；Frame.io 把媒体、版本、评论放在资产上下文 | **Adapt** 对象+版本+关联层级 | 当前 API 缺少部分类型/用途/关联时必须显示“未提供/待核对”，不能前端推断 | Asset 与 Version 的主次、图片/视频/人物分组、用途/项目/商品关联所需真实字段 |
| 中文状态、技术详情、错误恢复与权限审计如何表达 | 飞书以“待我处理/我关注/操作记录”等任务语言组织；快捷动作仍受权限约束；Atlassian lozenge 只承载会影响行动的状态 | **Adopt** 业务语言和权限可见性；**Adapt** 技术详情折叠 | `QC`、`HumanReview`、`attempt` 等仍需审计保留，但默认不要求运营理解 | 中文术语表、错误/阻断/权限的分层、技术详情内容和展开时机 |
| 390px 如何保留对象、状态、阻断与下一步 | Shopify 响应式布局改变列结构；Frame.io 将媒体和反馈保持在同一审核上下文，而不是把所有桌面模块顺序堆叠 | **Adopt** 任务优先重排；**Reject** 单纯桌面单列化 | 首屏必须保留当前对象、业务状态、首要阻断和唯一动作；筛选/技术证据可进抽屉或折叠 | 各页移动首屏信息预算、列表/详情切换、sticky 动作边界和返回上下文 |

## 5. 按内部 P1/P2 映射的取舍

### 5.1 信息架构

- **P1：全局导航与项目阶段导航职责不清，缺少全局生产任务入口。**
  - Adopt：Jira 的“跨项目稳定入口”与“项目内视图”职责分离。
  - Adapt：Workfront/飞书的个人工作聚合为“生产任务”，但资格、权限和状态完全由本项目服务端决定。
  - Reject：复制 Jira 的全部对象或让用户自定义核心生产导航；当前产品规模不足，且会隐藏安全门禁。
- **P1：Production 技术状态抢占业务叙事。**
  - Adopt：工作入口先回答谁的任务、处于什么状态、下一步是什么。
  - Adapt：Worker、eligible、attempt、handoff 等放入可展开技术详情，并在安全阻断时提升可见性。
  - Reject：把基础设施健康卡片继续作为运营页第一主区，或用前端推断“可执行”。

### 5.2 操作层级与控件语义

- **P1：Works 已交付终态仍有多个竞争动作。**
  - Adapt：参考 Frame.io 的批准/需修改二元审核决定，分别映射到本项目已有检查、返工和交付状态。
  - Reject：把“再次交付”或“重新生产”当通用终态主操作；任何生产重试仍受单工单授权和安全时序约束。
- **P2：搜索、筛选和批量能力缺少出现条件。**
  - Adopt：有同类集合和查找成本时出现搜索/筛选；批量工具只在选择后出现。
  - Adapt：只允许权限一致、状态兼容、结果可预览且不触发生产重试的批量操作。
  - Reject：因“企业工作台通常有批量”就加入批量出片、跨状态批准或批量删除。

### 5.3 中文内容、状态与权限审计

- **P1：`Ready`、`QC`、`HumanReview`、`Cloud Executor`、`attempt` 等技术词混入业务首屏。**
  - Adopt：参考飞书的“待我处理/需核对/已完成”等动宾业务语言。
  - Adapt：状态标签只承载会影响理解或行动的业务状态；技术名、ID、hash 和 attempt 放入详情。
  - Reject：删除审计证据，或把技术状态翻译成看似业务终态从而混淆自动检查与人工批准。
- **P1/P2：错误、权限不足和加载状态可能与内容同时出现。**
  - Adopt：Worklist 资格与快捷动作服从权限；错误恢复应给当前用户一个可执行下一步。
  - Reject：无权限时泄露对象存在性、加载失败后继续显示陈旧“可执行”、或用 toast 代替持久阻断。

### 5.4 响应式与素材

- **P1：390px 仅纵向堆叠，当前对象和下一步被推离首屏。**
  - Adopt：按任务优先级改变布局，不保持桌面模块的完整顺序。
  - Adapt：主列表和详情在窄屏切换；技术证据、历史和筛选进入抽屉/折叠，但保留可达性与返回上下文。
- **P1：Assets 仍以“商品图片”叙事混合多种产物，缺类型/用途/关联。**
  - Adapt：参考资源索引和媒体版本上下文，先用 API 已知字段分层。
  - Reject：根据文件扩展名、缩略图或页面来源猜用途；没有真实字段时不得伪造“人物/商品/成片”关联。

## 6. 明确拒绝的外部模式

1. **可配置卡片式首页作为当前优先项。** Workfront/飞书支持高度自定义工作台，但本项目首先要建立稳定的生产任务
   真值与唯一下一步；过早自定义会把 IA 问题转嫁给运营。
2. **默认展示高级搜索和复杂筛选器。** 当前数量与查询 API 尚未证明需要 Jira/飞书级复杂度，应先定义触发阈值。
3. **把批量操作等同于效率。** 任何批量批准、批量出片、自动重试都可能破坏人工批准和严格串行门禁。
4. **复制竞品状态颜色或视觉语言。** 本轮吸收的是任务组织和行为约束，不是品牌、布局像素或组件外观。
5. **移动端完整复刻桌面。** 390px 应保留任务上下文并渐进披露，不是把所有面板简单排成一列。
6. **用前端便利覆盖服务端真值。** 外部产品具备的搜索、素材元数据或批量接口，不代表本仓库已有相同能力。

## 7. 后续设计合同的输入与 acceptance gates

后续独立设计合同至少要作出以下可验收决定：

1. 定义一级导航、项目阶段导航、全局“生产任务”入口和 legacy `/index.html` 的完整职责表。
2. 定义 Production/Works/Assets 各关键服务端状态下的对象、阻断、唯一推荐动作、次级动作和技术详情。
3. 固化 Production 串行时序在 UI 中的展示与操作门禁，禁止把“Worker 开启”设计成普通运营快捷动作。
4. 定义 Works 的列表+预览结构、深链恢复、检查/返工/交付终态动作和重复交付防护。
5. 定义 Assets 只基于现有 API 的信息层级，并列出任何新增类型/用途/关联字段的独立接口决策，不在 UI 中伪造。
6. 制定中文业务术语表，逐一映射内部状态；明确默认文案、技术详情文案和权限/错误恢复文案。
7. 为 1440/768/390 定义首屏信息预算和列表/详情/抽屉行为，验收无横向滚动、焦点、reduced-motion 和深链。
8. 给搜索、筛选和批量动作设定量级、权限、状态兼容、可逆性、确认和结果报告门槛。
9. 用公开 browser seam 验证加载、空态、错误、权限、异步、冲突、历史、终态和恢复；不能只验正常截图。

### 原 Slice C 的处理

本研究不批准原 Slice C 直接开工。后续设计合同通过 acceptance gate 后，必须明确决定 Production/Works/Assets：

- 在保留业务范围的前提下 **rebase** 到新的 IA 与内容合同；或
- 被拆分并 **吸收** 到新的 Taste 严格串行实施切片。

Owner 已确定优先把这三页作为后续 Taste 实施候选，但具体切片、allowlist、API 缺口和验收仍属于下一阶段。
在合同通过前，不开始代码、全局重构或视觉换肤。

## 8. 研究结论

四组案例共同支持三个方向：跨项目入口与项目内阶段必须分工；高频运营入口应聚合“现在需要我处理什么”；列表、
详情、终态动作和移动布局应围绕对象与下一步渐进披露。它们同样给出限制：批量能力必须晚于权限和状态合同，
媒体审阅模式必须适配本项目的独立 A12/Work/交付状态，素材分类不能超越 API 真值。

因此，本研究只为下一份设计合同提供有证据的选择空间，不构成最终 IA、页面方案、实现授权、部署或客户验收。
