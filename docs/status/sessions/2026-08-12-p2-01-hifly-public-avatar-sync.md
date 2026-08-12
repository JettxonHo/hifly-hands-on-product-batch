# 2026-08-12 P2-01 Hifly 公共人物目录显式同步

## 授权与范围

- 对应 Issue：#126。
- 本轮只实现官方 Hifly public avatar list client、provider-neutral 分页 adapter、AvatarAsset memory/PostgreSQL 同步 upsert、admin-only sync API 与 production wiring。
- 不修改 web UI，不实现企业上传、人物推荐、创建人物、视频生成或 Playwright/Local Agent 路径；测试和 wiring 均不访问 Hifly。

## Agent 路由

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`。
- 配置文件：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理强度：`max`。
- 配置状态：`CONFIG_VERIFIED`；当前会话不可见 runtime model metadata，记录 `UNVERIFIED_RUNTIME_MODEL`。

## 实现结果

- `src/providers/hifly-api-client.js` 新增 `listPublicAvatars({ page, size })`，固定 `kind=2`，严格校验 `code/data/avatar/kind/title`，沿用 `HIFLY_API_*` 稳定错误，不保留 provider message/token。
- `src/avatar-selection/hifly-public-avatar-catalog.js` 通过 fake client 分页收集并去重为内部 `provider_key/display_name/source_type` 条目；不返回 request ID。
- memory/PostgreSQL AvatarAsset repository 新增同步 upsert：组织内 `seed_key=hifly-public:<avatar>` 稳定复用同一资产，重复同步不重复，标题更新原资产；公共条目不可确认且无 verified capabilities。PostgreSQL migration 002 仅允许非受控公共目录 asset 更新展示标题/描述/更新时间，其他字段与删除继续 append-only。
- Avatar selection service 与 route 新增 admin-only `POST /api/avatar-catalog/hifly-public/sync`；响应只包含 total/created/updated/unchanged/synced_at。生产 token 缺失或未接入 provider 时 fail closed；workspace GET 不自动同步。

## 验证

- `node --test test/hifly-api-client.test.js test/hifly-public-avatar-catalog.test.js test/avatar-selection-service.test.js test/avatar-selection-api.test.js test/production-start.test.js`：40/40 通过。
- `TEST_DATABASE_URL=<local-isolated-postgres> node --test test/avatar-selection-postgres.integration.test.js`：1/1 通过；测试在随机 schema 中执行并自行清理。
- `node --test test/manual-execution-browser.test.js` 与 `node --test test/vsa-a14-acceptance-browser.test.js`：分别 1/1 通过。
- `node --test --test-concurrency=4 test/*.test.js`：937 total / 923 pass / 14 既有 environment skip / 0 fail。默认全并发运行曾在本机大量并行浏览器进程下长时间停在 A11；受控并发完整通过，证明不是 P2-01 的自动外部请求或生命周期回归。
- `npm run check`：通过，检查 212 个 JavaScript 文件；`git diff --check`：通过。

## 外部调用与边界

- 真实 Hifly 请求：0；真实 DeepSeek 请求：0；Playwright/Capture/Local Agent：0；飞影积分消耗：0。
- 当前 checkout 未 commit/push、未建 PR、未合并、未关闭 Issue #126。PostgreSQL migration/upsert 仍需 CI 或配置测试数据库的环境验证；主控需独立 Review。
