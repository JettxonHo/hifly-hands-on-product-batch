# 2026-08-07 VSA-A06 Copy Review 实现会话

## 完成

- 在 `codex/vsa-a06-copy-review` 实现独立 HumanReview 纵向切片：领域服务、memory/PostgreSQL repository、独立 migration ledger、参数化 SQL、审计、安全 API 投影、config/start wiring。
- 实现不可变审核周期 + append-only transition/event + mutable head/row_version；revoked 永不恢复，新审核创建新周期。
- 实现服务端提交/批准门禁、admin 决策、member 只读决策权限、self-review、理由校验、幂等和并发控制。
- 实现 ProductRevision、CopyVersion、QC policy/result 相关失效传播；展示名等无关元数据不传播。
- 在 copy 工作区增加质检/审核 tab、Dialogs、门禁列表、失效提示、历史和 A07 禁用说明。
- 修复两个浏览器时序问题：QC 轮询后同步刷新审核投影；查看旧版本时不再被历史已完成 rewrite job 自动跳回输出版本。
- 按独立审查问题完成 TDD 修复：命令 receipt preflight 先于动态 gate，memory/PostgreSQL 保存原业务 head 快照；冲突 payload 仍拒绝。
- 增加最小显式失效 coordinator：ProductRevision current 变化、父 CopyVersion superseded、新 QualityResult 与 Finding effective conclusion 变化会在上游命令完成后主动 reconcile；审核读取仍保留兜底。
- 批准在 transition 后、返回前执行最终权威 recheck；barrier 回归覆盖首次 gate 通过后上游完成变化，并验证 approved 后立即持久化 revoked、批准 receipt 回放 revoked。
- 修复第二轮最终审查 Important：批准返回 projection 触发的自动撤销也携带批准 receipt key；double-gate barrier 精确覆盖 final gate 有效、projection gate 失效，首次与回放均 revoked 且只追加一次撤销。

## 验证

- Review/Quality service/API targeted（含 PostgreSQL 16）：47 pass / 0 fail。
- 全量：694 tests / 664 pass / 0 fail / 30 environment skips。
- PostgreSQL 16.14 clean migration/integration：1/1 pass，使用一次性本机 Docker 容器，测试后已停止清理。
- 系统 Chrome A04-A06 综合流程：1/1 pass，覆盖提交、self-review 批准、刷新恢复、失效撤销、1440/390 无横向滚动。
- 主控最终系统 Chrome 截图：`/private/tmp/hifly-a06-final-visual-qa/copy-quality-desktop.png`、`copy-quality-mobile.png`，不提交仓库。
- `npm run check` 检查 126 个 JavaScript 文件；`git diff --check` 通过。

## 风险与下一步

- A06 继续使用当前粗粒度 admin/member 身份，不实现完整 RBAC 或强制双人审核。
- A07 页面尚不存在，界面只显示禁用说明；后续通过 `getCurrentApprovedGate` 复用当前批准门禁。
- 显式协调是单体内 post-commit 调用，不与上游事务原子提交；进程中断窗口由审核读取和下游每次权威 gate 重验兜底。本轮没有引入分布式锁、通用 event bus 或 Outbox。
- 最终独立 Reviewer 结论为 **`APPROVED`**，无剩余 Critical/Important；主控负责 commit、push、PR、CI 与合并。

## 外部执行

- 未访问 Hifly。
- 未调用真实模型或真实 Provider。
- 未运行历史 `MULTI-002`，未消耗飞影积分。
