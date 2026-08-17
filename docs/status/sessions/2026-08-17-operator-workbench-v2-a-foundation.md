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
5. REQUIRED RED：V2-A 与 A14 默认并行时同时占用 `127.0.0.1:58400`，A14 以 `EADDRINUSE` 失败。
   最小 GREEN 将新 V2-A seam 移到独立的 58600 端口段；同一默认并行命令 2/2 通过，没有用
   `--test-concurrency=1` 掩盖冲突。
6. REQUIRED RED：共享 CSS 曾把所有带 `href` 的阶段链接着成完成绿，导致 Copy 尚未保存、质检未开始时，
   未来“人物”阶段看起来已经完成。GREEN 为五阶段显式提供 `completed / current / available / blocked`
   状态，由页面根据现有业务快照更新，不再从是否存在 `href` 猜测完成状态。真实 Copy seam 证明商品资料为
   completed、文案为 current、人物为 available、视频方案与生产为 blocked；真实 Avatar seam 进一步证明
   只有已人工批准的文案为 completed，而仍是草稿的商品资料保持 available。桌面和移动状态序列一致。

## 4. 验证

- focused V2-A + Copy + Avatar 真实 Chrome：4/4，通过；V2-A + A14 默认并行：2/2，通过。
- 直接受影响的真实 Chrome 兼容组：Project content、Slice A、V2-A、Copy generation/quality、Avatar、Plan、
  Production，合计 12/12，通过。
- `/private/tmp/hifly-v2-a-screenshots-20260817b` 由脚本 stub 产生，只证明 loading-state 壳层、布局、导航与
  1440×1000 / 768×900 / 390×844 无横向滚动；它不作为业务阶段状态的视觉证据。
- 真实 Copy 业务状态截图位于 `/private/tmp/hifly-v2-a-business-stage-screenshots-20260817d`，未纳入 Git。
  overview 与展开阶段证据各覆盖 1440×900、768×900、390×844，PNG 像素头与文件名一致。人工复核可见
  completed 上游、current 文案、available 人物和 blocked 后续阶段在桌面/移动端的颜色及层级彼此不同。
- reduced-motion、skip link 焦点、角色导航显隐、显式 legacy `/index.html` 隔离均由公开浏览器 seam 覆盖。
- 扩展浏览器兼容组（含 legacy GUI smoke 与 browser compatibility）：29/29，通过。
- `npm run check`：229 个 JavaScript 文件，通过。
- 完整默认并发 `npm test`（指定宿主已安装的系统 Chrome，不降低 test concurrency）：1023 tests，
  1009 pass，14 skip，0 fail，约 52 秒。14 个 skip 是未提供连接串的 13 个 PostgreSQL
  integration tests，以及未启用 `IDENTITY_BROWSER_SMOKE=1` 的 identity browser smoke；真实 Chrome 公开 seam
  已由上述宿主浏览器矩阵补证，固定 head CI 另含 identity-postgres 环境验证。
- 同一修复后的第一次原始 `npm test` 在无 `IDENTITY_BROWSER_EXECUTABLE` 的宿主环境中没有出现端口冲突，
  但 bundled Chromium 的 A14 子进程在测试主体完成后超过 4 分钟未退出，因此被人工终止；它不计为通过。
  随后使用项目一贯的系统 Chrome 路径、保持默认并发重跑得到上述完整 GREEN，不用一次绿色覆盖首次挂起事实。
- `git diff --check`：通过。Draft PR 的 Ubuntu、Windows 与 identity-postgres 固定 head CI 由 GitHub
  acceptance gate 记录并由主控复核；本提交不把自身尚未产生的 CI 结果写成既成事实。

## 5. Agent 与安全边界

- 逻辑角色：IMPLEMENTER；由主开发 session 执行。当前运行时未提供可核验模型身份，状态为
  `UNVERIFIED_RUNTIME_MODEL`，不虚构 `luna-worker` runtime 证明。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #176；等待主控独立复审。
