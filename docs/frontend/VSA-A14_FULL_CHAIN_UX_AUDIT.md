# VSA-A14 全链路 UX 审计与实施交接

> 任务：VSA-A14 Full-Chain UX Audit（Issue #70，https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/70）
> 角色：UI/UX Designer（设计/审计阶段，只产出本文档）
> 基线：`origin/main` = `eacc317b9437072b5f8d70c2bd9216a76627f9af`（VSA-A13 PR #91 与 A04～A13 收尾 PR #92 已合并）
> 工作分支：`codex/vsa-a14-ux-audit`；本阶段唯一写入文件：本文档
> 日期：2026-08-09
> 上游权威：D-027（LOW_FIDELITY_PAGE_STRUCTURE）、D-028（DOMAIN_MODEL_AND_STATE_MACHINES）、D-029（MANUAL_HANDOFF_PACKAGE_CONTRACT）、D-030（VERTICAL_SLICE_A_DELIVERY_PLAN）、KIMI_K3_STAGE0_VISUAL_AUDIT（设计系统）、VSA-A04-A06 / A07-A08 / A09-A10 / A11-A13 四份 UIUX 设计文档

---

## 0. 审计方法与事实核验口径

本审计区分两级事实：

- **【事实】**：在本 worktree 中直接阅读或检索 `web/`、`src/`、`test/` 源码核实（含行号/选择器/测试名）。所有缺陷条目均经二次核验。
- **【推断】**：基于产品合同与既有设计文档的设计判断，需实现阶段确认。

已通读的权威来源：`AGENTS.md`、`GOAL.md`、`docs/status/CURRENT.md`、`docs/PROJECT_HANDOFF.md`（VSA 段）、D-030 交付计划、SAAS 蓝图、USER_FLOWS、LOW_FIDELITY_PAGE_STRUCTURE、DOMAIN_MODEL_AND_STATE_MACHINES、MANUAL_HANDOFF_PACKAGE_CONTRACT、KIMI_K3_STAGE0_VISUAL_AUDIT、四份 VSA UIUX 设计文档、`docs/status/sessions/` 近期会话、`web/` 全部 38 个文件、`test/` 全部 103 个测试文件的清单与关键断言、Issue #70 正文（已通过 `gh` 实读，与本任务引用一致）。

全局架构事实（后续各节引用）：

- **无 SPA 路由**：`src/server/app.js:694-701` 以 `@fastify/static` 托管 `web/`，每个页面是独立 HTML 文档（`/login.html`、`/projects.html`、`/project.html`、`/assets.html`、`/copy.html`、`/avatar.html`、`/plan.html`、`/production.html`、`/works.html`、`/members.html`，`/` 为遗留 `index.html`）。
- **Feature flag 链**（`src/server/app.js:292-322`）：`assetsEnabled` → `projectContentEnabled` → `copyGenerationEnabled` → `copyQualityEnabled` → `copyReviewEnabled` / `avatarSelectionEnabled` → `videoPlanningEnabled` → `productionOrdersEnabled` → `manualHandoffEnabled` → `manualExecutionEnabled` → `artifactVerificationEnabled` → `worksEnabled`；`buildApp` 强制依赖链。
- **两套前端体系并存**：遗留工作台（`index.html` + `styles.css` + `app.js` + `api.js` + `auth-gate.js`，青色体系）与企业壳层页面（`tokens.css` + `base.css` + `shell.css` + `shell.js`，每页内联重复壳层标记）。企业页各自内联 `request()`/`csrf()` helper，统一 `x-identity-csrf` 头、`credentials: "same-origin"`、401/403 → `/login.html`。
- **角色模型**（服务端，粗粒度 member/admin，A06 已记录为已知边界）：文案审核决定（approve/request-changes/revoke）仅 admin（`src/copy-review/copy-review-service.js:17-18,141,198`，`COPY_REVIEW_FORBIDDEN`）；提交文案审核 member 可。方案审核 member+admin 均可（`src/video-planning/video-planning-service.js:10`）。生产工单创建 member+admin（`production-order-service.js:19`）。人工执行：领取 member/admin，**确认开始仅领取者本人**，上传/提交报告允许领取者或 admin 监督操作（`manual-execution-service.js:154-156`）。核验发起 member+admin（`work-verification-service.js:24`）。作品检查/交付登记 member+admin（`work-delivery-service.js:14`）。人物确认 member+admin（`avatar-selection-service.js:8`）。素材上传任意成员；成员管理仅 admin。
- **上下文传递合同**：全部经 URL query + `history.replaceState`，不使用 localStorage：`project.html?id=` → `copy.html?project=&revision=` → `avatar.html?project=&product=&copy=` → `plan.html?project=&product=&plan=` → `production.html?project=&product=&orderId=` → `works.html?work=&project=&product=`。
- **异步轮询事实**：copy 页生成/质检/改写 1s 轮询；plan 页预检 800ms；production 页交接包 2.5s、核验 2s（读取失败 3s 强制轮询恢复）；**assets 与 works 无轮询**。
- **AuditEvent 不在任何 UI 表面展示**（Phase 1 设计如此；A14 以服务端测试核对，不建查看器，见 §3.5）。

---

## 1. 执行摘要：整体 UX 评估

### 1.1 总体判断

A01～A13 链条**在逐阶段内部是连贯的**：每个页面都有唯一主操作、服务端权威状态、禁用原因、刷新恢复和 390px 降级，且各切片浏览器测试已在真实系统 Chrome 中验证过本页合同。四份 UI/UX 设计文档定义的跨页机制（面包屑、五阶段条、商品上下文条、URL 参数接力、禁用门禁列表）在实现中真实存在。

链条**在缝合处存在缺口**：新企业操作员登录后落在遗留本地批量工作台而非企业链路；商品页上下文不进 URL 导致跨页返回丢失选中商品；商品快照页的乐观并发冲突文案被一个真实代码缺陷覆盖为错误文案；素材核验是全链路唯一不自动刷新的异步表面。这些正是 A14 应当消化的集成缺口。

**对新企业操作员的可走通性结论**：以当前 `origin/main`，一位全新操作员在有人口头指引「从项目入口开始」的前提下可以走完整链；但以「登录后自助发现路径」为标准，当前不达标——着陆页是遗留运维页面，这是全链路第一优先级缺口。

### 1.2 Top 10 UX 集成缺口（按优先级排序）

| # | 级别 | 缺口 | 证据 | 性质 |
|---|---|---|---|---|
| G1 | **P0** | 登录/改密/会话恢复后一律落在 `/` 遗留批量工作台（青色体系、批次/抓包概念、真实执行按钮），企业链路入口只靠 `auth-gate.js` 追加到 `.status-strip` 的小 pill（且只有项目/素材中心/成员管理，无作品库/生产） | `web/login.js:66,69,83`（`location.assign("/")` / `replace("/")`）；`web/auth-gate.js:20-56`；`index.html` 无壳层导航 | 【事实】 |
| G2 | **P0** | 全链路端到端自动测试缺位：现有 13 个 browser 测试各管一页，没有任何测试跨越 copy→avatar→plan→production→works 的页面接力、上下文参数与导航顺序 | `test/` 清单（§11）；Issue #70 核心交付 | 【事实】 |
| G3 | **P1** | 商品快照 409 乐观并发冲突的提示文案被代码缺陷覆盖：`project.js:15` 的 `else` 无大括号，`notice.textContent = "保存失败，请稍后重试。"` 对 409 分支同样执行，Stage 0 合同文案「页面内容已过期，请刷新后继续。」永不显示，用户被误导去重试而非刷新 | `web/project.js:15`（直接阅读核实） | 【事实·代码缺陷】 |
| G4 | **P1** | 商品页选中商品不进 URL：`project.js:2` 只读 `id` 参数，刷新/深链后总是回到第一个商品；`copy.js:90` 的「查看商品事实」回链 `#productFactsLink` 只带 `?id=`，从商品 B 的文案页返回商品页会落到商品 A | `web/project.js:2,12`；`web/copy.js:90`（直接阅读核实） | 【事实】 |
| G5 | **P1** | 非 admin 访问 `/members.html` 被 `location.replace("/")` 弹到遗留工作台，而不是企业页或就地 forbidden 说明；与「forbidden 用业务语言表达」合同不符 | `web/members.js`（非 admin 重定向 `/`） | 【事实】 |
| G6 | **P1** | 素材核验是全链路唯一不轮询的异步表面：上传后提示「可以离开此页面，稍后刷新查看结果」，留在页面则「核验中」行永不自动转为通过/失败，与 copy/plan/production 的自动恢复体验不一致 | `web/assets.js`（无轮询）；对照 `copy.js:113-116`、`plan.js:118`、`production.js:129,218-223` | 【事实】 |
| G7 | **P2** | 设计 token 缺口：`--n-600`、`--n-800`、`--shadow-control` 在 `copy.css:58-59,71,73,88-89` 与 `production.css:42-43,62-63,72-73,84-85,99,101,110` 被使用但 `tokens.css` 未定义；`copy.css:71` 误用遗留 token `var(--surface)`。实际渲染回退为继承色/透明底，Finding 命中片段卡片丢失底色 | grep 核实（`web/copy.css`、`web/production.css`、`web/tokens.css`） | 【事实·代码缺陷】 |
| G8 | **P2** | `works.css:21` 作品列表行 hover 带 `transform: translateY(-1px)` 装饰位移，超出 Stage 0 允许的五种动效场景（状态变化只允许背景/边框色过渡） | grep 核实 | 【事实】 |
| G9 | **P2** | `#recoverWorkVerification` 按钮被 `production.js` 永久 `hidden = true`（死控件），而 `recoverWorkVerification()` 仍存在且使用 `window.prompt`——VSA 页面中唯一残留的原生 prompt（A11 已把原生 prompt/confirm 全部换成正式 Dialog） | `web/production.js`（`recoverButton.hidden = true`；`window.prompt("请说明已处理的事项与重新核验依据：", …)`，直接阅读核实） | 【事实】 |
| G10 | **P2** | 加载反馈仍以纯文本占位：项目列表把「正在加载...」渲染进 `.empty` 容器（`projects.html:37`），成员列表加载中直接 `textContent = "加载中…"`（`members.js:66`）；真实加载失败已有独立错误区，当前仅是视觉一致性欠账 | 直接阅读核实 | 【事实】 |

记录在案但不进 Top 10（避免过度修复）：断点碎片化（login 420 / base 680 / shell 760 / styles 820 / project-content 900 / plan 1050 / works 1080 / copy 1120——390px 下均正确塌缩，各切片已验证无横向滚动，仅 681-1120 中间宽度表现不一）；「素材中心」（组织级物料库）与「人物与素材」（阶段 3）命名相邻易混；遗留 `index.html` 的 pill 不含作品库入口（G1 修复后影响消失）。

### 1.3 与 Issue #70 的一致性

Issue #70 要求的全部负路径行为在**服务/API 层已有自动测试**（§8 逐行映射）；缺口集中在浏览器层的跨页断言与上述缝合缺陷。**未发现仓库事实与 Issue #70 冲突**，无 `DESIGN_BLOCKER`（详见 §10.4 与 §13）。

---

## 2. 全链路用户旅程地图

链路（D-030 §2/§10.1）：`登录 → 首次改密 → 项目列表 → 商品与目标（含素材引用） → 素材中心（上传核验） → 文案与质检（生成/QC/人工审核） → 人物与素材 → 视频方案（Preflight/方案审核） → 生成与交付（工单/交接包/人工执行/核验/作品卡） → 作品库（检查/交付登记）`。

### 2.1 登录与首次改密 — `/login.html`

- **入口**：直接 URL；任何企业页 `request()` 收到 401/403 → `location.replace("/login.html")`；`password_change_required` 状态由各页 `shell.js:15` / `auth-gate.js:11-13` 弹回登录页。
- **权威对象**：Member / Organization / Session。
- **主操作**：【登录】（`#submitButton`，唯一实心）；改密态标题切为「设置新密码」、按钮「保存并进入工作台」（`#authTitle`/`#authSubtitle`/`#newPasswordField`）。
- **阻断表达**：`#authError` inline（`role="alert"`），错误码映射中文（`AUTH_INVALID_CREDENTIALS`/`ACCOUNT_UNAVAILABLE`/`AUTH_RATE_LIMITED`/`NO_ACTIVE_MEMBERSHIP`/`PASSWORD_TOO_WEAK` 等，`login.js:11-21`）；登录态 401/403 时静默重取 intent 而非报错。
- **下一页**：成功 → `location.assign("/")` ——**落遗留工作台（缺口 G1）**。
- **刷新/重入**：加载即 `GET /api/auth/me`，已登录且无需改密 → `replace("/")`；网络失败显示「无法连接身份服务。」。

### 2.2 项目列表 — `/projects.html`

- **入口**：壳层导航「项目」（`data-feature="project-content"`，runtime 开启才显示）；feature off 直接访问 → `location.replace("/")`（`projects.js:33`）。
- **权威对象**：Project。
- **主操作**：【+ 创建项目】（`#openProjectDialog` → `#projectDialog`，名称必填，交付日期/说明可选；POST 带 `idempotency-key`）。
- **阻断/状态**：校验失败 `#formError`「请填写项目名称。」；加载失败 `#listError`「项目加载失败，请刷新重试。」+【刷新】；真空「还没有项目」；**加载中文案占用 `.empty` 容器（G10）**。
- **下一页**：行内「打开」→ `/project.html?id=<projectId>`。
- **刷新/重入**：手动 `#refresh`；无异步、无 URL 参数。

### 2.3 商品与目标 — `/project.html?id=<projectId>`

- **权威对象**：Project / Product / ProductRevision / ProductFact（卖点逐条确认）/ ContentBrief / available AssetVersion 复选引用。
- **主操作（随上下文唯一化）**：无商品时【+ 创建商品】（`#openProductDialog`）；编辑中【设为 Ready】（`#readyRevision`），【保存草稿】（`#saveDraft`）降为次。
- **阻断表达**：Ready 门禁 `PRODUCT_REVISION_READY_BLOCKED` → `.notice.blocked` 逐条列缺失（填写商品名称/确认至少一条卖点/选择至少一张可引用图片）；未保存卖点先确认 → blocked「请先保存草稿，再确认卖点。」；已 Ready 后 `#readyRevision` 禁用且 `title` 解释（本页唯一的 disabled-explain 实例）；**409 冲突文案缺陷（G3）**。
- **状态徽章**：`#revisionState`（`.state draft|ready|superseded` → 草稿/已 Ready/已被替代 · vN）。
- **下一页**：`#openCopyWorkspace` → `/copy.html?project=&revision=`（`copyGenerationEnabled` 才显示）。
- **刷新/重入**：重新拉取项目与素材；**只恢复第一个商品，选中商品不进 URL（G4）**；无 `id` → 回 `/projects.html`。

### 2.4 素材中心 — `/assets.html`

- **权威对象**：Asset / AssetVersion（六态核验状态机）。
- **主操作**：【上传商品图】（`#uploadForm`/`#assetFile`，accept jpeg/png/webp；SHA-256 → 授权 → PUT → 完成回调三步）。
- **状态表达**：上传成功提示「上传完成，服务端正在核验。可以离开此页面，稍后刷新查看结果。」；行级 `.state` 徽章（upload_pending/uploading/verifying → 信息蓝；available → 绿；verification_failed → 红 + 行内失败原因中文映射 `OBJECT_MISSING`/`FILE_TYPE_MISMATCH`/`SIZE_MISMATCH`/`CHECKSUM_MISMATCH`/`OWNERSHIP_MISMATCH`）。
- **阻断**：上传失败 `#assetError`「上传未完成，请检查图片后重试。」；核验失败**无重试入口**（该版本终态，需重新上传产生新版本——架构事实，非缺陷）。
- **下一页**：无链路出口（组织级物料库，不回特定项目）；返回项目靠壳层导航。
- **刷新/重入**：**无轮询（G6）**，`#refreshAssets` 手动刷新；无 URL 参数。

### 2.5 文案与质检 — `/copy.html?project=&revision=`

- **权威对象**：CopyVersion / 生成与改写 AsyncJob / QualityRun / QualityResult / QualityFinding / HumanReview。
- **布局**：阶段条（`.stage-strip`，`aria-current="step"`）+ 吸顶商品上下文条（`#productSelector`、`#revisionState`、`#productFactsLink`）+ 三栏（版本 `#copyVersions` ｜ 编辑 `#copyForm` ｜ 质检/审核 `#qualityPanel` 双 tab）。
- **主操作链**：【生成文案】→【保存】→【开始质检】→（逐条 Finding：接受并填理由/返回商品事实/人工修改/AI 改写）→【提交人工审核】→（admin）【批准】→【进入人物与素材 →】。
- **阻断表达**：生成禁用 `title` 解释（未 Ready / 已有任务进行中）；提交审核按服务端 gate 逐条列原因（`#reviewGateList`）；非 admin 看到只读审核视角提示「当前账号为只读审核视角，请联系管理员完成决策。」；失效 Finding 只读且无操作按钮。
- **下一页**：`#avatarStageLink`/`#nextStageLink` → `/avatar.html?project=&product=&copy=`；`#productionStageLink` 按 `productionOrdersEnabled` 门控（off 时 `aria-disabled` + 无 href）。
- **刷新/重入**：`revision` 参数恢复；生成/质检/改写 1s 轮询；脏输入 `#unsavedNotice` 三选项 + `beforeunload`；409 → `#conflictNotice`【查看最新版本/复制我的修改/放弃修改】。

### 2.6 人物与素材 — `/avatar.html?project=&product=&copy=`

- **权威对象**：AvatarAsset（目录）/ AvatarSelection（draft→confirmed→superseded）。
- **主操作**：【确认人物选择】（`#confirmAvatar` → `#confirmAvatarDialog` 摘要 + 后果文案）。
- **阻断表达**：`#selectionGateList` 逐条 ✓/!（文案批准有效/资产可用/授权有效/能力有 Evidence/企业范围/素材可访问）+ 责任方提示；授权失效/不完整禁用确认；`#nextPlanLink` 按 `videoPlanningEnabled` 门控（off 时文案「视频方案尚未开放」且无 href）。
- **下一页**：`#nextPlanLink` → `/plan.html?project=&product=`；`#copyContextLink` → 回文案页。
- **刷新/重入**：`copy` 参数缺省时服务端按 product 解析当前有效批准文案并回写 URL（A07 Review 修复后的真实行为）；无轮询（无异步）。

### 2.7 视频方案 — `/plan.html?project=&product=&plan=`

- **权威对象**：VideoPlanVersion（不可变）/ PreflightRun / PreflightResult / PlanReview；上游只读引用卡（商品快照/文案/人物，各带「查看 →」回链）。
- **主操作链**：【创建方案】（`#createPlan`）→【保存草稿】→【开始预检】→【提交方案审核】→（审核）【批准方案】→【前往生成与交付 →】。
- **阻断表达**：未保存禁预检（`#dirtyState`「有未保存的修改，请先保存后预检。」）；预检 blocked amber 不给强行通过；Local Agent 离线仅 amber 提醒「不影响保存、预检与方案审核」；「预检通过不等于人工批准」固定提示；创建工单未开放时 `#createOrderDisabled` 禁用按钮文本=服务端 `production_order_notice`。
- **下一页**：批准后 stage-5 链接 → `/production.html?project=&product=`。
- **刷新/重入**：`plan` 参数恢复；预检 800ms 轮询；切换商品/版本/刷新经 `#unsavedDialog`（保存并继续/放弃修改/取消）；409 → 恢复本地输入 + blocked「版本冲突：没有覆盖他人的修改。」。

### 2.8 生成与交付 — `/production.html?project=&product=&orderId=`

- **权威对象**：ProductionOrder / ManualHandoffPackage / ExecutionAttempt（manual）/ ManualExecutionReport / 候选产物 / 核验 Job / Work 结果卡。
- **主操作链**：【创建生产工单】（`#createOrderDialog` 四目的单选，不预选，未选禁用确认）→【生成交接包】→【下载交接包】（固定提示「下载不代表开始执行」）→【领取人工任务】→【确认开始】（`#startManualDialog` 强制展示工单目的+包版本+完整性摘要）→【上传候选作品】→【提交执行结果】（`#reportManualDialog`，outcome 无默认，偏差条件必填）→【发起核验】→ 作品卡【进入作品库检查与交付 →】。
- **阻断表达**：创建门禁失败时 `#createOrderButton` 禁用 + `title`（首条原因）+ `.notice.blocked` 列全部原因；包未 ready 时领取禁用 + `title`「交接包准备好后才能领取人工任务」；`waiting_for_executor` 信息蓝 + `#executorNotice` amber「当前没有可用的执行环境，工单将等待人工执行；不影响创建工单与交接包」；核验 requires_action → 引导提交更正报告；`recover` 死控件（G9）。
- **下一页**：`#worksLibraryLink` → `/works.html?work=&project=&product=`（`worksEnabled` 且有作品时由 span 升级为 `<a>`）；`#planContextLink` 回方案页。
- **刷新/重入**：`orderId` 参数恢复；包生成 2.5s、核验 2s 轮询，核验读取失败 3s 强制轮询并显示「核验状态暂时无法读取，正在继续自动更新。」；报告对话框本地草稿不持久化（关闭需确认）。

### 2.9 作品库 — `/works.html?work=&project=&product=`

- **入口**：壳层导航「作品库」（`shell.js:22-30` 在 `worksEnabled` 时动态插入，顺序：项目/素材中心/作品库/成员管理）；production 作品卡链接；feature off 直接访问 → `#worksUnavailable` 不可用面板（不暴露假入口）。
- **权威对象**：Work / WorkInspection（pending/passed/rework_required/superseded）/ DeliveryRecord（append-only）。
- **主操作链**：选择作品 →【标记为通过】（`#passDialog` 轻确认，含作品摘要与明确结论）→【登记交付】（`#deliveryDialog`，时间默认现在可编辑）；或【登记返工】（`#reworkDialog`，分类+原因+返回上游阶段必填）。
- **阻断表达**：返工后 `#passInspection`/`#requestRework` 双禁用（按钮文案变「无法再次通过检查」），`#actionExplanation` 说明「新的上游生产周期和新工单会产生新的作品，原作品与检查历史会保留」+ 责任方；交付未过检时 `#deliveryBlockedReason`「交付登记需先通过检查；由内容审核人处理检查状态。」；`#upstreamActionLink` 按 `target_upstream_stage` 计算回链（缺权威上下文时隐藏，不造假链接）。
- **筛选/空态**：项目+交付状态双筛选；「还没有已登记作品」/「没有符合筛选条件的作品」/「N 个作品」三态（`works.js:102`）。
- **刷新/重入**：`work` 参数深链恢复；无轮询（无异步任务）。

### 2.10 成员管理 — `/members.html`（admin）

- **权威对象**：Member（角色 member/admin）。
- **主操作**：【+ 创建成员】（`#memberDialog`，成功后在对话框内一次性展示临时密码：「请立即安全交付，该密码不会再次显示。」）；次操作【重置密码】；危险【停用】（`#disableMemberDialog` 确认，实心红在对话框内）。
- **阻断表达**：版本冲突「成员状态已被其他操作更新，请刷新后重试。」；邮箱冲突「该工作邮箱已存在。」；已停用成员显示「当前版本不支持重新启用」（已知产品边界）；**非 admin 被重定向到 `/` 遗留页（G5）**；**零成员无空态文案（G10）**。
- **刷新/重入**：手动刷新；无 URL 参数。

### 2.11 遗留本地批量工作台 — `/index.html`（运维兜底）

不进企业导航；`auth-gate.js` 向 `.status-strip` 追加 pill（素材中心/项目/成员管理/退出）。含批次/抓包/真实执行控件（积分风险由 runtime 门控）。**它是当前登录着陆页（G1）**。本页不属于 Slice A 链路，A14 不改造其视觉，只解决着陆与回链问题。

### 2.12 死端、重复动作、回链与命名审计

- **死端**：G1（遗留页成为着陆死端）；assets/members 无回链（架构事实：组织级库与设置区，可接受，但 members 的 forbidden 去向是缺陷 G5）。
- **重复动作**：copy/plan/production/works 的移动抽屉入口与桌面按钮是同一命令的两个渲染点，均带幂等键——无重复业务对象风险（已有测试佐证：改写双击 1 请求、工单双击 1 单）。
- **缺失回链**：G4（商品页不接受深链参数，文案页「查看商品事实」回链丢商品上下文）；其余 LF-018 权威回链均已实现（plan 上游卡、avatar `#copyContextLink`、production `#planContextLink`、works `#upstreamActionLink`）。
- **命名**：「素材中心」（assets，组织级）与「人物与素材」（阶段 3，avatar）相邻易混——记录，不在 A14 改名。
- **上下文丢失**：仅 G4 一处；其余页面刷新/深链均恢复上下文（§5.4 合同）。

---

## 3. 跨页信息架构

### 3.1 导航模型（只使用已实现页面）

一级导航（壳层侧栏，全部由 runtime flag 驱动、默认 `hidden` 防未授权闪烁，Foundation Stage 1 已修复过闪烁问题）：

```text
项目          data-feature="project-content"  → /projects.html
素材中心      data-feature="assets"           → /assets.html
作品库        data-feature="works"（worksEnabled 时 shell.js 动态插入）→ /works.html
成员管理      data-role="admin"               → /members.html
```

- 激活态：`shell.js:5-8` 按 `body[data-shell-page]` 对 `.app-nav [data-page]` 设 `aria-current="page"`。
- 顶部上下文栏：左位置标识，右组织名（`[data-shell-organization]`）+ 成员名（`[data-shell-member]`）+【退出】（`[data-shell-logout]` → POST `/api/auth/logout`）。
- **明确不建**（§3.5 记录决策）：首页仪表盘、全局「生产任务」聚合页、独立「设置」页（成员管理即设置入口）、审计查看器。LF-009 的全局生产任务页由 A09-A10/A11-A13 设计文档显式推迟到 A14 裁决——本审计裁决：**继续推迟**（Issue #70 禁止新页面/新对象；跨项目聚合缺口记录为后续跟进项，见 §10.4）。
- 遗留 `index.html`：不进导航；仅直接 URL 可达的运维兜底。

### 3.2 面包屑与阶段条

- **面包屑**：各链路灯页 eyebrow 模式「项目 / {项目名} / {阶段名}」，链回 `/projects.html`；项目名截断 + `title`。
- **五阶段条**（copy/avatar/plan/production 页内 `.stage-strip`）：固定顺序 商品与目标 → 文案与质检 → 人物与素材 → 视频方案 → 生成与交付；当前阶段 `aria-current="step"`；已实现阶段为真实链接；未启用阶段 `aria-disabled="true"` 且 JS 移除 `href`（`copy.js:64-76`、`avatar.js:57-60`、`plan.js:32`），文案说明「尚未开放」——不出现假链接（A08 Review 已验证初始 DOM 不暴露未启用 href）。
- **商品上下文条**（copy/avatar/plan/production 吸顶）：`#productSelector` 切换商品；切换时按各页规则回写 URL 参数（avatar 切商品会重置 `copy` 参数并由服务端重新解析当前有效批准文案）。

### 3.3 上下文持久化合同（权威）

URL query 是唯一跨页上下文载体（`history.replaceState` 同步；无 localStorage）：

| 页面 | 参数 | 恢复行为 |
|---|---|---|
| project | `id` | 恢复项目+**第一个商品**（G4：缺商品级参数） |
| copy | `project`, `revision` | 恢复指定文案版本工作区 |
| avatar | `project`, `product`, `copy` | `copy` 缺省时服务端解析当前有效批准并回写 |
| plan | `project`, `product`, `plan` | 恢复指定方案版本 |
| production | `project`, `product`, `orderId` | 恢复指定工单 |
| works | `work`, `project`, `product` | 深链选中作品并恢复上游上下文 |

A14 唯一修订：`project.html` 增加商品级参数（建议 `revision`，与 `#openCopyWorkspace`/`#productFactsLink` 既有参数名一致），选中商品切换时 `replaceState`，加载时优先恢复（积压项 B4）。

### 3.4 权威返回链接（LF-018 映射的现状）

| 异常类别 | 权威页面 | 现状 |
|---|---|---|
| 商品事实问题 | 商品与目标 | copy `#productFactsLink` ✓（但丢商品参数，G4）；works 返工 `target_upstream_stage=product` → `/project.html?id=` ✓ |
| 文案问题 | 文案与质检 | avatar `#copyContextLink` ✓；works 返工 → `/copy.html?project=&product=` ✓ |
| 人物问题 | 人物与素材 | plan 上游人物卡「查看 →」✓；works 返工 → `/avatar.html?project=&product=` ✓ |
| 方案问题 | 视频方案 | production `#planContextLink` ✓；works 返工 → `/plan.html?project=&product=` ✓ |
| 执行问题 | ProductionOrder 详情 | production 页内（无跨页需求）✓ |
| 执行环境问题 | 设置/Local Agent | Slice A 无 Local Agent 页面；以 `#executorNotice` amber 提醒表达，不阻断 ✓（Phase 1 边界） |
| 作品问题 | 返工返回上游 | works `#upstreamActionLink` ✓ |

### 3.5 本审计确认的架构裁决（不建新页面）

1. **全局「生产任务」聚合页**：继续推迟。理由：Issue #70 只允许集成加固；当前单项目单链路体量下 production.html 已承载全部执行管理；跨项目发现效率缺口记录为 Slice A 之后跟进项。
2. **首页仪表盘**：不建（Stage 0 既定；登录着陆问题由 B2 用已实现页面解决，而非新建首页）。
3. **AuditEvent/诊断查看器**：不建 UI。Phase 1 口径为「普通用户看业务语言；授权人员可查必要脱敏诊断」由服务端 API/日志层保证，A14 以测试核对（§8 第 12-13 行、§11）。
4. **设置中心**：成员管理继续兼任设置入口（admin）。

---

## 4. 1440px 集成工作流

约定：【主】= 当屏唯一实心品牌蓝主操作；[次] = 次按钮；(状态) = 状态徽章；⚠ = amber 提醒/阻断；✕ = 红（仅真实失败/危险确认）。

### 4.1 登录与首次改密（无壳层，居中卡片 min(100%,380px)）

```text
┌────────────────────────────┐     密码临时态 → 同卡片原地切换：
│ 飞影企业工作台              │     「设置新密码 / 临时密码已验证」
│ 登录                        │     主按钮：【保存并进入工作台】
│ 工作邮箱 [_______________]  │
│ 密码     [_______________]  │     错误：#authError inline 红字 role=alert
│ 【登录】               【主】│     （AUTH_INVALID_CREDENTIALS 等中文映射）
└────────────────────────────┘
        ↓ 成功（A14 修复 B2 后：projectContentEnabled → /projects.html）
```

### 4.2 项目列表 → 商品与目标

```text
壳层: │项目● 素材中心 作品库 成员管理│ 组织·姓名 退出│
──────────────────────────────────────────────────────────
项目                                            【+ 创建项目】主
名称                  交付日期      说明          [打开] → /project.html?id=
空:「还没有项目」+ 创建引导 / 失败:「项目加载失败，请刷新重试。」+[刷新]

/project.html?id= ——————————————————————————————————————
项目 / {项目名}                                 【+ 创建商品】主(无商品时)
┌商品(280px)──────┬商品快照 (状态:草稿 vN)────────────────┐
│ 云感保湿乳(草稿) │ 名称/品类/说明/表达风格/补充要求        │
│ 滋润型(已Ready) │ 核心卖点: [输入][确认][次] 逐条(待确认⚠/已确认✓)│
│                │ 商品图片(仅 available): ☐主图.jpg·版本1   │
│                │ [保存草稿][次]  【设为 Ready】主         │
└────────────────┴───────────────────────────────────────┘
⚠ 阻断条(操作行上方):「暂不能 Ready：填写商品名称、确认至少一条卖点、
  选择至少一张可引用图片。」  409 → blocked「页面内容已过期，请刷新后继续。」(B3 修复后)
```

### 4.3 素材中心

```text
素材中心                                        【上传商品图】主
上传区(一行: 选择文件 + 上传; 成功后提示「可以离开此页面，稍后刷新查看结果。」)
文件名          版本   状态            上传时间
主图.jpg        v1    (核验通过)✓绿    08-05 14:02
banner.png      v2    (核验失败)✕红+行内原因  08-05 13:40
new.png         v1    (核验中)信息蓝    08-06 09:12   ← B5 修复后自动轮询转态
```

### 4.4 文案与质检（链路最密一页）

```text
项目 / {项目名} / 文案与质检
[商品与目标✓] [文案与质检●] [人物与素材] [视频方案] [生成与交付]   ← 阶段条
┌商品上下文条(吸顶): [商品切换▾] (快照 v3·已 Ready) 查看商品事实 →┐
├版本列表(280)──┬文案正文──────────┬质检|审核(tab)───────────────┤
│ v4 已冻结·AI  │ (draft 可编辑)    │ (质检通过)✓ (审核中)蓝       │
│ v3 已被替代   │ [保存][次]        │ Finding 卡片: 命中/原因/建议   │
│ 空:「还没有文案」│ 409→三选项恢复条 │  [接受并填理由][返回商品事实]  │
│ 【生成文案】主 │                  │  [人工修改][AI 改写]          │
│               │                  │ 门禁列表逐条✓/!               │
│               │                  │ 【提交人工审核】主 → (admin)   │
│               │                  │ 【批准】主(对话框摘要)         │
└───────────────┴──────────────────┴──────────────────────────────┘
批准后:【进入人物与素材 →】   非 admin:「当前账号为只读审核视角，请联系管理员完成决策。」
```

### 4.5 人物与素材

```text
┌目录+筛选(288/弹性)──┬预览与信息──────────┬当前选择(384)──────────┐
│ 来源/状态筛选        │ 预览图/名称/来源     │ 文案 v4·已批准(上下文)  │
│ 人物卡片(无「推荐」)  │ 授权: 有效至…/即将到期⚠│ 门禁清单逐条✓/!+责任方 │
│                    │ 能力: 仅 Evidence 项 │ 【确认人物选择】主(对话框) │
└───────────────────┴───────────────────┴──────────────────────┘
确认后:【进入视频方案 →】(videoPlanningEnabled; off 时「视频方案尚未开放」无 href)
```

### 4.6 视频方案

```text
┌方案版本(280)──┬方案摘要+输出说明──────┬预检|审核(tab)────────────┐
│ v2 草稿       │ 上游只读卡×3(各带查看→)│ A 上游有效性 / B 完整性   │
│ v1 已被替代   │ [保存草稿][次]        │ C 生产准备度(离线仅⚠提醒)  │
│ 空:【创建方案】主│ 【开始预检】主       │ 「预检通过不等于人工批准」  │
│              │ (未保存时禁用+原因)   │ 【提交方案审核】主→【批准方案】│
└──────────────┴─────────────────────┴───────────────────────────┘
批准后:【前往生成与交付 →】   未满足时: [创建生产工单尚未开放]禁用+服务端原因文本
```

### 4.7 生成与交付（三阶段同页递进）

```text
┌工单列表(280)───┬工单详情────────────────┬右栏(包→执行→核验→作品)─────┐
│ 首次生产       │ (等待执行)信息蓝        │ 交接包: (可下载)✓           │
│  (等待执行)蓝  │ 目的卡: 首次生产(固定)   │ [生成交接包][下载][次]      │
│ 空:【创建生产工单】主│ 输入快照卡×4(只读)  │ 「下载不代表开始执行」       │
│ ⚠当前没有可用的 │ 创建时间/创建人        │ 人工执行: 【领取人工任务】主  │
│  执行环境…不影响 │                      │ →【确认开始】(对话框:目的+包  │
│  创建工单与交接包│                      │  版本+完整性摘要人工核对)    │
│              │                      │ →【上传候选作品】(≤256MB)   │
│              │                      │ →【提交执行结果】主(对话框)   │
│              │                      │ 核验: 【发起核验】主          │
│              │                      │ 「执行完成不等于工单完成」     │
│              │                      │ 作品卡→【进入作品库检查与交付→】│
└──────────────┴──────────────────────┴────────────────────────────┘
```

### 4.8 作品库

```text
┌作品列表+双筛选───┬作品详情───────────────┬检查与交付────────────────┐
│ 项目▾ 交付状态▾  │ 预览(降级说明)/文件信息  │ (待检查)蓝→(可交付)✓绿    │
│ 作品行(状态点)   │ 来源快照卡(方案/文案/人物/│ 【标记为通过】主(轻确认对话框)│
│ 「N 个作品」    │  商品, 缺上下文隐藏链接) │ 【登记返工】[次](分类+原因  │
│                │ 检查历史/交付历史(共N次) │  +返回阶段必填)           │
│                │ [下载][次]              │ 【登记交付】主(通过后才可用) │
└───────────────┴──────────────────────┴───────────────────────────┘
返工后: 双检查按钮禁用(「无法再次通过检查」)+ #actionExplanation 说明新周期/责任方
```

### 4.9 有意义状态 → 唯一主操作对照表

| 页面·状态 | 唯一主操作 |
|---|---|
| 登录 / 改密 | 登录 / 保存并进入工作台 |
| 项目列表 空/非空 | + 创建项目（对话框内「创建」） |
| 商品页 无商品 / 编辑中 / 已 Ready | + 创建商品 / 设为 Ready / （无，展示已 Ready 徽章+title） |
| 素材中心 | 上传商品图 |
| 文案 无版本 / 草稿 / 未质检 / needs_review / passed 未提交 / pending(admin) / approved | 生成文案 / 保存 / 开始质检 / （逐条 Finding 处理，无单一主按钮）/ 提交人工审核 / 批准 / 进入人物与素材（链接） |
| 人物 未确认 / 已确认 | 确认人物选择 / 进入视频方案（链接） |
| 方案 空 / 草稿未保存 / 已保存未预检 / 预检通过未审 / pending / approved | 创建方案 / 保存草稿 / 开始预检 / 提交方案审核 / 批准方案 / 前往生成与交付（链接） |
| 生产 无工单 / waiting / 无包 / 包 ready / 已领取 / 执行中 / 已上传 / 报告完成 / 核验通过 | 创建生产工单 / 生成交接包 / 下载（次，主操作仍为领取）/ 领取人工任务 / 确认开始 / 上传候选作品 / 提交执行结果 / 发起核验 / 进入作品库（链接） |
| 作品库 待检查 / 可交付 / 需返工 / 已交付 | 标记为通过 / 登记交付 / （无主操作，展示返工指引+上游链接）/ （再次交付须新明确命令，主操作仍为登记交付） |

---

## 5. 390px 集成工作流

### 5.1 适配机制（现状，均已实现并有测试）

| 页面 | 列表/导航 | 详情 | 主操作 |
|---|---|---|---|
| 壳层 | 侧栏塌缩为顶部 48px 横向滚动导航（`shell.css:18-27`） | — | — |
| 登录 | 卡片 `width: min(100% - 32px, 380px)`（420px 断点） | 同构 | 表单内 |
| 项目列表/商品 | 行卡片化；商品列表横向滚动 chips（≤680px） | 编辑区单列 | 阻断条吸在操作按钮上方 |
| 素材中心 | 行卡片（文件名截断+状态独立行） | — | 上传表单单列 |
| 文案 | 版本列表 → `#versionDialog` 抽屉（含移动端生成/重试入口，A04 修复） | 编辑单列，右栏整块下移 | 吸底操作区 |
| 人物 | 目录 → `#catalogDialog`（80dvh 底部锚定） | 详情单列 | `.selection-actions` 吸底条 + 禁用原因 amber 叠在按钮上方 |
| 方案 | 版本 → `#versionDialog` | 单列 | 吸底「提交方案审核」 |
| 生产 | 工单 → `#orderDrawer` | 单列，快照卡可点 | `.package-actions` 吸底 |
| 作品库 | 列表 → `#workDrawer` 底部抽屉 | 预览 100% 宽 | `.works-mobile-action` 固定底栏（`env(safe-area-inset-bottom)`，页面补偿 `padding-bottom: 96px`），唯一主操作 `#mobilePrimaryAction` |
| 成员 | 行卡片带字段标签（`data-label` 伪标签） | — | 操作按钮整行两枚 |

### 5.2 保证项（A14 验收断言）

1. **无横向滚动**：每页每状态断言 `document.documentElement.scrollWidth === document.documentElement.clientWidth`（现有各切片 browser 测试同款断言，A14 e2e 沿用）。
2. **无隐藏业务状态**：所有状态徽章在移动布局仍可见（版本状态、门禁清单、执行/核验/作品状态）；抽屉打开前后状态文本一致。
3. **无遮挡控件**：吸底条不遮挡最后一块内容（works 已有 96px 补偿；production/avatar 吸底条为页面流内 sticky，不覆盖内容）；对话框 `width: min(calc(100% - 32px), 520px)`。
4. **对话框后返回**：所有对话框关闭后页面上下文不变（URL 参数未动）；报告/改写等带本地输入的对话框关闭需确认（production 报告对话框已实现）。
5. **刷新后返回**：URL 参数恢复（§3.3 合同）；异步任务轮询自动恢复（copy 1s/plan 800ms/production 2.5s/2s；assets 修复 B5 后补齐）。
6. **深链进入**：`?work=`、`?orderId=`、`?plan=`、`?revision=` 均可直达对应选中态；B4 修复后商品页支持商品级深链。
7. **跨页返回**：阶段条与面包屑在 390px 塌缩为可点「阶段 N/5」与单行面包屑，不丢失上一级入口。

---

## 6. 统一状态与消息审计

色板引用 `tokens.css`：成功 `#067647/#ecfdf3/#abefc6`；提醒 `#9a6700/#fffaeb/#f0b429`；失败 `#b42318/#fef3f2/#fecdca`；进行/等待 `#175cd3/#eff4ff/#b2ccff`；失效灰 `#667085/#f2f4f7/#eaecf0`；品牌蓝 `#1769e0`。组件：`.notice`（success/error/blocked 三态）、`.state.*` 徽章、`<dialog>`、`.empty`、吸底操作条。

| # | 状态 | 中文展示文案（现网实际） | 语义色 | 下一步 | 责任角色 | 现有组件支持 | 缺口 |
|---|---|---|---|---|---|---|---|
| 1 | loading | 「正在加载...」（projects）、「加载中…」（members）、骨架未实现 | 中性灰 | 等待 | 系统 | `.empty`/`#catalogLoading` 等文案式 | 无骨架屏；G10 记录（P2） |
| 2 | true empty | 「还没有项目」/「还没有商品」/「还没有文案」/「暂无可选人物」/「还没有视频方案」/「还没有已登记作品」 | 中性灰 | 引导主操作（创建/生成/上传） | 操作者 | `.empty` + 页内主按钮 | members 零成员无文案（G10，P1 小修） |
| 3 | filtered empty | 「没有符合筛选条件的作品」；人物目录「没有符合条件的人物」+【清除筛选】（`#clearFilters`） | 中性灰 | 清除筛选 | 操作者 | `.empty` + 清除按钮 | 无 |
| 4 | success | 「草稿已保存。」/「商品快照已 Ready。」/「任务已领取，请确认开始。」/「核验请求已受理；执行完成不等于工单完成。」 | 成功绿 | 继续链路上下一步 | 操作者 | `.notice.success`；徽章 cross-fade | 无 |
| 5 | validation error | 「请填写项目名称。」/「该工作邮箱已存在。」/登录 `#authError` 错误码中文映射/报告对话框内字段级校验 | 失败红 inline | 修正后重提交 | 操作者 | `#formError`/`#authError`/对话框内 `.error`（`role=alert`） | 无 |
| 6 | business blocked | 「暂不能 Ready：…（逐条缺失）」/「请先保存草稿，再确认卖点。」/门禁清单逐条原因（avatar/plan/production）/「交付登记需先通过检查；由内容审核人处理检查状态。」 | 提醒 amber | 文案含下一步+责任方；部分含回权威页链接 | 依门禁（操作者/审核人/管理员） | `.notice.blocked` + `#selectionGateList`/`#reviewGateList`/gateLabels + `title` | G3 使 project 页 409 误入此类文案错误（P1） |
| 7 | technical failure | 「保存失败，请稍后重试。」/「生成失败」+重试/「生成未完成」+【重试生成】/「核验状态暂时无法读取，正在继续自动更新。」 | 失败红 | 重试（幂等键保证安全） | 操作者；持续失败转管理员 | `.notice.error` + 重试按钮 | 无 |
| 8 | unauthorized | 无页面文案：401/403 → `location.replace("/login.html")`（全部企业页 `request()` 统一） | — | 重新登录 | 操作者 | 全页统一 helper | 无 |
| 9 | forbidden | 文案页「当前账号为只读审核视角，请联系管理员完成决策。」；works 403 → 操作错误映射（联系组织管理员）；跨组织 →「此对象不在本企业可用范围内。」（avatar reasonLabels/production gateLabels） | 提醒 amber | 联系管理员/返回可用页 | 管理员 | `.notice.blocked`/对话框错误 | G5：members 非 admin 被弹到遗留页（P1） |
| 10 | 乐观并发冲突 | copy「此内容已被他人更新，你的修改未保存。」+【查看最新版本/复制我的修改/放弃修改】；plan「版本冲突：没有覆盖他人的修改。」；members「成员状态已被其他操作更新，请刷新后重试。」；avatar 409 对话框「人物选择已被他人更新…」 | 提醒 amber（blocked） | 三选一/刷新 | 操作者 | `#conflictNotice`/`#dirtyState`/对话框 | **G3：project 页 409 显示「保存失败，请稍后重试。」（缺陷）** |
| 11 | async running | 「核验中」/「生成中（可离开本页）」/「已有生成任务进行中，可离开页面后返回查看」（title）/「上传完成，服务端正在核验。可以离开此页面…」 | 信息蓝 progress | 可离开；自动轮询恢复 | 系统 | `.state.verifying/.queued/.running` + 轮询 | G6：assets 不轮询（P1）；无虚假百分比（符合） |
| 12 | refresh/re-entry | 无专门文案：URL 参数 + 服务端重取 + 轮询恢复；脏输入 `beforeunload` 守卫 | — | 继续 | 操作者 | replaceState 合同（§3.3） | G4：project 页商品级上下文丢失（P1） |
| 13 | superseded/revoked/invalidation | 「已被替代」灰徽章；「已撤销」灰+原因；「质检结论已失效…」amber 阻断条；「批准已失效」amber；失效 Finding 只读无操作 | 失效灰（对象）+ 提醒 amber（传播横幅） | 重新质检/重新审核/派生新版本 | 操作者+审核人 | `.state.superseded/.revoked` + `.notice.blocked` | 无（服务层传播已有测试，见 §8） |
| 14 | waiting_for_executor | 「等待执行」+「当前没有可用的执行环境，工单将等待人工执行；不影响创建工单与交接包」 | **信息蓝（不是红）** + amber 提醒条 | 生成交接包走人工；等待执行环境 | 执行器管理员（恢复环境）；操作者（走人工包） | `.state.waiting_for_executor` + `#executorNotice` | 无 |
| 15 | requires_action | 「需要处理」（人工执行）/「需要人工处理」（核验）；「请先提交更正报告」引导 | **提醒 amber（不是红）** | 真实恢复检查/更正报告，不给「标记已处理直接成功」 | 操作者/执行者 | `.state.requires_action`/`.blocked` + `#recheckManualDialog`/更正报告入口 | G9：recover 死控件+window.prompt（P2） |

补充语义红线（全部已落实并有断言）：`waiting_for_executor ≠ failed`、`requires_action ≠ failed`（amber 非红）、`QC passed ≠ approved`（双徽章并列+固定提示）、`Preflight passed ≠ approved`（按钮文案含「人工审核」）、`下载 ≠ 开始执行`、`上传完成 ≠ 核验通过`、`报告 completed ≠ 工单 succeeded`（`#manualExecutionMeta` 固定提示）、`下载作品 ≠ 交付`（「下载不等于交付；交付请使用登记交付」）、UI 不模拟服务端终态（全部状态来自 GET 投影，浏览器测试以受控 fake 验证）。

---

## 7. 主路径 UX 验收脚本

> 目标：全新测试 Organization，从首次登录/临时密码到 DeliveryRecord，全部经正式 UI 完成；异步 worker 由测试钩子驱动（与现有 browser 测试一致的 `runNextVerificationJob`/worker run，非数据库改写）；不访问真实 Hifly、不消耗积分。
> 账号：**A = 管理员**（种子管理员，负责成员管理与两处审核批准与作品检查）；**O = 运营/执行者**（member，负责业务操作与人工执行）。角色分配与服务端门禁一致（§0 角色事实：文案批准仅 admin；确认开始仅领取者本人）。
> 前置：`buildApp` 开启全部 feature flag（`assets…worksEnabled`），`createFakeExecutor` + 受控 copy provider / quality evaluator / preflight evaluator + memory ObjectStore；`agentReadinessPort` 离线（验证离线不阻断）。

| 步骤 | 账号 | 操作（页面/元素） | 操作员可见检查点（断言） | 跨页链接断言 |
|---|---|---|---|---|
| 1 | A | 打开 `/login.html`，临时密码登录 | 改密卡片原地出现（`#newPasswordField`），按钮「保存并进入工作台」 | — |
| 2 | A | 设置新密码 | 着陆企业页（B2 修复后：`/projects.html`；修复前为 `/` + pill 入口） | 壳层导航含「项目」 |
| 3 | A | `/members.html` →【+ 创建成员】 | `#memberDialog`；创建后对话框一次性展示临时密码 +「该密码不会再次显示。」 | — |
| 4 | O | 退出 A；O 临时密码登录→改密 | 同步骤 1-2；`/api/auth/me` 为 active | — |
| 5 | O | `/projects.html` →【+ 创建项目】 | 真空「还没有项目」→ 创建后出现行 | 行「打开」href=`/project.html?id=` |
| 6 | O | 进入项目 →【+ 创建商品】→ 填名称/卖点 →【保存草稿】→ 逐条【确认】 | `#revisionState`「草稿 · v1」；卖点行「待确认→已确认」；「草稿已保存。」 | eyebrow「项目 / {名}」回 projects |
| 7 | O | `/assets.html` → 上传商品图 | 「核验中」信息蓝；（worker 钩子驱动后）转「核验通过」绿；B5 修复后无需手动刷新 | 壳层「素材中心」`aria-current` |
| 8 | O | 回项目页勾选图片 →【设为 Ready】 | 「商品快照已 Ready。」；按钮禁用 + title 解释；刷新后仍 Ready | `#openCopyWorkspace` href=`/copy.html?project=&revision=` |
| 9 | O | 进入文案页 →【生成文案】 | 生成中状态；可离开；轮询恢复；完成后版本列表出现 v1 草稿 | 阶段条当前=文案与质检 |
| 10 | O | 【开始质检】→（受控 passed） | 「质检通过」绿 + 审核徽章并列（passed≠approved 提示） | — |
| 11 | O | 【提交人工审核】 | 「审核中」蓝；O 视角不出现批准按钮（只读提示） | — |
| 12 | A | 打开同一 `copy.html` URL →【批准】（对话框） | 「已批准」绿 + 当前有效；self_review 不适用（A≠O） | 「进入人物与素材 →」href=`/avatar.html?project=&product=&copy=` |
| 13 | O | 进入人物页 → 选人物 →【确认人物选择】（对话框） | 门禁清单全 ✓；「人物已确认。」 | 「进入视频方案 →」href=`/plan.html?` |
| 14 | O | 进入方案页 →【创建方案】→ 保存 →【开始预检】 | 预检通过/存在提醒；「预检通过不等于人工批准」；离线仅 amber 提醒不阻断 | 上游三卡各带「查看 →」 |
| 15 | O |【提交方案审核】；A 批准 | 「已批准」绿 | 「前往生成与交付 →」href=`/production.html?` |
| 16 | O | 进入生产页 →【创建生产工单】（选「首次生产」）→ 确认 | 工单「等待执行」信息蓝 + ⚠「当前没有可用的执行环境…不影响创建工单与交接包」；双击只产生 1 单 | 阶段条当前=生成与交付 |
| 17 | O | 【生成交接包】→ ready →【下载】 | 「下载不代表开始执行。」；包版本+完整性摘要可见；无 ExecutionAttempt 产生（§8-7） | — |
| 18 | O | 【领取人工任务】→【确认开始】（对话框） | 对话框强制展示目的+包版本+完整性摘要；「已确认开始人工执行。」 | — |
| 19 | O | 【上传候选作品】→【提交执行结果】（outcome=completed） | 「候选作品已上传，等待提交结果。」→「执行结果已提交，候选作品等待后续核验。」；工单仍未完成 | — |
| 20 | O | 【发起核验】 | 「核验请求已受理；执行完成不等于工单完成。」→「核验通过」+ 工单「已完成」绿 + 作品卡 | 「进入作品库检查与交付 →」href=`/works.html?work=&project=&product=` |
| 21 | A | 进入作品库 → 预览 →【标记为通过】（轻确认对话框含摘要） | 「可交付」绿；交付历史「共 0 次」 | 壳层导航含「作品库」且 `aria-current` |
| 22 | O | 【登记交付】（时间默认现在可编辑） | 「已交付 · 共 1 次」绿；交付历史 append-only 一行 | — |
| 23 | O | 全程随机刷新（每阶段至少一次）+ 一次深链直达 | 各页从服务端恢复真实状态；上下文不丢（§3.3；B4 修复后含商品级） | — |

主路径禁止项断言：全程不出现 Provider/Playwright/影刀/Token/Cookie/checksum 原文/内部任务 ID（沿用 `work-verification-browser`、`work-delivery-browser` 的禁词断言模式扩展到全链）；无虚假进度条；无「标记已处理直接成功」入口。

---

## 8. 负路径 UX 验收矩阵

> 覆盖 Issue #70 全部 13 个场景 + 4 个补充通用负路径。「已有证据」列引用现存测试（文件: 测试题）；「A14 补强」列只列缺口，不重复建设。

| # | 场景 | 页面/层 | 初始状态 | 用户动作 | 可见结果 | 恢复/下一步 | 已有自动化证据 | A14 补强 |
|---|---|---|---|---|---|---|---|---|
| 1 | blocked 文案不可批准 | copy | QualityResult=blocked | 查看审核 tab | 无提交/批准入口；blocked amber 无「强行通过」；Finding 无接受按钮 | 修改文案/补事实→新版本→完整重检 | `copy-quality-browser`（失效 Finding 无操作按钮）；`copy-quality-service` 系列 | e2e 断言批准按钮不存在且原因可见 |
| 2 | QC passed 未 approved 不进有效 VideoPlan | avatar/plan | passed 无 approved review | 打开人物页/方案页 | avatar 门禁清单「文案批准」✗ + 「确认前请返回文案与质检完成当前有效批准」；plan 创建门禁列原因 | 回文案页完成人工批准 | `avatar-selection-service`（approved_copy_missing）；`video-planning-service` gate 测试 | e2e 跨页：确认按钮禁用原因可见 |
| 3 | revoked Review 不可恢复 | copy/plan | approved → revoked | 尝试再次操作 | 「已撤销」灰+原因；再次批准必须新周期入口 | 新 CopyVersion/新方案→新审核 | `copy-review-service`「revoked approval never restores…」；plan 侧同类 | — |
| 4 | 相关上游变化撤销下游批准；无关展示变化不撤销 | copy/avatar/plan | 全链已批准 | 改商品名称（相关）/改展示名（无关） | 相关：amber「批准已失效/已撤销」横幅，下游 current_valid=false；无关：无变化 | 重新质检+重新审核 | `copy-review-service:203,221,232`；`video-planning-service:203,228`；`avatar-selection-service:140,154` | e2e 断言横幅出现在下游页面 |
| 5 | Local Agent 离线不阻断方案审核与等待工单 | plan/production | 执行环境离线 | 预检/提交审核/创建工单 | 仅 amber 提醒「不影响保存、预检与方案审核」；工单「等待执行」信息蓝 | 无（正常路径） | `video-planning-service:73`；`production-order-service:183`；A09-A12 browser 默认离线 fixture | e2e 全程离线跑通（§7 前置） |
| 6 | 重复点击不产生重复工单 | production | 方案已批准 | 双击确认创建 | 工单列表恰 1 条 | — | `production-order-browser`（dblclick→1）；`production-order-service:193` | — |
| 7 | 包生成/下载不创建 ExecutionAttempt | production | 工单 waiting | 生成+下载 | 包「可下载」；执行区仍显示领取入口；「下载不代表开始执行。」 | 领取才开始执行 | `manual-handoff-package-api:35`；`manual-handoff-package-browser` | e2e 断言下载后 manual 面板无 attempt |
| 8 | 报告 completed 不直接使工单 succeeded | production | attempt running | 提交 completed 报告 | 「执行结果已提交，候选作品等待后续核验。」；工单非「已完成」 | 发起核验 | `manual-execution-service:118`；`manual-execution-api:36`；`manual-execution-browser` meta 断言 | — |
| 9 | 核验失败不创建 Work | production | 候选已上传 | 发起核验（受控失败） | 「核验失败」红+业务原因；无作品卡；工单不 succeeded | 更正报告→重新核验 | `work-verification-a12:88,99,110,183` | e2e 断言作品卡不出现 |
| 10 | 同一候选最多一个 Work | production/API | 核验已通过 | 重复发起核验 | 幂等收敛；仍一个作品 | — | `work-verification-a12:252`；`work-verification-service:71` | — |
| 11 | 跨 Organization ID 全部拒绝 | 各页/API | 两个组织 | 携带外组织 ID 访问/操作 | 业务文案「此对象不在本企业可用范围内」或 404 不泄漏 | 回本组织页面 | 15 个现存隔离测试（`assets-api:118`、`project-content-service:308`、`production-order-service:219`、`manual-handoff-package-api:86`、`work-delivery-service:156` 等） | e2e 增加 URL 级外组织 ID → 不崩溃+业务文案 |
| 12 | 包/报告/日志不含 Secret/永久 URL | production/包内容 | 包 ready | 下载并检查 | UI 无禁词；manifest/README 文本无 token/签名 URL/永久路径 | — | `manual-handoff-package-api:35`；`manual-handoff-package-service:151`；`assets-api:212`；`identity-auth:96`；两个 browser 禁词断言 | e2e 对下载 ZIP 的 **manifest.json/README.md 文本** 做禁词扫描（不扫二进制，遵守 A10 既定边界） |
| 13 | 重复交付请求不产生重复事件 | works | 已交付 1 次 | 双击/重放交付 | 「已交付 · 共 1 次」不变；同 key 回放首次结果 | 真实再交付须新明确命令 | `work-delivery-service:126`；`work-delivery-api:91`；PG 集成测试 | browser 层双击断言 |
| 14 | 未认证访问企业页 | 任意 | 未登录 | 直接打开 `/copy.html?…` | 重定向 `/login.html` | 登录 | 各页 `request()`/shell.js 统一行为；`identity-browser` 覆盖登录生命周期 | e2e 首步断言 |
| 15 | member 执行审核决定（forbidden） | copy | pending review | member 视角查看 | 无批准按钮；「当前账号为只读审核视角，请联系管理员完成决策。」 | admin 处理 | copy.js 行为 + A06 服务门禁 `COPY_REVIEW_FORBIDDEN` | e2e 断言 member 无批准控件 |
| 16 | 409 乐观并发（逐页） | project/copy/plan/members/avatar/works | 两人编辑同一对象 | 后保存者提交 | copy 三选项条；plan「版本冲突：没有覆盖他人的修改。」；members/avatar/works 各自冲突文案；**project 当前文案错误（G3）** | 查看最新/复制/放弃/刷新 | `copy-generation-browser` 冲突段；`project-content-service:102` 等 | B3 修复后补 project 页 409 browser 断言 |
| 17 | feature-off 直达 URL | works 等 | `worksEnabled=false` | 直接打开 `/works.html` | `#worksUnavailable` 不可用面板，无假入口；导航无「作品库」 | 开启功能或离开 | `work-delivery-browser`（feature 入口与禁用说明）；`assets-browser` 两个 feature-off 测试 | e2e 覆盖 works/production 门禁 |

未发现 Issue #70 场景与仓库事实冲突。

---

## 9. 动效与反馈加固

### 9.1 规范（Stage 0 既定，仍为权威）

只允许五种场景、120-240ms、ease-out（`cubic-bezier(0.2,0,0.38,1)`，token：`--motion-fast: 140ms`、`--motion-panel: 220ms`）：①保存/确认成功 notice 淡入；②上传 spinner + 行状态换色 cross-fade 120ms；③异步任务状态色过渡 120ms；④抽屉/对话框 opacity+translateY(8px→0) 200-220ms；⑤选中行/tab 背景边框色过渡 120-150ms。禁止：循环/呼吸/视差/数字滚动/假进度/按压位移/任何 >240ms。

### 9.2 现状符合度（事实）

- 符合：`base.css` `dialog-in` 220ms、`notice-in` 140ms；focus ring 统一；`prefers-reduced-motion` 压零开关存在于 `base.css`、`styles.css`、`works.css`；VSA 页无 toast（通知全部 inline `.notice`）；无假进度（异步全部「状态徽章+轮询」，无百分比）。
- 越界：**G8** `works.css:21` hover `translateY(-1px)` 装饰位移（删除，保留 border/背景过渡）。遗留 `styles.css` 的 `:active` 按压位移属遗留页，不在 A14 范围。
- 回归依据：`frontend-foundation-browser` 已断言 reducedMotion 下 `transitionDuration < 0.001`；A14 e2e 沿用该断言到 copy/production/works。

### 9.3 交互过渡规格（实现核对表）

| 交互 | 规格 | 现状 |
|---|---|---|
| 行/版本/人物选中 | 背景 tint + 左边框 3px 过渡 120-150ms | ✓（`.is-selected` 等） |
| 面板/抽屉/对话框 | `dialog-in` 220ms opacity+translateY(8px) | ✓（`base.css:78`） |
| 校验错误出现 | `notice-in` 140ms 淡入，无位移弹跳 | ✓ |
| 异步提交 | 按钮禁用 + spinner + 文案不变；状态徽章 cross-fade 120ms | ✓（改写双击测试佐证禁用） |
| 状态刷新（轮询转态） | 徽章色 cross-fade 120ms，无布局跳动 | ✓ |
| 冲突恢复条出现 | `notice-in` 140ms；本地输入保留不清空 | ✓（copy/plan）；project 页文案缺陷见 B3 |
| reduced-motion | 全部过渡/动画 ≤0.01ms；spinner 换静态文案 | ✓ 全局 media query |

---

## 10. 小型集成缺陷实施积压

> 边界：只含 A14 允许的「小型集成缺陷修复」；不新建领域对象/页面/全局导航；不改 API 合同与数据库。每项含回归风险与测试证据。优先级：P0 = 阻断全链路连贯/验收；P1 = 明确缺陷或合同违背；P2 = 打磨与一致性。

### 10.1 P0

**B1 — 全链路端到端主路径浏览器测试（Issue #70 核心交付，非缺陷）**
- 新增：`test/vsa-main-path-browser.test.js`（建议名）；可新增 `test/helpers/browser-world.js` 收敛现有 13 个 browser 测试复制的启动样板（只供新测试使用，不重构旧测试）。
- 内容：§7 脚本 23 步；1440 与 390 双视口；§5.2 保证项断言。
- 回归风险：低（纯新增）。证据：真实系统 Chrome 实跑通过；环境缺 Chrome/禁 TCP 时明确 skip（不记为 pass）。

**B2 — 企业链路的连贯着陆与 forbidden 去向（修复 G1/G5）**
- 当前缺陷【事实】：登录/改密/已登录重进一律 `location.assign("/")`（`web/login.js:66,69,83`）落遗留工作台；非 admin 访问 members 被 `location.replace("/")`（`web/members.js`）。
- 期望行为：定义唯一「企业首页目标」=`projectContentEnabled ? "/projects.html" : "/"`；login.js 在登录成功/改密成功/me 命中三处按 `/api/runtime` 选择目标；members.js 非 admin 改为到同一目标（feature off 时自然回到 `/`，无循环）。
- 影响文件：`web/login.js`、`web/members.js`。
- 回归风险：`identity-browser`（仅 identity 开启 → 目标仍为 `/`，不变）；`frontend-foundation-browser`（开启 projectContent，登录后断言需从 `/` 改为 `/projects.html`）；`assets-browser` 两个 feature-off 测试（不变）；遗留 workbench 与 gui-smoke 不动。Owner 已明确进入 A14，本项作为 A14 有界集成修复执行，不改 feature-off 的遗留兜底行为。
- 测试证据：更新后两个 browser 测试实跑；新增断言「登录后落在企业页且导航含项目」。

### 10.2 P1

**B3 — project.js 409 冲突文案被覆盖（修复 G3）**
- 当前缺陷【事实】：`web/project.js:15` `else` 无大括号，`notice.textContent = "保存失败，请稍后重试。"` 对 409 分支同样执行；Stage 0 合同文案「页面内容已过期，请刷新后继续。」不可达。
- 期望行为：409 → `.notice.blocked` +「页面内容已过期，请刷新后继续。」；其他错误 → `.notice.error` +「保存失败，请稍后重试。」。
- 影响文件：`web/project.js`（一处控制流修复）。
- 回归风险：极低；`project-content-browser` 未断言 409 文案。
- 测试证据：新增/扩展 browser 断言——制造 stale `expected_revision` 后保存，断言 blocked 类与合同文案。

**B4 — 商品页商品级上下文进 URL（修复 G4）**
- 当前缺陷【事实】：`project.js:2` 仅读 `id`；刷新/深链/从文案页「查看商品事实」返回均落到第一个商品。
- 期望行为：商品切换时 `replaceState` 写入（建议 `revision` 参数，与下游页面既有参数名一致）；加载时优先恢复该参数指定的商品；`copy.js:90` 的 `#productFactsLink` 追加同一参数。
- 影响文件：`web/project.js`、`web/copy.js`（各一处）。
- 回归风险：`project-content-browser` 流程断言（创建/Ready/刷新恢复）需保持通过；注意 `loadProject(selectRevisionId)` 已支持按 revision 选择，改动面小。
- 测试证据：browser 断言——选商品 B → 刷新 → 仍为商品 B；从 copy 页点「查看商品事实」→ 落商品 B。

**B5 — 素材核验轮询（修复 G6）**
- 当前缺陷【事实】：`assets.js` 无轮询；「核验中」行需手动刷新。
- 期望行为：存在 `upload_pending/uploading/verifying` 行时启动轻量轮询（建议 2s，与全站节奏一致），全部终态后停止；保留「可以离开此页面」语义。
- 影响文件：`web/assets.js`。
- 回归风险：`assets-browser`「刷新恢复核验中→通过」流程需保持通过。
- 测试证据：browser 断言——上传后不手动刷新，行状态自动转为通过/失败。

### 10.3 P2

**B7 — 设计 token 补缺（修复 G7）**
- `web/tokens.css` 增补 `--n-600`、`--n-800`（按 Stage 0 中性色阶插值：建议 `#475467`/`#1d2939`）、`--shadow-control`；`web/copy.css:71` 的 `var(--surface)` 改为 `var(--n-50)`。
- 回归风险：纯视觉；以 1440/390 截图比对（Finding 命中卡片恢复底色）。
**B8 — 移除 works.css:21 hover `translateY(-1px)`（修复 G8）**；保留 border/背景过渡；reduced-motion 断言沿用。
**B9 — 清理 production.js 死控件（修复 G9）**
- 当前【事实】：`#recoverWorkVerification` 永久隐藏且 `recoverWorkVerification()` 使用 `window.prompt`。
- 期望行为：删除死按钮与死函数（服务端 `POST /api/work-verification-jobs/:id/recover` 保留不动；业务 requires_action 的正式路径是更正报告，技术失败是重试——UI 均已覆盖）；实现时先检索 `test/` 确认无断言引用该控件。
- 回归风险：低。
**B10 — 记录项（不在 A14 改代码）**：断点碎片化（420/680/760/820/900/1050/1080/1120）；「素材中心 vs 人物与素材」命名；遗留页 pill 无作品库入口。均记入后续视觉/IA 跟进，不阻塞 A14。

### 10.4 DESIGN_BLOCKER 判定

**无 DESIGN_BLOCKER。** 两处曾被设计文档推迟到 A14 裁决的事项，本审计裁决如下，均不与 Issue #70 冲突：
1. 全局「生产任务」页（LF-009）→ 继续推迟（§3.5-1），跨项目聚合缺口记为 Slice A 后跟进项；
2. 登录着陆页 → Owner 已明确进入 A14，以 B2 有界修复处理，而非新建首页。

---

## 11. 自动化测试与截图验收计划

### 11.1 端到端主路径测试（新增 1 个）

- 文件：`test/vsa-main-path-browser.test.js`；启动方式沿用现有 browser 测试模式（`identityApp` 全 flag + `findAvailablePort` + `app.listen` + 系统 Chrome，`IDENTITY_BROWSER_EXECUTABLE` 可覆盖，缺环境 `t.skip`）。
- 内容：§7 全部 23 步；双账号（admin/member）；`agentReadinessPort` 离线；受控 provider/evaluator。
- 横切断言（每阶段）：URL 参数合同（§3.3）；刷新恢复；阶段条当前项 `aria-current="step"`；导航顺序恰为 `[项目, 素材中心, 作品库, 成员管理]`（沿用 `work-delivery-browser` 的断言方式）；无横向滚动（1440/390）；禁词扫描（全链）。
- 禁用原因断言：Ready 门禁三条、生成禁用 title、提交审核门禁列表、确认人物门禁清单、创建工单禁用 notice、领取禁用 title、交付前禁用原因——逐一断言「为什么/下一步/谁处理」三要素至少其二可见。

### 11.2 负路径测试（以复用为主，缺口最小新增）

- 复用：§8 矩阵「已有自动化证据」列的全部 service/API/browser 测试直接纳入 A14 验收套件。
- 新增（browser/API 小断言）：
  1. project 页 409 文案（B3 回归）；
  2. project 页商品级刷新恢复与 copy→project 回链（B4 回归）；
  3. assets 自动转态（B5 回归）；
  4. 跨组织 URL ID 直达不崩溃 + 业务文案（API 已有 15 个隔离测试，browser 补 1 条）；
  5. 下载 ZIP 的 manifest.json/README.md **文本** 禁词扫描（token/signature URL/永久路径模式；不扫二进制，遵守 A10 边界）；
  6. works 交付双击（browser 层幂等）；
  7. 登录着陆断言（B2 回归，含 projectContent on/off 两态）。

### 11.3 截图检查点（1440 × 390 双视口）

建议沿用既有环境变量模式：`A14_SCREENSHOT_DIR` 设置时才产出，不进仓库（与 A04/A05/A09 一致，截图存仓库外）。

| 页面 | 状态检查点 |
|---|---|
| login | 登录态 / 改密态 / 错误态 |
| projects | 真空 / 多条 / 创建对话框 / 加载失败 |
| project | 无商品 / 草稿编辑 / Ready 阻断条 / 已 Ready / **409 blocked（B3 修复后）** |
| assets | 真空 / 核验中-通过-失败三态行 / 上传中 |
| copy | 空 / 生成中 / passed 未提交 / pending（admin 与 member 双视角）/ approved 当前有效 / 失效横幅 / 409 三选项 |
| avatar | 目录 / 门禁清单未过 / 确认对话框 / 已确认 |
| plan | 空 / 草稿未保存禁预检 / 预检提醒 / 审核对话框 / 已批准+入口 |
| production | 空工单 / waiting+离线提醒 / 包 ready / 开始对话框 / 报告对话框 / 核验中 / 作品卡 |
| works | 列表双筛选 / 待检查 / 通过确认对话框 / 已交付 / 返工禁用态 |

### 11.4 skip 与 pass 的区分（沿用现有纪律）

- 系统 Chrome 不可用 / 本地禁 TCP（EPERM）→ `t.skip("…")`，**不记为通过**；可用环境（CI 或本机系统 Chrome）定向实跑的结果单独记录。
- PostgreSQL 集成：无 `IDENTITY_TEST_DATABASE_URL`/`TEST_DATABASE_URL` 一律 skip；以 CI PostgreSQL 任务为权威证据。
- `identity-browser` 需 `IDENTITY_BROWSER_SMOKE=1`。
- A14 验收报告必须分开列示：实际通过数 / 环境 skip 数及原因 / CI 运行号。

---

## 12. Codex / luna-worker 实施交接

### 12.1 允许范围

- `test/`：新增 `vsa-main-path-browser.test.js` 与必要的负路径断言；可新增 `test/helpers/browser-world.js`（仅供新测试）；按 B2/B3 更新 `frontend-foundation-browser` 等既有断言。
- `web/`：仅 B2-B5 与 B7-B9 列明的文件（`login.js`、`members.js`、`project.js`、`copy.js`、`assets.js`、`tokens.css`、`copy.css`、`works.css`、`production.js` 死代码）。
- 文档：状态/会话文档由主控按治理流程固化（实现者不代写状态快照之外的文件）。

### 12.2 禁止范围

- 不新建/首次实现任何主要领域对象（ProductRevision…DeliveryRecord，Issue #70 明令）；不改 `src/` 领域服务、API 合同、路由、数据库/migration；不改 `package.json`/lockfile/依赖；不改造遗留 `index.html`/`styles.css`/`app.js` 视觉；不建全局「生产任务」页、首页、审计查看器；不访问 Hifly、不调真实 Provider、不跑 Capture HTTP/批次、不消耗积分；不做 git commit/push/PR/合并（等 Owner 授权流程）；不新增哈希/SHA-256 用途或超出既有合同的防御代码。

### 12.3 建议文件清单与复用点

- 复用：`test/helpers/identity-world.js`（`identityApp`/`intent`/`login`/`activateAdmin`）；`src/server/app.js` `buildApp` + 各 memory repository + `createFakeExecutor`；受控 doubles（`createControlledCopyProvider`/`createControlledQualityEvaluator`/preflight evaluator）；`buildManualHandoffZip`；`findAvailablePort`。
- 参考断言模式：`work-delivery-browser`（导航顺序/禁词/移动吸底）、`copy-generation-browser`（409 三选项/截图）、`production-order-browser`（双击幂等）、`manual-execution-browser`（报告不等于完成）。

### 12.4 有序 TDD 任务

1. **T1（B2）**：先写失败断言（登录后落 `/projects.html`、members forbidden 去向），再改 `login.js`/`members.js`，更新 `frontend-foundation-browser`。
2. **T2（B1）**：e2e 主路径 1440 全绿（§7 步骤 1-22），再补 390 与刷新/深链断言（步骤 23）。
3. **T3（B3/B4）**：先写 409 文案与商品级恢复的失败断言，再改 `project.js`/`copy.js`。
4. **T4（B5）**：assets 轮询，先断言后实现；成员列表加载占位仅记录为视觉欠账，不为基本不可达的「零成员 Organization」增加防御分支。
5. **T5**：§8 矩阵中 5 条新增负路径断言（跨组织 URL、ZIP 文本扫描、交付双击等）。
6. **T6（B7/B8/B9）**：token 补缺、移除 hover 位移、删死控件；截图比对。
7. **T7**：`A14_SCREENSHOT_DIR` 截图检查点（§11.3）双视口实跑，仓库外留存。
8. **T8**：`npm run check` + 全量 `npm test` + `git diff --check`；CI Ubuntu/Windows/PostgreSQL 绿；skip/pass 分列记录。

### 12.5 映射到 Issue #70 的 Definition of Done

- 「End-to-end main-path automated test; cross-page navigation」→ T1+T2（§7 脚本全绿，含导航顺序与上下文断言）。
- 「Permission & Organization isolation regression」→ §8-11/14/15 复用 15 个隔离测试 + 新增 URL 级断言。
- 「Invalidation-propagation regression」→ §8-3/4 复用既有 service 测试 + e2e 横幅断言。
- 「Error/empty/concurrency UX hardening」→ B3/B4/B5 + §6 表逐状态核对。
- 「AuditEvent & redacted-log verification」→ 复用 `identity-auth:96`、`manual-handoff-package-api:35` 等 + 新增 ZIP 文本扫描；不建 UI。
- 「Small integration-defect fixes」→ B2-B9 全部，无新对象。
- 「Disabled actions must explain why…」→ §11.1 禁用原因断言覆盖全部门禁点。

### 12.6 A14 是否需要新领域模型

**不需要。** Issue #70 的全部行为在 A01～A13 已有服务端实现与 service/API 测试；本审计发现的缺口全部是 `web/` 缝合层缺陷与 `test/` 跨页证据缺口。A14 = 端到端测试 + 小型集成加固，可在不触碰任何领域状态机的前提下完成。

---

## 13. 运行时证据与结论

### 13.1 运行时身份

- 请求值：模型 `kimi-code/k3`；reasoning effort `max`；上下文 `1048576`（1M）。
- 配置状态：主控已读取 `~/.kimi-code/config.toml`，确认 `[models."kimi-code/k3"]` 的 `max_context_size = 1048576`、`default_effort = "max"` 且 `[thinking] enabled = true`，记 **`CONFIG_VERIFIED`**。
- 运行时验证：CLI 不暴露实际服务端运行模型 → **`UNVERIFIED_RUNTIME_MODEL`**（不声称运行时已验证）。
- 本阶段合规：只新增本文档一个文件；未改 `web/`、`src/`、`test/`、API、migration、状态/交接文档；未 commit/push/PR；未访问 Hifly、未调真实 Provider、未跑 Capture HTTP/批次、未消耗积分。

### 13.2 业务冲突

**无。** 仓库事实与 Issue #70 不冲突；两项曾推迟到 A14 的裁决（全局生产任务页、登录着陆）已分别按「继续推迟」与「有界修复 B2」处理（§10.4）。

### 13.3 结论与推荐实施顺序

A01～A13 的链路与 D-027/D-028/D-029/D-030 的合同在实现层一致；缺口集中在登录着陆、商品页上下文持久化、一个 409 文案缺陷与若干 P2 一致性项。A14 可以且应当以「一条端到端主路径测试 + 有界缝合修复」完成，不需要新领域模型。

推荐顺序：**T1 着陆修复 → T2 e2e 主路径 → T3/T4 P1 缺陷 → T5 负路径补强 → T6 P2 → T7 截图 → T8 全量回归与 CI**。
