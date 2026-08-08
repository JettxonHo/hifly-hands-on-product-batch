# VSA-A12 候选产物核验与 Work 创建

## 范围

- Issue：#68；角色：`luna-worker`；未使用 Terra。
- Worktree：`/private/tmp/hifly-vsa-a12`。
- Branch：`codex/vsa-a12-candidate-verification`。
- Base：`origin/main=9af3f5e20fa264ea562a015fbb6bbbd4e4043ee5`（A11 PR #89 已合并，Issue #67 已关闭）。

## 已完成

- 保留前任未跟踪红测 `test/work-verification-service.test.js`，并从最小 memory service/repository green 扩展到完整 A12 核心切片。
- 增加 memory/PG Work Verification repository、AsyncJob worker、独立 status ledger/audit migration、bounded retry/recover/lease。
- 复用 A03 canonical Asset/AssetVersion repository；成功核验注册 `kind=work_video`、`status=available` 的 AssetVersion，Work 固定保存 `primary_asset_version_id`。
- 服务端读取最新有效 completed report、primary candidate、固定 attempt/package 与对象存储真实内容；验证组织归属、关联、唯一 primary、媒体类型、大小和 SHA-256 checksum。
- Work 固定保存 VideoPlan/Copy/Avatar/production config、package/version/manifest、attempt/report、candidate/checksum 等来源快照。PG 成功事务在同一 client 完成 AssetVersion、Work、candidate passed、order succeeded、ProductionOrder AuditEvent、A12 AuditEvent 与 ledger；memory 对失败路径回滚。
- Sol Review 后补齐不可变 correction report → 新 verification job 恢复链、中文 UI 业务投影、POST 受理后 GET 瞬时失败的自动轮询恢复，以及 PG 001→002 迁移约束列集合识别。002 不猜自动截断名；create request 按 receipt→natural 顺序保留双 advisory lock，PG 回归覆盖同一幂等键并发不同自然键的稳定冲突/replay；成功后任意新自然键核验请求的 memory/PG 阻断行为也已对齐。
- 业务 `failed`/`requires_action` 与技术 `failed` 分开；technical retry 与 requires_action recover 均受 `maxAttempts` 约束，lease 过期可 reclaim 或终止并更新 candidate projection。
- 接入 API/app/start，`artifactVerificationEnabled` 默认关闭；production 页面增量显示真实状态、摘要、恢复动作、Work/AssetVersion 卡和 A13 作品库禁用说明；不创建 `works.html`。
- 文档已统一当前事实：A11 PR #89 已合并、Issue #67 已关闭，`origin/main=9af3f5e`；A12 以该提交为基线。

## 验证

- A12 targeted service/API/worker tests：已通过；覆盖 AssetVersion 引用、Work insert/order transition/asset registration 失败回滚、业务失败、技术重试、recover、lease、并发幂等、跨组织和 member/admin 权限。
- PG integration：测试已加入 clean isolated migration/transaction assertions；本机没有 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 时明确 skip，未声称通过。
- Browser flow：测试已加入 1440/390、刷新恢复、无横向滚动、无 `works.html`、无内部术语、初次进入首条 GET 失败后自动恢复、失败→更正报告→重新核验及一次瞬时 GET 失败后恢复到 passed 的断言；本机 Chrome Mach port 权限阻止启动，明确 skip。Sol 已在 `04a963f` 后用系统 Chrome 实跑 A12 browser 1/1（8.48s），覆盖 initial GET fail→第二次 200→requires_action/correction/passed 及 1440/390。
- 最终验证：定向 service/API/worker 为 15 pass；`npm run check` 检查 172 个 JavaScript 文件通过；`npm test` 为 789 tests / 747 pass / 0 fail / 42 skipped；`git diff --check` 通过。
- PG integration 已执行但本机未设置 `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL`，因此 1 个环境 skip；该 skip 不计为迁移/事务 rollback 通过，待 CI/带数据库环境实证。browser 本机同样因 `MachPortRendezvous ... Permission denied` 1 skip；Sol 已在 `04a963f` 后用系统 Chrome 实跑 A12 browser 1/1（8.48s）。
- `npm audit --omit=dev --audit-level=high`（官方 npm registry）报告仓库现有依赖 1 moderate、20 high，多项无修复；A12 未新增依赖，也未执行范围外自动升级。

## 安全与后续

- 未访问 Hifly，未发送真实 Provider/Capture HTTP，未运行批次，未消耗积分。
- 未提交 config.local、凭据、batches、outputs、视频、HAR、log、screenshots 或 node_modules。
- A12 本轮 timer 所有权修复提交为 `04a963f`；后续由上游进行 CI/Review，不 push、PR、merge 或关闭 Issue。A13/A14 不在本切片实现范围内。
