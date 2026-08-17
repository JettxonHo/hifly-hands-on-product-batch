# 2026-08-17 运营工作台 UX V2 设计合同会话

## 1. 任务与范围

- 跟踪 Issue：#174 `UX-D02: Operator workbench V2 independent design contract`
- 精确基线：`origin/main@db6b4ad22f8870579393880046a42057ea27979c`
- 分支：`codex/operator-workbench-ux-v2-contract`
- 生命周期：Owner 已批准“运营任务流优先”的方向；本轮只提交独立设计合同 proposal。合同只有随 acceptance PR
  合并进入 `main` 后才计为 `designed`，代码实现仍需后续独立切片。

严格 allowlist：

1. `docs/frontend/OPERATOR_WORKBENCH_UX_V2_CONTRACT.md`
2. `docs/status/CURRENT.md`
3. `docs/ROADMAP.md`
4. `docs/status/sessions/2026-08-17-operator-workbench-ux-v2-contract.md`

本轮没有修改 HTML、CSS、JavaScript、API、数据库、migration、测试、依赖或部署文件。

## 2. 读取的权威输入

- `docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md`
- `docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md`
- `docs/frontend/OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- 当前 Production、Works、Assets、shell 与阶段页面的源码和现有公开合同（只读）

外部案例只作为已完成研究输入。本会话没有继续搜索案例，也没有把竞品 IA 或视觉风格当成产品真值。

## 3. 本轮设计决策

1. 一级导航承担跨项目稳定对象；项目阶段导航只承担当前项目/商品的商品资料、文案、人物、视频方案和生产五阶段。
2. “生产任务”进入目标一级 IA，但必须先通过组织隔离的服务端任务索引 Product/API gate；门禁前不显示死链接、
   不在浏览器聚合项目伪造队列。
3. 显式 `/index.html` 继续是本地/运维 legacy fallback，不进入企业导航，也不改变真实执行确认与积分门禁。
4. 各页统一对象、业务状态、阻断、唯一下一步和折叠技术详情；中文词典明确区分自动检查、人工批准和技术证据。
5. Production 使用完整时序状态矩阵，保留激活前 Worker off、唯一 eligible、当前工单零 attempt、active attempts=0、
   terminal 关 Worker、失败停批且无自动重试、成功经 A12/Work/真实字节下载后才下一条。源码核对确认
   `createProductionOrder()` 直接持久化 `waiting_for_executor`，`draft/ready` 只存在于 `status_history`；矩阵因此只使用
   当前工单、交接包、attempt 和 Cloud readiness/claim 的可观察条件。交接包矩阵覆盖 `generating`、`ready`、
   `generation_failed`、`expired`、`superseded` 和 `revoked`；只有 `ready` 包可被领取。
6. Works 已交付终态以查看交付记录为主；追加交付是明确次级动作并新增审计记录，不能覆盖历史或成为默认主操作。
7. Assets 可直接按 `product_image`、`avatar_image`、`work_video` 真实类型分组；用途、关联、缩略图、搜索和分页的
   数据缺口必须另过 Product/API gate，不由前端猜测。
8. 原 Slice C 被 V2 严格串行切片吸收：shared IA/content/control foundation → Production → Works → Assets →
   必要时回补 Slice A/B。每片独立 Issue、Draft PR、公开浏览器回归和 Review，前一片合并后才开始下一片。
9. 当前企业端只有 `GET /api/cloud-executor/status` 只读状态接口，没有组织管理员 Worker 启停命令；页面只能提示等待
   获授权运维使用既有部署控制面。状态字段按投影区分 `worker.connection=offline/online` 与
   `readiness.status=disabled/unconfigured/requires_login/storage_blocked/available/busy/requires_action`。未来 Web 启停须
   单独通过 Product/API、安全授权与审计 gate。

## 4. 证据与验证

- `npm run check`：通过，检查 229 个 JavaScript 文件。
- `git diff --check`：通过。
- strict allowlist：只有本会话第 1 节列出的四份文档。
- 相对引用目标存在；active CURRENT/ROADMAP 不再把 Issue #172 写成待完成 gate，也不保留“之后再决定原 Slice C”
  的旧方向。
- fixed-head Ubuntu、Windows 与 identity-postgres CI 结果以 Draft PR 的 GitHub checks 为权威证据。
- 本轮没有运行页面实现或视觉截图验收，因为没有代码变化；1440/768/390 是后续每个实现切片的公开浏览器 gate。

## 5. 未执行边界

- 未开始 shared foundation、Production、Works、Assets 或 Slice A/B 回补。
- 未使用 Taste 实现，未修改 API/DB/领域状态，未新增全局生产任务页面。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- Draft PR 不自动 mark Ready、merge 或关闭 Issue #174；等待主控与 Owner 独立 acceptance。
