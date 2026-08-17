# 2026-08-17 运营工作台 V2-B Production 实现会话

## 1. 任务与边界

- 跟踪 Issue：#178 `UX V2-B: Production task flow`。
- 精确基线：`origin/main@0aba2c91f458e4e5dfb22a6c4dfb334d293f75bb`。
- 分支：`codex/operator-workbench-v2-b-production`。
- 生命周期：V2 设计合同和 V2-A 已合并；V2-B 只有随 acceptance PR 合并进入 `main` 后才计为仓库实现，
  部署、真实 Provider 和生产采用仍是独立门禁。

本轮只修改 Production 页面、直接相关公开浏览器回归和权威状态文档。没有开始 Works、Assets 或 A/B 回补；
没有修改 API、数据库、migration、领域状态、身份授权、Provider、Cloud Executor 运行时、Local Agent、依赖或部署。

## 2. Product/API gate 与设计判断

- 现有 Production workspace、manual handoff、manual execution、A12/Work verification 与
  `GET /api/cloud-executor/status` 已能表达工单、交接包、执行、核验与作品登记状态，因此本轮不需要新增后端 seam。
- 当前 API 不能向组织运营页面证明全组织 `eligible=[currentOrderId]` 或 active attempts=0。按 V2 合同，这不是由前端
  扫描或拼装的理由：`ready` 包仍显示“生产门禁未通过”，等待获授权运维在既有部署控制面核对。
- 企业 Web 不提供 Worker 启停、自动领取、自动重试或“创建下一单”命令。失败/需处理继续停止；成功也必须经过
  A12 passed、Work available 和真实字节下载验收后，才允许在 Worker off 下准备下一条。
- 使用 `taste-skill:redesign-existing-projects` 的 Scan → Diagnose → targeted upgrade：保留既有 vanilla 页面和
  业务控件，只把业务摘要、控件层级、中文状态和技术详情分层落到现有结构；V2 合同和服务端真值优先于通用视觉建议。

## 3. TDD 与实现证据

公开 seam 是真实 Production 浏览器页面，不测试私有函数。

1. RED：approved Plan 且无工单时不存在 `#productionTaskSummary`。GREEN：首屏显示当前商品、生产阶段、
   “可准备生产”和唯一“创建生产工单”。
2. RED：创建工单后无交接包，以及 generating / generation_failed / expired / superseded / revoked / ready
   包状态会使业务摘要消失。GREEN：每种服务端状态都有中文业务状态、阻断和唯一下一步；失败不会自动重试。
3. RED：running Cloud 状态仍显示“生产门禁未通过”。GREEN：执行中、失败/需处理、A12 未开始/进行中/需处理、
   Work 登记中、待作品验收、已交付待真实下载验收均按服务端投影更新，技术 ID 不进入业务摘要。
4. RED：真实 Production workspace 工单状态随 Cloud 进入 running 后，摘要因只接受 `waiting_for_executor` 而隐藏。
   GREEN：当前工单的 ready 包状态继续承载 running/failed/succeeded 业务矩阵，不依赖工单停留在等待态。
5. RED：`cancel_requested` 被误写成整批失败。GREEN：取消中显示“等待终态”，cancelled 显示只读取消结果与
   “查看结果或按新授权重新规划”，不复用旧 attempt 自动重跑。
6. 初次 Production project bootstrap 定向 fail-once 后，页面将“刷新当前工单”设为唯一推荐动作；点击重新执行
   完整 runtime/project/product/workspace bootstrap 并恢复。刷新失败不会制造第二个推荐动作。
7. RED：第一张工单创建后，两个创建入口仍为 enabled，失败态和已交付但缺少真实字节验收时也可打开第二张工单
   Dialog。GREEN：上游 gate、已批准方案与零工单共同决定创建能力；按钮、Dialog 和提交使用同一判断，任一已有工单
   都保持禁用。
8. RED：控制面的真实默认 Work 状态 `pending_review` 被显示为“生产门禁未通过”，原测试还构造了
   `work.delivery_status=pending_review` 与 `delivery.status=deliverable` 的不可能组合。GREEN：测试改用一致投影，
   `pending_review` / `rework_required` / `deliverable` / `delivered` 分别进入检查、返工、登记交付和交付记录/真实下载验收；
   四态均不宣称“本单已完成”或开放下一单。
9. 控制面真实 `claimed` 形状的公开 characterization：order/attempt 为 claimed、readiness busy、execution pending、
   progress claimed 时显示“正在生成 / 等待”，无领取或激活建议，创建下一单仍禁用；现有实现已满足，无需制造代码改动。

Cloud Executor、attempt、heartbeat、handoff、eligible 投影可用性和只读执行结果默认进入“技术与审计详情”；
业务阻断仍在任务摘要中可见。作品入口由任务摘要提供，避免把推荐动作藏进折叠详情。

## 4. 浏览器与响应式证据

- Production 公开 seam 覆盖 1440×1000、768×1024、390×844；三种视口均无页面级横向滚动、业务摘要先于
  技术详情、推荐动作最多一个。
- 临时截图位于系统临时目录 `hifly-v2-b-production-screenshots/`，PNG 像素头与文件名一致，不纳入 Git。
- Dialog 打开后焦点进入，关闭后返回触发按钮；技术详情 summary 有可见键盘焦点；reduced-motion 下非必要
  transition 收敛到 0.01ms。
- 直接受影响的真实 Chrome 兼容组包含 V2-B、V2-A foundation、ProductionOrder、manual handoff、manual execution
  与 A12 work verification，共 6/6 通过。

## 5. 验证与停止边界

- Production focused 真实 Chrome：1/1 通过；直接受影响兼容组（V2-B、V2-A foundation、ProductionOrder、
  manual handoff、manual execution、A12 work verification）6/6 通过。
- `npm run check`：229 个 JavaScript 文件通过。
- 审阅修复后的默认 `npm test`（设置本机 Chrome executable）：1024 tests，1010 pass，14 skip，0 fail，约 64.5 秒。
  其中 13 个 skip 是未提供测试数据库环境时的 PostgreSQL migration/repository 集成场景，另 1 个是必须显式设置
  `IDENTITY_BROWSER_SMOKE=1` 才运行的真实身份浏览器 smoke；它们不被记作本轮浏览器 GREEN。
- `git diff --check` 和严格 allowlist 通过；固定 head 三组 CI 由 Draft PR 记录并作为主控 acceptance 证据。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #178；等待主控独立复审。
