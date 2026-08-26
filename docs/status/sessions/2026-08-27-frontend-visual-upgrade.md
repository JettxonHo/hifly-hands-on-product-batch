# 2026-08-27 单任务工作区视觉与交互升级

## Goal

- Issue #254：在已合并的 Stage 1–5 单任务工作区业务合同上，落实 Owner 已确认的精细化运营界面。
- 视觉方向固定为深色指挥顶栏、桌面三栏任务工作区、浅色底部操作栏，以及单一蓝色推荐动作；768 收敛为两栏，390 继续使用列表/详情/返回的单面板结构。
- 本轮只改变信息层级、密度、样式和公共视觉回归，不新增 API、数据库、领域状态、写命令或 Provider 行为。

## 固定基线与范围

- exact base：`main@831c92719cf2e6da1680d07de654e82741960939`。
- branch：`codex/frontend-visual-upgrade`。
- 初始 allowlist 为 7 个文件；在编辑前通过 Issue #254 checkpoint 扩为以下 9 个文件：
  - `docs/PROJECT_HANDOFF.md`
  - `docs/ROADMAP.md`
  - `docs/status/CURRENT.md`
  - `docs/status/sessions/2026-08-27-frontend-visual-upgrade.md`
  - `web/workspace.html`
  - `web/workspace.css`
  - `test/operator-single-workspace-stage-2-browser.test.js`
  - `test/operator-single-workspace-stage-3-browser.test.js`
  - `test/operator-single-workspace-stage-4-browser.test.js`

## 实现

- 将原先分离的侧栏与身份栏收敛为全宽深色指挥顶栏，保留既有导航、身份、退出和 feature/role 显隐选择器。
- 1440 使用 240px 商品队列、弹性当前任务、280px 服务端任务详情三栏；阶段条补充“已完成 / 当前阶段 / 可进入”等视觉语义，但数据仍只来自既有 `data-stage-state`。
- 768 使用商品队列 + 当前任务两栏，服务端详情下移；390 保留既有 product list/detail layer、Back/Forward、焦点恢复和固定底栏。
- 底部操作栏改为浅色，唯一推荐动作保持既有 `#workspacePrimaryAction` 和 action registry，按钮最小高度 52px（移动 50px）、圆角 16px。
- Copy 页签、商品列表按钮和页面内辅助命令统一降为中性 secondary 样式，防止与底部推荐动作竞争；没有改变任何点击处理、payload、409/503 或 Dialog 合同。
- Avatar 目录和大图区域只调整密度、边框与排版。测试截图里的 1x1 黑/白 PNG 只证明受控授权、字节和布局，不是生产人物视觉。

## RED -> GREEN

- 旧界面的系统 Chrome 公共 RED：缺少已接受的深色指挥顶栏。
- Stage 2 首轮唯一动作 RED：页面内同时出现商品文案入口、生成文案和两个页签等四个竞争性蓝色控件；样式收敛后只剩固定底部推荐动作。
- Stage 3 新增公共 computed-style / layout 合同，锁定深色顶栏、浅色底栏、16px 主按钮、1440 三栏、768 两栏、390 详情层与无横向溢出。
- Stage 4 补充真实公开 action readiness 与唯一品牌动作断言，继续覆盖 VideoPlan 的 409、历史、预检、审核和 Dialog 焦点。

## 当前验证

- Stage 1 系统 Chrome：2/2 PASS。
- Stage 2 系统 Chrome：3/3 PASS。
- Stage 3 系统 Chrome：3/3 PASS。
- Stage 4 系统 Chrome：9/9 PASS。
- Stage 5 系统 Chrome：6/6 PASS。
- `npm run check`：248 个 JavaScript 文件 PASS；`npm run validate`：3 条产品数据 PASS；`git diff --check` PASS。
- default `npm test` 自然结束但不记 GREEN：1213 total / 1197 pass / 15 existing environment skip / 1 fail。
  唯一失败为未修改的 `operator-workbench-v2-assets-browser` 移动详情标题焦点在并行负载下得到空焦点；同一公开用例随后
  isolated 1/1 自然 PASS。本轮不以单跑覆盖全量失败，也不扩 scope 修改无关 Assets 页面；最终全量终态等待 fixed-head CI。
- 临时截图目录：`/private/tmp/hifly-frontend-stage{1,2,3,4}-final/`，不提交仓库。

## 边界

- PR #253 的公共人物缩略图同步仍是独立 Draft，不属于本分支，不在本轮合并或校准。
- 本轮没有访问 Hifly/Provider、没有登录或读取真实账户、没有创建任务、点击生成、运行 Worker/Local Agent、部署、写生产数据或消耗积分。
- 本轮不补商品缩略图、不新增 Assets preview/API，也不开始 MBL 后生产化；任何需要新字段、权限、API 或运行时能力的视觉需求必须另过 Product/API gate。
- 当前仅为仓库候选；只有 Draft PR exact-head CI 与独立 Review 通过并合并后，才计为仓库实现，不表示部署、真实运行时或客户验收。
