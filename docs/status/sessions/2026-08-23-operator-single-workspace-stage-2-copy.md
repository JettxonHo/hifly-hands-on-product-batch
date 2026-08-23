# 运营单任务工作区 Stage 2 文案

> 执行日期：2026-08-23 至 2026-08-24
> 固定基线：`origin/main@f87c2068d4668f72f40396ddfc815c0a472fc003`
> 治理入口：Issue #240；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，Stage 2 才计为仓库实现；本次没有部署或生产验收

## Product/API gate

- 现有 CopyGeneration、CopyQuality 与 CopyReview service/API 已分别持有 CopyVersion、异步生成、QualityResult 和
  HumanReview 真值，不需要新领域状态、数据库 schema 或跨阶段写聚合。
- operator workspace 只 additive 读取 current ProductRevision 下的 exact current 或明确请求的历史 CopyVersion。
  `avatar`、`video_plan`、`production` 保持 `legacy/not_loaded`，本切片没有读取这些领域 service。
- Copy 写命令继续走既有 API；聚合投影不接管保存、质检或人工审核语义。QC `passed` 不等于 HumanReview
  `approved`，只有当前有效批准才出现“进入人物”。
- 方案 A 的目标只按 Taste Scan -> Diagnose -> targeted upgrade 落到既有 vanilla HTML/CSS/JS 和 opt-in workspace；
  没有搬运 throwaway 原型、引入框架或修改未迁移页面的共享视觉合同。

## RED -> GREEN

1. Service RED：Stage 2 请求预期 `render_mode=workspace`，基线实际返回 `legacy`；GREEN 后投影 exact CopyVersion、
   generation、quality 和 human review，且后续三阶段保持 zero-read `legacy/not_loaded`。
2. Deep-link RED：请求历史 CopyVersion 时仍返回 current 版本；GREEN 后历史版本只读并唯一推荐回到 current，组织、
   project、product 与 current ProductRevision 任一不匹配都使用统一 404。
3. Browser RED：公开真实 Chrome seam 锁定生成、保存、QC、人工提交/批准、上游/历史、409、本地 dirty、Back/Forward、
   initial fail-once、unknown action fail-closed、Tab 键盘与三视口；GREEN 后每个状态最多一个
   `data-recommended-action`，审批 409 保持 Dialog，不提前关闭。
4. Reliability RED：受影响浏览器默认并行组首次 10/11，Stage 2 seam 与既有 Production 同抢 `58900`；为 Stage 2
   两条顶层测试分配独立 `59200` / `59250` 端口段后，同一默认并行命令 11/11。
5. Review RED：CopyGeneration memory/PostgreSQL repository 均以 newest-first 返回任务，投影却复用了只适合
   oldest-first QualityRun 的 `at(-1)`，导致旧失败任务覆盖新 queued/running 任务；service 与默认 App API 回归均先稳定
   复现 `job-old`，GREEN 后使用显式 newest-first 选择器，活动新任务期间不再出现重试建议。
6. Review RED：真实 `needs_review` 首屏只有 finding 文本，无法调用已有 resolution API；GREEN 后每个未处理 review
   finding 提供“接受并填写理由 / 返回商品资料 / 人工修改文案”三条既有安全路径，理由为空阻断，409 保留 Dialog 和输入，
   全部判断项真实成为 effective `passed` 后才开放提交人工审核。`hard_block` 没有接受入口。AI 改写仍保留在既有 Copy
   页面，本次没有迁入单任务工作区，也没有用假状态替代。
7. Screenshot run 首轮 2/3：历史 -> current 的测试在 URL 已切换、异步 render 尚未完成时立即读取 editor 状态；将断言
   改为等待公开可编辑状态后，同一真实 Chrome 文件 3/3。此项只修测试观察时序，没有改变页面或领域语义。

## 实现边界

- 服务端 operator workspace 在 Copy stack 可用时才迁移 `copy`；Copy 能力未开启时仍安全回既有 `/copy.html`，并绑定
  当前商品的 exact current revision。
- action registry v1 仅 additive 登记 Stage 2 文案动作，并固定 stage/kind/中文标签。未知 registry、未知 code、错
  stage 或错 kind 均禁用主动作和阶段链接，只保留 scoped“刷新当前文案”。
- 浏览器使用实时 product/copy context 生成链接，不携带跨商品的旧具名上下文。权威读取失败时清除 stale Copy/QC/review，
  桌面与移动 10 个阶段链接全部禁用；恢复成功后按 exact current 对象重建。
- dirty 保存、派生、历史只读、409 保留本地正文、异步 polling、QC/人工审核分离、完整 Tab roving focus、Dialog 焦点、
  390 列表 -> 详情 -> 返回和 reduced-motion 均由公开 seam 覆盖。
- 生成任务投影遵循 CopyGeneration repository 的 newest-first 合同；QualityRun 继续遵循其 oldest-first 合同，二者不再
  共用含糊的“latest”位置假设。质检 finding 控件是上下文次级动作，不添加 `data-recommended-action`，主状态仍最多一个
  推荐动作。

## 精确 allowlist

1. `src/operator-workspace/operator-workspace-service.js`
2. `src/server/app.js`
3. `src/server/routes/operator-workspace.js`
4. `web/workspace.html`
5. `web/project.js`
6. `web/workspace.css`
7. `web/workspace-copy.js`
8. `test/operator-workspace-service.test.js`
9. `test/project-content-api.test.js`
10. `test/project-content-postgres.integration.test.js`
11. `test/operator-single-workspace-stage-2-browser.test.js`
12. `docs/status/CURRENT.md`
13. `docs/ROADMAP.md`
14. `docs/status/sessions/2026-08-23-operator-single-workspace-stage-2-copy.md`

`src/server/routes/operator-workspace.js` 与新 `web/workspace-copy.js` 在代码编辑前已通过 Issue #240 scope checkpoint 从初始
12 文件扩为最终 14 文件；没有进一步扩张。

## 验证

- 复审修复 focused service/API：84/84 pass；其中 exact changed matrix（workspace service、默认 App API、Stage 2
  browser）22/22 pass。
- 本地一次性 PostgreSQL 16：`test/project-content-postgres.integration.test.js` 1/1 pass，容器随后移除。
- 复审修复真实 Chrome：Stage 1/Stage 2/旧 Copy/Avatar 组合先完成 9/9，随后既有组合进入无输出长等待并被如实停止；
  剩余 Project/Plan/Production 拆分组 3/3 pass。两组共同覆盖本次计划的 12 条受影响浏览器路径，不把被停止的组合命令
  记作整体通过。
- Stage 2 真实 Chrome：3/3 pass，新增 needs_review resolution、理由必填、409 恢复与 hard-block fail-closed。
- `npm run check`：244 JavaScript files。
- 默认 `npm test`：1123 total / 1108 pass / 15 existing environment-gated skips / 0 fail。
- 临时 PNG：approved 与 needs_review 全状态组位于 `/private/tmp/hifly-stage-2-review-screenshots-20260824d/`，
  needs_review 最终人工核对组位于 `/private/tmp/hifly-stage-2-review-screenshots-20260824e/`；PNG 头分别为
  1440x900、768x900、390x844，人工核对 findings、上下文次级动作、唯一底部主动作及三视口层级均无页面级横向
  滚动。二进制未提交。
- fixed-head GitHub CI 以 Draft PR 的 checks 元数据与最终结果评论为准；session 不在提交正文中自引用最终 head。

## 未执行边界

没有开始 Stage 3，没有新增 Avatar preview、Plan 或 Production 投影；没有部署、SSH、访问 Hifly/Provider、启动 Worker
或 Local Agent、修改生产数据、创建真实工单、生成视频或消耗积分。
