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

## 实现边界

- 服务端 operator workspace 在 Copy stack 可用时才迁移 `copy`；Copy 能力未开启时仍安全回既有 `/copy.html`，并绑定
  当前商品的 exact current revision。
- action registry v1 仅 additive 登记 Stage 2 文案动作，并固定 stage/kind/中文标签。未知 registry、未知 code、错
  stage 或错 kind 均禁用主动作和阶段链接，只保留 scoped“刷新当前文案”。
- 浏览器使用实时 product/copy context 生成链接，不携带跨商品的旧具名上下文。权威读取失败时清除 stale Copy/QC/review，
  桌面与移动 10 个阶段链接全部禁用；恢复成功后按 exact current 对象重建。
- dirty 保存、派生、历史只读、409 保留本地正文、异步 polling、QC/人工审核分离、完整 Tab roving focus、Dialog 焦点、
  390 列表 -> 详情 -> 返回和 reduced-motion 均由公开 seam 覆盖。

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

- focused service/API：75/75 pass。
- 本地一次性 PostgreSQL 16：`test/project-content-postgres.integration.test.js` 1/1 pass，容器随后移除。
- 真实 Chrome 受影响默认并行组：11/11 pass，覆盖 Stage 1、Stage 2、旧 Copy、Avatar、Plan、Production 与共享壳层。
- Stage 2 真实 Chrome：2/2 pass。
- `npm run check`：244 JavaScript files。
- 默认 `npm test`：1120 total / 1105 pass / 15 existing environment-gated skips / 0 fail。
- 临时 PNG：`/private/tmp/hifly-stage-2-screenshots-20260824a/`；PNG 头分别为 1440x900、768x900、390x844，
  人工核对为桌面三段式、768 两栏、390 单面板，无页面级横向滚动。二进制未提交。
- fixed-head GitHub CI 以 Draft PR 的 checks 元数据与最终结果评论为准；session 不在提交正文中自引用最终 head。

## 未执行边界

没有开始 Stage 3，没有新增 Avatar preview、Plan 或 Production 投影；没有部署、SSH、访问 Hifly/Provider、启动 Worker
或 Local Agent、修改生产数据、创建真实工单、生成视频或消耗积分。
