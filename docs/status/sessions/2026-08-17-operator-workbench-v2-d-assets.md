# 2026-08-17 运营工作台 V2-D Assets 实现会话

## 1. 任务与边界

- 跟踪 Issue：#182 `UX V2-D: Assets by real type`。
- 精确基线：`origin/main@426c7c00f9b4970641cf3a96e559590b9b4a14ec`。
- 分支：`codex/operator-workbench-v2-d-assets`。
- 生命周期：V2-C 已进入 `main`；V2-D 只有随 acceptance PR 合并进入 `main` 后才计为仓库实现。部署、真实业务验收
  和客户采用仍是独立门禁。

本轮只处理 Assets 页面、一个公开浏览器回归和权威状态文档。没有开始 A/B 回补、组织级生产任务或新素材能力；
没有修改 API、数据库、migration、领域状态、身份授权、Provider、Cloud Executor、Local Agent、依赖或部署。

## 2. Product/API gate 与设计判断

- 当前 API 已足够完成本片，不需要扩后端。服务端真实 kind 只有 `product_image`、`avatar_image`、`work_video`；
  页面分别显示“商品图片、人物图片、作品视频”。
- Asset 可观察为 `active` / `disabled`；删除后不再出现在 list projection。AssetVersion 可观察为 `upload_pending`、
  `uploading`、`verifying`、`available`、`verification_failed`。页面不创建新状态，也不按文件名推断状态。
- `work_video` 由已核验生产产物登记，在素材中心只读；没有上传、重命名、停用、删除或上传新版本入口。图片继续沿用
  现有授权、类型/大小/SHA-256 核验、不可变版本、乐观 revision、组织隔离、管理员动作和临时下载授权。
- 当前 API 不提供缩略图、项目/商品/人物/Work 关联、业务用途标签、全局搜索或分页。页面明确显示“关联信息当前未提供”，
  不把未知写成“未使用”，也不由浏览器拼装关联。
- 使用 Taste 的 Scan → Diagnose → targeted upgrade：保留 vanilla HTML/CSS/JS、现有壳层和服务端命令，仅重组素材分类、
  列表/详情层级、状态叙事、动作优先级和小屏分层；V2 合同和 API 真值优先。

## 3. TDD 与实现证据

公开 seam 使用真实 Assets 浏览器页面和既有 HTTP API，不直接测试前端私有函数。

1. 首个有效 RED：修正测试 fixture 的企业落点后，真实 Chrome 等待“人物图片”分类 30 秒超时；旧页面只呈现
   “商品图片”。最小 GREEN 后三种真实类型均可扫描，图片上传 kind 只有商品/人物，作品视频无任何写入口。
2. 页面按 Asset 与 AssetVersion 分层显示名称、状态、版本历史和折叠技术详情；中文状态来自服务端投影。图片可按现有
   权限上传新版本、重命名和执行管理员动作；作品视频只提供查看与临时授权下载。
3. 初始 list 失败会清除“正在加载”，保留错误并把“刷新当前分类”作为唯一恢复动作；成功刷新才清理错误。处理中版本
   继续轮询服务端，不伪造终态。
4. 重命名 409 保留用户输入并禁用旧前置条件；用户显式载入同一个素材的最新 list 状态后，输入仍保留，只有同一素材
   仍可写时才允许再次明确保存。停用/删除冲突同样 fail-visible，不自动重试。
5. 1440px 使用可扫描列表 + 详情双栏；768px 与 390px 使用列表/详情顺序视图。选择素材后焦点进入详情标题，返回后
   恢复到原列表项；Dialog 焦点进入/关闭恢复、可见 focus、reduced-motion 和无页面级横向滚动继续保留。
6. 旧 Assets 浏览器 seam 仍可直接设置 `#assetFile` 并触发“上传并开始核验”，feature-off legacy GUI 和 assets-disabled
   企业入口保持原行为。

## 4. 验证与停止边界

- V2-D 与既有 Assets 真实 Chrome 组合：
  `test/operator-workbench-v2-assets-browser.test.js test/assets-browser.test.js` → 7/7 通过（V2-D 4 项、既有兼容 3 项）。
- 素材 API/service：`test/assets-api.test.js test/assets-service.test.js` → 30/30 通过；没有扩展后端接口。
- 共享前端与 A14 浏览器兼容：`test/frontend-foundation-browser.test.js test/vsa-a14-acceptance-browser.test.js`
  → 2/2 通过。
- 临时截图仅写入 `/private/tmp/hifly-v2-d-assets-screenshots-20260817/`，不进入 Git；PNG 像素头为
  `assets-1440.png` 1440px、`assets-768.png` 768px、`assets-390.png` 390px，三者均无页面级横向滚动。
- `npm run check` → 229 个 JavaScript 文件通过；`npm test` → 1032 项，1018 通过、14 跳过、0 失败。
  14 项跳过由 13 项未配置测试 PostgreSQL 的 integration gate 与 1 项未开启 `IDENTITY_BROWSER_SMOKE` 的 opt-in
  浏览器 gate 构成；本轮受影响的真实 Chrome seam 已由上述宿主浏览器命令单独验证。
- `git diff --check` 通过；fixed-head CI 在 Draft PR 创建后记录。
- 严格 allowlist 为 7 个文件：Assets HTML/CSS/JS、一个 V2-D browser test、CURRENT、ROADMAP 与本 session。
  没有配置、凭据、截图、批次、日志、输出或依赖文件进入变更。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #182；等待主控独立复审。
