# 运营单任务工作区 Stage 4 视频方案

> 执行日期：2026-08-24
> 固定基线：`origin/main@4293be0e80deafc0d844f596239626be4bcdead4`
> 治理入口：Issue #244；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，Stage 4 才计为仓库实现；本次没有部署或生产验收

## Product/API gate

- 现有 VideoPlanning service/API 已持有 VideoPlan 创建、保存、派生、preflight run/result/history、人工审核、上游失效、
  idempotency、optimistic conflict 与组织隔离真值；不需要新领域状态、数据库 schema、权限角色、跨阶段写聚合或依赖。
- operator workspace 只 additive 调用既有 `getWorkspace`，并把 exact current VideoPlan、preflight 与人工审核投影为公开业务
  真值。selected plan、run/result/review/history 必须绑定 exact organization/project/product/plan；错配或字段缺失 fail
  closed，不以旧版本或其他商品的数据补位。
- Stage 1 商品资料、Stage 2 文案与 Stage 3 人物继续使用已合并投影；Stage 5 Production 固定
  `legacy/not_loaded`，counted/throwing 端口和默认 App API 证明 Stage 4 请求零读取 Production service。进入生产只导航
  到既有页面，不创建工单、不推断 eligible、attempt、Worker、A12 或 Work。
- VideoPlanning workspace/API 在同一 project/product/current ProductRevision 与 current valid AvatarSelection 上工作；
  preflight passed/warning 与人工批准保持独立。未命中 Product/API stop condition。

## RED -> GREEN

1. Projection RED：基线 `stage=video_plan` 仍为 `legacy/not_loaded`；GREEN 后 projection/action registry 只 additive 增加
   Stage 4 所需动作，精确投影 current/historical VideoPlan、preflight run/result/history 和 human review。unknown registry/
   code、wrong stage/kind、对象绑定错配与读取失败均 fail closed，且没有 stale action。
2. Default App/API RED：默认装配不能从 operator workspace 读取 VideoPlan；GREEN 后仅在既有 VideoPlanning stack 与
   operator workspace 同时启用时注入读取端口，精确转发 `plan` 深链。Production 注入 counted/throwing port 仍为零调用；
   缺失、跨组织或错商品继续统一安全 not-found，领域读取失败为可恢复 503。
3. Browser RED：基线方案入口回旧 `plan.html`，没有单工作区编辑、preflight、人工审核、历史或冲突恢复。GREEN 后复用
   既有 VideoPlanning 写 API 完成创建/保存/派生、运行预检、提交审核、批准或要求修改；dirty 与 409 保留本地输入，载入
   最新后才继续。历史版本只读，Back/Forward、scoped refresh 和 initial fail-once 都保持 URL、对象与表单 authority 对齐。
4. Truth separation RED：基线无法在单工作区证明 preflight 与人工批准分离。GREEN 后 queued/running/failed 与
   passed/warning/blocked/invalidated 分别投影；passed/warning 只开放提交人工审核，pending review 才允许有权管理员批准或
   要求修改，approved 才允许进入既有 Production 页。上游人物失效时唯一安全动作返回人物，不自动重建方案。
5. Compatibility RED：Stage 4 additive projection 使 Stage 1/2/3 的严格“所有后续阶段必须 legacy”客户端校验拒绝新响应，
   且共享阶段链接使用了页面初始化时不可见的 workspace 变量。GREEN 后各旧 Stage 接受已经迁移阶段的 `workspace/ok|error`
   投影但仍要求 Production `legacy/not_loaded`；非当前已迁移阶段读取错误保留准确 workspace URL 和中性错误态，当前阶段
   权威读取失败则禁用全部阶段链接并只留 scoped refresh。
6. Responsive RED：基线没有 Stage 4 的单任务 composition。GREEN 后 1440 使用商品列表、当前任务、辅助上下文与固定操作区；
   768 独立收敛为两栏；390 使用单面板、紧凑阶段入口和底部主动作。三者共享业务真值但不把桌面实现成放大移动布局。

## 实现边界

- Stage 4 只对现有 opt-in vanilla HTML/CSS/JS 做 targeted upgrade；没有搬运 throwaway 原型、引入框架/依赖、改动
  VideoPlan 状态机或新增公共写 API。
- client dirty、saving、conflict 与 read error 可以在 persisted recommended action 之上 fail closed；服务端计划、preflight、
  review 与 history 仍是领域真值。每个状态最多一个 `data-recommended-action`，上下文按钮不与底部主动作竞争。
- 技术 ID、row version、preflight run/result 与审核历史在折叠详情中可访问；业务主层使用中文。刷新只重读当前商品的 exact
  Product/Copy/Avatar/VideoPlan workspace，不宣称刷新 Production 或全站状态。
- Stage 5 Production、安全门禁、Worker、eligible、attempt、handoff、A12、Work 与失败停批语义完全未迁移、未推断。

## 精确 allowlist

1. `docs/ROADMAP.md`
2. `docs/status/CURRENT.md`
3. `docs/status/sessions/2026-08-24-operator-single-workspace-stage-4-plan.md`
4. `src/operator-workspace/operator-workspace-service.js`
5. `src/server/app.js`
6. `src/server/routes/operator-workspace.js`
7. `test/operator-single-workspace-stage-4-browser.test.js`
8. `test/operator-workspace-service.test.js`
9. `test/project-content-api.test.js`
10. `web/project.js`
11. `web/workspace-avatar.js`
12. `web/workspace-copy.js`
13. `web/workspace-plan.js`
14. `web/workspace.css`
15. `web/workspace.html`

## 验证

- service/API/VideoPlanning 非数据库聚焦组：51/51 pass；本地临时 PostgreSQL 16 的 VideoPlanning integration 1/1
  pass，验证后容器已停止。
- Stage 4 真实 Chrome：4/4 pass；Stage 1/2/3/4 与旧 Plan 页面组合：13/13 pass。公开 seam 覆盖创建、dirty/save、409、
  preflight、人工审核、历史、Back/Forward、initial/scoped recovery、unknown action、下游阶段中性错误态、Production
  zero-read、键盘 Tab、焦点、reduced-motion 与无页面级横向滚动。
- 1440x900、768x900、390x844 临时 PNG 位于 Git 外临时目录；SHA-256 分别为
  `b852b4a6b12ac3293d0ab9011f9e65e7ef45c6cc728ad65af8796d3eeba6e07a`、
  `94d1f85daa4fc313a6d6230dd8f0a8f460bdbf5a625d1c740d105bc6765b4277`、
  `b5e6c93fc05d7dfba33ef934f582130ddd2a697865e45d285bf339dcbf023f6c`。三张均已人工看图，截图只证明
  synthetic browser seam 的响应式 composition，不是部署、Provider 或生产数据证据；二进制未提交。
- `npm run check`：246 JavaScript files；official-registry audit 为 0 high/critical、2 个既有 moderate，均来自
  `exceljs -> uuid`，本片未执行 breaking `--force` 修复。
- 默认 `npm test` 未修改并发参数并自然完成：1148 total / 1133 pass / 15 existing environment-gated skips / 0 fail，
  约 138.1 秒。`git diff --check` 与严格 15 文件 allowlist 通过；fixed-head CI 的最终结果以 Draft PR 元数据和结果评论
  为准，session 不在提交正文中自引用最终 commit。

## 未执行边界

没有开始 Stage 5 或 Production 投影；没有新增领域状态、DB migration、依赖、组织队列或跨阶段写事务；没有部署、SSH、
访问 Hifly/Provider、启动 Worker 或 Local Agent、修改生产数据、创建真实候选/工单、生成视频或消耗积分。
