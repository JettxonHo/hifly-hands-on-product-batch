# 运营单任务工作区 Stage 3 人物

> 执行日期：2026-08-24
> 固定基线：`origin/main@c6ce40166a9b68da58dfb91c77682148f9876c60`
> 治理入口：Issue #242；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，Stage 3 才计为仓库实现；本次没有部署或生产验收

## Product/API gate

- 现有 AvatarSelection service/API 已持有目录、推荐、显式确认、授权、能力 Evidence、历史与 optimistic conflict 真值；
  通用 Asset service 已持有组织隔离的短时授权与 exact verified bytes，不需要新领域状态、数据库 schema、角色或跨阶段事务。
- 现有目录表私有持有 `material_asset_version_id`。首轮独立复审证明“先读目录、再单独 mint 通用 Asset grant”会留下
  interleaving 窗口；修正后 memory 使用相应串行门禁，PostgreSQL 的预览和企业目录登记先取得相同组织级 advisory
  transaction gate，再在预览事务内锁定 exact 目录/目录版本和父 Asset/AssetVersion 并 mint grant。授权因而在一个
  可线性化边界内重核组织、active 目录、私有绑定，且登记重放与预览不会以相反跨表锁序并发；
  `avatar_image` 父 Asset、available exact version 与 verified metadata，而不把内部 ID 投影给浏览器；未命中
  Product/API stop condition。
- operator workspace 只 additive 读取 exact current approved CopyVersion 下的 Avatar workspace；同商品旧 CopyVersion 已确认的
  AvatarSelection 保留为 `copy_version_changed` 失效历史并要求重新选择，不误作 404，也不恢复成有效确认。Stage 1 商品资料
  与 Stage 2 文案保持原投影；`video_plan`、`production` 继续 `legacy/not_loaded`，counted/throwing 端口证明本切片没有读取
  这些领域 service。
- 人物选择仍由既有显式确认 API 写入；目录卡片和预览授权本身不提交选择，不改变 authorization/capability/material gate，
  也不把“选中”误写成人工确认。

## RED -> GREEN

1. Service/atomic RED：基线没有 preview authorization；首轮实现又可在目录读取后、grant mint 前禁用目录或父 Asset，
   仍返回 token。GREEN 后按 actor/org、可见 active 目录条目、私有素材绑定、父 Asset `active`、`kind=avatar_image`、
   exact version `available` 与 verified media/size/SHA-256 fail closed，并以 memory 串行门禁和 PostgreSQL 同事务行锁覆盖
   mutation-first 与 authorization-first 的确定时序。父 Asset disabled、版本 unavailable、wrong kind、checksum/grant
   drift 均在返回 URL 前阻断。
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
5. Browser RED：基线 workspace 人物阶段没有真实图片、详情层或确认路径；首轮实现又会在权威 refresh 后沿用同 catalog
   version 的旧 URL，并在自然到期后继续保留已加载图片。GREEN 后真实 Chrome 从同一短时授权 URL 渲染缩略图与大图，
   权威 refresh 总是作废旧授权并按最新素材真值重新授权；到期定时器主动清除 `src`。两个 distinct exact PNG/hash 证明
   人物和版本没有串用；授权失败、过期和 corrupt bytes 解码失败均显示自然中文原因与首字 fallback，重试只刷新图片。
6. Responsive/recovery RED：基线 390 没有人物列表 -> 详情 -> 返回语义；首轮人物条目又覆盖原生 button role，商品选择器
   未使用 secondary 层级并在当前态出现不可读颜色。GREEN 后人物按钮保留原生语义并由 listitem wrapper 承载列表结构，
   商品选择器保持次级层级与可读 current 状态；390 点击人物把焦点送入详情，返回恢复 exact list item。1440/768/390
   均覆盖真实图片、素材失效、过期、decode fallback、重试、可见焦点与无页面级横向滚动。
7. Reliability RED：Stage 3 浏览器 seam 初始复用 Stage 2 的 `59300` 端口段，默认并行组合暴露冲突风险；改用独立
   `59400` / `59450` / `59500`。PostgreSQL Avatar 原子回归显式加入 required `identity-postgres` job，不再依赖默认测试中
   的环境 skip；route-level 503 证明临时 cause 中的 credential 字样不会进入安全响应。
8. Second-review RED：在 reviewed head 上，预览会在登记重放释放素材锁前进入相反的目录 -> 素材锁序；同商品 approved
   Copy 替换使旧人物选择返回 404；dirty Back/Forward 的“放弃并继续”只改变 URL；合法 PNG bytes 替换仍能沿用旧 grant
   返回 200；目录重绘会把键盘焦点丢给 body。GREEN 以组织级 PostgreSQL advisory gate 串行跨表事务、保留
   `copy_version_changed` 失效历史、显式区分 history restore/apply、下载时重算 size/SHA-256，并在 1440/768 重聚焦 exact
   目录按钮、390 先切换可见 layer 再聚焦详情。公开测试还为 Stage 4/5 注入 counted/throwing 端口并锁定零读取；跨商品
   selection 仍统一 not found。

## 实现边界

- Preview authorization 是人物专用的同源短时公共 seam；public catalog/workspace 继续不返回私有素材绑定。底层 grant 与
  bytes 路径继续由既有 Asset service 持有；实际响应 bytes 必须与授权时 verified size/SHA-256 一致，不新增永久 URL 或
  browser data URL。
- Workspace 只预取当前可见列表的有限缩略图，详情复用同一已授权版本。过期或失败不会沿用 stale URL；失败占位明确说明
  是素材缺失、授权失败或图片无法显示，而不是虚构头像。
- 目录选择是本地 dirty 状态；只有 Dialog 明确确认才调用既有 AvatarSelection 写 API。409 保留选中项与 Dialog 输入，
  “载入最新人物选择”后才以新 revision 继续；历史、授权与能力 blocker 不被前端绕过。
- 方案 A 只按 Taste Scan -> Diagnose -> targeted upgrade 落到现有 opt-in vanilla HTML/CSS/JS；没有搬运 throwaway
  原型、引入框架/依赖或修改未迁移页面的共享视觉合同。
- Owner 后续视觉方向不属于本片实现：完成各功能 Stage 后另开独立 gate，把 PC 1440/768 与移动 390 作为并行一等合同，
  允许响应式 composition 不同但保持同一业务真值、动作与状态词；两端都需真实 Chrome 与人工视觉 acceptance，不把
  移动置于 PC 之上，也不把桌面当作放大的移动布局。

## 精确 allowlist

1. `.github/workflows/ci.yml`
2. `docs/ROADMAP.md`
3. `docs/status/CURRENT.md`
4. `docs/status/sessions/2026-08-24-operator-single-workspace-stage-3-avatar.md`
5. `src/assets/asset-service.js`
6. `src/assets/memory-asset-repository.js`
7. `src/assets/postgres-asset-repository.js`
8. `src/avatar-selection/avatar-selection-service.js`
9. `src/avatar-selection/memory-avatar-selection-repository.js`
10. `src/avatar-selection/postgres-avatar-selection-repository.js`
11. `src/operator-workspace/operator-workspace-service.js`
12. `src/server/app.js`
13. `src/server/routes/avatar-selection.js`
14. `test/avatar-selection-api.test.js`
15. `test/avatar-selection-postgres.integration.test.js`
16. `test/avatar-selection-service.test.js`
17. `test/cloud-executor-persistent-media.test.js`
18. `test/operator-single-workspace-stage-3-browser.test.js`
19. `test/operator-workspace-service.test.js`
20. `test/project-content-api.test.js`
21. `web/project.js`
22. `web/workspace-avatar.js`
23. `web/workspace.css`
24. `web/workspace.html`

Issue #242 初始锁定 19 文件；首轮独立复审在实现前记录了四类必要扩张：required CI 与 Asset service/memory/PostgreSQL
内部授权门禁。第二轮修复又在编辑前记录了一个兼容测试扩张：下载端按 grant 的真实 size/SHA-256 验证 bytes 后，既有
Cloud Work fixture 不能再使用占位 checksum，故只在原测试中改为 exact bytes 的真实 SHA-256。最终总 diff 严格为以上
24 文件，没有 Cloud Executor/Work 行为改动、DB migration、dependency、通用公共 Asset API、后续阶段或部署扩张。

## 验证

- focused service/API/Assets compatibility：95/95 pass；exact grant-byte 修正后的 Cloud Work/Avatar 下载兼容组 14/14 pass。
- local PostgreSQL 16：`test/avatar-selection-postgres.integration.test.js` 1/1 pass；一次性容器在验证完成后停止。
- Stage 3 真实 Chrome：3/3 pass；第三条用例在 1440x900、768x900、390x844 逐一覆盖 exact bytes、素材失效、
  自然到期、corrupt bytes、重试、原生 button/focus、商品次级控件层级与无页面级横向滚动。
- Stage 1/2/3 与受影响 Assets 浏览器兼容组：11/11 pass，使用默认并行行为；Stage 3 单独再跑 3/3 pass。
- `npm run check`：245 JavaScript files。
- 第二轮修复过程中，首个默认全量曾出现一个未改 V2-D focus 偶发失败，以及 Cloud Work fixture 的占位 checksum 被新增
  bytes 校验正确拒绝；前者单文件通过，后者按提前记录的第 24 文件 checkpoint 改为真实 SHA-256。一次自定义失败诊断
  reporter 留下孤立 Node/Playwright 测试树，已只终止该明确进程树，相关运行不计为全量证据。清理后最终代码树的精确
  `npm test` 未改并发参数并自然完成：1139 total / 1124 pass / 15 existing environment-gated skips / 0 fail，约 161.9 秒。
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：0 high/critical；2 个既有 moderate，
  均为 `exceljs -> uuid`，本片未执行 breaking `--force` 修复。本机默认 npmmirror audit endpoint 不受支持的失败亦未冒充安全结论。
- `git diff --check`：pass；总 diff 严格 24 文件。
- 修正后临时 PNG 位于 `/private/tmp/hifly-stage-3-avatar-screenshots-20260824g/`，像素头为 1440x900、768x900、
  390x844，SHA-256 分别为 `1ec0cc6a5c5b50e2e456fcc01fb5211088192c4dbcf47785523b8e43121d3bc8`、
  `0c5e16fdac957d913d3e30ecee163e7235c224d013c63936fef36a82f5b84989`、
  `996ed89b3f683c42c36f1c407106e1fee0fb83e272975484e0a542c40ad55869`；二进制未提交并已人工看图。
- 截图使用公开 browser seam 的本地 exact-byte 1x1 PNG fixture，只证明同源授权图片路径、三视口层级与无页面级横向
  滚动，不是生产人物素材、Provider 或视觉质量证据。390 详情焦点与返回由公开 Chrome 断言补证。
- fixed-head GitHub CI 以 Draft PR checks 元数据与最终结果评论为准；session 不在提交正文中自引用最终 head。

## 未执行边界

没有开始 Stage 4、VideoPlan 或 Production 投影；没有新增领域状态、DB migration、组织队列或跨阶段写事务；没有部署、
SSH、访问 Hifly/Provider、启动 Worker 或 Local Agent、修改生产数据、创建真实候选/工单、生成视频或消耗积分。
