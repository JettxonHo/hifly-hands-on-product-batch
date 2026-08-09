# Local Agent 最小真实生产执行器实施计划

## Task 1: 执行身份与持久化合同

- TDD 扩展 manual execution memory/PG repository，使 attempt/candidate/report 支持 `local_agent` 与 `executor_agent_id`，人工路径不变。
- 新 migration 只做向后兼容扩展，不重写历史记录。
- 校验同一记录只能绑定 member 或 agent 其中一种执行身份。

## Task 2: 云端 Agent 服务与 API

- 新建 Local Agent service、Bearer guard、routes。
- 实现单任务 claim/start/heartbeat/package/candidate/report。
- 复用 ProductionOrder、handoff package、candidate store 和 A12 verification ports。
- 默认 feature off；生产配置缺 token/id/org 时 fail closed。

## Task 3: Local Agent CLI

- 新建受环境变量驱动的 agent client 与单次 `run-once` 命令。
- 解包 handoff package，读取冻结输入，按 avatar version 查本地映射。
- 组装现有 batch task并调用现有 executor/batch runner。
- 默认 fake 测试；真实 Playwright 模式显式开启，串行 1 条，失败即停。

## Task 4: 端到端无积分验证

- memory service/API tests。
- PostgreSQL migration/integration tests（环境可用时）。
- fake Local Agent 系统测试：ProductionOrder -> Work。
- auth、幂等、租约过期、requires_action、上传完整性和默认关闭回归。
- `npm run check && npm test && git diff --check`。

## Task 5: 文档与交付

- 更新 `docs/status/CURRENT.md` 和 session handoff。
- 写 Local Agent 配置/运行手册，明确云端与 Mac 各自环境变量。
- 独立 Sol Review 后创建 PR；不在本阶段真实访问飞影。
