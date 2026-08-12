# CE-03 Cloud Playwright adapter session

日期：2026-08-12
Issue：#138
角色：`IMPLEMENTER`
请求自定义 Agent：`luna-worker`
配置：`~/.codex/agents/luna-worker.toml`
配置模型：`gpt-5.6-luna`，reasoning `max`
模型状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`

## Branch / base

- Branch：`codex/ce-03-cloud-playwright-adapter`
- Base：`origin/main@d912d93`
- Implementation commit：`490b4b9`
- Sol Review follow-up implementation commit：`4d5b34a`
- READY PR：[JettxonHo/hifly-hands-on-product-batch#146](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/146)，`Closes #138`，当前 `OPEN` / non-draft；follow-up code commit `4d5b34a` 的 Ubuntu、Windows、PostgreSQL CI 全部通过。
- Scope：仅 CE-03；未回滚或覆盖其他工作区改动。

## 实际改动

- 新增 `src/cloud-executor/playwright-adapter.js`，将 standalone Cloud Executor 的 browser context/page 生命周期、显式 workspace/profile 配置和现有 `runBatch` 组合到 CE-02 runtime。
- 通过现有 `HiflyHandsOnProductPage` 与 `createHiflyExecutor` 注入页面/执行器，不复制 Hifly selector、上传、生成、确认或下载流程。
- 将既有 checkpoint 映射到受控 `pre_submit`、`submitted`、`wait_download`、`unknown_post_submit` 阶段；未知或含糊的提交结果转为 `requires_action`，halt worker，禁止 Provider submit 自动重试。
- 扩展 CE-02 service/runtime/config 以接受 `playwright` standalone mode、progress heartbeat、显式 workspace，并保持默认 `disabled` / `fail_closed`；没有修改或新增 migration，没有把 browser lifecycle 接入 Fastify/Web/API。
- 新增 fake Playwright/page adapter 测试，包含 workspace/profile 注入、既有 Hifly composition、checkpoint/progress 映射、一次 submit 上限、unknown post-submit no-retry 和 selector/flow duplication guard。

## Sol Review follow-up

- 修正 Windows CI 路径断言：预期值由当前平台的 `path.resolve` / `path.join` 计算，不再把 POSIX 绝对路径硬编码为 Windows 预期。
- 删除生产路径对伪造 `package.task` / `execution_task` / `manifest.task` 的依赖。Playwright 模式在 attempt 启动后通过新增最小 `downloadPackageForCloudExecutor` port 取得已领取 ready 包的 archive，仅向 adapter 转发受控 `{ body, contentType }`。
- adapter 将 archive 解包到 Cloud workspace 的 attempt 目录，并直接复用 Local Agent 已有 `extractHandoffPackage`、`loadAvatarMappings`、`compilePackageToBatchItem`；通过 `CLOUD_EXECUTOR_AVATAR_MAPPING_FILE` 或注入映射显式解析人物本地文件。聚焦测试仍保留 `taskFactory` seam，但 package fixture 不再携带 task。
- 新增 integration-shaped fake：使用现有 ManualHandoffPackage service/worker 生成真实 manifest + embedded asset zip，经 Cloud package port 下载、现有 compiler 编译后，由现有 Hifly executor/page fake 完成一次批处理。没有复制领域编译、selector 或 DOM flow。
- package archive 和 port 的额外内部字段只在 runtime 内部流转；service 在执行器边界要求 Buffer，并丢弃私有 URL 等额外字段。公开 attempt/report/candidate/result、日志和错误原因均不包含 archive、manifest 正文、素材、secret 或 URL。

## 验证

- `node --test test/cloud-executor-playwright.test.js test/cloud-executor.test.js`：20/20 passed。
- `node --test test/cloud-executor.test.js test/cloud-executor-playwright.test.js test/manual-handoff-package-service.test.js test/local-agent-package-compiler.test.js`：36/36 passed。
- `node --test test/local-agent*.test.js test/execution-backend-config.test.js test/batch-runner.test.js`：127/127 passed。
- `npm run check`：220 JavaScript files checked, passed。
- `npm test`：975 total / 961 passed / 14 existing environment skips / 0 failed；另以 dot reporter 完整重跑，exit 0。
- `git diff --check`：通过。
- PR #146 CI（follow-up code commit `4d5b34a`）：Ubuntu Node 22、Windows Node 22、identity-postgres 全部 passed；Windows portability 回归已获得 CI 证明。

## 外部边界与后续

- 未启动 Cloud Executor/真实 Hifly 浏览器，未访问 Hifly，未调用外部真实 HTTP 或 DeepSeek，未领取真实 ProductionOrder，未部署，未产生飞影积分消耗；所有新增执行测试均使用 fake browserType/context/page、fake page/adapter 和本地临时目录。全量回归中的既有本地 GUI/browser fixture tests 仅覆盖仓库回归，不属于本轮外部动作。
- 没有真实批次、错误或下载产物路径可记录；CE-03 不进行 Hifly 访问、生成或积分验证。
- PR 已由已认证 gh CLI 创建（GitHub connector 创建权限返回 403）；Sol Review 两项代码问题已在 `4d5b34a` 修复并通过完整 CI，后续由独立 Review 决定。不合并或审批自己的 PR，不进入 CE-04+、部署或真实飞影动作。
