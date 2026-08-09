# Local Agent 最小执行器切片会话记录

- 角色：Sol 主控与独立 Review；实现 Agent 使用准确自定义 Agent `luna-worker`，配置 `gpt-5.6-luna` / Max；状态 `CONFIG_VERIFIED`、`UNVERIFIED_RUNTIME_MODEL`，未回退 Terra。
- 基线：`origin/main@05e4466`；分支：`codex/cloud-production-executor`。
- 已实现云端最小闭环：Agent Bearer readiness、claim/start/lease heartbeat、交接包下载、候选 MP4 authorize/upload/complete、completed/requires_action/failed 受控报告，以及 completed 后触发既有 A12 核验与 Work 创建。执行者以 Agent 身份进入 attempt/candidate/report/audit/ledger，不伪造成成员。
- 已实现 macOS Local Agent CLI：默认 standby 只上报在线、不领取任务；fake 需 `LOCAL_AGENT_FAKE_EXECUTION=true`，真实执行需 `--real` 与 `LOCAL_AGENT_REAL_EXECUTION=true` 双门禁。执行时保持单任务串行，从 A10 交接包编译既有批处理输入，按云端人物素材版本读取本地人物映射；租约续期失败后停止上传和终态报告。
- production config、Compose 与 `.env.example` 已增加默认关闭的 Local Agent 配置；运行手册见 `docs/deployment/LOCAL_AGENT_RUNBOOK.md`。
- 验证：Local Agent/生产/A12 定向 74 tests，73 pass / 1 PostgreSQL environment skip / 0 fail；全量串行 862 tests，848 pass / 14 environment skips / 0 fail；`npm run check` 检查 204 个 JavaScript 文件，`git diff --check` 通过。skip 未记作通过。
- 当前尚未完成：真实云端部署更新、Mac 与云端配对、真实飞影单条执行、A12/Work 真实产物验收。不得据此宣称云端端到端可用。
- 本轮未启动真实 Playwright、未访问 Hifly、未部署、未 push/merge、未消耗积分。PG integration 缺少测试数据库时只能记为 skip，不能记为通过。
