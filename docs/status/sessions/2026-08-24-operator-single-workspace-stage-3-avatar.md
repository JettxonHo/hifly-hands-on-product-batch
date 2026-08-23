# 运营单任务工作区 Stage 3 人物

> 执行日期：2026-08-24
> 固定基线：`origin/main@c6ce40166a9b68da58dfb91c77682148f9876c60`
> 治理入口：Issue #242；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，Stage 3 才计为仓库实现；本次没有部署或生产验收

## Product/API gate

- 现有 AvatarSelection service/API 已持有目录、推荐、显式确认、授权、能力 Evidence、历史与 optimistic conflict 真值；
  通用 Asset service 已持有组织隔离的短时授权与 exact verified bytes，不需要新领域状态、数据库 schema、角色或跨阶段事务。
- 现有目录表私有持有 `material_asset_version_id`，memory 与 PostgreSQL repository 均可按 actor organization 和 exact
  catalog ID 读取当前可见条目。人物 preview gate 因而能在服务端重核目录、私有绑定、父 Asset 与 exact AssetVersion，
  而不把内部 ID 投影给浏览器；未命中 Product/API stop condition。
- operator workspace 只 additive 读取 exact current approved CopyVersion 下的 Avatar workspace。Stage 1 商品资料与 Stage 2
  文案保持原投影；`video_plan`、`production` 继续 `legacy/not_loaded`，本切片没有读取这些领域 service。
- 人物选择仍由既有显式确认 API 写入；目录卡片和预览授权本身不提交选择，不改变 authorization/capability/material gate，
  也不把“选中”误写成人工确认。

## RED -> GREEN

1. Service RED：基线 Avatar service 没有 preview authorization；GREEN 后按 actor/org、可见 active 目录条目、私有素材绑定、
   父 Asset `active`、`kind=avatar_image`、exact version `available` 与 verified media/size/SHA-256 fail closed，再内部复用
   短时 Asset grant。父 Asset disabled、版本 unavailable、wrong kind、checksum/grant drift 均在返回 URL 前阻断。
2. API RED：`POST /api/avatar-catalog/:avatarId/preview-authorizations` 基线为 404；GREEN 后保持既有 identity/CSRF，缺失、
   跨组织或不可见统一 404，素材不可用为 422，瞬时读取/授权错误为 503。201 公共响应只含
   `url/expires_at/media_type/size/checksum_sha256`，不含 material ID、object key、永久/Provider URL、Cookie、token body、
   credential 或 Profile path。
3. Projection RED：`stage=avatar` 基线仍是 `legacy/not_loaded`；GREEN 后绑定 exact current ProductRevision、approved
   CopyVersion、AvatarSelection 与目录门禁，并保持 Stage 4/5 zero-read。action registry v1 只 additive 登记
   `return_to_copy`、`select_avatar`、`continue_to_video_plan`、`retry_avatar_read`；unknown version/code、wrong stage/kind
   均不显示、不执行动作。
4. Integration RED：真实默认 App 的 Avatar copy gate 返回嵌套 `copy.copy_version_id`，初版 projection 只读取扁平字段并
   产生 `copy_version_id=null`；默认 App API 回归稳定复现后，GREEN 显式兼容现有服务契约并锁定 exact ID，不修改 Avatar
   领域响应。
5. Browser RED：基线 workspace 人物阶段没有真实图片、详情层或确认路径；GREEN 后真实 Chrome 从同一短时授权 URL 渲染
   缩略图与大图，确认仍需 Dialog 和既有 POST。授权失败、过期、解码失败显示自然中文原因与首字 fallback；重试重新授权，
   不用假图片或远端 CDN。
6. Responsive/recovery RED：基线 390 没有人物列表 -> 详情 -> 返回语义；GREEN 后点击列表与移动主动作均把焦点送入详情，
   返回恢复 exact list item。初始/bootstrap、scoped refresh、dirty、409、history、Back/Forward、preview expiry 以及 unknown
   action 均 fail-visible；权威读取失败会禁用桌面/移动全部阶段链接，只保留 scoped refresh，恢复后按 exact 当前对象重建。
7. Reliability RED：Stage 3 浏览器 seam 初始复用 Stage 2 的 `59300` 端口段，默认并行组合暴露冲突风险；改用独立
   `59400` / `59450` 后，Stage 1/2/3 默认并行 7/7，完整受影响 Chrome 组合 11/11。

## 实现边界

- Preview authorization 是人物专用的同源短时公共 seam；public catalog/workspace 继续不返回私有素材绑定。底层 grant 与
  bytes 路径继续由既有 Asset service 持有，不新增永久 URL 或 browser data URL。
- Workspace 只预取当前可见列表的有限缩略图，详情复用同一已授权版本。过期或失败不会沿用 stale URL；失败占位明确说明
  是素材缺失、授权失败或图片无法显示，而不是虚构头像。
- 目录选择是本地 dirty 状态；只有 Dialog 明确确认才调用既有 AvatarSelection 写 API。409 保留选中项与 Dialog 输入，
  “载入最新人物选择”后才以新 revision 继续；历史、授权与能力 blocker 不被前端绕过。
- 方案 A 只按 Taste Scan -> Diagnose -> targeted upgrade 落到现有 opt-in vanilla HTML/CSS/JS；没有搬运 throwaway
  原型、引入框架/依赖或修改未迁移页面的共享视觉合同。

## 精确 allowlist

1. `src/avatar-selection/avatar-selection-service.js`
2. `src/avatar-selection/memory-avatar-selection-repository.js`
3. `src/avatar-selection/postgres-avatar-selection-repository.js`
4. `src/operator-workspace/operator-workspace-service.js`
5. `src/server/app.js`
6. `src/server/routes/avatar-selection.js`
7. `web/project.js`
8. `web/workspace.html`
9. `web/workspace.css`
10. `web/workspace-avatar.js`
11. `test/avatar-selection-service.test.js`
12. `test/avatar-selection-api.test.js`
13. `test/avatar-selection-postgres.integration.test.js`
14. `test/operator-workspace-service.test.js`
15. `test/project-content-api.test.js`
16. `test/operator-single-workspace-stage-3-browser.test.js`
17. `docs/status/CURRENT.md`
18. `docs/ROADMAP.md`
19. `docs/status/sessions/2026-08-24-operator-single-workspace-stage-3-avatar.md`

该 allowlist 在代码编辑前已锁定于 Issue #242，没有 API/backend/DB/dependency 或后续阶段扩张。

## 验证

- focused service/API：55/55 pass。
- local PostgreSQL 16：`test/avatar-selection-postgres.integration.test.js` 1/1 pass；一次性容器随后停止并移除。
- 真实 Chrome 受影响组合：Stage 1/2/3 与旧 Project/Copy/Avatar/Assets 11/11 pass；其中 Stage 1/2/3 默认并行
  7/7 pass。
- Assets/Avatar service/API compatibility：72/72 pass。
- `npm run check`：245 JavaScript files。
- 默认 `npm test` 自然完成：1136 total / 1121 pass / 15 existing environment-gated skips / 0 fail。既有
  V2 Production browser 用例在默认并发中耗时约 332 秒但最终通过，没有中止、取消或以串行替代。
- `git diff --check`：pass；总 diff 严格 19 文件。
- 临时 PNG 位于 `/private/tmp/hifly-stage-3-avatar-screenshots-20260824c/`，像素头为 1440x900、768x900、
  390x844，SHA-256 分别为 `4498b5584e4b2ba0c3ab4accac1ce914a9df6e6b1b28240fe14b5e2f237199cf`、
  `96011c53dc2ed0ff746f80693b78edbb379ddc35a4d00751c51bd80e280ba379`、
  `2acbbef71e0ee31573f695534b37894280d738eb59d2cb10481cf4bbc401eca7`；二进制未提交。
- 截图使用公开 browser seam 的本地 exact-byte 1x1 PNG fixture，只证明同源授权图片路径、三视口层级与无页面级横向
  滚动，不是生产人物素材、Provider 或视觉质量证据。390 详情焦点与返回由公开 Chrome 断言补证。
- fixed-head GitHub CI 以 Draft PR checks 元数据与最终结果评论为准；session 不在提交正文中自引用最终 head。

## 未执行边界

没有开始 Stage 4、VideoPlan 或 Production 投影；没有新增领域状态、DB migration、组织队列或跨阶段写事务；没有部署、
SSH、访问 Hifly/Provider、启动 Worker 或 Local Agent、修改生产数据、创建真实候选/工单、生成视频或消耗积分。
