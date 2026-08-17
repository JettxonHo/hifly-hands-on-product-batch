# 2026-08-17 运营工作台 V2-C Works 实现会话

## 1. 任务与边界

- 跟踪 Issue：#180 `UX V2-C: Works review and delivery`。
- 精确基线：`origin/main@847bd28d0db1ced194dd7499bea6d962a8c90be5`。
- 分支：`codex/operator-workbench-v2-c-works`。
- 生命周期：V2-B 已进入 `main`；V2-C 只有随 acceptance PR 合并进入 `main` 后才计为仓库实现，部署、真实下载验收
  和客户采用仍是独立门禁。

本轮只处理 Works 检查与交付页面、经 Product/API gate 批准的下载真值 additive seam、直接相关公开回归与权威状态文档。
没有开始 Assets、A/B 回补、组织级生产任务、批量交付或自动返工；没有修改数据库、migration、领域状态、身份授权、
Provider、Cloud Executor、Local Agent、依赖或部署。

## 2. Product/API gate 与设计判断

- 现有组织隔离 Works list/detail、检查、返工、交付、幂等回放、并发前置条件和临时下载授权足以表达 V2-C 业务状态。
- 唯一事实缺口是下载授权原本只返回 URL 和过期时间，Work 也没有服务端原始文件名。前端猜文件名或按扩展名推导媒体
  类型会破坏 V2 合同，因此主控批准一个最小 additive seam：同一可用 AssetVersion 的已核验文件名、媒体类型、大小和
  SHA-256 随授权投影，并由下载 grant 继续约束真实字节与响应头。
- seam 不新增 DB/schema、命令、状态、角色或永久 URL；跨组织、过期 token 和既有错误语义保持 fail-closed。
- 使用 `taste-skill:redesign-existing-projects` 的 Scan → Diagnose → targeted upgrade：保留 vanilla 页面和业务命令，
  只调整 Works 的列表/详情层级、状态叙事、动作优先级和移动端分层；V2 合同与服务端真值优先。

## 3. TDD 与实现证据

公开 seam 使用真实 Works 浏览器页面和现有 HTTP API，不直接测试前端私有函数。

1. 服务端下载真值 RED：`node --test test/work-delivery-api.test.js` 得到 2 个失败，旧授权响应只有 URL/过期时间，
   下载响应也没有 `Content-Disposition`。GREEN 后 asset service 与 Works API 从同一个可用 AssetVersion 返回已核验
   文件名、媒体类型、大小、SHA-256 与真实 bytes；Unicode 文件名可用，控制字符、引号、反斜杠及 `'()*` 不可注入响应头。
2. Works 终态 RED：`node --test test/operator-workbench-v2-works-browser.test.js` 在已交付作品中找不到唯一主操作
   “查看交付记录”。最小 GREEN 后该动作成为唯一推荐动作，“新增一次交付”保留为显式次级 Dialog，检查动作退出终态。
3. 下载 metadata RED：同一公开浏览器 seam 等待服务端文件名超时。GREEN 后页面只使用授权响应中的文件名、媒体类型、
   大小和校验值，并持续显示“交付登记不等于真实字节下载验收”。
4. 四种业务状态保持真实：`pending_review` 进入检查，`rework_required` 返回明确上游阶段，`deliverable` 进入交付，
   `delivered` 收敛到交付记录。深链目标不可见或不存在时安全回落到首个组织内可见 Work 并改写 URL，不显示隐藏内容。
5. 重复表单提交只有一个请求；409 保留用户输入并显式提示，关闭 Dialog 后焦点返回触发控件。初始列表失败不会继续
   显示加载态，点击“刷新”执行完整 bootstrap 后恢复；空态没有伪造可执行动作。
6. 1440px 保持可扫描列表与大预览/详情双栏；768px 与 390px 使用列表/详情顺序视图，详情内有明确
   “返回作品列表”。三个视口均无页面级横向滚动，reduced-motion 和可见焦点合同保留。

### 独立复审纠偏

主控在 fixed head `1f8df2672f38f2864901b8b1120c056a036811b0` 发现三项必须修复的公开行为，本分支按同一
V2-C 合同继续 RED → GREEN：

1. 768px RED 证明 `.works-layout` 仍为双窄栏 `grid`。断点修正后，1440 保持列表/详情双栏；768 与 390 进入
   列表/详情顺序视图，均可从列表进入详情并明确返回。
2. 焦点 RED 证明隐藏列表后 `#selectedWorkName` 不可聚焦。详情标题现以 `tabindex=-1` 接收焦点；直接点击列表和
   “查看作品详情”都会在详情显示后转移焦点，返回则恢复到原作品列表项。
3. 交付幂等 RED 证明技术失败后的人工重试生成了不同 `idempotency_key`。现在每次显式打开交付 Dialog 创建一个
   logical key，模糊/技术失败重试复用；成功或显式载入 409 后的最新作品状态才换新 key。409 保留全部表单字段、
   禁止继续使用旧前置条件，并提供“载入最新作品状态”动作；载入后使用新 inspection id/revision 与新 key，由用户
   再次明确提交。

## 4. 验证与停止边界

- API/service 聚焦回归：
  `node --test test/assets-api.test.js test/work-delivery-api.test.js test/work-delivery-service.test.js test/assets-service.test.js`
  → 41/41 通过。
- Works 聚焦浏览器回归：
  `node --test test/work-delivery-browser.test.js test/operator-workbench-v2-works-browser.test.js` → 2/2 通过。
- 受影响真实 Chrome 组：V2 foundation、V2 Production、V2 Works、既有 Work delivery、VSA-A14 → 5/5 通过。
- `npm run check` → 229 个 JavaScript 文件通过；`git diff --check` 通过。
- 默认 `npm test` 已真实重跑；输出推进到第 530 个用例后持续无输出超过 2 分钟，因此主动终止，不能记为本地全量
  GREEN。受影响的 V2 foundation、V2 Production、V2 Works、既有 Work delivery 与 VSA-A14 浏览器文件已在上述
  真实 Chrome 组单独通过；完整回归仍以 Draft PR 固定 head 的 Ubuntu、Windows、identity-postgres 三组 CI 为
  acceptance 门禁。
- 临时截图只写入 `/private/tmp/hifly-v2-c-screenshots-20260817/` 且未纳入 Git；PNG 像素头分别为
  `works-1440.png` 1440×1000、`works-768.png` 768×1024、`works-390.png` 390×844。
- 严格 allowlist 为 12 个文件：Works HTML/CSS/JS，2 个 approved additive seam 源文件，4 个直接测试文件，
  CURRENT、ROADMAP 与本 session。没有配置、凭据、截图、批次、日志、输出或依赖文件进入变更。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #180；等待主控独立复审。
