# 2026-08-30 Issue #264 DeepSeek provider activation deployment mapping

## 会话范围与权限

- Issue：#264 DeepSeek provider activation deployment mapping
- Exact base/head at start：`0eb52fa` (`origin/main`)
- Branch：`codex/rbv-deepseek-provider-activation`
- 角色：`IMPLEMENTER`；运行时模型元数据：`UNVERIFIED_RUNTIME_MODEL`
- 本轮 exact allowlist（checkpoint 5467345331 后）：`.dockerignore`、`docker-compose.production.yml`、`test/production-deployment.test.js`、`docs/ENVIRONMENT.md`、`docs/status/CURRENT.md`、`docs/ROADMAP.md`、本文档。

本轮只把已有 DeepSeek 选择器接入 production Compose 的 `app` 环境映射。没有读取、访问或写入任何 Secret，
没有 Provider/DeepSeek 请求、Hifly/飞影访问、登录、浏览器、业务数据、生产部署、CI/GitHub 写入或积分动作；
积分消耗为 `0`。

## TDD RED → GREEN

1. 先在 `test/production-deployment.test.js` 增加公开 deployment-contract 断言：三个选择器必须默认
   `phase1_controlled_test_double`，`DEEPSEEK_API_KEY` 必须是无字面量/无 fallback 的 `${DEEPSEEK_API_KEY}` 透传。
2. Old head `0eb52fa` 运行 `node --test test/production-deployment.test.js`：`7 pass / 1 fail`（RED，首个缺失
   `COPY_GENERATION_PROVIDER` Compose mapping 断言失败）。
3. 仅在 `docker-compose.production.yml` 的 `app.environment` 增加三个受控默认选择器和
   `DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}` 透传映射。
4. 同一 deployment test：`8 pass / 0 fail`（GREEN）。
5. Checkpoint 5467345331 新增 `.dockerignore` 合同断言；当前候选运行 `node --test test/production-deployment.test.js`
   为 `7 pass / 1 fail`（RED，缺少 `.env` 规则）。
6. 仅在 `.dockerignore` 增加 `.env`、`.env.*` 与 `!.env.example`；deployment test 恢复为 `8 pass / 0 fail`（GREEN），
   完成该 P0 secret-context 排除闭环。

## 实际改动

- `docker-compose.production.yml`：为 production `app` 显式映射 `COPY_GENERATION_PROVIDER`、
  `COPY_QUALITY_EVALUATOR`、`COPY_QUALITY_REWRITER`，三个默认均为 `phase1_controlled_test_double`；
  `DEEPSEEK_API_KEY` 无字面量、无 Compose 默认值，仅透传外部环境。
- `test/production-deployment.test.js`：锁定上述四项公开部署合同和 Secret fallback 禁止条件。
- `.dockerignore`：排除 `.env` 与 `.env.*`，再显式保留 `.env.example`，避免本地 Secret 进入 Docker build context。
- `docs/ENVIRONMENT.md`、`docs/status/CURRENT.md`、`docs/ROADMAP.md`：记录 Issue #264 的仓库候选、
  受控默认、fail-closed 边界以及未部署/未通过 exact-head CI 的事实。

## 验证记录

| command | result |
|---|---|
| `node --test test/production-deployment.test.js`（old head） | RED：7 pass / 1 fail |
| `node --test test/production-deployment.test.js`（Compose mapping） | GREEN：8 pass / 0 fail |
| `node --test test/production-deployment.test.js`（checkpoint .dockerignore RED） | RED：7 pass / 1 fail；缺少 `.env` 规则 |
| `node --test test/production-deployment.test.js`（.dockerignore P0 closure） | GREEN：8 pass / 0 fail |
| `npm ci --ignore-scripts` | 依赖安装完成，250 packages；未执行 Provider 或应用启动 |
| `node --test test/production-start.test.js`（依赖安装后） | GREEN：15 pass / 0 fail |
| `node --test test/real-batch-validation-governance.test.js test/real-batch-calibration-readiness-governance.test.js`（owner/main） | GREEN：28 pass / 0 fail |
| `npm run check` | GREEN：Checked 249 JavaScript file(s). |
| `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`（owner/main） | GREEN：exit success at high threshold；0 critical、0 high、2 moderate（`uuid` via `exceljs`；强制修复会 breaking，超出本轮范围） |
| `POSTGRES_PASSWORD=compose-dummy-only-20260830 COPY_GENERATION_PROVIDER=deepseek COPY_QUALITY_EVALUATOR=deepseek_hybrid COPY_QUALITY_REWRITER=deepseek DEEPSEEK_API_KEY=dummy-placeholder-not-a-secret docker compose -f docker-compose.production.yml config --quiet` | GREEN：exit 0；仅 Compose 静态解析，未启动容器或访问 Provider |
| `git diff --check` | GREEN：无输出、exit 0 |
| exact 7-file allowlist / outside=0 | GREEN：changed=7、allowlist=7、outside=0 |

## 当前状态与下一步

Issue #264 的仓库实现候选已完成，production deployment 与 production-start focused tests 均通过；`.dockerignore` P0
secret-context 排除也已闭合。
exact-head CI 与部署仍 pending；真实 DeepSeek smoke/认证与费用核对按本 Stage 合同明确 deferred。Owner 已明确授权在独立 Review 与
exact-head CI 通过后进入 deployment/provider activation stage；默认配置不会自动选择 DeepSeek，服务端现有缺 key/不支持值
仍 fail closed。首个真实 Copy job 仍需另行授权。

## Activation maintenance gate（安全审查补充）

在触碰 git、env 或 image 前，必须先在现行 App 容器内以 `umask 077` 执行数据库备份；dump 必须为非零字节、mode `0600`，
并在容器内以 `pg_restore --list` 校验成功。将变更前完整 `.env` 原样复制到仓库与 build context 之外的
`/opt/hifly-runtime/rbv004-rollback/`，且副本必须为 root-owned、mode `0600`。进入已获授权的 deployment/provider activation stage 时，必须在 build 前捕获运行中 App image ID 并赋予不可变 rollback tag；随后在旧 App 仍运行期间构建新镜像；重建前只停止 `app`，不停止
Proxy 或 PostgreSQL。App 停止后，跨**全部组织**只读核对 `copy_generation_jobs`、`copy_quality_runs` 与
`copy_rewrite_jobs`，其中 `status IN ('queued', 'running')` 的记录数必须均为 `0`（不因 `attempts` 已达上限而豁免），
然后才可启动新 App。任一核对失败或出现非零时，恢复受控配置/旧 App 并停止，不启动新 Provider 路径。启动新 App 只能使用
`docker compose -f docker-compose.production.yml up -d --no-build --no-deps --force-recreate app`。

新 App healthy 后，因既有 Nginx 静态 `proxy_pass http://app:3000` 可能仍指向旧 Docker IP，必须先执行 `nginx -t`，
再在**现有** Proxy 容器内 reload/HUP，不重建 Proxy；随后要求公网 HTTPS `/healthz` 通过，并记录 Proxy container ID、
`StartedAt` 与 `RestartCount` 均未变化。公网 health 失败即回滚；禁止宽泛 `docker compose up proxy`。在 bounded health deadline 内，
必须比较 Cloud Executor container ID、image ID、`StartedAt`、`RestartCount`，确认 `CLOUD_EXECUTOR_ENABLED=false`、
`CLOUD_EXECUTOR_MODE=fail_closed`、standby heartbeat 恢复且 `claim_enabled=false`，并比较变更前后的
`copy_generation_jobs`、`copy_quality_runs`、`copy_rewrite_jobs` aggregate total 与 status counts（日志仅作补充，不能替代数据库聚合）。
任一 health/invariant 检查失败即自动执行 env+image rollback。

回滚必须恢复整份 `.env`，将捕获的 predeploy App image ID 重新 tag 为 Compose service image，然后仅对 `app` 执行
`docker compose -f docker-compose.production.yml up -d --no-build --no-deps --force-recreate app`；不得重建 Proxy、PostgreSQL 或 Executor。回滚后必须再次确认
App health、公网 HTTPS `/healthz`，以及 Executor container ID、`StartedAt`、`RestartCount` 均未变化。本会话未执行备份、复制或回滚。
正常回滚仅恢复整份 `.env` 与 App image，不自动恢复数据库 dump。若发现意外 queue/provider delta，应停 App、恢复受控 env/旧 image，
保留数据库、日志和审计证据；数据库恢复只能在 writers quiesced 后作为单独授权的最后手段，既不能撤销已产生的费用，也可能抹除事故证据。

安全审查交接的当前只读基线：generation `succeeded=9, active=0`；quality `succeeded=9, active=0`；rewrite
`active=0`。本会话未访问数据库或 Provider，不重新读取该基线。

## Independent safety review checkpoint

- 已关闭 P0：worker queue maintenance gate 现要求跨全部组织的三个 Copy 表不存在任何 `queued`/`running` 记录；
  `.dockerignore` secret context gate 已锁定 `.env`、`.env.*` 忽略并保留 `!.env.example`。
- 已关闭 P1：App 重建后对既有 Proxy 执行 `nginx -t` 与容器内 reload/HUP，不重建 Proxy，并以公网 HTTPS `/healthz`、
  container ID、`StartedAt`、`RestartCount` 不变作为验收条件。
- Armed residual risk 由 Owner 接受：activation 仍是人工维护窗口，未启用 automatic enqueue；首个真实 Copy job 仍另行未授权。
- 最终独立 code review 已对最新 7-file candidate 给出 `APPROVE`，P0/P1/P2 均为 0；exact-head CI 仍 pending。
