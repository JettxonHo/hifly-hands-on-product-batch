# docs/status/ — 项目持久化状态

本目录是项目跨模型协作的持久化记忆系统。聊天上下文、Claude memory、Codex 私有上下文均不是项目事实来源。

## 文件职责

| 文件 | 职责 |
|------|------|
| `CURRENT.md` | 只保存当前有效状态。任何代理接手时首先阅读此文件。 |
| `sessions/` | 每次重要开发会话的执行记录。一个文件对应一轮有意义的工作。 |
| `SESSION_TEMPLATE.md` | session 文档模板。 |

## 与其他文档的关系

| 文档 | 定位 |
|------|------|
| `docs/status/CURRENT.md` | 当前快照，精简，<200 行。 |
| `docs/PROJECT_HANDOFF.md` | 历史接力和事故过程记录，不再作为唯一当前状态来源。保留用于追溯。 |
| `docs/decisions/` | 架构决策及其原因（ADR 格式）。 |
| `docs/experiments/` | 实验设计、变量、成本和结果。 |
| `docs/ROADMAP.md` | 版本目标、Issue 和依赖关系。 |

## 规则

1. 每轮重要工作必须更新 `CURRENT.md`。
2. 每轮必须创建或更新 session 文档。
3. 不得只追加到超长 handoff 顶部而不更新 CURRENT.md。
4. 不得使用 Claude 私有 memory、Codex 私有上下文或 `.claude/` 替代仓库文档。
