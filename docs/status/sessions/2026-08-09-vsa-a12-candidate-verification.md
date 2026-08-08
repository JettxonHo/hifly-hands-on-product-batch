# VSA-A12 候选产物核验与 Work 创建

## 范围

- Issue：#68；角色：`luna-worker`；未使用 Terra。
- Worktree：`/private/tmp/hifly-vsa-a12`。
- Branch：`codex/vsa-a12-candidate-verification`。
- Base：`9af3f5e20fa264ea562a015fbb6bbbd4e4043ee5`。

## 已完成

- 保留前任未跟踪红测 `test/work-verification-service.test.js`，并从最小 memory service/repository green 扩展到完整 A12 核心切片。
- 增加 memory/PG Work Verification repository、AsyncJob worker、独立 status ledger/audit migration、bounded retry/recover/lease。
- 复用 A03 canonical Asset/AssetVersion repository；成功核验注册 `kind=work_video`、`status=available` 的 AssetVersion，Work 固定保存 `primary_asset_version_id`。
- 服务端读取最新有效 completed report、primary candidate、固定 attempt/package 与对象存储真实内容；验证组织归属、关联、唯一 primary、媒体类型、大小和 SHA-256 checksum。
- Work 固定保存 VideoPlan/Copy/Avatar/production config、package/version/manifest、attempt/report、candidate/checksum 等来源快照。PG 成功事务在同一 client 完成 AssetVersion、Work、candidate passed、order succeeded、ProductionOrder AuditEvent、A12 AuditEvent 与 ledger；memory 对失败路径回滚。
- 业务 `failed`/`requires_action` 与技术 `failed` 分开；technical retry 与 requires_action recover 均受 `maxAttempts` 约束，lease 过期可 reclaim 或终止并更新 candidate projection。
- 接入 API/app/start，`artifactVerificationEnabled` 默认关闭；production 页面增量显示真实状态、摘要、恢复动作、Work/AssetVersion 卡和 A13 作品库禁用说明；不创建 `works.html`。
- 文档已修正当前 A11 旧“等待合并”描述：A11 是本分支基线，但不声称已进入远端 main。

## 验证

- A12 targeted service/API/worker tests：已通过；覆盖 AssetVersion 引用、Work insert/order transition/asset registration 失败回滚、业务失败、技术重试、recover、lease、并发幂等、跨组织和 member/admin 权限。
- PG integration：测试已加入 clean isolated migration/transaction assertions；本机没有 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 时明确 skip，未声称通过。
- Browser flow：测试已加入 1440/390、刷新恢复、无横向滚动和无 `works.html` 断言；若本机 Chrome Mach port 权限阻止启动则明确 skip。
- 最终验证：定向 service/API/worker 为 15 pass；`npm run check` 检查 172 个 JavaScript 文件通过；`npm test` 为 789 tests / 747 pass / 0 fail / 42 skipped；`git diff --check` 通过。
- PG integration 与 browser flow 均已执行但各 1 个环境 skip：本机未设置 `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL`，且系统 Chrome 受 `MachPortRendezvous ... Permission denied` 阻止启动；未把 skip 记录为通过。
- `npm audit --omit=dev --audit-level=high`（官方 npm registry）报告仓库现有依赖 1 moderate、20 high，多项无修复；A12 未新增依赖，也未执行范围外自动升级。

## 安全与后续

- 未访问 Hifly，未发送真实 Provider/Capture HTTP，未运行批次，未消耗积分。
- 未提交 config.local、凭据、batches、outputs、视频、HAR、log、screenshots 或 node_modules。
- 下一步是提交当前 branch；不 push、PR、merge 或关闭 Issue。A13/A14 不在本切片实现范围内。
