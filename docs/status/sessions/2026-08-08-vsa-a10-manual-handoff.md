# 2026-08-08 VSA-A10 ManualHandoffPackage 实现会话

## 任务与运行时

- Issue：GitHub #66 / VSA-A10「ManualHandoffPackage generation and download」
- 逻辑角色：IMPLEMENTER
- 请求的自定义 Agent：`luna-worker`
- 配置文件：`~/.codex/agents/luna-worker.toml`
- 配置模型：`gpt-5.6-luna`
- 配置推理强度：Max
- 配置验证状态：`CONFIG_VERIFIED`
- 实际运行时模型：`UNVERIFIED_RUNTIME_MODEL`（运行环境未暴露可验证模型信息）
- worktree：`/private/tmp/hifly-vsa-a10`
- 分支：`codex/vsa-a10-manual-handoff`
- 基线：`fd6a2062c2329e66617ee35e028cc1ae4ffce4f2`（A09 PR #86 已合并）
- 约束：未 commit、push、创建 PR、合并或关闭 Issue；未访问 Hifly、Provider、Playwright/Capture HTTP 生产链路或消耗积分。

## 已完成

- 先写失败测试，再实现 `src/manual-handoff/`：ManualHandoffPackage 合同、AsyncJob 租约 worker、memory/PostgreSQL repository、独立 migration/ledger、审计、幂等和组织隔离。
- 生成 ZIP 的 `manifest.json` 是唯一权威清单；`README.md` 只由最终 manifest 派生；embedded 素材只进入受控 `assets/`。支持 embedded、short_lived_fetch、provider_existing 引用模式，并过滤 Secret/Cookie/password/token、永久 URL、路径和跨组织字段。
- 使用 `contract_type=manual_handoff`、`contract_version=1.0`、package version、manifest hash、package hash；支持 generating、ready、generation_failed、superseded、expired、revoked 投影和历史保留。
- 生成请求以 order + package version + contract version + generation request 做幂等；同请求回放同 package/job，冲突拒绝。生成/下载不创建 ExecutionAttempt，不改变 ProductionOrder 运行状态。
- ready 下载使用短时 HttpOnly cookie 授权，授权过期后可重新获取同一包版本；重复下载记录审计且不创建新版本；public JSON、日志和 manifest 不暴露 token、签名 URL 或永久路径。
- 接入 `src/server/routes/manual-handoff.js`、app/start feature wiring、`migrate:manual-handoff` 和直接 `archiver` 依赖；默认 flag 保持关闭，旧 Playwright/Capture HTTP 路径不改。
- 增量更新 `web/production.html/css/js`：生成、异步恢复、失败重试、下载、重新授权、内容摘要、历史、等待/过期/阻断语义，以及 A11 仅禁用说明且无可执行入口；390px 无横向滚动。

## Review 修复（同一 A10 范围）

- 复核 A08/A09 数据链后确认：原 A09 `snapshotForOrder()` 只保留 copy/product/avatar ID，真实 order 无法提供 A10 所需正文、产品事实、人物事实和素材引用。
- 新增 `ProductionOrder` 创建时的 A04-A07 输入快照 port，冻结真实文案正文/版本/审核、ProductRevision 产品与固定 AssetVersion 引用、已选 avatar 展示/来源/授权/能力事实；A10 生成阶段不读取当前可变业务事实，只按固定 asset version 读取字节。
- 旧 order 或冻结事实不完整时返回受控 `generation_failed` 原因，不产生空字段 ready 包；新增真实 A04-A09 服务/API 创建 order 后打开 A10 ZIP/manifest 的集成测试。
- 删除 embedded 二进制正文的 URL/token 正则扫描；新增含普通 URL 元数据图片仍可打包的回归测试，manifest/README 继续不投影 Secret/Cookie/Profile/永久 URL。
- 浏览器测试现在由受控 archive fake 制造首轮失败，真实执行生成失败、刷新恢复、点击重试并 ready；不使用真实网络。
- 针对 ready 完整性复核，在每个 embedded asset 写入 ZIP 前校验冻结 `size`/实际 `Buffer.length` 与冻结 `checksum`/实际 SHA-256；不匹配抛出受控 `MANUAL_HANDOFF_ASSET_INTEGRITY_MISMATCH`，worker 投影为脱敏 `generation_failed`，不会写入 ready package object。新增错误字节、错误 size、错误 checksum 测试，并修正所有相关 fixtures 为真实一致值。
- 针对用户结果复核，扩展同一 `renderManualHandoffReadme(manifest)` 派生段，展示固定商品、完整批准文案、人物名称/来源/授权摘要、VideoPlan 输出说明，并按 manifest 中的数组有条件展示预期行为、已知限制、人工确认点；真实链 ZIP 测试锁定 README 内容、manifest 权威性及 README 敏感内容边界。

## 验证证据

- `node --test test/manual-handoff-package-service.test.js`：10 pass / 0 fail；覆盖错误字节、错误 size、错误 checksum 无 ready package。
- `node --test test/manual-handoff-package-api.test.js`：3 pass / 0 fail。
- `node --test test/manual-handoff-package-real-chain.test.js`：1 pass / 0 fail；真实 A04-A09 服务/API 链路创建 order，并检查 A10 ZIP manifest 权威性、README 派生一致性、真实固定输入内容和敏感内容边界。
- `node --test test/manual-handoff-package-postgres.integration.test.js`：1 skipped；未设置 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL`，未声称 PostgreSQL 通过。
- `node --test test/manual-handoff-package-browser.test.js`：1 pass / 0 fail；在受控本地环境用系统 Chrome 实跑 generation_failed、刷新恢复、重试、ready、下载、订单状态不变、A11 禁用入口和 390px overflow。
- `node --test test/production-order-browser.test.js`：1 pass / 0 fail；验证 A10 默认关闭不破坏 A09。
- `node --test` A04-A10 targeted：27 pass / 1 skipped / 0 fail；skip 为 PostgreSQL 集成。
- `npm run check`：通过，检查 159 个 JavaScript 文件。
- `npm test`：755 tests / 717 pass / 0 fail / 38 environment skips；PostgreSQL 和多数浏览器全量用例按环境条件 skip，A10/A09 浏览器已另行实际通过。
- `git diff --check`：通过。

## 未完成、风险与下一步

- 本地没有 PostgreSQL 测试连接，clean migration/repository integration 需由 CI 或带 `TEST_DATABASE_URL` 的受控环境补跑。
- 浏览器第一次在普通沙箱中因 Chromium macOS bootstrap 权限 skip；申请受控环境后 A10 与 A09 定向浏览器均实际通过。
- package hash 当前是由权威 manifest、派生 README 和 embedded 素材 checksum 组成的稳定内容指纹；ZIP 压缩实现使用成熟 `archiver`，未扩展无关依赖或字段。
- 主控下一步：独立代码/安全 Review，确认 migration/CI，再自行 commit、push、创建 PR；实现者不得批准或合并自己的 PR。A11+ 不在本 worktree 范围。

## 成本与外部服务

- 未访问 Hifly。
- 未发送真实 Provider、Playwright、Capture HTTP 生产请求。
- 未运行历史批次，未消耗飞影积分。
