# 多 Agent 协作规范

> 状态：Active
> 最后更新：2026-08-08
> 适用范围：产品策划、Issue 实现、Review、CI、合并与 Goal 验收

## 1. 角色与模型记录

| 逻辑角色 | 首选配置 | 职责 |
|---|---|---|
| `ORCHESTRATOR_REVIEWER` | GPT-5.6 Sol / XHigh | 产品与架构决策、拆分、任务合同、最终 Review、Goal 验收 |
| `IMPLEMENTER` | 自定义 Agent `luna-worker`（`gpt-5.6-luna` / Max） | 按合同实现、测试、文档、commit、push、PR、修复 Review |
| `AUXILIARY_REVIEWER` | GPT-5.6 Terra / XHigh | 仅在主控明确派发时承担独立调查、测试或 Review；不得作为实现任务的自动回退 |

每个实现任务必须按自定义 Agent 名称 `luna-worker` 启动，使其加载
`~/.codex/agents/luna-worker.toml`；不得只传 `gpt-5.6-luna` 模型字符串冒充自定义 Agent。任务开始时记录：
逻辑角色、自定义 Agent 名称、配置文件、配置模型、推理强度、线程、Issue、分支、基准提交，以及
`CONFIG_VERIFIED`、`RUNTIME_VERIFIED` 或 `UNVERIFIED_RUNTIME_MODEL`。当前会话无法发现 `luna-worker`
时，不得自动回退 Terra，也不得启动新的实现任务；应报告 `STATUS: BLOCKED_LUNA_WORKER_UNAVAILABLE`，
保留已完成成果并等待重启 Codex、重新打开任务或 Owner 明确决定。

### Kimi Code 长期规则（Owner 2026-08-08 确认）

- 后续 Kimi 设计固定使用 `kimi-code/k3`。
- Context 按 1M 处理；当前已核验 `max_context_size=1048576`。
- thinking effort 必须显式设为 `max`；当前默认值为 `high`，不得误报为 `max`。
- 运行时若无法从 wire/session 元数据验证实际模型，必须标记 `UNVERIFIED_RUNTIME_MODEL`。

## 2. 权威事实与恢复顺序

```text
1. AGENTS.md
2. GOAL.md、产品 Decision/Specification 与 owner 最新明确决定
3. 当前 GitHub Issue、分支、PR、CI 与实际 diff
4. docs/status/CURRENT.md（恢复入口和缓存快照；冲突时更新）
5. docs/agent-collaboration.md
6. docs/product/README.md 及当前 Issue 引用的其他规范
7. docs/PROJECT_HANDOFF.md（只补历史背景）
```

聊天、模型私有 memory 和未提交的个人笔记不构成长期事实。重要决定写入 `docs/product/DECISION_LOG.md` 或 ADR，执行状态写入 CURRENT 与 session 文档。

## 3. 标准任务合同

实现前必须有可执行合同，至少包括：Issue/Goal/里程碑、用户结果、工作范围、非工作范围、允许和禁止修改的模块、接口与数据合同、验收场景、测试命令、依赖和合并顺序、风险、自主决策范围、升级条件、交付物、分支和基准提交。

实现 Agent 遇到产品歧义、规范冲突、公共接口或核心架构变化、不可逆 Migration、跨模块范围扩大、安全/隐私/成本风险时暂停相关部分并升级；普通实现细节按仓库模式自主决定。

## 4. 分支、并行与 PR

- 一个 Issue 原则上对应一个独立 worktree、一个分支和一个主 PR。
- 并行只用于文件、Migration 和公共接口边界清晰的任务；否则串行。
- 实现分支从最新 `origin/main` 开始，禁止把无关工作区、凭据、登录态、批次、产物或私有日志带入。
- PR 必须关联 Issue，并说明背景、目标、方案、范围/非目标、验收映射、测试、证据、风险、兼容/数据影响、回滚和 Review 重点。
- 不 force push，不隐藏失败测试，不用重跑掩盖首次失败。

## 5. Review 与修复循环

Review Agent 必须读取实际 diff、测试和 CI，按正确性、可读性、架构、安全、性能与范围进行审查。结论只能是：

```text
APPROVED
CHANGES_REQUESTED
BLOCKED
ESCALATE_TO_HUMAN
```

实现者不能最终批准或合并自己的 PR。若主控直接实现，必须由独立 Agent 或人工审查。`CHANGES_REQUESTED` 必须给出位置、触发条件、后果和预期修法；同一问题连续两轮未解决时重新分析根因，不重复机械提示。

Goal 级最终验收使用另一组状态：`GOAL_APPROVED`、`GOAL_APPROVED_WITH_FOLLOW_UPS`、
`GOAL_BLOCKED`、`GOAL_REJECTED`、`ESCALATE_TO_HUMAN`。PR Review 状态与 Goal 验收状态不得混用。

只有验收、必要测试、构建、CI、文档和 Review 全部满足，且无待人工确认风险，才可合并。是否自动关闭 Issue 以 PR 授权和仓库约定为准。

## 6. 工程克制与安全边界

- 只阻塞可真实触发且会影响核心业务、凭据、权限、数据或成本的风险。
- 密码哈希和会话 Token 不可逆摘要是身份核心边界；D-029/D-030 已确认的 checksum、manifest/package hash 和幂等 payload fingerprint 是核心完整性合同。除此之外，普通业务字段不得为了形式完整追加哈希/SHA-256。
- 不为基本不可能出现的 case 堆叠重复防御和测试；非核心低概率风险记录为限制或后续 Issue。
- Rubric 是判断工具，不是机械得分表。测试应锁定用户可观察行为和真实状态边界。
- 真实飞影访问与积分消耗永远需要当次明确授权，默认只跑本地无积分测试。

## 7. 上下文检查点与回退

运行时能准确提供上下文容量时，以约 70% 为软触发；无法读取时不得假装知道百分比。里程碑完成、重大决策、长会话、模型切换或开始大 Review 前，由产生状态变化的实现者或主控更新 CURRENT、GOAL、Decision/ADR、session、Issue/PR 与测试状态后再压缩或交接；只读 Reviewer 不修改被审分支。

Agent 不可用时记录配置与运行时核验结果；未经 Owner 明确许可不得替换 `luna-worker`。环境失败要区分
代码、测试、CI 和外部依赖。发生并行冲突时暂停受影响合并，由主控确定事实来源、接口归属和合并顺序。

## 8. 当前分配（Issue #275 VideoPlan Create Idempotency-Key Seam）

```text
当前 Goal：RBV-GOAL-001；当前 bounded Stage：Issue #275 VideoPlan Create Idempotency-Key Seam
当前阶段：VIDEOPLAN_CREATE_IDEMPOTENCY_SEAM（provider-free candidate，等待独立 Review/exact-head CI）
当前 Decision：D-037（docs/product/DECISION_LOG.md#d-037-real-batch-production-validation）
当前 Pilot Contract：docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md
当前 Readiness Record：docs/status/RBV_CALIBRATION_READINESS_FREEZE.md（底层 Goal 门禁仍为 BLOCKED_PRE_REAL_RUN）
当前任务：为 legacy Plan 与 integrated workspace 的 VideoPlan 创建提供可选、可审计、原样透传的 Idempotency-Key；空值生成 ordinary UUID，空白/超长/非字符串 fail-closed，其他命令继续使用既有生成 key；provider-free only
Stage 1 状态：合同与人工门禁已完成历史（Issue #259 / PR #260），不再是当前 active stage
实现分支：codex/videoplan-precommitted-idempotency-seam
实现 Agent 请求配置：自定义 Agent luna-worker / gpt-5.6-luna / Max（provider-free bounded implementation）
实现 Agent 配置状态：CONFIG_VERIFIED
实现 Agent 运行时状态：UNVERIFIED_RUNTIME_MODEL（当前工具未暴露实际运行模型元数据）
最终审查配置：主控 ORCHESTRATOR_REVIEWER；实现者不得自审/批准，Draft PR 在独立 Review/exact-head CI 前停止；两者通过后可按现有 Owner 工程授权合并并执行零业务变更部署
后续：真实 Plan Create、Provider/Hifly、登录或积分动作仍禁止；下一 Owner Gate 仅为一次真实 Plan Create
```

### 历史分配（Issue #273 RBV-012 One-Attempt Contract Correction）

状态：工程阶段已完成并已合并/部署，保留为历史/非当前；GitHub Issue #273 仍 OPEN，不覆盖 Issue #275 当前 active bounded Stage。

```text
当前 Goal：RBV-GOAL-001；历史 bounded Stage：Issue #273 RBV-012 Copy Quality One-Attempt Contract Correction
当前阶段：QUALITY_ONE_ATTEMPT_CONTRACT_CORRECTION（provider-free candidate，等待独立 Review/Owner Gate）
当前 Decision：D-037（docs/product/DECISION_LOG.md#d-037-real-batch-production-validation）
当前 Pilot Contract：docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md
当前 Readiness Record：docs/status/RBV_CALIBRATION_READINESS_FREEZE.md（底层 Goal 门禁仍为 BLOCKED_PRE_REAL_RUN）
当前任务：把正式 Copy Quality path 修正为 one authorization → one logical run → at-most-one dispatch/HTTP request，持久化 usage/charge truth，lease/reclaim/retry fail-closed，并保持 parent Copy v1 不被 Quality start supersede；provider-free only
Stage 1 状态：合同与人工门禁已完成历史（Issue #259 / PR #260），不再是当前 active stage
实现分支：codex/rbv-quality-one-attempt
实现 Agent 请求配置：自定义 Agent luna-worker / gpt-5.6-luna / Max（provider-free bounded implementation）
实现 Agent 配置状态：CONFIG_VERIFIED
实现 Agent 运行时状态：UNVERIFIED_RUNTIME_MODEL（当前工具未暴露实际运行模型元数据）
最终审查配置：主控 ORCHESTRATOR_REVIEWER；实现者不得自审/批准，Draft PR 停在 Owner Gate
后续：候选停止于独立 Review 与 Owner Gate；不得自动执行真实 Quality Evaluation；后续真实 DeepSeek run 必须重新取得逐动作 Owner Authorization
```

### 历史分配（CE-08，非现行）

状态：历史/非现行；以下保留当时分配，不覆盖当前 RBV Goal。

```text
当前 Goal：P0 Cloud Executor 纯云端生产闭环（GOAL_COMPLETE）
当前里程碑：CE-08 / #143 production closeout 完成；下一阶段为 3 条严格串行内部试运行与 release-readiness
当前 Issues：#143 已完成并关闭；后续内部试运行按唯一工单、零 attempt 和单条授权门禁执行
当前任务：收敛 CURRENT、GOAL、ROADMAP、Cloud Executor P0 Evidence、session 与 ADR 索引；不改代码、不部署、不访问飞影
实现分支：codex/ce08-closeout
实现 Agent 请求配置：自定义 Agent luna-worker / gpt-5.6-luna / Max（docs-only）
实现 Agent 配置状态：CONFIG_VERIFIED
实现 Agent 运行时状态：UNVERIFIED_RUNTIME_MODEL（当前工具未暴露实际运行模型元数据）
最终审查配置：主控 ORCHESTRATOR_REVIEWER；文档收尾不提交、不合并，留主控审阅
后续：保持 Mac Local Agent 关闭，执行 3 条严格串行内部试运行；随后处理可信 CA、依赖审计和 works query follow-up
```
