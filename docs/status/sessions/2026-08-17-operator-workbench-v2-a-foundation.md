# 2026-08-17 运营工作台 V2-A 共享基础实现会话

## 1. 任务与边界

- 跟踪 Issue：#176 `UX V2-A: Shared IA, content, and control foundation`
- 精确基线：`origin/main@c701ddeb6ef2e489becd8fe1a1b03762877408b0`
- 分支：`codex/operator-workbench-v2-a-foundation`
- 生命周期：V2 设计合同已合并；本轮只实现第一片 shared IA/content/control foundation。实现只有随
  acceptance PR 合并进入 `main` 后才计为仓库完成，部署与生产采用仍是独立门禁。

本轮没有修改 API、数据库、migration、领域状态、身份授权、Provider、Cloud Executor、Local Agent、下载或
生产执行语义，也没有开始 V2-B Production、V2-C Works、V2-D Assets 或 A/B 回补。

## 2. 设计与实现约束

- 完整读取并使用 `taste-skill:redesign-existing-projects`。采用其 Scan → Diagnose → targeted upgrade 方法，
  只修复导航职责、阶段层级、业务词典和控件语义；拒绝营销页结构、外部字体、渐变、框架重写和视觉大爆炸。
- `docs/frontend/OPERATOR_WORKBENCH_UX_V2_CONTRACT.md`、现有领域/API 真值和本 Issue allowlist 的优先级
  高于 Taste 的通用建议。
- 一级导航统一为“项目 / 作品库 / 素材中心 / 成员管理（admin）”；当前没有组织级生产任务真实索引，
  因此不显示“生产任务”，不创建死链或浏览器聚合队列。
- 项目阶段统一为“商品资料 / 文案 / 人物 / 视频方案 / 生产”。QC passed 与人工批准、预检通过与方案批准
  继续保持独立；Cloud Executor、attempt 和 handoff 不进入业务主状态。
- 刷新按钮使用明确的页面或当前商品作用域；审计历史和能力配置使用 opt-in 折叠原语并保留键盘焦点。
- `.operator-task-page` 继续作为共享样式边界；显式 `/index.html` 保持 legacy local/ops fallback，既有执行和
  积分确认门禁不变。

## 3. TDD 证据

公开 seam 是同 runtime/角色跨企业页导航、项目阶段、中文词典、三视口与 legacy 边界，而不是私有函数。

1. RED：同一 admin runtime 的一级导航实际顺序为“项目 / 素材中心 / 作品库 / 成员管理”，与合同不符。
   GREEN：`shell.js` 把动态作品库入口稳定插入素材中心之前；admin 与 member 跨页顺序均通过。
2. RED：Project 页面没有项目五阶段导航。GREEN：以 opt-in DOM 和共享样式接入五阶段，Copy 入口只在当前商品
   资料已就绪且能力开启时可用。
3. RED：Project 仍显示“设为 Ready”，Copy/Plan 摘要仍暴露旧英文领域词。GREEN：按 V2 中文词典改为
   “资料已就绪 / 文案质检 / 人工审核”，并保持自动检查与人工批准的状态边界。
4. 视觉复核发现 Project 新阶段 DOM 未获得共享样式。最小 GREEN 将既有阶段布局复制为
   `.operator-task-page` opt-in 原语；1440/768/390 截图与无横向滚动断言通过。

## 4. 验证

- `node --test test/operator-workbench-v2-foundation-browser.test.js`：1/1，通过。
- 直接受影响的真实 Chrome 兼容组：Project content、Slice A、Copy generation/quality、Avatar、Plan、Production，
  合计 11/11，通过。
- 临时截图目录：`/private/tmp/hifly-v2-a-screenshots-20260817b`，未纳入 Git。Project、Copy、Production、
  Works、Assets、Members 等代表页面的 PNG 头分别验证为 1440×1000、768×900、390×844；无页面级横向滚动。
- reduced-motion、skip link 焦点、角色导航显隐、显式 legacy `/index.html` 隔离均由公开浏览器 seam 覆盖。
- 扩展浏览器兼容组（含 legacy GUI smoke 与 browser compatibility）：29/29，通过。
- `npm run check`：229 个 JavaScript 文件，通过。
- 完整 `npm test`：1023 tests，1009 pass，14 skip，0 fail。14 个 skip 是未提供连接串的 13 个 PostgreSQL
  integration tests，以及未启用 `IDENTITY_BROWSER_SMOKE=1` 的 identity browser smoke；真实 Chrome 公开 seam
  已由上述宿主浏览器矩阵补证，固定 head CI 另含 identity-postgres 环境验证。
- `git diff --check`：通过。fixed-head 三组 CI 在 Draft PR 推送后补录。

## 5. Agent 与安全边界

- 逻辑角色：IMPLEMENTER；由主开发 session 执行。当前运行时未提供可核验模型身份，状态为
  `UNVERIFIED_RUNTIME_MODEL`，不虚构 `luna-worker` runtime 证明。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #176；等待主控独立复审。
