# AGENTS.md

本文件是项目级协作规范。无论接手者是 Codex、Claude Code，还是其他代码代理，都必须先阅读并遵守本文件，再继续执行任务。

## 当前最高优先级

Owner 于 2026-08-12 正式纠偏 P0：当前正式交付目标是 `GOAL.md` 定义的 **Cloud Executor 纯云端生产闭环**，以 D-034 和 `docs/product/CLOUD_EXECUTOR_P0.md` 为准。

Cloud Executor 使用独立 `cloud_executor` 身份和独立进程/Docker service，在云端复用现有 Hifly Playwright 核心；Profile、素材、视频和 Evidence 必须持久化。并发固定为 1，登录/存储未就绪时 claim 前失败关闭，失败立即停止且不自动重试。

本地 GUI 与 Playwright/Local Agent 链路是已验证的兼容基线，不得破坏或删除，但 Local Agent 不再是 P0 主实现、主提示或验收捷径。CE-02～CE-07 禁止真实飞影生成与积分消耗；CE-08 必须另行明确授权。只有纯云端真实工单完成 Hifly→云端 artifact→A12→Work→鉴权下载后，才可宣称 P0 可投入内部试运行。

## 必读接力文档

继续任何开发、测试或排障前，**按顺序**阅读：

```text
docs/status/CURRENT.md      ← 上下文恢复入口与最近一次状态快照
AGENTS.md                    ← 本文件
GOAL.md                      ← 当前 Goal、里程碑与完成标准
docs/agent-collaboration.md  ← 多 Agent 角色、权限、交接与 Review 规则
docs/product/README.md       ← 产品文档权威入口
docs/product/CLOUD_EXECUTOR_P0.md ← 当前 P0 产品合同
docs/ROADMAP.md              ← 版本目标与 Issue 依赖
docs/PROJECT_HANDOFF.md      ← 仅在需要历史背景时阅读
```

若上下文丢失、模型切换、账号切换或工具切换，应以 `docs/status/CURRENT.md` 为恢复入口，
再用实际 GitHub Issue/PR/CI、Git 分支和 diff 核验当前事实；二者冲突时以实际状态为准并更新快照。

## 持久化记录规则（2026-08-01 更新）

1. 聊天记忆不是项目事实来源。
2. 每轮产生实际改动、决策或状态变化的重要工作必须更新 `docs/status/CURRENT.md`。
3. 实现、修复或治理会话应创建或更新 `docs/status/sessions/` 下的 session 文档；只读 Reviewer 不修改被审分支，只在 Review 结果中报告事实。
4. GitHub Issue 是任务事实来源。
5. ADR（`docs/decisions/`）是架构决策事实来源。
6. 当前状态不得只追加到超长 handoff 顶部。
7. 不得使用 Claude 私有 memory、Codex 私有上下文或 `.claude/` 替代仓库文档。

## 多 Agent 与模型真实性

1. 逻辑角色、实际模型、线程、Issue、分支和权限必须分开记录。
2. 无法从运行时确认模型时，写 `UNVERIFIED_RUNTIME_MODEL`，不得按角色名假装模型已启用。
3. 主控/策划/最终审查由 ORCHESTRATOR_REVIEWER 承担；实现优先交给独立 IMPLEMENTER。
4. 实现任务使用准确名称 `luna-worker`；不可用时必须失败关闭并报告，不得自动回退 Terra。
5. 实现者不得最终批准或合并自己的 PR；Review 必须读取实际 diff、测试与 CI，而不是只看描述。
6. 每个实现任务原则上对应一个 Issue、一个独立分支和一个主 PR；并行任务必须有不冲突的文件与接口边界。
7. 完整规则和任务包格式见 `docs/agent-collaboration.md`。

## 安全校验与工程克制（2026-08-06 更新）

本项目以可交付、可维护的业务系统为目标，不以安全攻防论文式覆盖为目标。

1. 处理会直接影响核心功能、凭据安全、权限隔离或真实数据安全的风险，但禁止过度防御。
2. 除核心安全或已确认的业务完整性/幂等合同外，不新增哈希或 SHA-256，不把哈希扩展到普通业务字段或形式化校验。D-029/D-030 已要求的 checksum、manifest/package hash 与幂等 payload fingerprint 保留，但不得自行扩张。
3. 密码不得明文存储、会话 Bearer Token 不得明文落库，属于身份系统核心风险，可以使用标准密码哈希与不可逆 Token 摘要。
4. 不为没有真实触发路径或业务后果的极低概率 case 反复堆叠防御代码和测试。
5. Rubric 与验收清单用于识别真实风险，不得机械套用；综合触发概率、业务后果、复杂度和维护成本判断。
6. 非核心低概率风险优先记录为已知限制或后续 Issue，不阻塞当前业务闭环。

## 持久化记录内容要求

产生实际改动、决策或状态变化的实现者/主控必须把重要进度写入持久文档。只读 Reviewer 不修改被审分支，只输出审查结果；状态变化由实现者或主控随后固化。

必须记录的内容：

1. 已完成的实际改动。
2. 正在处理的任务和当前卡点。
3. 下一步计划。
4. 已执行的验证命令和结果。
5. 是否涉及飞影真实积分消耗。
6. 当前关键批次、状态、错误信息和下载产物路径。

记录位置：

- 当前快照 → `docs/status/CURRENT.md`。
- 会话记录 → `docs/status/sessions/YYYY-MM-DD-<slug>.md`。
- 架构决策 → `docs/decisions/ADR-NNN-<slug>.md`。
- 历史接力 → `docs/PROJECT_HANDOFF.md`（只读历史背景；新状态不再强制追加）。
- 不要只把关键状态留在聊天上下文里。
- 不要用某个模型私有的记忆空间替代项目文档。

`docs/` 文档职责划分（学到的经验、坑、决策按主题写进对应文档，不要全堆进 PROJECT_HANDOFF）：

| 文档 | 写什么 |
|------|--------|
| `docs/PROJECT_HANDOFF.md` | 历史接力记录；当前状态以 CURRENT + 实际 Git/GitHub 为准。 |
| `docs/CALIBRATION.md` | 飞影页面校准：配置字段含义 + 页面已知行为/坑（如手持图账号级残留、删图关弹窗）+ 页面调试方法（如 `dumpModalDomSnapshot`）。 |
| `docs/ENVIRONMENT.md` | 运行环境：依赖、安装、GUI 启动、配置项、输出目录、打包 + 运行相关的坑（如改代码必须重启、沙箱/代理网络）。 |
| `docs/SOP.md` | 批量生产标准操作流程。 |
| `docs/飞影提示词模板.md` | 提示词与口播模板。 |
| `docs/飞影标准视频工作流.md` | 工作流定义。 |

判断原则：当前状态 → `docs/status/CURRENT.md`；本轮证据 → `docs/status/sessions/`；长期有效的页面行为/调试经验 → `CALIBRATION`；长期有效的环境/运行经验 → `ENVIRONMENT`；生产流程 → `SOP`。

## 当前关键批次

Playwright 历史 GUI 排障批次：

```text
batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f
```

它目前是混合态（已有完成产物 + 失败/待执行条目），仅作为 GUI 重试行为的历史样本；不要为了验证一个按钮从头重跑并消耗积分。

当前 Capture HTTP 调试批次：

```text
batch-ec174f28-e9b8-4541-b2e7-c60b10e22474
```

最近状态：

```text
batch status: real_batch_completed (2026-07-23 恢复后)
MULTI-001: completed / remote_id 652265 / artifacts/未命名.mp4
MULTI-002: pending (未获新的积分授权，未执行)
```

原 manifest drift 已按正确流程恢复：重新录制当前响应 → 脱敏 → offline replay + real_dry_run → 用户授权下以 `resume: true`、`pointBudget: 1` 完成首条。详见 `docs/PROJECT_HANDOFF.md` 顶部。后续不得执行 `MULTI-002`，除非用户在新会话再次明确授权积分风险。

## 飞影积分和真实执行规则

飞影真实生成会消耗积分。默认只做本地无积分验证。

真实执行前必须：

1. 告知用户将消耗积分。
2. 获得用户明确允许。
3. 优先限制为 1 条商品。
4. 记录批次 ID、SKU、飞影作品时间、下载路径和失败阶段。

禁止为了调试确认按钮或下载按钮，反复从素材上传开始跑完整流程。

## Git 与文件安全

本项目可能存在用户或其他代理留下的未提交改动。

执行前必须查看：

```bash
git status --short --branch
```

规则：

- 不要回滚未理解的改动。
- 不要删除用户文件。
- 只提交与当前任务相关的文件。
- 不要提交 `config.local.json`、登录态、批次数据、下载视频、日志、截图、`outputs/` 或 `node_modules/`。

## 常用命令

启动 GUI：

```bash
npm run gui
```

登录飞影：

```bash
npm run login
```

本地测试：

```bash
npm test
npm run check
```

重点测试：

```bash
node --test test/state-machine.test.js test/server-api.test.js test/batch-runner.test.js
npm run check
```

检查当前关键批次：

```bash
node -e "const fs=require('fs');const p='batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/batch.json';const b=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({status:b.status,execution_error:b.execution_error,items:b.items.map(i=>({sku:i.sku,status:i.status,error_phase:i.error_phase,error_message:i.error_message,output_path:i.output_path,submit_checkpoint:i.submit_checkpoint&&{phase:i.submit_checkpoint.phase,observed_at:i.submit_checkpoint.observed_at}}))},null,2));"
```
