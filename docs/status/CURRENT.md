# 项目当前状态

> 最后更新：2026-08-13
> A14 功能基线：`ba687dedc593c5bb23b9321acfa8dc8d5b79cd0c`（PR #94；Goal 收尾见 PR #95）
> 当前 Goal：P0 Cloud Executor 纯云端生产闭环（D-034）；CE-01～CE-07 已完成并关闭，CE-08 已完成真实生成、云端保存与 A12，正在修复最后的鉴权下载缺口

## 2026-08-13 CE-08 单条纯云端真实生成成功，鉴权下载缺口已完成本地修复

- 云端飞影登录已通过 noVNC 完成，并通过新 login-only 容器证明持久 Profile 可跨容器复用；Mac Local Agent 全程关闭。
- Cloud GUI 新建唯一 reproduction 工单 `ff5285cd-d2b7-4552-a276-cff18015fc67`，交接包 `1f35ece9-9b98-4814-925e-f7f508506fa2` 为 ready。激活前工单 attempt 为 0、组织内只有该工单 eligible、active attempt 为 0。
- Cloud Executor 串行执行一次并成功：attempt `46d1f209-caf8-4998-8d5d-5e435b0b0f11` 与工单均为 `succeeded`；飞影余额从 `53566` 变为 `52916`，本次实际消耗 650 积分。成功后 Worker 已立即停止并恢复 disabled/fail-closed，没有第二次领取或重试。
- 云端候选视频为 `video/mp4`、43,425,097 bytes；A12 job `2e8adabc-c570-4ef6-b5bb-26733c4ad262` 为 `succeeded / passed`，Work `80958749-9f92-40e6-a30e-7c886b555ef6` 为 `available`。视频与 Evidence 均位于持久卷中。
- 最后一段鉴权下载首次实测为：授权创建 201，但 GET 返回 404。根因是 Web app 未挂载 Cloud Executor 独立输出卷，不是飞影、生成、A12 或权限失败。
- 分支 `codex/ce08-cloud-artifact-download` 已完成最小本地修复与回归：app 只读挂载成品卷，并仅在主对象存储缺失时读取该卷；写入/删除语义不变。待合并部署后，复用现有 Work 做无积分下载复验；复验前不得重新启动 Worker或再次访问飞影。

## 2026-08-13 CE-08 #143 Cloud Executor 成品只读回退修复（本地实现完成）

- 当前分支：`codex/ce08-cloud-artifact-download`；基线：`main@dc4ca9f`；角色 `IMPLEMENTER`；请求自定义 Agent `luna-worker`；配置模型 `gpt-5.6-luna`、推理 `max`；配置状态 `CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 根因已按 Issue #143 复现：Cloud Executor 将候选视频写入独立 `cloud_executor_outputs` 卷，而 Web app 的本地对象存储只读取 `/var/lib/hifly/objects`，因此 A12 注册后 Work 鉴权下载返回 404。
- 最小实现：Web app 保持 `/var/lib/hifly/objects` 为主对象存储；资产读取在主 store 缺失时只读回退到 `CLOUD_EXECUTOR_OUTPUTS_DIR`，写入与删除仍只落主 store。生产 Compose 让 app 以 `:ro` 挂载 `cloud_executor_outputs`，Cloud Executor 继续以可写方式挂载同一卷。
- 回归证据：旧实现下新增 Work 鉴权下载 seam 为 `404 != 200`；部署 seam 在实现前有 2 个断言失败；修复后两个 focused 文件合计 `23/23` 通过。`npm run check`、Compose 静态解析、全量 `npm test`（`1,017` tests / `1,003` pass / `14` skipped / `0` fail）与 `git diff --check` 已通过。
- 本轮未访问飞影或真实 HTTP，未启动 Cloud Executor worker，未 claim/修改 attempt，未生成视频，未消耗积分；真实部署卷挂载与 CE-08 live Work 下载仍待主控在授权环境中复核。
- Session：`docs/status/sessions/2026-08-13-ce-08-cloud-artifact-download.md`。

## 2026-08-13 CE-07 阿里云 standby 实证通过

- 本节记录的是当时的 CE-07 验收快照；后续最新状态见上方 CE-08 章节。
- Cloud Executor 保持 disabled/fail-closed standby，health 为 `readiness=disabled`、`claim_enabled=false`；内部 heartbeat 为 online。
- 修复后的 Cloud Executor 经容器重启仍健康，Profile marker inode/mtime/内容保持；attempt 总数重启前后均为 9。
- 3001 未发布，noVNC 只监听 `127.0.0.1:6080`。待机时宿主机约 2.5 GiB 可用内存、32 GiB 可用磁盘，无 swap；真实 Chromium 容量仍须由 CE-08 单条验证证明。
- Owner 已授权 CE-08 恰好 1 条真实云端出片及相应积分风险；只允许零 attempt 合格工单，首失败即停，不自动重试，不执行第二条。
- 当前唯一 P0 差距：云端飞影 Profile 登录、Cloud Executor `playwright` 激活、唯一新零-attempt 工单门禁，以及真实 Hifly → 云端视频 → A12 → Work → 鉴权下载证明。Local Agent 必须关闭且不参与本次验收。

## 2026-08-13 CE-07 / Issue #142 Cloud Executor 重启恢复修复（READY PR）

- 基于已合并的 `main@e95a1ff`，分支 `codex/ce-07-xvfb-restart-recovery`；角色 `IMPLEMENTER`，请求自定义 Agent `luna-worker`，配置 `gpt-5.6-luna` / `max`，配置状态 `CONFIG_VERIFIED`，运行时模型元数据不可见（`UNVERIFIED_RUNTIME_MODEL`）。
- 根因：容器重启后本容器 `/tmp/.X99-lock` 与 `/tmp/.X11-unix/X99` 残留，入口直接启动 Xvfb，进入 `Server is already active for display 99` / `CLOUD_EXECUTOR_XVFB_UNAVAILABLE` restart loop。
- 修复：入口在 Xvfb 前探测活动 display；活动 X server 或 lock PID 仍存活时 fail-closed 并保留文件；确认 stale 后只清理当前 DISPLAY 对应的 lock/socket，再保持 Xvfb → x11vnc → websockify → login/worker 顺序。
- Important Review follow-up：真实 Xvfb lock 第一行 PID 可能带 POSIX 空白；入口现先去除该空白，再做纯数字与 `kill -0` 检查。即使 `xdpyinfo` 暂时失败，padded live PID 也会保留 lock/socket 并返回 `CLOUD_EXECUTOR_XVFB_ALREADY_RUNNING`；padded stale PID 仍可清理。
- 回归覆盖 stale 清理、启动顺序、活动 display 不误删，以及默认 worker/login 两条 dispatch 路径。验证：focused `15/15`、`sh -n`、`npm run check`（229 JS）、`NODE_OPTIONS=--test-reporter=dot npm test` exit 0、`git diff --check`。
- 本轮未 SSH、未访问 Hifly/Provider、未启动真实 provider、未 claim、未消耗积分；阿里云实机重启/live proof仍待独立部署授权与 Review，不在本 PR 声称已验证。
- 实现提交：`f47fca4`；READY PR [#151](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/151) 已推送到 `main`，OPEN、非 draft；PR 只引用 #142，不自动关闭 Issue。CI 在交接时仍 pending。
- Session：`docs/status/sessions/2026-08-13-ce-07-xvfb-restart-recovery.md`。

## 2026-08-12 CE-07 / Issue #142 阿里云 standalone Cloud Executor Worker（READY PR，待 Review）

- 当前分支：`codex/ce-07-aliyun-standby-deployment`；基线：`main@9dd35ab`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 已新增生产 Worker 专用入口 `scripts/cloud-executor-worker.js`、standalone health server 与 `src/cloud-executor/production.js`：只在显式 active 配置下组装 PostgreSQL identity/assets/production-orders/manual-handoff/manual-execution/work-verification repositories；初始化只做 schema-current check，不执行 migration。Web `production-start` 未接入 Worker。
- 已新增 A12 wiring：共享 production order/member port、manual handoff package port、candidate/output object store 与 verified output asset port；A12 verification worker 与 Cloud Worker 都由 standalone 进程拥有，concurrency 固定为 1。
- 已新增 allowlist heartbeat client/Worker progress 上报：Bearer 只来自 env header，HTTP body/health JSON/error callback 不包含 token、raw exception、Profile/path、storage key 或媒体；默认 disabled/fail_closed 为长期 healthy standby，不读取 Hifly config、不创建 browser、不访问 Provider、不列单、不 claim。
- 已新增 production Compose/image/entrypoint：Chrome/Playwright、Xvfb、loopback-only noVNC、Profile/assets/outputs/evidence/batches/locks/handoff volume、1-instance/resource/healthcheck 合同；新增阿里云 CE-07 runbook，包含显式 migration、重启 marker、内存/磁盘观察、SSH tunnel 和 rollback。
- 本轮无 Sol 决策 blocker；实机部署与 live proof 明确留给 Sol 在 PR 合并后执行，当前不做 SSH、不访问飞影/Provider、不调用真实 heartbeat 外部服务、不 claim、不消耗积分。
- 当前验证已通过：独立 Review follow-up focused tests `44/44`；`npm run check` 检查 229 个 JavaScript 文件；`npm test` 为 1,012 tests / 998 pass / 14 existing environment skips / 0 fail；entrypoint shell syntax 与 `git diff --check` 通过；`docker compose -f docker-compose.production.yml config` 静态解析通过。
- 实现提交：`0c0209d`；READY PR [#150](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/150)（Closes #142；OPEN、非 draft、未合并、未批准）。实现者不批准或合并自己的 PR。
- 独立 Review follow-up 已补齐 4 个部署阻断合同：Worker 同时接入 internal 与非 internal egress network，只有 loopback noVNC 对宿主机发布且 health 不发布；disabled/fail_closed 启动会准备持久 workspace/非敏感 marker，失败受控为 `storage_blocked/requires_action`；显式、默认关闭的 heartbeat-only pairing 可向 `app:3000` 上报 disabled/unconfigured 状态且控制面禁止伪报 available；production entrypoint 可显式 dispatch CE-04 login command，默认仍启动 Worker。
- 专用接力记录：`docs/status/sessions/2026-08-12-ce-07-aliyun-standby-deployment.md`。

## 2026-08-12 CE-06 / Issue #141 Cloud Executor 控制面投影与生产 UX（READY PR，待 Review）

- 当前分支：`codex/ce-06-cloud-control-plane-ux`；基线：`main@1d6bc65`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 实现提交：`141dcc8`；READY PR [#149](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/149)（Closes #141；OPEN、非 draft；未合并、未批准）。
- 新增最小 Cloud Executor 控制面投影：Worker `offline/online`、受控 readiness、当前订单/attempt、归一化 progress、受控 terminal failure，以及 execution succeeded、A12 pending/passed、Work delivery 的独立状态。公共对象仅返回 allowlist 字段，不返回 raw exception、Profile/服务器路径、storage key、VNC、secret 或 token。
- 新增默认 disabled/fail-closed 的 `/api/cloud-executor/status` 与可选 Bearer 鉴权的 `/internal/cloud-executor/v1/heartbeat`；heartbeat presence 为短期内存状态，执行事实继续读取现有 attempt/report/A12/Work/Delivery 合同，不在 HTTP 请求内运行浏览器任务。未改变 Local Agent 默认与进程归属。
- Sol 独立审查 follow-up 已修复两个合并阻塞项：生产 Web 现在从既有 `CLOUD_EXECUTOR_ENABLED/MODE/ID/ORGANIZATION_ID` 加载纯控制面配置，并新增 `CLOUD_EXECUTOR_HEARTBEAT_TOKEN`、`CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS`；启用时缺少 org/executor/token 会在建 pool 前失败关闭。`production-start` 只向 `buildApp` 传控制面对象，不解析 Worker poll、不开 Chrome、不 claim/start。架构保护测试保留并精确断言 decorator/状态 route 可存在但没有 worker/service/runOnce，`worker.autoStart` 不触发 poll。
- 身份与租户边界已补充 API 证据：未登录 `/api/cloud-executor/status` 返回 `401 AUTH_REQUIRED`；登录到非目标 Organization 时返回 disabled 空投影，且在 organization scope 不匹配时不读取 Cloud attempt/report repository；`/api/runtime` 仅返回 enabled/configured/mode，不返回 heartbeat bearer token。
- 生产页已将 Cloud Executor status section 置于工单区之前，包含离线、重新登录飞影、低磁盘、待命、忙碌/进度、requires_action、失败与作品交付指导；历史人工/交接包面板保留为次级入口。核验作品只链接既有鉴权 Work/Delivery 页面，不新增未鉴权 artifact route。
- 第二轮独立审查 follow-up 已增加有界 Cloud status polling：生产默认 5 秒；读取失败显示离线安全态，并按 10 秒低频恢复；使用自调度 timeout 与共享 in-flight request，避免并发重入和 timer 叠加；`pagehide` / `beforeunload` 均停止 polling。轮询只更新 Cloud 区域，不重载 production workspace。
- 验证：原 focused `167/167`；第二轮最终指定 focused `node --test test/production-start.test.js test/cloud-executor-control-plane.test.js test/production-order-browser.test.js` 为 22/22；`npm run check` 通过（225 个 JavaScript 文件）；`NODE_OPTIONS=--test-reporter=dot npm test` 0 退出；`git diff --check` 通过。浏览器测试不调用 reload，自动覆盖 busy→后续 progress→status read failure/offline→恢复→requires_action/failure→A12 passed/delivered Work link，保持 1440/390 无横向溢出；慢响应下最大并发 status request 为 1，离页后不再发请求。
- 依赖审计：官方 npm registry `npm audit --omit=dev --audit-level=high` 报告 7 个既有漏洞（5 high/2 moderate），未在 CE-06 范围内升级依赖；当前镜像 registry 的 audit endpoint 返回 `NOT_IMPLEMENTED`。
- 外部边界：0 次 Hifly/真实浏览器 Provider 页面/DeepSeek/外部 HTTP，0 次真实 claim、部署或积分消耗；只使用 in-memory/fake/local browser fixture。CE-07 仍需目标云环境对独立 Worker、heartbeat/readiness、disabled/fail-closed standby、持久 volume、重启恢复和资源/磁盘做 live proof；CE-08 仍需另行授权真实纯云端出片。

## 2026-08-12 CE-05 / Issue #140 Cloud 持久素材、视频与磁盘门限（本地 READY，待独立 Review）

- 当前分支：`codex/ce-05-cloud-persistent-media`；基线：`main@b78fe08`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 实现提交：`3eca3db`；Sol Review 修复提交：`ec12499`；READY PR：[#148](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/148)（Closes #140；未合并、未批准）。
- 已新增可复用 Cloud workspace/storage seam：启动/ready 前创建固定 `profile`、`assets`、`outputs`、`evidence` 目录；Profile 生命周期仍归 CE-04。未注入 candidate store 时，standalone runtime 复用现有 local object store，并将 Cloud 输出持久化到 `outputs`；注入 manual-execution candidate store 的现有组合保持不变。
- 已新增 `CLOUD_EXECUTOR_MIN_FREE_BYTES`（默认 1 GiB）与 `statfs`/注入等价物检查。Sol Review follow-up 已将门限从单一 root 扩展到所有实际写入位置：root、assets、outputs、evidence、batches、locks；任一路径检查失败或低于门限都在订单 list/claim/attempt 创建前返回受控 `storage_blocked`。Profile 容量仍归 CE-04 login readiness；公开状态不暴露路径或磁盘容量细节。
- 已新增 `deploy/cloud-executor-storage.yml` 与 `docs/deployment/CLOUD_EXECUTOR_STORAGE_CONTRACT.md`，显式挂载 assets/outputs/evidence named volumes；未新增 Cloud Executor 文件 route，视频继续复用 A12 verified output AssetVersion 与现有鉴权 Work preview/download 合同。
- 已新增第二 runtime/service/store 共享临时持久根的重启测试：商品/人物素材、Evidence、candidate 元数据与视频字节保留；通过现有 verified output registration 和鉴权 Work 下载路径返回原始视频字节。公开 Cloud result 不含绝对路径、raw storage key、signed URL、cookie 或 token。
- Sol Review follow-up 最终验证：CE-02/03/04 + CE-05 focused `38/38`；`npm run check` 检查 223 个 JavaScript 文件；`npm test` `993` tests / `979` pass / `14` existing environment skips / `0` fail；`git diff --check` 通过；CE-05 Compose fragment `docker compose -f deploy/cloud-executor-storage.yml config` 通过。
- PR #148 follow-up head `e4936c8` 的 CI 已通过：Ubuntu Node 22、Windows Node 22、identity-postgres 全部 success。
- 外部边界：0 次 Hifly/真实浏览器/Provider/DeepSeek/HTTP，0 次真实 ProductionOrder claim，0 次部署，飞影积分消耗 0。CE-07 仍需目标云环境的真实 volume/bind、disabled/fail-closed standby、磁盘/readiness 与重启恢复证明；CE-08 仍需另行授权真实纯云端出片。

## 2026-08-12 CE-04 / Issue #139 Cloud Profile 与受控登录（READY PR 待 Review）

- 当前分支：`codex/ce-04-cloud-login-readiness`；基线：`main@678aa48`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 已新增 Cloud Executor 独立 login mode/command：默认仍为 `disabled` / `fail_closed`；启用 login mode 只构造 login runtime，返回值没有 `service`、`worker`、`runOnce` 或 claim seam。登录命令只允许 `login`，仅复用现有 Cloud Playwright adapter、`HiflyHandsOnProductPage.openWorkbench()` 与 executor `preflight()`，不上传、不生成、不消耗积分。
- 已新增持久 Profile/workspace contract：默认 `/var/lib/hifly/cloud-executor/profile`，Profile 目录创建固定非敏感 marker；fake adapter 重启后 marker 与 readiness 保持。Cookie、LocalStorage、Token、Profile 内容不写入 Git、数据库、公共 API、日志或快照；仓库内同名 cloud Profile/marker 已忽略。
- 已新增 login-only 的 Xvfb/noVNC 配置与 CE-07 contract fragment：默认 `DISPLAY=:99`、noVNC `127.0.0.1:6080`、`private`/`public=false`；只接受 loopback/RFC1918 bind，fragment 无 public `ports:` 映射，实际镜像/部署仍归 CE-07。
- readiness 在 claim 前调用既有 Playwright preflight；`LOGIN_REQUIRED` 以及 fake 的 missing/expired session 都只返回受控 `requires_login`，不列订单、不 transition、不 claim；公开 readiness 与命令日志不携带原始 preflight/error 细节。
- 已验证：CE-04 + CE-02/03 focused 30/30；`npm run check` 检查 223 个 JavaScript 文件；最终全量 `npm test` 985 total / 971 pass / 14 existing environment skip / 0 fail；`git diff --check` 通过。官方 registry 的 `npm audit --omit=dev --audit-level=high` 报告 7 个既有依赖漏洞（5 high/2 moderate），未在本任务扩大范围修复；镜像 registry 的 audit endpoint 不支持。
- 外部边界：0 次 Hifly 访问、0 次真实浏览器页面访问、0 次上传/生成/下载、0 次 DeepSeek、0 次积分、0 次 real claim、0 次部署；全部 CE-04 测试使用 fake page/executor/filesystem marker。
- Implementation commit：`62854cb`；READY PR [#147](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/147) 已创建，`OPEN`、非 draft、目标 `main`，body 关联 `Closes #139`。CI 初次运行的 Ubuntu Node 22、Windows Node 22、identity-postgres 全部通过；不合并、不审批、不部署、不执行真实登录或 Provider 动作。
- Sol Review follow-up 已修复两项部署合同正确性：compose 使用固定宿主机 loopback `127.0.0.1:6080:6080`，可由 SSH tunnel 实际到达且没有公网 listener；容器内 websockify 使用固定、不可由产品配置覆盖的 `0.0.0.0:6080` 接收 Docker 转发，x11vnc 仍只监听容器 loopback。产品配置继续为 `private` / `public=false` 并拒绝 wildcard/public bind。
- 新增 CE-04 专用 login Dockerfile/entrypoint contract，安装 Playwright Chromium、Xvfb、x11vnc、noVNC/websockify 与显示检查工具，按 Xvfb → VNC → noVNC → login command 顺序启动；最终 live image/orchestration 仍归 CE-07。本 follow-up 只做 static/fake 验证，没有 build/download image、启动容器、部署或访问 Hifly。
- Follow-up 验证：Cloud focused 31/31；`npm run check` 检查 223 个 JavaScript 文件；`npm test` 986 total / 972 pass / 14 existing environment skip / 0 fail；`docker compose ... config`、`sh -n`、`git diff --check` 通过。依赖审计仍为前述 7 个既有项，未改依赖。
- 当前卡点/下一步：等待独立 Review；若 Review 无新要求，不再扩大 CE-04 范围。

## 2026-08-12 CE-03 / Issue #138 Cloud Playwright adapter（Sol Review follow-up 已实现）

- 当前分支：`codex/ce-03-cloud-playwright-adapter`；基线：`origin/main@d912d93`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 新增独立 `src/cloud-executor/playwright-adapter.js`：Cloud Executor 自己拥有 persistent Playwright context/page 的 composition 与 close 生命周期，显式接收 workspace/profile/assets/outputs/evidence 路径；通过现有 `HiflyHandsOnProductPage`、`createHiflyExecutor` 与 `runBatch` 组成执行链，没有复制 selector 或页面流程。运行时 `mode=playwright` 只在 standalone Cloud Executor runtime 中构造它；Web/Fastify 没有新增浏览器生命周期或 worker wiring。
- 受控进度阶段固定为 `pre_submit`、`submitted`、`wait_download`、`unknown_post_submit`，由既有 Hifly checkpoint 映射；提交后无唯一稳定证据、提交超时或结果含糊时统一返回 `requires_action`，停止 adapter/worker，禁止 Provider submit 重试。CE-02 service 现在持久化该结论为 `requires_action` / `not_retryable`，不领取下一条订单。
- Cloud config 新增显式 workspace/profile 派生配置，默认仍为 `disabled` / `fail_closed`；未修改或新增 migration，未改 Local Agent 与 Web/API 进程归属。
- Sol Review follow-up 已修复 Windows 路径可移植性和真实 handoff contract：Playwright 模式通过最小 Cloud package port 下载已领取 ready archive，adapter 在 attempt workspace 内复用 `extractHandoffPackage` / `loadAvatarMappings` / `compilePackageToBatchItem` 编译真实 `product_revision`、`copy_snapshot`、`avatar_snapshot`、`video_plan_snapshot`、`asset_references`，不再依赖伪造 `package.task`。人物映射通过 `CLOUD_EXECUTOR_AVATAR_MAPPING_FILE` 或测试注入显式配置。
- 新增由现有 ManualHandoffPackage service/worker 生成真实 zip 的 integration-shaped fake，证明 archive 可编译并进入现有 Hifly executor/page core。Cloud service 只向 adapter 转发 `{body, contentType}`，Buffer 之外失败关闭；archive、manifest/素材正文、secret、URL 和 port 额外字段不进入公开投影或日志。
- 已验证：CE-03 adapter + CE-02 focused tests 20/20；真实包/编译相关 focused tests 36/36；Local Agent/core focused tests 127/127；`npm run check` 检查 220 个 JavaScript 文件；`npm test` 975 total / 961 pass / 14 existing environment skip / 0 fail（另以 dot reporter 完整重跑 exit 0）；`git diff --check` 通过。
- 外部边界：0 次 Cloud Executor/真实 Hifly 浏览器启动、0 次 Hifly 访问、0 次外部真实 HTTP/DeepSeek、0 次 ProductionOrder real claim、0 次部署、0 次积分消耗；无真实批次、错误或下载产物路径。本轮新增路径仅使用 fake Playwright/page、fake executor 和本地 fixtures；全量回归中的既有本地 GUI/browser fixture tests 不属于 Cloud Executor 外部动作。
- Implementation commits：`490b4b9`（初始实现）、`4d5b34a`（Sol Review follow-up）；READY PR [#146](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/146) 已创建并关联 `Closes #138`，当前 `OPEN`、非 draft。follow-up code commit 的 Ubuntu Node 22、Windows Node 22、identity-postgres CI 全部通过，Windows portability 回归已有 CI 证明。GitHub connector 创建权限返回 403，使用已认证 `gh` CLI。
- 当前卡点/下一步：等待独立 Review；不合并或审批自己的 PR，不做 CE-04+、部署或真实飞影动作。

## 2026-08-12 P0 Cloud Executor 正式架构纠偏启动

- Owner 明确把 P0 从“云端控制台 + 个人电脑 Local Agent”纠偏为“云端控制台 + 独立 Cloud Executor Worker”。Local Agent 代码和历史 Evidence 保留，但不再是 P0 主实现、主提示或验收路径。
- 新 P0 要求任意浏览器可操作，云端 Chrome/Playwright 复用现有飞影执行核心，Profile/商品图/人物图/视频/Evidence 位于持久磁盘；并发固定 1，登录/磁盘未就绪时 claim 前失败关闭，首失败即停且不自动重试。
- 已建立 D-034、`docs/product/CLOUD_EXECUTOR_P0.md`、对应 Spec/Plan、新 `GOAL.md` 和 Issues #136～#143。实施顺序为 CE-01→CE-08；CE-02～CE-07 全部无真实生成，只有 CE-08 在另行授权后执行一条新零 attempt 工单。
- 阿里云只读复核：服务器代码 `d6e1f50`、工作树干净；app/postgres/proxy 均 healthy；app 正在使用新镜像，且不同于回滚镜像；内外 HTTPS health 均 `ok`；13 个 migration ledger 表存在；运行时 `PRODUCTION_EXECUTOR=fail_closed`。旧 `LOCAL_AGENT_ENABLED=true` 尚未擅自修改，后续由 Cloud Executor 实施/部署任务显式收敛。
- 本轮没有 claim、没有打开 Hifly、没有运行生成、没有 DeepSeek 调用，飞影积分消耗 0。CE-01 阶段不能宣称 Cloud Executor 已实现或纯云端可用；CE-02 的本地实现不等于 runtime/deployment proof。

## 2026-08-12 CE-02 / Issue #137 Cloud Executor runtime（PR #145 Review 纠正）

- 当前分支：`codex/ce-02-cloud-executor-runtime`；权威基线：`origin/main@deec74ec67261a931994ca9e072432c978ea5d0b`；逻辑角色：`IMPLEMENTER`；请求自定义 Agent：`luna-worker`；配置：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- CE-02 已在本地实现但尚未宣称部署或运行时证明：新增 additive migration `004_cloud_executor_identity.sql` 与 memory/PostgreSQL repository cloud identity seams；`manual`、`local_agent`、`cloud_executor` 三者保持互斥身份，候选/报告也保持 exact-one uploader/submitter。新增 `src/cloud-executor/` fake-only service、serial Worker、readiness 和 fake executor，默认 `disabled`/`fail_closed`。
- Worker loop 为单进程 concurrency=1：readiness 先于 claim；每次最多领取一条 handoff-ready order；执行 start、lease/heartbeat（以 `progress_phase` 作为 bounded checkpoint）、fake candidate/report、A12 exactly-once trigger；fake failure 立即停机且不领取下一条；lease expiry 进入 `requires_action`，不自动创建或重试 attempt。Cloud Executor 使用独立 `cloud_executor` service seams，不使用 Local Agent bearer route、浏览器/Hifly/Playwright/DeepSeek 或真实 HTTP。
- Sol Review 指出的进程归属阻断项已纠正：Fastify `buildApp` 不再接收、构造、decorate 或启动 Cloud Executor；`startProductionServer` 不再传入 Cloud Executor 配置；Web production config 完全忽略 `CLOUD_EXECUTOR_*`，即使这些变量无效也不影响 Web 启动。`/api/runtime` 仅保留固定 disabled/fail_closed 的只读 seam。
- 新增独立 `src/cloud-executor/config.js`、`runtime.js` 与 `start.js`。只有显式调用 standalone runtime entrypoint 并传入独立配置/ports 时，才会构造并拥有 Cloud Executor service + worker；构造本身不启动，disabled/fail_closed/unconfigured 不构造 worker。Compose/.env 中原先误接到 app service 的 Cloud Executor 配置已移除，独立 Docker service 部署仍归 CE-07。
- Review 纠正验证：focused `cloud-executor + production-start + manual-execution PostgreSQL` 为 29 total / 28 pass / 1 environment skip / 0 fail；`npm run check` 检查 219 个 JavaScript 文件；`npm test` 为 968 total / 954 pass / 14 existing environment skip / 0 fail；`git diff --check` 通过。
- 本轮外部动作与费用：0 次 Hifly、0 次 DeepSeek、0 次真实 HTTP、0 次 ProductionOrder real claim、0 次部署、飞影积分消耗 0。READY PR [#145](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/145) 由本次纠正提交更新；未回复/resolve Review thread、未审批、未合并、未部署；运行时/部署证明仍待后续范围完成，CE-03 未开始。

## 2026-08-12 P3 阿里云部署与 standby 检查完成（无飞影生成）

- 阿里云 `/opt/hifly-pilot` 已从 `cf13679` 升级到 `main@d6e1f50`。升级前数据库备份为 `hifly-20260812T073732Z.dump`（444 KB、非空），旧应用镜像保留为 `hifly-pilot-app:rollback-cf13679`。
- 服务器访问 GitHub 443 一度超时；未重复撞公网，而是从本机生成仅含九个提交的 Git bundle，经 SSH 传输并在远端 `--ff-only` 更新。服务器 Git 工作树最终干净。
- 新镜像构建成功；13 组 production migration 全部成功。app、postgres、proxy 均 healthy，内外网 HTTPS `/healthz` 均返回 `{"status":"ok"}`，新应用日志显示监听 `0.0.0.0:3000`，未出现启动/schema 错误。
- Mac Local Agent 使用既有私有配置执行默认 `run-once`，只上报 heartbeat（HTTP 200）并返回 `standby`；没有领取工单、没有开启 fake/real executor、没有访问飞影或 DeepSeek，积分消耗 0。
- P3 下一步是通过已部署 GUI/API 登记第 2 个人物候选并建立本地映射，然后准备三条批准链。真实生成仍使用既有 standing authorization 和逐条运行门禁。

## 2026-08-12 P3 / Issue #132 小批量真实验收准备（无副作用）

- 验收目标固定为 3 个不同商品、至少 2 个不同人物，按一商品一 ProductionOrder 串行执行；每条继续要求唯一可领取工单、零 attempt、交接包 ready、人物映射存在、飞影登录预检 ready。任何首个失败立即停止，禁止自动重试。
- 本机已有 3 个可用商品图：iPad、吉伊卡哇玩偶、熊玩偶；本机私有目录已有 1 个已映射人物，并已在仓库外准备第 2 张合成男性人物候选。第 2 个人物仍需在部署后完成企业人物登记和本地映射，不能把本地图片存在视为云端可选。
- P2-02/P2-03 已随 `main@d6e1f50` 部署到阿里云试运行环境，migration、三容器健康和无副作用 standby 均已通过；尚未执行真实飞影目录同步或生产生成。
- 下一门禁：完成第 2 个人物登记/映射后，逐条准备 3 个批准工单并使用 standing authorization；部署与 standby 阶段未访问飞影、未领取工单、积分消耗 0。
- 详细合同见 Issue #132 与 `docs/status/sessions/2026-08-12-p3-small-batch-readiness.md`。P4 不在本轮提前开始。

## 2026-08-12 P2-03 / Issue #130 人物品类推荐（实现与独立审查完成）

- 当前分支：`codex/p2-03-avatar-category-recommendations`；基准：`main@4776189abc9412307a9d6bbb43735b0afdf01c15`；逻辑角色：`IMPLEMENTER`；运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- Avatar workspace 通过注入的 `app.projectContent.productRevisionPort` 读取当前 approved CopyVersion 绑定 ProductRevision 的 authoritative `primary_category`；仅对现有 catalog gate `can_confirm=true` 的人物计算推荐，不复制产品状态，不自动创建或改变 AvatarSelection。
- 推荐规则确定性实现：主品类与 `category_tags` trim/lowercase 后精确匹配；有精确匹配时只推荐匹配人物并稳定优先排序；无精确匹配时回退到空标签可确认通用池；其余可浏览但不推荐，不可确认永不推荐；无可用推荐时返回稳定 reason code 和中文说明。
- workspace/API 的 provider-neutral recommendation projection 含 `recommended`、`reason_code`、中文 `reason`、`matched_tags`；未新增数据库列，未返回 provider ID、object key、上传 token 或本地路径。目录、详情、移动抽屉均显示推荐 badge/理由，现有来源/状态筛选、确认/更换 Dialog 保持不变。
- 验证：focused service/API/browser 27/27（两条 browser 用例，含管理员登记回归与 390px 无横向滚动）；完整受控并发回归 954 total / 940 pass / 14 既有 environment skip / 0 fail；`npm run check` 检查 213 个 JavaScript 文件；`git diff --check` 通过。Sol 独立审查只修正测试夹具缺失的 authoritative revision port，未改推荐业务逻辑。
- 本轮未访问 Hifly/DeepSeek/Playwright/Capture/Local Agent 生产路径，未访问外部服务，未消耗飞影积分。尚未部署生产，也未做真实人物/商品生产验证；详细过程见 `docs/status/sessions/2026-08-12-p2-03-avatar-category-recommendations.md`。

## 2026-08-12 P2-02 / Issue #128 企业人物素材登记（实现与独立审查完成）

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`；配置文件：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理强度：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- 已完成最小合同：资产上传 kind 显式支持 `avatar_image`，默认仍为 `product_image`，沿用现有 checksum/verification；管理员可登记同组织已核验可用人物版本，保存授权、说明、可选 Evidence 和归一化 `category_tags`，裸上传不自动声明能力。
- `materials_accessible` 由关联 available asset version 派生，重复 material version 登记幂等并保持组织隔离；非 controlled enterprise 人物可由管理员禁用，历史选择保留且禁用后不可新确认。公共 Hifly 记录标签为空，controlled seed/public sync 不可被该管理动作改写。
- 新增后置 work-verification migration `003_preserve_avatar_image_kind.sql`，不改已应用 001/002，最终保留 `product_image`、`avatar_image`、`work_video`；先行 assets migration 同样保留已有 `work_video`，避免升级顺序暂时收窄约束；memory/Postgres/API 安全投影均不返回 object key、上传 token 字段、provider ID 或 Mac 路径。
- GUI 已支持管理员上传/登记/检查授权、能力标签、素材状态、分类标签和禁用；成员管理区只读。内部 Evidence reference 不在界面显示，公共同步人物与受控预置人物来源标签明确区分。Local Agent 私有映射支持 `npm run local-agent:avatar-map -- set|list|remove`，保持 `avatar_asset_version_paths` 与 package compiler 兼容，不产生云端路径上传。
- 验证覆盖 memory service、API、资产 kind/安全投影、migration order、Local Agent mapping/compiler、GUI admin/non-admin browser acceptance；focused suite 69/69，PostgreSQL 16 隔离 schema 的 avatar migration/integration 1/1，完整受控并发回归 949 total / 935 pass / 14 既有 environment skip / 0 fail；`npm run check` 检查 213 个 JavaScript 文件，`git diff --check` 通过。
- Sol 独立审查已收紧企业人物数据库状态为仅允许 `active -> disabled` 且 revision 精确加一；禁用后数据库直接恢复会被拒绝。未访问真实 Hifly/DeepSeek，未运行真实 Local Agent，积分消耗 0。
- 当前边界：尚未部署到 PostgreSQL production，未做 P2-03 品类推荐、自动确认或真实人物 Provider 能力核验。

## 2026-08-12 P2-01 / Issue #126 Hifly 公共人物目录显式同步（本地实现待 Review）

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`；配置文件：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理强度：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- 已完成最小合同：Hifly API client 新增文档分页 `GET /api/v2/hifly/avatar/list?page=&size=&kind=2`；新增 fake-only provider-neutral 多页 adapter；memory/PostgreSQL AvatarAsset 同步 upsert 复用 `seed_key=hifly-public:<avatar>`，重复同步幂等、标题变化更新同一内部 asset，并保持组织隔离。
- 同步条目固定为 `source_type=public`、`controlled_seed=false`、无预览/本地人物素材/手里有货证据，故 `materials_accessible=false`、`capability_status=unverified`、无 verified capability、不可确认；provider key 仅留服务端 `seed_key`，不进入 workspace/UI 投影。
- 新增 admin-only `POST /api/avatar-catalog/hifly-public/sync`；读取 workspace 不触发 provider；无 Hifly provider client 稳定返回 `HIFLY_PUBLIC_AVATAR_SYNC_UNAVAILABLE`；生产仅在 `HIFLY_API_TOKEN` 存在时接入 client/adapter，启动不发请求。为支持受控公共目录标题更新，新增最小 avatar migration 002，保留其他 asset/版本/能力/选择记录 append-only。
- 当前验证：定向 40/40 通过；PostgreSQL integration 使用本地隔离 schema 1/1 通过；A11、A14 浏览器验收分别单独通过；完整回归以受控并发运行，937 total / 923 pass / 14 既有 environment skip / 0 fail；`npm run check` 检查 212 个 JavaScript 文件通过；`git diff --check` 通过。默认全并发曾因本机同时存在大量浏览器进程而长时间停在 A11，终止该次运行后用 `--test-concurrency=4` 完整通过，未把资源争用误记为代码失败。
- 真实外部调用：0 次 Hifly；未运行 Playwright/Capture/Local Agent；飞影积分消耗 0。实现尚未 commit/push、建 PR、合并或关闭 Issue #126；下一步由主控独立 Review，并在带 PostgreSQL 的 CI/环境验证 migration 002 与 PG upsert。

## 2026-08-12 P1-03 / Issue #122 DeepSeek 质检改写（待提交）

- 基准：`main@a72f2fd`；独立分支：`codex/p1-03-deepseek-rewrite`。
- 已完成：DeepSeek 改写 adapter、受控输入投影、结构输出校验与一次结构重试；现有异步 rewrite worker 保留父文案，只创建一个子草稿并对新草稿重新执行完整 QC。
- 生产配置可显式选择 `COPY_QUALITY_REWRITER=deepseek`；默认仍为 `phase1_controlled_test_double`。文案生成、质检和改写可独立选择，共用服务端 DeepSeek Key；缺 Key 在建 pool 前失败关闭，启动零外呼。
- Provider 只接收冻结文案、当前商品修订中的已确认文字事实、规范化 ContentBrief、改写范围/指令与被选 Finding 的最小字段，不发送素材 URL/路径、组织/成员标识、Provider evidence 或浏览器凭据。
- 已验证：改写器、服务和生产启动定向测试 50/50；`npm run check` 检查 211 个 JavaScript 文件；全量 `npm test` 927 项、913 pass / 14 environment skip / 0 fail；`git diff --check` 通过。
- 真实外部调用：0 次 DeepSeek，0 次 Hifly，0 费用/积分。详细记录见 `docs/status/sessions/2026-08-12-p1-03-deepseek-rewrite.md`。
- 下一步：全量回归、PR、CI 与独立审查通过后按 standing merge authorization 合并并关闭 Issue #122；随后进入 P2 人物目录与品类选择。

## 2026-08-12 P1-02 / Issue #120 确定性规则与 DeepSeek 语义质检（已合并）

- 基准：`main@33fe790`；独立分支：`codex/p1-02-deepseek-quality`。
- 已完成：确定性已确认事实/数字/直接矛盾规则、显式平台规则注入、DeepSeek 语义 evaluator、服务端权限收敛与混合 evaluator；模型 finding 只能成为 `review`，确定性 `fact_gate/hard_block` 仍掌握阻断权。
- 生产配置可显式选择 `COPY_QUALITY_EVALUATOR=deepseek_hybrid`；默认仍为 `phase1_controlled_test_double`，与文案生成 Provider 可独立选择，缺 `DEEPSEEK_API_KEY` 在建 pool 前失败关闭，启动零外呼。
- QualityRun 技术失败不创建 QualityResult；现有服务端继续聚合 `blocked/needs_review/passed`，HumanReview 仍是唯一 `approved` 命令。
- 已验证：evaluator 定向 17/17、生产启动 11/11；`npm run check` 210 个 JavaScript 文件；全量 `npm test` 914 项、900 pass / 14 environment skip / 0 fail；`git diff --check` 通过。
- 真实外部调用：0 次 DeepSeek，0 次 Hifly，0 费用/积分。详细记录见 `docs/status/sessions/2026-08-12-p1-02-deepseek-quality.md`。
- PR #124 已合并到 `main@a72f2fd`，Issue #120 已关闭；Ubuntu、Windows、PostgreSQL CI 全绿。

## 2026-08-12 P1-01 / Issue #121 DeepSeek 官方文案适配（已合并）

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`；配置：`~/.codex/agents/luna-worker.toml`；配置模型：`gpt-5.6-luna`；推理：`max`；运行时模型元数据不可见，记为 `UNVERIFIED_RUNTIME_MODEL`。
- 基准：`origin/main@1eca202`；独立分支：`codex/p1-01-deepseek-generation`。
- 已完成：provider-neutral HTTPS JSON transport、DeepSeek 官方 OpenAI-compatible client、`deepseek-v4-flash`/非思考/JSON Output 请求、允许文本事实投影、`{body}` 输出校验与最多一次同配置结构重试；生产配置可显式选择 `deepseek`，缺 `DEEPSEEK_API_KEY` 在建池前失败关闭；默认和 demo 仍显式使用 `phase1_controlled_test_double`。
- 当前边界：只交付可选择 adapter 与配置，不切换已部署环境，不实现 QC/改写，不修改 UI、数据库、Hifly/Local Agent/视频代码；activation pending。
- 已验证：官方 `api-docs.deepseek.com` 只读文档 curl（无 API 调用）；DeepSeek 定向测试、生产启动测试、现有 copy-generation 回归共 33 项通过；`npm run check` 检查 207 个 JavaScript 文件；全量 `npm test` 共 894 项、880 pass / 14 environment skip / 0 fail；`git diff --check` 通过。
- 真实外部调用：0 次 DeepSeek，0 次 Hifly，0 费用/积分；未使用真实 key，未写入 secret、raw response、prompt 正文或文案日志。
- PR #123 已由 squash commit `33fe790` 合并，Issue #121 已关闭；CI 的 Ubuntu、Windows、PostgreSQL 三组均通过。独立 Sol Review 无任何级别发现，结论 `APPROVED`。
- 已部署环境仍保持受控 Provider，真实 DeepSeek activation 尚未执行。

## 2026-08-12 生产化核心能力升级 Goal 启动

- Owner 批准按固定顺序开发尚未完成的核心能力：事实重基线 → DeepSeek 文案/语义 QC → 人物目录与品类选择 → 3 商品/2 人物小批量验收 → 声音/背景/场景/姿势 Evidence → 常驻 Local Agent → 正式生产基础设施。
- 新 Goal 与详细范围见 `GOAL.md`、`docs/product/PRODUCTIONIZATION_UPGRADE_PLAN.md` 和 D-033。每项继续使用独立 Issue、分支和 PR，由 `luna-worker` 实现、Sol 独立审查。
- 当前第一项是无费用实现 DeepSeek Provider Adapter 与配置测试；生产 wiring 仍为 `phase1_controlled_test_double`，真实模型 smoke 尚未执行，也未产生 DeepSeek 费用。
- 已跑通的 Playwright/Local Agent「手里有货」单条链路保持不变。本轮重基线未访问飞影、未执行生成、未消耗积分。

## 2026-08-12 新云端系统最小真实执行器闭环已跑通

- PR #117 已经 CI 全绿并 squash 合并到 `main@eaf64c9`。云端部署前备份为 `/var/backups/hifly/hifly-20260812T012109Z.dump`，旧应用镜像保留为 `hifly-pilot-app:rollback-e9c0df2`；13 组 migration 全部成功，app/postgres/proxy healthy，HTTPS `/healthz` 返回 `ok`，服务器 Git 工作树干净。
- 部署后只调用正式 A12 技术重试入口，没有运行 Local Agent real 命令、没有打开或访问飞影、没有上传或生成，也没有产生新的积分风险。
- 核验 job `bd0789ed-e152-49fa-8931-17bb58e0a422` 第 2 次尝试为 `succeeded / passed`；候选 `e6d33671-f662-458a-a200-cfb4e85d5f7a` 的 verification 为 `passed`，原工单 `970cc09d-2f33-4c9c-9b2a-72136bdc8988` 为 `succeeded`。
- 唯一 Work `41905ac8-4a41-4072-84cd-a6856c7e0124` 已创建且为 `available`；主资产版本 `838c83c9-e5a6-4f33-86b0-ffa378bbcde3` 为 `available / video/mp4 / 41874377 bytes`，与候选媒体一致。
- 至此已实证完成：云端真实工单与交接包 → Mac Local Agent → 飞影手里有货生成 → 稳定作品下载 → 云端候选上传 → A12 核验 → Work 登记。实际飞影积分仍以飞影后台流水为准；standing authorization 剩余 4 次。
- 详细记录见 `docs/status/sessions/2026-08-12-ninth-real-local-agent-output-verification-failure.md`。

## 2026-08-12 第九次真实执行已出片，A12 核验技术失败（已恢复）

- PR #116 已合并到 `main@04aac4b`：真实页面命中点击外层上传后才出现的失败残留时，只走“重新编辑”回到上传态；Playwright lazy executor 尊重 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 及其相对 Profile；游客态登录信号在 heartbeat/claim 前失败关闭。
- 使用同一外部配置重新登录后，无副作用预检返回 `ready / playwright`。通过正式云端 API 创建 reproduction 工单 `970cc09d-2f33-4c9c-9b2a-72136bdc8988`；交接包 `89e14d98-5619-456c-b82a-88112a823949` 为 `ready / v1`，创建后全组织只有该工单活跃、attempt 数为 0。
- 本轮正式使用 standing authorization 的第 1/5 次，只运行一次 real 双门禁。自动化真实命中失败残留恢复、上传并校验当前人物/商品、点击一次手持图生成、确认、填写并回读 72 字批准文案、点击一次外层视频生成；飞影作品 `696679`（`2026-08-12 08:57:44`）生成完成，并通过稳定作品身份点击安全下载按钮。
- Local Agent attempt `5c093c19-19b5-456e-8028-60ff2ec03459` 为 `succeeded`，报告 `e2c523e9-a5c6-4d7b-b825-61b5f7aba96b` 为 `completed`；候选 `e6d33671-f662-458a-a200-cfb4e85d5f7a` 已上传，大小 `41874377` bytes、`video/mp4`。真实命令正常退出 0，没有第二次生成。
- A12 worker 随后以技术错误 `MANUAL_HANDOFF_CONTEXT_REQUIRED` 失败：核验 job `bd0789ed-e152-49fa-8931-17bb58e0a422` 为 `failed / technical`，candidate 为 `pending_verification / failed`，工单仍为 `running`，Work 0。根因是内部 authoritative package lookup 未传递 job 已有的 `requested_by_member_id / requested_by_role`，不是飞影或候选视频失败。
- 无积分 TDD 修复已完成：A12 authoritative package lookup 会转发 verification job 中已有的 `actorMemberId / actorRole`，不降低交接包服务的权限校验。实现由 `luna-worker` 完成，主控独立 review 未发现 blocker。验证：`npm run check` 检查 204 个 JavaScript 文件；`npm test` 共 879 项，865 pass / 14 environment skip / 0 fail；`git diff --check` 通过。
- 下一步只允许合并、部署并对既有 candidate 的技术核验 job 发起 retry；不得再次调用飞影。真实生成授权计数已扣除 1 次，standing authorization 剩余 4 次。本轮已点击飞影计费动作，实际积分以飞影后台流水为准。
- 详细记录见 `docs/status/sessions/2026-08-12-ninth-real-local-agent-output-verification-failure.md`。

## 2026-08-12 第八次真实执行被点击上传后出现的失败弹窗残留阻断，已停止且未重试

- Owner 明确授权工单 `e9d6139f-42cf-4145-95b0-1c2f5b834d4c` 最多执行 1 条真实飞影生成并接受积分风险。执行前确认它是唯一活跃工单、状态为 `waiting_for_executor`、交接包 `d0856dc8-7bc7-42f6-b55f-551b68f27e22` 为 `ready / v1`、attempt 数为 0，现有预检错误返回 `ready / playwright`。
- 唯一真实命令完成 heartbeat、claim、start 和交接包下载，随后失败并提交报告。attempt `59b4a9a1-eb96-44c5-a0c0-25c8d404f181`、报告 `a466cf58-2fa8-490d-8f49-f712ba8d1074`；工单/attempt 为 `failed`，报告为 `failed / not_retryable`，candidate 0、Work 0。失败后没有运行第二次命令。
- 只读实页诊断确认本次真实执行实际误用了运行目录中的会员 Profile，页面显示余额 `55637`。点击外层“上传人物+产品图”后，账号级旧失败弹窗才出现，内容为“生成失败 / 再次生成 150积分 / 重新编辑 / 确认”。现有修复只在点击外层入口之前检查失败态，因此仍会等待不存在的“上传商品”入口直至超时。
- 本次没有进入人物/商品上传，也没有点击手持图 `立即生成 150积分`、`再次生成 150积分` 或外层视频生成；未观察到本轮可计费动作。余额较更早记录发生变化，不能归因到本轮，最终积分结算仍以飞影后台流水为准。
- 无积分 TDD 修复已完成：打开外层入口后立即再次检查失败弹窗，命中时只走“重新编辑”恢复上传态，禁止点击“再次生成”；游客态信号会在 heartbeat/claim 前返回 `LOGIN_REQUIRED`；Playwright lazy executor 也会尊重 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 对应配置及相对 Profile 路径，不再静默改用运行目录配置。修复后无副作用预检已对正确外部 Profile 返回 `LOGIN_REQUIRED`，没有 heartbeat、claim、上传或生成。
- 验证：`npm run check` 检查 204 个 JavaScript 文件；`npm test` 共 878 项，864 pass / 14 environment skip / 0 fail；`git diff --check` 通过。下一步先合并修复，再用同一外部配置运行 `npm run login` 保存登录态，并仅做无副作用预检。该工单授权已经使用，不得重试。
- Owner 随后明确授予未来 5 次单条真实飞影生成权限，无需逐次再次确认。该 standing authorization 从下一条新 reproduction 工单开始计数，当前剩余 5 次；每次仍必须先通过登录态、唯一工单、零 attempt 和交接包就绪门禁，每次最多 1 个工单/1 条生成，失败即停且不自动重试。
- 详细记录见 `docs/status/sessions/2026-08-12-eighth-real-local-agent-stale-failure-after-open.md`。

## 2026-08-11 第八次真实验收前置就绪（未执行生成、未消耗积分）

- 第七次失败工单继续保留为 `not_retryable` 审计链，没有恢复或重用。通过正式云端 API 创建新 reproduction 工单 `e9d6139f-42cf-4145-95b0-1c2f5b834d4c`，绑定已批准视频方案 `ab4f7c0c-2cfa-4023-9b63-b419233efab3`。
- 新交接包 `d0856dc8-7bc7-42f6-b55f-551b68f27e22` 为 `ready / v1`；生成 job `7af613f9-39c6-4190-96d5-f2fee7ffeea0` 为 `succeeded / attempts 1`。
- 云端只读复核确认它是全组织唯一 `waiting_for_executor` 工单，ExecutionAttempt 数为 0。Local Agent 飞影登录预检返回 `ready / playwright`。
- 本轮没有运行 real 双门禁，没有领取工单、上传素材或点击生成，积分消耗 0。下一步只允许在 Owner 明确授权该工单最多 1 条真实飞影生成并接受积分风险后执行一次；失败立即停止且不自动重试。
- 详细记录见 `docs/status/sessions/2026-08-11-eighth-real-local-agent-preflight.md`。

## 2026-08-11 第七次真实执行被账号级失败弹窗残留阻断，已停止且未重试

- Owner 明确授权工单 `b5e180bc-7d7d-4d22-be4a-57ac0bd2484e` 最多执行 1 条真实飞影生成并接受积分风险。执行前确认它是唯一 `waiting_for_executor` 工单、交接包 `3c653228-2dff-420e-aaa1-5754792d299e` 为 `ready / v1`、attempt 数为 0，飞影登录预检为 `ready`。
- 唯一真实命令完成 heartbeat、claim、start 和交接包下载，随后在打开「手持商品图」弹窗时失败。attempt `512e225c-d8f2-4ce7-b5d8-39237cc42c3e`、报告 `f7bb5133-fc4c-4e07-938f-b289701a0c1a` 已落盘；工单/attempt 为 `failed`，报告为 `failed / not_retryable`，candidate 0、Work 0。失败后没有运行第二次命令。
- 只读实页检查确认弹窗停留在上一轮的「生成失败 / 再次生成 / 重新编辑 / 确认」状态；本轮接口证据中的人物图与商品图 OSS key 也与第六次失败执行完全相同。当前代码只清理成功残留，不会清理失败残留，因此等待不存在的「上传商品」入口直至超时。
- 本轮没有点击新的手持图「立即生成」或外层视频生成。页面余额执行前后均为 `56041`，未观察到本轮新扣分；最终积分结算仍以飞影后台流水为准。
- 本次真实授权已经使用，当前工单不得重试。独立分支已用 TDD 完成无积分最小修复：失败残留先点「重新编辑」回到上传态，再上传当前工单素材；代码不会点击「再次生成」。定向 `test/batch-runner.test.js` 为 80/80，`npm run check` 检查 204 个 JavaScript 文件，全量 `npm test` 为 874 total / 860 pass / 14 skip / 0 fail。
- 修复尚未进行新的真实浏览器或积分验证；该边界是刻意遵守失败即停约束。合并后如需再次真实验收，必须创建新 reproduction 工单并重新取得单条积分授权。
- 详细记录见 `docs/status/sessions/2026-08-11-seventh-real-local-agent-stale-failure.md`。

## 2026-08-11 第七次真实验收前置就绪（未执行生成、未消耗积分）

- 未恢复或重用第六次失败工单。通过正式云端 API 创建新 reproduction 工单 `b5e180bc-7d7d-4d22-be4a-57ac0bd2484e`，继续绑定已批准视频方案 `ab4f7c0c-2cfa-4023-9b63-b419233efab3`。
- 新交接包 `3c653228-2dff-420e-aaa1-5754792d299e` 为 `ready / v1`；生成 job `72c3eb76-0f4c-4432-afca-3e065f850fb9` 为 `succeeded / attempts 1`。
- 只读数据库复核确认它是全组织唯一 `waiting_for_executor` 工单，ExecutionAttempt 数为 0。Local Agent 飞影登录预检返回 `ready / playwright`。
- 本轮没有运行 real 双门禁，没有领取工单、上传素材或点击生成，积分消耗 0。下一步只允许在 Owner 明确授权该工单最多 1 条真实飞影生成并接受积分风险后执行一次；失败立即停止且不自动重试。
- 详细记录见 `docs/status/sessions/2026-08-11-seventh-real-local-agent-preflight.md`。

## 2026-08-10 第六次真实执行在飞影手持图上游失败，已停止且未重试

- Owner 明确授权工单 `77aa217b-9a86-42de-8412-6dca62b0841b` 最多执行 1 条真实飞影生成并接受积分风险。执行前再次确认它是唯一 `waiting_for_executor` 工单、交接包 `8df73c3d-7fdd-49b5-b672-a2e1f4b420b1` 为 `ready / v1`、attempt 数为 0，飞影登录预检为 `ready`。
- 唯一真实命令完成 heartbeat、claim、start、交接包下载、人物与商品上传，并点击一次手持商品图生成。飞影接口随后返回 `goods_holding_image_generation.data.status = 4`，页面进入“生成失败”；没有进入外层视频提交。
- attempt `8793ea7b-4fe5-41a5-b4b1-1dfbff6d5013`、报告 `70cd9d0d-556b-4e96-a4fe-89d65832c59d` 已安全收口：工单和 attempt 为 `failed`，报告为 `failed / not_retryable`，candidate 0、Work 0。失败后没有启动第二次命令。
- “最新作品”仍只有旧作品 `692503`，未出现本次新视频。账户余额在执行前后页面读取均为 `56041`，未观察到净扣分；最终积分结算仍以飞影后台流水为准。
- 该失败是飞影手持图上游明确失败，不是登录、上传、确认、下载或云端报告链路回归。当前没有足够证据支持继续修改本地代码，也不得自动重试。若 Owner 决定继续，必须新建 reproduction 工单并再次明确授权最多 1 条真实生成。
- 详细记录见 `docs/status/sessions/2026-08-10-sixth-real-local-agent-upstream-failure.md`。

## 2026-08-10 第六次真实验收前置就绪（未生成、未消耗积分）

- 复用唯一已批准的 `iPad 平板电脑` 输入：商品 `ca54826c-91b3-4b9e-9fb7-f922a4152e1d`、视频方案 `ab4f7c0c-2cfa-4023-9b63-b419233efab3`、人物素材版本 `4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0`。第四次真实执行曾用同组输入生成飞影手持图和视频，因此没有把第五次上游生成失败误判为本地素材合同失效。
- 通过正式云端 API 创建 reproduction 工单 `77aa217b-9a86-42de-8412-6dca62b0841b`；交接包 `8df73c3d-7fdd-49b5-b672-a2e1f4b420b1` 为 `ready / v1`，生成 job `6d482d51-171a-40b1-be6c-b73d449c7b97` 为 `succeeded / attempts 1`。
- 只读数据库复核确认全组织只有该工单处于 `waiting_for_executor`，ExecutionAttempt 数为 0。Local Agent 飞影预检返回 `ready / playwright`；在存在该待执行工单时运行默认 standby 只完成 heartbeat 200 并返回 `local_agent_standby`，没有 claim。
- 本轮没有上传素材、点击飞影生成、创建 attempt 或消耗积分。下一步必须由 Owner 新授权最多 1 条真实生成后，才允许运行一次 real 双门禁；失败立即停止且不自动重试。
- 详细记录见 `docs/status/sessions/2026-08-10-sixth-real-local-agent-preflight.md`。

## 2026-08-10 第五次真实执行在飞影手持图生成失败，失败态识别已修复

- 新 reproduction 工单 `5ce1cd6d-fa17-4d66-acc0-697cf649dc36`、交接包 `5d7d7722-3726-4abe-a608-a551862dc2d8`（`ready / v1`）通过唯一待执行、attempt 0 和飞影登录 `ready` 的无副作用门禁。
- Owner 授权的唯一真实命令成功完成云端领取、交接包下载、人物/商品上传，并只点击一次手持商品图生成。飞影约 30 分钟后明确显示“生成失败”，没有进入批准文案填写或外层视频提交。
- attempt `2aaea76b-d770-4e5e-bc89-a486a2b7cb79`、报告 `3b33138b-40dd-4af4-b708-291a3e5e23a3` 已安全收口：工单/attempt failed，报告 `failed / not_retryable`，candidate 0、Work 0，没有自动重试。
- 自动化此前会把失败弹窗的“再次生成 / 重新编辑 / 确认”误识别成成功操作组，继而误报 AI 文案开关。修复后“生成失败”优先于成功按钮组合，等待器立即终止，不会继续确认、填写文案或提交视频。
- 本次已点击 `立即生成 150积分`，实际扣分以飞影后台账单为准；截图余额 `56191` 不能区分本轮与上一轮延迟结算。
- 本次授权已使用。继续真实验收前必须合并本轮修复、创建新 reproduction 工单并取得新的单条积分授权。
- 详细记录见 `docs/status/sessions/2026-08-10-fifth-real-local-agent-hifly-generation-failure.md`。

## 2026-08-10 第四次真实执行已生成飞影作品，下载根目录错误失败即停

- Owner 新授权最多执行 1 条真实飞影生成。使用正式 API 创建 reproduction 工单 `bc0153e2-1f2c-49bd-a75d-ab909fb28a20`，交接包 `e4ed7df0-0b87-4ce4-acfd-17948215dff9` 为 `ready / v1`；执行前确认飞影登录预检 ready、全组织只有该工单待执行且 attempt 数为 0。
- 唯一真实命令已成功完成商品与人物上传、手持商品图生成和确认、批准文案填写及外层视频提交。飞影作品 `692503`（`2026-08-10 14:20:20`）生成完成，自动化正确识别并点击其下载按钮。
- 下载文件写入本地之前发生受控失败：attempt `f71a9bfd-51e2-4312-bc5d-206dd09c6504`、报告 `ed678819-b5f6-4bcb-b023-816492523325`；工单和 attempt 为 failed，candidate 0，没有云端视频或 Work，没有自动重试。
- 根因是 Hifly 下载器仍用仓库配置根目录校验输出，而 Local Agent 为每次执行使用系统临时 `projectRoot`，合法临时下载目录因此在 `saveAs` 前被误判为路径越界。修复后 `runBatch` 通过已有内部 context 传递 `projectRoot`，Hifly executor 转发给页面适配器，下载结果相对本次批处理根目录返回。
- 相关回归覆盖 context 传递、Hifly executor 转发、配置根与批处理根不同时的合法下载，以及原有越界拒绝。定向门禁 95/95 通过；完整门禁与 PR 状态见本轮后续记录。
- 本次实际点击了飞影生成操作，积分应以飞影后台账单为准；提交时页面仍显示旧余额 `56841`，不是扣费后的可靠读数。
- 本次真实授权已经使用，当前 attempt 为 `not_retryable`。修复合并后如需继续，必须创建新 reproduction 工单并由 Owner 再次明确授权最多 1 条真实生成。
- 详细记录见 `docs/status/sessions/2026-08-10-fourth-real-local-agent-download-root-failure.md`。

## 2026-08-10 第三次真实执行失败即停，商品上传文件扩展名已无积分修复

- Owner 新授权最多执行 1 条真实飞影生成，接受积分扣除，失败立即停止且不自动重试。旧工单的失败报告为 `not_retryable`，因此保留其审计链，并通过正式 API 创建 reproduction 工单 `5e245a67-cdf8-4836-be66-6c5c58118990`；交接包 `d969bb14-3032-4592-81c8-6c5c277b4611` 为 `ready / v1`。
- 执行前确认飞影 `preflight = ready / playwright`，且云端只有这一个 `waiting_for_executor` 工单。唯一真实命令成功 heartbeat、claim、start、下载交接包并进入飞影弹窗。
- attempt `cabb5e35-9691-429c-9b97-1a7902e6590c` 在商品上传校验阶段失败，报告 `f603334f-694c-4025-aeda-d4791cbad0b8` 正常落盘；工单和 attempt 均为 `failed`，candidate 0，没有视频，没有自动重试。
- 截图显示弹窗商品位仍是“上传商品”，弹窗“立即生成”保持禁用，账户积分仍为 `56841`。本次没有点击任何生成按钮，未进入积分动作。
- 根因：交接包正确声明商品图为 `image/png`，但 Local Agent 解包路径是无扩展名的 `assets/<asset-version-id>`；Playwright 因此向浏览器提供空 MIME type，飞影静默拒绝。修复后编译器根据媒体类型生成仅用于上传的 `.png` 或 `.jpg` 临时副本。
- 本次真实授权已经使用。修复合并后仍需创建新的 reproduction 工单，并由 Owner 再次明确授权 1 条真实生成；禁止直接重复 real 命令。
- 详细记录见 `docs/status/sessions/2026-08-10-third-real-local-agent-extension-failure.md`。

## 2026-08-10 第二次真实执行失败即停，弹窗上传根因已无积分修复

- Owner 只授权 1 条真实生成。本次 attempt `41f7db49-8c2a-43ab-947f-936ba7be9ef4` 完成云端 heartbeat、claim、start、交接包下载及飞影已登录页面进入，但在人物素材上传处失败；没有点击任何生成按钮，没有 candidate 或视频，也没有自动重试。
- 执行前发现 PostgreSQL 报告写入列/参数数目不一致；PR #106 已修复、合并并部署，云端备份和回滚镜像保留，失败报告因此能够正常落盘并把工单收口为 `failed`。
- 实页 DOM 证明人物/商品上传控件各自包含隐藏 file input。旧代码既强制等待不稳定的 chooser，又以页面级 `/上传人物/` 误命中外层“上传人物+产品图”。修复后限定可见弹窗并直接设置对应 input，chooser 只作兼容回退。
- 商品上传成功时，旧校验还会把右下推荐缩略图 `pd4.jpg` 当主商品图。现改为按展示面积选择主预览，面积相同再取右侧。
- 无积分实页复验已看到人物与商品两个主预览，商品校验通过，积分显示 `56841 -> 56841`；没有点击生成。相关定向门禁与最终 CI 结果见本轮 PR。
- 本次真实授权已经使用。下一次必须先合并修复、正式恢复失败工单，并由 Owner 重新明确授权 1 条积分任务；禁止直接重复 real 命令。
- 详细记录见 `docs/status/sessions/2026-08-10-second-real-local-agent-upload-control-failure.md`。

## 2026-08-10 飞影登录态预检与文件选择器异常收口完成（未生成视频）

- 已在独立 Local Agent checkout 中完成无积分 TDD 修复：真实双门禁在 heartbeat/claim 前先打开「手里有货」并检查登录弹窗；命中手机号或微信登录信号时返回 `LOGIN_REQUIRED / requires_action`，不会领取云端工单。
- 若登录在领取工单后失效，批处理暂停状态会映射为受控 `LOGIN_REQUIRED` 报告，服务端可把工单收口为 `requires_action`，不再以通用失败或悬空租约结束。
- 上传文件的 `filechooser` 等待与按钮点击改为同一 `Promise.all` 生命周期；点击被登录弹窗阻断时会重新检查登录态，并且不再遗留未处理的 chooser rejection。
- Owner 已重新登录并保存 Profile。随后只调用执行器 `preflight()` 做实机验证，结果为 `ready / playwright`；该调用没有 heartbeat、claim、上传素材或点击生成，飞影积分消耗 0。
- 验证：相关 Local Agent/批处理测试 101/101 通过，静态检查 204 个 JS，`git diff --check` 通过。全量 `npm test` 输出中的 838 项均通过，但进程被既有 `yingdao-rpa-executor.test.js` worker 阻塞而未自然退出，因此不把它记作一次完整全量通过。
- 原工单仍为 `requires_action`，本轮没有恢复或领取。下一步先通过受支持的云端恢复入口将它恢复为 `waiting_for_executor`，再次确认唯一可领取工单和 attempt 状态；之后仍需 Owner 新的单条积分授权，失败即停且不自动重试。
- 详细记录见 `docs/status/sessions/2026-08-10-local-agent-login-preflight-fix.md`。

## 2026-08-10 首次云端工单真实执行在飞影登录门禁失败（未生成视频）

- Owner 明确授权仅执行 1 条真实飞影生成并接受积分扣除，要求失败立即停止且不自动重试。执行前复核确认云端只有工单 `97bba08b-d602-4fd2-88b3-86f3af76f570` 可领取，交接包 `ca1e1192-ea25-465f-ba06-78cb67c8afab` 为 `ready / v1`，attempt 数为 0。
- Local Agent 双门禁运行后成功完成 heartbeat、claim、start 和交接包下载，并进入飞影「手里有货」页面；但保存的飞影浏览器 Profile 已退出登录，页面弹出登录框。上传阶段等待 `filechooser` 30 秒超时，进程退出，没有点击弹窗「立即生成」或外层视频生成。
- 本次 attempt 为 `3c90b604-f79f-4769-b235-7b00783bb724`。进程异常未提交失败报告；租约到期后仅调用一次 claim 清理动作，服务端把 attempt 与工单收口为 `requires_action / lease_expired`，并返回空 attempt，没有重新领取或重试。
- 数据库复核：candidate 0、report 0、Work 0。因为失败发生在上传前且未点击任何生成按钮，按链路判断没有触发积分动作；最终积分账单仍以飞影账户后台为准。
- 下一步必须先重新执行 `npm run login` 保存有效飞影登录态，再以无积分 TDD 修复登录页前置识别和 `filechooser` 等待异常收口。修复与验证完成后，仍需 Owner 对新的 1 条真实生成重新授权，禁止沿用本次授权自动重试。
- 详细记录见 `docs/status/sessions/2026-08-10-first-real-local-agent-run.md`。

## 2026-08-10 单条真实工单与人物映射已就绪（未访问飞影、未消耗积分）

- 在阿里云正式试运行界面创建项目 `真实出片验收 2026-08-10`，录入并核验 1 个 `iPad 平板电脑` 商品；商品快照、图片素材、文案生成、QC、文案人工批准均完成。
- 选择并确认受控目录人物 `林小满 v1`。其人物素材版本 `4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0` 已在 Mac 私有配置中映射到已准备的人物图；映射文件与图片权限均为 600，未进入 Git。
- 视频方案 v1 已预检并人工批准；预检仅提示云端没有常驻生产执行环境，不阻止 Local Agent 工单。制作说明固定为 9:16 竖版、使用已批准文案和已确认人物、不添加未经确认的参数或价格。
- 生产工单 `97bba08b-d602-4fd2-88b3-86f3af76f570` 已创建为 `first_production / waiting_for_executor`；交接包 `ca1e1192-ea25-465f-ba06-78cb67c8afab` 为 `ready / v1`，执行尝试数为 0。
- 交接包已下载到仓库外并完成离线编译校验：单商品、商品图可读、批准文案 72 字、人物映射命中。随后再次运行默认 standby，heartbeat 200、输出 `local_agent_standby`；没有领取工单。
- 当前只差 Owner 对本次 1 条真实飞影生成的单独积分授权。授权前禁止运行 real 双门禁；失败后立即停止且不自动重试。本阶段飞影积分消耗 0。
- 详细证据见 `docs/status/sessions/2026-08-10-real-order-and-avatar-mapping.md`。

## 2026-08-10 Local Agent 已部署并完成 standby 配对（未访问飞影、未消耗积分）

- 阿里云试运行环境已从 `646c0a9` 升级到 `main@8846602`。升级前生成数据库备份
  `hifly-20260810T020113Z.dump`，旧应用镜像保留为回滚标签。
- 新镜像使用仓库外阿里云镜像源 Dockerfile 构建；13 组 production migration 全部成功，包含
  `manualExecution` 下的 Local Agent 002/003 migration。app、postgres、proxy 均 healthy，HTTPS
  `/healthz` 返回 200，服务器 Git 工作树干净。
- 云端启用单一 `mac-agent-01`，绑定试运行 Organization；Bearer Token 仅保存在服务器 `.env` 和 Mac 用户级
  `~/.config/hifly-local-agent/cloud.env`，文件权限为 600，未进入仓库、日志或本文档。
- Mac 使用独立干净运行目录 `~/.local/share/hifly-local-agent/app`，版本同为 `8846602`。默认运行
  `npm run local-agent:run-once` 后 heartbeat 返回 200，并输出 `local_agent_standby`；本次没有开启 fake/real
  环境变量，没有领取工单、下载交接包或调用飞影。
- 当前只证明云端与 Mac 的认证、网络和 readiness 心跳可用，不能宣称真实出片或云端端到端已验收。下一步需准备
  1 个符合门禁的工单和本地人物映射，并由 Owner 另行明确授权 1 条飞影积分后运行 real 双门禁；失败即停且不自动重试。
- 本阶段飞影积分消耗为 0。详细证据见
  `docs/status/sessions/2026-08-10-local-agent-deployment-and-standby.md`。

## 2026-08-10 Local Agent 最小执行器实现完成（部署前历史检查点）

- 云端控制面已实现 Agent readiness、claim/start/lease heartbeat、交接包下载、候选 MP4 回传、受控结果报告，并把成功候选交给既有 A12 核验创建 Work。
- macOS CLI 默认 standby，只上报在线而不领取工单；fake 需显式环境开关，真实 Playwright 需 `--real` 和 `LOCAL_AGENT_REAL_EXECUTION=true` 双门禁。缺人物映射进入 `requires_action`；租约续期失败停止上传和报告。
- Local Agent 默认关闭，云端仍保持 `PRODUCTION_EXECUTOR=fail_closed`。配置和运行步骤见 `docs/deployment/LOCAL_AGENT_RUNBOOK.md`。
- 无积分验证：定向 74 tests 为 73 pass / 1 PostgreSQL environment skip / 0 fail；全量串行 862 tests 为 848 pass / 14 environment skips / 0 fail；静态检查 204 JS 与 diff check 通过。skip 未计为通过。
- 该历史检查点只完成代码和无积分 fake 闭环，当时尚未部署；当前部署状态以上方最新章节为准。真实飞影单条验收仍未执行，因此不能宣称云端端到端可用。
- 本轮未访问飞影、未消耗积分。真实单条验收必须重新明确授权，并遵守失败即停、不自动重试。

## 2026-08-10 Local Agent Task 1+2 有界阶段完成（未访问飞影、未消耗积分）

- 按主控再次收紧范围，本轮完成 memory 状态修正、PG migration 002/repository lease 字段、显式 agent order/package 内部 port、独立 Bearer guard、claim/start/heartbeat/package download routes，以及 production config/wiring；candidate/report/A12/CLI 均未开始。
- Local Agent 默认 feature off；生产仅在 `LOCAL_AGENT_ENABLED=true` 且 `LOCAL_AGENT_ID`、`LOCAL_AGENT_ORGANIZATION_ID`、`LOCAL_AGENT_TOKEN` 完整时注册 route。token 只留在 env→内存 guard，不进数据库、响应或日志；生产 executor 仍 `fail_closed`。
- `executor_type=local_agent` 与 `executor_agent_id`、`operator_id=null` 由 migration CHECK 和 memory/PG repository 共同约束；order transition 经过 `transitionOrderForAgent`，不使用 `actorRole=agent` 穿过 member service。租约失效账本使用 repository current status，并记录 `actor_agent_id`。
- 配置状态：`CONFIG_VERIFIED`（`~/.codex/agents/luna-worker.toml` 为 `gpt-5.6-luna` / Max）；运行时身份不可见，记录 `UNVERIFIED_RUNTIME_MODEL`；未回退 Terra。
- 定向验证：Local Agent service 3 pass；Local Agent API/feature-off 3 pass；production-start/config/wiring 6 pass；manual execution/handoff/API 20 pass；production-order/server-security 18 pass；`npm run check` 198 JS；`git diff --check` 通过。PG integration 1 skip，原因是本机缺少 `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL`，未计为通过。
- 本轮未启动 Playwright、未访问 Hifly、未部署、未 push/merge/创建 PR，未运行 CLI，飞影积分消耗为 0。

## 2026-08-10 阿里云 2C4G 内部试运行环境已部署（未访问飞影、未消耗积分）

- `origin/main=646c0a9` 已部署到阿里云 Ubuntu 22.04 轻量服务器；服务器 Git 工作树保持干净，部署变量、证书、数据库数据与备份均不进入 Git。
- Docker Engine 29.7.2 / Compose v5.4.0 已安装；PostgreSQL 15、Node 应用和 Nginx 三个容器均为 healthy，只有 22/80/443 对外监听，app 3000 与 PostgreSQL 5432 仅在 Compose 网络内可达。
- A01-A14 共 13 组 production migration 全部通过；公网 HTTPS `/healthz` 返回 `{"status":"ok"}`，登录页可访问，初始管理员登录返回 `password_change_required`。
- `pg_dump` 已生成备份，并成功恢复到临时验证数据库；验证得到 92 张 public tables，随后删除临时库，生产库未受影响。
- 服务器资源验收时 app/PostgreSQL/Nginx 合计使用约 185 MiB 内存，系统盘约 13% 已用，满足当前低并发内部试运行基线。
- 当前使用 30 天自签 IP 证书，仅用于内部试运行；正式对外前必须配置域名、可信证书、备案/安全组策略和监控备份。`PRODUCTION_EXECUTOR=fail_closed`，服务器未配置 Hifly Token，也没有触发真实飞影请求或积分消耗。
- 阿里云网络下 Docker Hub 与 Debian 官方源出现超时；镜像通过 DaoCloud 公共镜像前缀预拉取并重新标记，应用镜像使用仓库外 Dockerfile 将 Debian apt 源替换为阿里云镜像。服务器仓库源码未改动。细节见 `docs/deployment/ALIYUN_2C4G_DEPLOYMENT_NOTES.md`。

## 2026-08-09 Hifly 官方 API Token 底座与连接验证（未生成视频、未消耗积分）

- Owner 确认 D-032：官方 API Token 使用服务端 `HIFLY_API_TOKEN` 或云 SecretStore 托管；Q-018 关闭。
- 新增最小 Hifly API client 与管理员显式 `POST /api/providers/hifly/connection-test`，仅查询账户积分；无自动请求、无创作任务。
- 生产默认 `fail_closed`、Capture HTTP 与 Playwright 路径保持不变；公开 API 未确认「手里有货」，因此不会由 Token 路径执行该能力。
- 底座实现阶段只访问公开 API 文档页面；后续经 Owner 确认才执行下方一次真实只读连接检查。

### 后续验证更新

- Owner 配置 API Key 后，已完成一次显式账户积分只读检查：官方 API 连接成功、返回整数余额，没有创建任务或消耗积分。
- Key 已从误用的 `.env.example` 迁移到 Git 忽略且权限为 `600` 的 `.env`；模板恢复为空，真实值未提交。
- `hifly_agent_token` 暂不接入当前批量生产；截图中暴露的旧值必须在飞影后台轮换。

## 2026-08-09 Sol 隔离实机验收完成（未访问飞影、未消耗积分）

- Sol 使用独立 Compose project `hifly-pilot-verify`，对外测试端口为 HTTP `28080`、HTTPS `28443`；使用临时
  自签证书和测试密码，均不是生产凭据/证书。镜像 build 成功；首次从 Docker Hub 拉取时出现若干 EOF，重试后
  成功，确认不是代码失败。
- `postgres:15-alpine` healthy，当前 13 个 A01-A14 migration steps 全部成功；app healthy，
  `nginx:1.30.4-alpine` healthy。HTTPS `GET /healthz` 返回 `200 {"status":"ok"}`，`/login.html` 返回 200。
- `pg_dump` backup 成功，并恢复到 fresh `hifly_restore_verify` 成功；恢复库 public tables count 为 92。
- Sol 全量 `npm test`：821 total / 776 pass / 45 skip / 0 fail（约 40 秒）；生产定向测试 9/9，
  `npm run check` 检查 193 个 JS，`git diff --check` 与 Compose config 均通过。
- 验收使用的临时容器随后由 Sol 清理；临时自签证书不具备生产用途。全程未访问 Hifly、未执行真实 provider/Playwright/Capture，
  未消耗飞影积分。

## 2026-08-09 腾讯云 2C4G 一体化内部试运行基线（IMPLEMENTER；未访问飞影、未消耗积分）

- 分支 `codex/tencent-cloud-pilot` 在设计基线 `e1f985e` 上完成生产入口、显式 A01-A14 migration、PostgreSQL
  backup/restore、Docker Compose 与 Nginx 合同；默认生产执行器为 `fail_closed`，真实飞影/provider/executor
  未配置时不会伪造成功。
- Compose 试点数据库统一为 `postgres:15-alpine`，与 Node 22 slim/bookworm 内的 `postgresql-client` major
  版本一致；`POSTGRES_PASSWORD` 必须显式提供，不再有可启动的默认密码。backup/restore argv 只使用脱敏
 连接 URI，密码通过子进程 `PGPASSWORD` 传递，日志不输出连接串。
- 生产入口只读取环境变量/secret，不读取 `config.local.json`；固定监听 `0.0.0.0:PORT`，不自动跳端口；
  `startupMigrations=false`，启动只做 repository initialize/schema-current 校验。demo/legacy 默认 startup
  migration 与 Playwright 路径保持不变。
- Compose 仅 proxy 对外发布，app/PostgreSQL 走内网并使用持久 volume、healthcheck 和 2C4G 资源上限；
  `HTTP_PORT`/`HTTPS_PORT` 可覆写，证书契约为 `deploy/certs/fullchain.pem` 与 `privkey.pem`。`/healthz`
  不受 identity guard，但受 trusted Host 约束，Nginx health proxy 使用允许的 Host；单次批量请求上限为
  128 MiB，生产 `maxBatchBytes` 与 Nginx `client_max_body_size` 对齐。
- 已通过：`node --test test/production-start.test.js test/production-deployment.test.js`（9/9）；
  `npm run check`（193 个 JavaScript 文件）、`git diff --check`、默认及 `HTTP_PORT=18080 HTTPS_PORT=18443`
  的隔离 Compose config，以及隔离项目名的 app image build。Sol 独立重跑全量测试通过：821 tests，776 pass，
  45 skip，0 fail，约 40 秒；本 IMPLEMENTER 未重复长测。
- 本轮未启动、停止或修改任何既有 Docker 容器，未访问 `hifly.cc`、未运行真实 provider/Playwright/Capture，
  未消耗积分；该文档与 `docs/deployment/TENCENT_CLOUD_2C4G_DEPLOYMENT_RUNBOOK.md` 明确本方案尚未达到公网
  生产交付。

## 2026-08-09 云端试运行准备启动

- PR #97 已 squash merge，`main=fc54f7c`；A01-A14 一键本地演示入口已进入正式基线。
- 新分支 `codex/tencent-cloud-pilot` 正在进行腾讯云 2C4G 部署与仓库清理审计，未触碰根工作区既有脏文件。
- 初步结论：2C4G 可承载低并发内部试运行；正式客户生产建议把 PostgreSQL 与文件存储拆到托管服务，
  Playwright 浏览器执行器不与应用长期同机。详见 `docs/deployment/TENCENT_CLOUD_2C4G_DEPLOYMENT_DESIGN.md`。
- 当前仅完成设计与盘点，尚未部署服务器、接入真实 Provider/COS 或执行真实飞影；积分消耗为 0。

## A01-A14 本地演示入口实现（2026-08-09；已合并；未访问飞影、未消耗积分）

- 实现已通过 PR #97 squash merge 到 `main=fc54f7c`；Ubuntu、Windows、PostgreSQL CI 全绿。
- 已新增跨平台 Node 命令 `npm run demo` / `demo:stop` / 显式 `demo:reset`，专用 `docker-compose.demo.yml`、独立 Compose project/volume，以及从 `55433` 起自动避让占用的 loopback DB 端口；A01→A14 migration 顺序固定，并补齐 `migrate:manual-execution` CLI。
- demo server 启用全量 VSA feature，使用现有 controlled provider/evaluator、`fake-executor` 和 fail-closed capture transport；不读取 `config.local.json` 或飞影登录态，不调用真实 Provider/Capture HTTP/Playwright/影刀。登录落点为 `/login.html`，固定本地临时账号首次登录强制改密；演示文件保存在已忽略的项目 `.local-demo/`。
- Sol 独立验证：demo 定向 10/10；`npm run check` 通过（186 JS）；全量 `npm test` 为 813 tests / 768 pass / 0 fail / 45 environment skips；`git diff --check` 通过。独立 worktree 已执行 `npm ci`，未改根工作区的旧 `node_modules` 或脏文件。
- Docker 实跑通过：既有 `55432`～`55434` 被占用时自动选择 `127.0.0.1:55435`，PostgreSQL healthy，13 组 migration 全部完成；真实本地浏览器完成临时密码登录 → 强制改密 → `/projects.html`，并确认统一企业壳层入口。验收后数据库已 reset 并重新启动为干净初始状态，GUI 当前运行于 `http://127.0.0.1:4317/login.html`。
- 本轮未访问外部服务、未执行真实飞影或积分动作。配置状态：`CONFIG_VERIFIED`（`~/.codex/agents/luna-worker.toml` 为 `gpt-5.6-luna` / Max）；运行时身份不可见，记录 `UNVERIFIED_RUNTIME_MODEL`，未回退 Terra。

## VSA-A14 全链路验收与加固（Issue #70，2026-08-09）

- Kimi Code 已按 `kimi-code/k3`、1M context、Max reasoning 产出并合并
  `docs/frontend/VSA-A14_FULL_CHAIN_UX_AUDIT.md`（PR #93，main `ed6567c`）。配置状态
  `CONFIG_VERIFIED`，CLI 未暴露服务端模型身份，运行时状态 `UNVERIFIED_RUNTIME_MODEL`。
- 实现位于 `/private/tmp/hifly-vsa-a14-implementation`、分支 `codex/vsa-a14-acceptance`，基于
  `ed6567c`。准确使用自定义 Agent `luna-worker`（`gpt-5.6-luna` / Max）实施，Sol 独立 Review；
  未使用 Terra。
- 已补企业 feature-aware 登录落点与非管理员回链、商品 revision URL 恢复、文案页返回上下文、
  project 409 冲突文案、素材核验 2s 有界轮询、缺失 token、works hover 位移和 production 死控件清理。
- 独立 Review 发现并修复生产工单开启且尚无视频方案时 `plan.status` 空引用；回归测试先复现，
  修复后 A14 主路径不再通过 service hook 预置方案，而是从空状态填写说明并点击创建。
- 新增 A14 系统 Chrome 主路径：全新企业管理员/成员登录与改密 → 项目/商品/素材 → 文案生成、
  质检与审核 → 人物确认 → 空视频方案创建、预检与批准 → 工单、交接包、人工执行、核验、Work
  检查与交付。1440px 生产页与 390px 作品页均断言无横向溢出；截图仅在
  `/private/tmp/hifly-vsa-a14-screenshots/`，不进仓库。
- 验证：A14 + A10 browser 2/2 pass、0 skip；`npm run check` 178 JS；`git diff --check` 通过；
  全量 `npm test` 为 803 tests / 789 pass / 0 fail / 14 environment skips。跳过项为既有 PostgreSQL/
  identity browser 环境条件，不计为通过。
- PR #94 已于 2026-08-09 squash merge，merge commit 为 `ba687de`，Issue #70 已自动关闭；
  Ubuntu、Windows、PostgreSQL CI 全绿。A14 最终结论为 `GOAL_APPROVED`。没有访问 Hifly、没有
  真实 Provider/Capture HTTP、没有运行批次、没有消耗飞影积分。

## VSA-A13 作品检查与交付记录（Issue #69，2026-08-09）

- 状态：PR #91 已于 2026-08-09 squash merge，Issue #69 已关闭，merge commit 为 `75dfe96ec50fe06e24396c4ca8e47aef9e5135c2`。Sol 独立 Review 的 3 个 Important 与 final follow-up 均已修复，最终结论无 Blocker/Important。
- 后端正式 Work 检查与交付边界：检查状态为 pending/passed/rework_required/superseded；pending/passed 的返工字段保持为空，rework_required 三项字段完整，superseded 保留被替代记录原字段；pending/passed 可创建新检查并 supersede 旧记录，当前 rework_required 禁止同一 Work 新 pass/新 rework，原 Work/history 保留，未来上游新周期/新作品不在本 Slice 创建。只有当前 passed 才能交付；同一幂等键同载荷回放首次结果、异载荷冲突、新 key 支持多次真实交付；关键命令写入审计与状态账本。
- Memory 与 PostgreSQL repository 共用同一服务合同；pass/rework/delivery 均必须携带当前 inspection identity+revision，缺失稳定返回 400，stale 返回 409，receipt replay 在状态变化后仍回放。新增 clean migration、事务写入、组织/角色隔离、跨组织拒绝、下载授权与交付登记分离。PostgreSQL CI 已覆盖 clean migration、rework 可写且阻止后续检查并保留字段、并发幂等、回放、重复交付、返工门禁、历史 append-only、审计/账本并通过。
- 新增 `web/works.html/css/js`：项目/交付状态筛选、列表、预览及降级说明、来源快照、检查/历史、下载、交付登记/历史；pending 通过先开选中作品摘要/明确结论的轻确认 Dialog；rework_required 禁用检查按钮并说明需新的上游生产周期/新工单，移动主操作只打开作品抽屉；上下文齐全时链接视频方案/文案/人物/商品页面，缺少权威 ID 时隐藏链接；交付时间默认现在且可编辑。1440 三栏、390 单栏作品抽屉与吸底唯一主操作。`worksEnabled` 默认 false，关闭时导航不出现、直接访问显示不可用；开启时 shell 按项目/素材中心/作品库/成员管理顺序插入入口。A12 production 摘要仅在 flag 开启且作品存在时动态显示入口。
- 验证：A13 service/API/PG 定向为 10 pass、1 skip；A13 系统 Chrome browser 为 1 pass/0 fail/0 skip（本地 fake，覆盖 1440/390、导航顺序、通过确认、交付时间、检查/交付/返工、移动阻断、上游链接、无横向滚动/禁用 UI 词）；A12 service/API/worker 为 3 pass；A12 系统 Chrome browser 回归为 1 pass/0 fail/0 skip；`npm run check` 检查 178 个 JavaScript 文件通过；`npm test` 为 801 tests / 757 pass / 0 fail / 44 skipped；`git diff --check` 通过。
- 本轮使用准确自定义 Agent `luna-worker`，配置 `~/.codex/agents/luna-worker.toml` 为 `gpt-5.6-luna` / Max，状态 `CONFIG_VERIFIED`；运行时模型不可见，记录 `UNVERIFIED_RUNTIME_MODEL`，未使用 Terra。
- 官方 registry 的 `npm audit --omit=dev --audit-level=high` 报告仓库既有 7 项依赖风险（5 high、2 moderate）；A13 未新增依赖，修复涉及破坏性升级，按本任务边界不处理。
- PR #91 CI：Ubuntu、Windows、PostgreSQL 全绿。没有访问 Hifly、没有发送真实 Provider/Capture HTTP、没有运行批次、没有消耗飞影积分；未触碰根工作区 `gui/visual-refresh` 的脏文件。当前停止，不开始 A14。

## VSA-A12 候选产物核验与 Work 创建（Issue #68，2026-08-09）

- 状态：核心服务、worker、memory/PG repository、独立 migration/ledger、API wiring 与 production 页面增量已实现；Sol Review 的 Important 修复、定向/全量回归已完成，timer 所有权修复提交为 `04a963f`。本 worktree 基于已进入 `origin/main` 的 A11 提交 `9af3f5e`（PR #89，Issue #67 已关闭）。
- 核验服务端只读取同 Organization/order 的最新有效 completed ManualExecutionReport、其 primary candidate、固定 attempt/package；重新核对对象存在/归属/关联、唯一主要视频、媒体类型、大小与 SHA-256 checksum。Work 不只保存 candidate ID：成功时复用 A03 canonical asset repository 注册 `work_video` Asset + available AssetVersion，并在 Work 保存 `primary_asset_version_id`。
- Work 固定保存 ProductionOrder 输入快照中的 VideoPlan/Copy/Avatar/production config，以及 package/version/manifest、attempt/report、candidate/checksum 和输出媒体摘要；客户端不能提交或替换这些权威事实。
- 成功路径在 PG 同一 transaction client 中完成 canonical AssetVersion、Work、candidate passed projection、ProductionOrder succeeded、ProductionOrder AuditEvent、A12 AuditEvent、AsyncJob 与 ledger；memory transaction 覆盖 AssetVersion、Work、candidate、order transition、receipt/audit/ledger 回滚。技术 failed 与业务 failed/requires_action 分开，retry/recover 有 maxAttempts、lease heartbeat 和过期恢复。
- 更正报告遵循不可变历史：新 latest completed report + primary candidate 创建新 job，旧 report/job/audit 保留；相同 report/candidate/checksum 仍幂等，一工单最多一个 Work，且成功后任意新自然键核验请求均由 memory/PG 一致阻断（natural replay 仍优先返回）。PG migration 002 通过 `pg_constraint.conkey` 精确删除 001 的旧唯一约束并新增短名约束，runner 按数字文件名顺序应用；集成测试含不同报告同 checksum 探针及 receipt/natural 双锁并发回归。
- UI 只显示中文业务投影（文件完整性、作品已登记、正式文件版本已固定），不显示内部任务/错误/版本编号；更正入口在新报告出现后可达，无新报告时引导先提交更正。POST 已受理与后续 GET 瞬时失败分离，queued/running 自动轮询，成功读取后清除失败提示。
- A12 还覆盖组织/角色隔离、幂等/并发单 Work、服务 API、刷新恢复 UI、执行完成不等于工单完成、A13 作品库禁用说明；未创建 `works.html`，旧 GUI/Playwright/Capture HTTP 默认路径保持不变。
- 验证状态：A12 service/API/worker 定向测试 15 pass；`npm run check` 检查 172 个 JavaScript 文件通过；`npm test` 为 789 tests / 747 pass / 0 fail / 42 skipped；`git diff --check` 通过。PG integration 在本机无 `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL` 时 1 skip，未计为通过；本机 browser 1 skip（系统 Chrome `MachPortRendezvous ... Permission denied`）。Sol 已在 `04a963f` 后用系统 Chrome 实跑 A12 browser 1/1（8.48s），覆盖 initial GET fail→第二次 200→requires_action/correction/passed 及 1440/390；该外部通过结果不与本机 skip 混记。
- 本轮使用准确自定义 Agent `luna-worker`，未使用 Terra；没有访问 Hifly、没有运行真实 Provider/Capture HTTP、没有运行批次、没有消耗飞影积分。

## VSA-A11 Manual ExecutionAttempt 与结果登记实现（Issue #67，PR #89 已合并，2026-08-09）

- 状态：A11 首轮 Review 的 Important 修复、TDD、静态检查、全量回归和 Sol 独立复审均已完成，结论 `APPROVED`，
  无剩余 Blocker/Important。A11 已通过 PR #89 合并，Issue #67 已关闭；`9af3f5e` 是当前 `origin/main`，也是 A12 分支基线。
- 已实现领取与确认开始两步命令；领取时绑定精确 `package_id`、`package_version`、`manifest_hash`、package 完整性摘要和 `executor_type=manual`。
  交接包生成/下载路径不创建 attempt；同订单 `claimed/running` 只有一个有效 attempt；包 revoked 后不能开始新的执行。
- 已实现候选产物受控上传授权、组织/attempt/package 完整性重验、checksum/大小/媒体类型校验、上传完成回调和 pending-verification 投影；不创建 A12 核验任务或 Work。
- 已收紧报告状态机：幂等回放先于状态门禁；首次报告只接受 `running`（取消只接受 `cancel_requested`）；已有报告必须 supersede 当前最新有效报告；终态、非最新 supersede、状态倒退和不可重试失败改写均受控拒绝。`completed_at`/`completedAt` 纳入受控报告 fingerprint，route 显式规范映射；memory/PG 共用同一服务合同。
- 候选视频新增有界 `manualExecution.maxCandidateBytes`（默认 256 MiB，上限 512 MiB），服务授权与 PUT route 均限流；A03 图片仍为原 20 MiB。未完成上传映射 422，超限映射 413。
- 同组织非 operator member 不能 start/upload/submit；现有合同下 admin 可做 upload/submit 监督操作但不能代替 operator start；跨组织继续 404 且不泄漏。
- production.html 按设计补齐包版本/完整性摘要、非默认 outcome、requires_action/failed/cancelled 约束、显式 deviation、重检查/取消 Dialog、失败可重试/不可重试重入与刷新恢复；A12 核验/Work、A13 作品库保持 gated；feature-off 旧 A10 占位保留。
- A11 service 定向：10 pass；API 定向：4 pass；A11 service/API/PG 合并：15 tests / 14 pass / 0 fail / 1 skipped；系统 Chrome browser：1 pass / 0 fail / 0 skip，覆盖 1440、390、刷新恢复、requires_action amber+恢复、failed retryability 和无横向滚动；`npm run check`：164 个 JavaScript 文件通过；`npm test`：772 tests / 732 pass / 0 fail / 40 skipped；`git diff --check` 通过。
- PostgreSQL clean migration/integration 因本机未设置 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 明确 skipped，未声称通过；待 CI PostgreSQL 验证。系统 Chrome 使用本地受控 fake 数据，不访问外部服务，未生成仓库截图。
- 本轮没有访问 Hifly、没有 Capture HTTP、没有运行真实批次、没有消耗飞影积分；配置模型为 `gpt-5.6-luna` / Max，配置状态 `CONFIG_VERIFIED`，运行时模型状态 `UNVERIFIED_RUNTIME_MODEL`。
- Sol 已独立复核 PostgreSQL 事务边界、A09 order transition 兼容性、候选上传重试/授权旋转、报告状态链、
  A11 feature gate 与生产页状态文案；系统 Chrome 真实复跑通过。实现 Agent 未自行批准或合并成果，PR #89 已由合并流程完成。

## VSA-A11-A13 页面设计完成（Issues #67-#69，2026-08-08）

- A10 已通过 PR #87 合并，Issue #66 已关闭；合并提交为 `0ca96009d94dd3d5e65f7b179366804246fe9bd6`。
- Kimi Code 已使用显式模型 `kimi-code/k3` 产出 `docs/frontend/VSA-A11-A13_UIUX_DESIGN.md`，唯一设计改动；
  配置证据为 `max_context_size=1048576`、`default_effort=max`、thinking enabled。CLI 未暴露实际服务端运行模型，
  因此运行时验证状态为 `UNVERIFIED_RUNTIME_MODEL`，配置状态为 `CONFIG_VERIFIED`。
- 主控独立复核未发现 DESIGN_BLOCKER：A11/A12 增量复用 `production.html`，A13 新建权威作品库
  `works.html`；报告完成、上传完成、核验通过、工单完成与交付登记保持独立业务事实。
- 本轮只生成设计文档，没有修改 `web/`、`src/`、`test/`、API、数据库或 migration；没有访问 Hifly、
  没有发送真实 Provider/Capture HTTP、没有运行批次、没有消耗积分。
- 设计 PR #88 已合并；A11 PR #89 已合并。继续使用准确自定义 Agent `luna-worker` 按 A12 → A13 顺序逐项实现、测试、
  独立 Review、CI 和合并；不自动回退 Terra，不开始 A14。

## VSA-A10 当前实现与独立验收（Issue #66，2026-08-08）

- 状态：本 worktree 的 A10 实现、Review 修复、定向测试和浏览器验收已完成；未 commit、push、创建 PR、合并或关闭 Issue。
- worktree：`/private/tmp/hifly-vsa-a10`；分支：`codex/vsa-a10-manual-handoff`；基线：`fd6a2062c2329e66617ee35e028cc1ae4ffce4f2`（A09 PR #86 已合并）。
- 已实现 ManualHandoffPackage、AsyncJob、memory/PostgreSQL repository、独立 migration/ledger、服务/API、Organization 隔离、权限、审计、短时下载授权、状态历史和默认关闭 feature flag。
- ZIP 固定包含权威 `manifest.json` 与由 manifest 派生的 `README.md`，只按 embedded 模式写入受控 assets；实现 `manual_handoff` / `1.0`、package/manifest/package hash、幂等、失败脱敏重试、superseded/expired/revoked 历史投影。
- README 的派生作业说明包含固定商品、完整批准文案、人物名称/来源/授权摘要、VideoPlan 输出说明，以及 manifest 中存在的预期行为、已知限制和人工确认点；不新增独立事实。
- 生成与下载不创建 ExecutionAttempt，也不改变 ProductionOrder 状态；下载授权不向 public JSON、日志或 manifest 暴露 token、签名 URL、永久路径。
- A09 创建 ProductionOrder 时新增深模块输入快照：冻结真实 A04 文案正文/版本/审核事实、A02 ProductRevision 产品事实与固定 AssetVersion 引用、A07 已选人物展示/来源/授权/能力事实；A10 仅按固定 asset version 读取字节。旧 order 缺少这些事实时以受控错误失败，不会生成空字段 ready 包。
- 补充真实 A04-A09 服务/API 链路到 A10 ZIP/manifest 集成测试；移除二进制图片正文的 URL/token 正则扫描，含普通 URL 元数据的合法图片可随包写入，敏感边界仍由受控 asset version、组织/权限/用途和 manifest 投影保证。
- 每个 embedded asset 入包前校验冻结 `size` 与实际 `Buffer.length`、冻结 `checksum` 与实际 SHA-256；错误字节、长度或 checksum 进入 `generation_failed`，不会写入 ready ZIP。相关测试 fixtures 使用真实一致的尺寸与 checksum。
- `/production.html/css/js` 右栏增量覆盖生成、刷新恢复、重试、下载、重新授权、内容摘要、历史和 A11 禁用说明；A09 feature-off 浏览器回归保持无 A10 按钮，390px 无横向滚动验收已实跑。
- 浏览器测试用受控 fake 实跑 generation_failed → 刷新恢复 → 重试 → ready → 下载，并覆盖 390px 无横向滚动与 A11 无可执行入口；不访问真实网络。
- 定向验证：ManualHandoff service 10 pass；API 3 pass；真实 A04-A09→A10 链路 1 pass；A10 系统 Chrome/Playwright 1 pass；A09 production-order 系统 Chrome/Playwright 回归 1 pass；`npm run check` 通过（159 个 JavaScript 文件）。
- 全量 `npm test`：755 tests / 717 pass / 0 fail / 38 environment skips。A10 PostgreSQL clean migration/integration 因未设置 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 明确 skipped，未声称通过。
- `git diff --check` 已通过；依赖仅新增成熟 server-side `archiver` 并更新 `package-lock.json`。
- 本轮未访问 Hifly、未发送真实 Provider/Capture HTTP、未运行批次、未消耗飞影积分。配置模型为 `gpt-5.6-luna` / Max，配置状态 `CONFIG_VERIFIED`；实际运行时模型无法从环境验证，标记 `UNVERIFIED_RUNTIME_MODEL`。

## VSA-A09 当前实现与独立验收（Issue #65，2026-08-08）

- A09 已在独立 worktree `/private/tmp/hifly-vsa-a09`、分支 `codex/vsa-a09-production-order` 从基准
  `1afac0b56b740d41cb9b0d5c0b1363b2f3e57a08` 实现，并已由 PR #86 合并；A10 当前 worktree 以合并提交
  `fd6a2062c2329e66617ee35e028cc1ae4ffce4f2` 为基线，根工作区未触碰。
- 已实现 ProductionOrder memory/PostgreSQL repository、独立 migration/ledger、服务端正式的当前有效已批准
  VideoPlan port、创建/列表/详情/工作区 API、组织隔离、成员权限、幂等回放/冲突、新意图新工单、输入快照、
  `draft → ready → waiting_for_executor` 状态链、同事务 AuditEvent/Outbox，以及 Local Agent 离线非阻断投影。
- `/production.html/css/js` 遵循 A09 三栏/390 单列设计；右栏仅保留真实「尚未生成交接包」占位，没有 A10 生成按钮或
  A11 领取入口。A08 `plan.html` 批准后在 productionOrders feature 开启时展示真实入口；默认 feature off 保持旧路径。
- Sol 首轮 Review 的 3 项修复已完成：outbox 允许唯一受控的 `published_at` 首次写入并保护其余字段；
  Video Planning 服务端按 feature/head/frozen/approved/preflight gate 投影生产可用性，API 与 `plan.js` 均消费该投影；
  A07 copy-quality 浏览器断言已更新为真实「进入人物与素材」链接并校验 href。
- targeted：ProductionOrder/Video Planning service/API 共 25 pass；PostgreSQL 迁移集成 1 skipped（未设置
  `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL`，未声称通过）；`npm run check` 通过（149 JS 文件）。
- `npm test`：739 tests / 703 pass / 0 fail / 36 skipped。Sol 已使用系统 Chrome 实跑 A09/A08/A07 targeted 3/3，
  并对 A09 1440px/390px 临时截图完成视觉验收；无横向滚动、文字遮挡、按钮溢出或状态语义误用。
- Sol 独立代码与视觉复审未发现剩余 Critical/Important。PostgreSQL 集成因本机没有测试数据库连接而 skipped，
  待 PR CI 数据库任务验证。
- Kimi 长期规则已记录：固定 `kimi-code/k3`、1M context（`max_context_size=1048576`）、thinking 显式 `max`；
  当前默认 `high` 不得误报，wire/session 无法验证时标 `UNVERIFIED_RUNTIME_MODEL`。
- 本轮未访问 Hifly、未发送真实 Provider 请求、未运行任何批次、未消耗飞影积分。

## Agent 路由迁移与 A09-A10 设计（2026-08-08）

- A08 已通过 PR #84 合并并关闭 Issue #64；Ubuntu、Windows、identity/PostgreSQL CI 全绿。
- Kimi Code 已使用 `kimi-code/k3` 完成 `docs/frontend/VSA-A09-A10_UIUX_DESIGN.md`；主控已复核并修正
  ProductionOrder 幂等边界与较早工单状态表达。只包含设计文档，不修改生产代码。
- Owner 已于 2026-08-08 明确恢复 Goal；当前从 main `1afac0b` 建立 A09 独立 worktree
  `/private/tmp/hifly-vsa-a09`、分支 `codex/vsa-a09-production-order`，准备实现 Issue #65。
- Owner 已纠正实现模型路由：后续边界明确的实现任务必须使用自定义 Agent `luna-worker`，配置为
  `~/.codex/agents/luna-worker.toml`、`gpt-5.6-luna`、Max；不再自动回退 Terra。
- 配置文件已核验，状态 `CONFIG_VERIFIED`。恢复后的当前会话已明确暴露
  `agent_type: "luna-worker"`；派发前运行时状态仍为 `UNVERIFIED_RUNTIME_MODEL`，派发后按工具可见证据更新。
- 当前无 Active Terra Agent。已完成的 Terra Review/修复结果全部保留并已进入 A07/A08 合并历史；
  Socrates 与 Tesla 的已完成会话已关闭，不删除其成果。
- A09 实现、Review 修复和独立验收已在上方独立 worktree 完成，等待 PR/CI；不得回退 Terra，也不要在本 worktree
  执行 A10/A11+。
- 本轮未访问 Hifly、未发送真实 Provider 请求、未运行 `MULTI-002`、未消耗积分。

## VSA-A08 当前本地实现（Issue #64）

- A07 已通过 PR #83 合并并关闭 Issue #63；A08 基于该 main 在 `/private/tmp/hifly-vsa-a08`、分支
  `codex/vsa-a08-video-plan` 完成本地实现、两轮独立 Review 修复与最终复审，尚未 commit、push、PR、CI 或合并。
- 已实现不可变 VideoPlanVersion（draft→frozen→superseded）、只读 ProductRevision/approved CopyVersion/
  confirmed AvatarSelection/实际 capability snapshot 引用；frozen 修改只能派生新 draft。
- PreflightRun 技术执行与 PreflightResult 业务结论完全分离；三组检查为 upstream_validity、
  plan_completeness、production_readiness。技术失败不产生 blocked 结论；执行环境离线只产生 amber warning，
  不阻止保存、预检、提交或批准审核。
- PlanReview 采用不可变审核记录 + 状态头 + 追加事件；passed/warning 不会自动 approved；同方案仅一个审核周期，
  changes_requested/revoked 后必须派生新方案，revoked 不恢复。审核决定支持相同命令安全回放，并始终返回
  当前服务端投影。读取/关键命令会重验上游与 capability/Evidence 快照，相关变化使预检 invalidated、
  批准 revoked；未进入权威快照的展示元数据不级联。
- memory/PostgreSQL repository、独立 migration、正式 API、异步 preflight worker 与 `/plan.html/css/js`
  已完成；A07 阶段 4 已变为真实链接；A09「创建生产工单」明确禁用且无假链接。
- 页面在草稿有未保存输入时禁用预检并提示先保存；切换商品、切换版本和刷新均通过保存/放弃/取消
  对话框保护本地输入。A07 仅在 runtime 明确启用 A08 时展示可点击视频方案入口。
- 当前自动验证：A08 service/API 定向 12 pass；PostgreSQL 16 clean migration/integration 1/1 实际通过；
  系统 Chrome 中 A07 回归与 A08 1440/390 页面合同 2/2 实际通过；全量 724 tests / 690 pass /
  0 fail / 34 environment skips；`npm run check` 142 文件通过。全量命令中的浏览器/数据库用例仍按
  环境条件 skip，但已分别在可用环境定向实跑通过。
- 最终独立 Reviewer 结论为 **`APPROVED`**，无剩余 Critical/Important。首轮发现的审核决定回放、
  capability/Evidence 失效传播、未保存输入保护与 feature flag 入口问题均已按 TDD 修复；初始 DOM
  在 runtime 返回前也不会暴露 A08 链接。
- 本轮未访问 Hifly、未调用真实 Provider/外部生产、未运行 `MULTI-002`、未消耗积分。

## VSA-A07 已合并快照（Issue #63）

- A06 已通过 PR #81 合并并关闭 Issue #62；A07/A08 Kimi 设计已通过 PR #82 合并；A07 已通过
  PR #83 合并并关闭 Issue #63。
- 已交付 existing-only 公共/企业目录；Phase 1 受控预置显式标记；不连接真实 Hifly、不提供人物/
  声音/背景创建、不宣称推荐。未知能力不投影 supported，只有带 Evidence 的 verified capability 展示。
- AvatarAsset、AvatarAssetVersion、AvatarVerifiedCapability、AvatarSelection 已有正式 memory/PostgreSQL
  repository 与独立 migration；选择事实/事件历史保留，状态为 draft→confirmed→superseded。
- member/admin 可浏览和显式确认；A06 current effective approved copy、资产、授权/有效期、Evidence、
  Organization 范围与素材访问由服务端确认 gate 权威重验。expired/incomplete/unknown/cross-org 均阻断。
- 相同 key+payload 回放、冲突 payload 拒绝；商品级 `selection_revision` 防静默覆盖。更换创建新选择，
  旧选择 superseded retained。上游批准后续失效通过读取/下游 gate 动态投影 current_valid=false，历史不改写。
- 独立 Reviewer 首轮两项 Important 已按 TDD 最小修复：receipt 重放返回完整首次业务结果，不再把旧选择/
  revision 与最新 history 拼接；workspace 在 copy query 缺省时按 product 解析 current effective approved copy，
  返回 resolved id，前端商品切换后恢复 URL/状态并可继续确认。最终独立复审 `APPROVED`，无剩余
  Critical/Important。
- 正式 API 与 `/avatar.html/css/js` 已完成；桌面 288/弹性/384 三栏、390 单栏/目录 Dialog、门禁、
  禁用原因、确认/更换 Dialog 与历史；`copy.html` 阶段 3 为真实链接；A08 保持禁用且无假页面。
- Reviewer 前 service/API 实际为 11 pass；修复回归加入后为 14 pass。PostgreSQL 16 clean integration
  1/1 实际通过；全量 710 tests / 678 pass / 0 fail / 32 environment skips；`npm run check` 133 files；
  `git diff --check` 通过。
- 主控使用系统 Chrome 实跑 browser flow 1/1，覆盖 1440/390、确认/更换/刷新/历史、未知能力、
  商品切换恢复对应批准文案、无横向溢出及 A08 禁用边界。
- 本轮未访问 Hifly、未发送真实业务 HTTP、未调用真实 Provider、未运行 `MULTI-002`、未消耗积分。

## VSA-A06 已合并快照（Issue #62）

- PR #81 已合并，Issue #62 已关闭，合并提交 `517654c`。
- 已交付独立 HumanReview、不可变审核周期、append-only transition/event、memory/PostgreSQL、正式 API、
  审计、主动/读取失效协调与 current effective approved-copy gate；最终独立 Review 为 `APPROVED`。
- 系统 Chrome 1440/390 与 PostgreSQL 16 clean integration 均实际通过；详细证据见
  `docs/status/sessions/2026-08-07-vsa-a06-copy-review.md`。该轮未访问 Hifly、未消耗积分。

## VSA-A05 已合并快照（Issue #61）

- A04 已通过 PR #79 合并，Issue #60 已关闭；A05 后续通过 PR #80 合并，Issue #61 已关闭。
- A05 已实现服务端权威 QC policy、current/ready ProductRevision 门禁、异步 QualityRun、不可变
  QualityResult/QualityFinding、D-028 Finding 结构字段、逐条 Resolution，以及持久化 RewriteJob
  驱动的新版本与自动完整 QC。
- memory/PostgreSQL repository、独立 migration、正式 API 与 `/copy.html` 质检右栏均已完成；
  A06 审核操作未提前实现，passed 明确不等于 approved。
- Terra/High 最终复审追加四项 Important。实现者已按 TDD 完成 current ProductRevision 正式门禁、
  已完成 Result 的当前有效性投影、Finding 完整性校验及 AI 改写 Dialog 双击幂等；复审结论为
  **`APPROVED`**，无剩余 Critical/Important。
- D-025 policy/事实漂移均不会改写历史 Result：API 动态投影 `current_valid` 与受控失效原因，UI 以
  amber 阻断；失效 Finding 只读展示且不再提供处理动作。child draft 成为 current 后，旧 ready
  revision 在 freeze 前即被拒绝。
- Rewrite worker 在 Provider 调用前后均复核 current revision；运行期间事实变化不会遗留 stale
  CopyVersion，Job 以稳定 stale 错误失败。
- 当前全量无积分自验：673 tests / 644 pass / 0 fail / 29 environment skips；`npm run check`
  119 文件。系统 Chrome 1440/390 流程 1/1、PostgreSQL 16 clean migration/integration 1/1；
  最终截图在仓库外 `/private/tmp/hifly-a05-final-visual-qa/`。
- PR #80 已合并到 `main`，提交为 `0a1fa9c`。该轮未访问 Hifly、未执行真实外部生成、未消耗积分。

## VSA-A04 已合并快照（Issue #60）

- Kimi Code 已使用 `kimi-code/k3` 完成 A04-A06 页面级设计，批准文档为
  `docs/frontend/VSA-A04-A06_UIUX_DESIGN.md`；未发现 `DESIGN_BLOCKER`。
- A04 已在独立分支 `codex/vsa-a04-copy-generation` 实现 Provider-neutral 异步文案生成、
  CopyVersion 历史、幂等、安全重试、租约恢复、冻结后派生、组织隔离、PostgreSQL migration、
  正式 API 与独立 `/copy.html` 工作区。
- A05 QC 与 A06 人工审核没有提前实现；Phase 1 受控生成器不是真实模型或飞影接入。
- 真实系统 Chrome 已通过生成失败/重试、离开后恢复、冻结历史、派生新草稿、409 冲突恢复和
  390px 无横向溢出流程。桌面与移动截图保存在仓库外 `/private/tmp/hifly-a04-visual-qa/`。
- 最终验证：全量 641 tests / 614 pass / 0 fail / 27 environment skips；系统 Chrome A04 1/1；
  PostgreSQL 16 clean migration 1/1；`npm run check` 108 文件；`git diff --check` 通过。
- 独立 Reviewer 首轮发现 390px 失败态缺少重试入口；已补移动版本抽屉重试并将真实浏览器流程改为
  移动端失败后完成重试，复审结论 `APPROVED`，无剩余 Blocker/Important。
- PR #79 已合并，Issue #60 已关闭；合并提交为 `2484197`。
- 本轮未访问 Hifly、未执行真实外部生成、未消耗积分。

## Kimi K3 前端视觉升级策划（2026-08-06）

- 已建立独立规划文件 `docs/frontend/KIMI_K3_FRONTEND_VISUAL_UPGRADE_PLAN.md`，采用 Stage 0 方向确认、Stage 1 基础层、Stage 2 随 VSA 增量落地、Stage 3 全链路收尾的节奏。
- 已建立 Claude 对接提示词 `docs/prompts/CLAUDE_KIMI_K3_FRONTEND_HANDOFF.md`；Claude 只协调 Stage 0 与业务复核，Kimi K3 只负责设计，Owner 批准 Stage 1 后由 Codex 实施代码、测试和 Git 交付。
- Kimi Code `0.33.0` 已通过 `kimi-code/k3` 完成 Stage 0 真实审计；完整结果存入 `docs/frontend/KIMI_K3_STAGE0_VISUAL_AUDIT.md`。
- Owner 已批准“冷中性灰 + 品牌蓝 `#1769e0`”方向，并要求动效简约、高级、丝滑；动效只服务保存、上传、状态切换、抽屉和对话框等真实反馈。
- Owner 已授权单独建立 Stage 1 Frontend Foundation Issue；后续由 Codex 实施、测试，并交给独立 Reviewer 审查。
- 未实现的首页、生产任务、作品库不得进入代码导航；遗留 `index.html` 继续作为运维兜底页，不作为企业一级导航。
- 本轮未访问 Hifly、未发送真实外部 HTTP、未消耗积分。

## Frontend Foundation Stage 1（Issue #77）

- 状态：Codex 已完成本地实现、视觉验收与独立 Review；Review 结论 `APPROVED`，无剩余 blocker/important；ready PR #78 已创建。
- 分支/worktree：`codex/frontend-foundation-stage1` / `/private/tmp/hifly-frontend-foundation-stage1`。
- 已覆盖登录、项目、商品快照、素材中心、成员管理；共享导航只含已实现入口，遗留 `index.html` 未改。
- 验证：628 tests / 624 pass / 0 fail / 4 environment skips；桌面与 390px 截图位于仓库外 `/private/tmp/hifly-stage1-visual-qa/`。
- 下一步：等待 PR #78 CI 与 Owner 合并授权；未经 Owner 单独授权不合并、不关闭 Issue #77。
- 本轮未访问 Hifly、未运行真实生成、未消耗积分。

## VSA-A02 已合并快照

- Issue #58 已完成并关闭；PR #74 已在最终 diff 审查和三组 CI 全绿后合并，`main` 提交为 `5e8b28a`。
- 已交付 Project/Product/ProductRevision memory/PostgreSQL 持久化、独立 `project_content_schema_migrations`、service/API、最小 UI、审计、幂等、乐观并发与下游 ready snapshot port。
- ready 只通过 A03 `assetReferencePort` 绑定 available 商品图片，并复用同一 transaction client；PostgreSQL 16 rollback 测试通过。
- 系统 Chrome 已完成创建项目、创建商品、保存卖点、逐条确认、选择图片、Ready、刷新恢复与重复 Ready 禁用流程。
- 默认 feature disabled，旧 Playwright workbench 回归通过；完整套件 627 tests / 603 passed / 24 environment-conditional skips / 0 failed，A02 PostgreSQL 16 与系统 Chrome 定向测试另行实际通过且无 skip。
- 独立 Reviewer 首轮发现相同 Ready 快照会派生重复 child revision；TDD 修复后复审 `APPROVED`，无 Blocker/Important。
- PR #74 最终分支 CI run `31083604483` 与合并后 `main` CI run `31084194959` 均通过 Ubuntu、Windows、identity/PostgreSQL 三项检查。
- 未访问 Hifly、未发送真实外部 HTTP、未消耗积分。
- 详细证据见 `docs/status/sessions/2026-08-06-vsa-a02-project-content.md` 和 `docs/project-content/VSA-A02.md`。

## VSA-A03 已合并快照

- Issue #59 已完成并关闭；PR #73 已在 CI 全绿后以仓库允许的 squash 方式合并，`main` 提交为 `78a8fc3`。
- A03 使用独立 `asset_schema_migrations`，与 A01 共用 PostgreSQL 连接但不进入 identity migration ledger。
- 已交付资产 API、核验状态机、可恢复 verification job、生产 PostgreSQL/memory repositories、
  local development ObjectStore、素材中心 UI 和唯一 A02 `assetReferencePort`。
- PostgreSQL 16 clean migration/integration 已通过；未访问飞影、未消耗积分、未宣称 COS 已接入。
- 详细证据见 `docs/status/sessions/2026-08-06-vsa-a03-assets.md` 和 `docs/assets/VSA-A03.md`。

## 当前开发

- VSA-A01 / Issue #57 已完成，PR #71 已合并，Issue #57 已关闭。
- 合并提交：`82d1c9f5075098559306f4a72eebbeaa79ed1959`。
- A01 独立 Review 结论为 `APPROVED`；最终 CI run `31072997173` 的 Ubuntu、Windows、PostgreSQL identity 三项均通过。
- A01 已实现 PostgreSQL 权威身份库、工作邮箱登录、首次强制改密、单 Organization 上下文、退出、disabled 每请求失效，以及管理员成员管理。
- A02 / Issue #58 与 A03 / Issue #59 均已合并并关闭；A02 ready 通过唯一 `assetReferencePort` 绑定 available AssetVersion，Wave 2 已完成。
- A02 实施 Agent 使用 GPT-5.6 Sol / Medium；独立 Reviewer 使用 GPT-5.6 Terra / High。

## 当前治理

- 产品定位、D-025～D-030、A01～A14 边界和 Issues 已存在，不重复规划或创建。
- `GOAL.md` 是 Goal 级快照；`docs/agent-collaboration.md` 记录角色、权限、交接和 Review。
- 当前新增功能主线是 Slice A；旧 GUI/Playwright 是兼容基线和运维兜底。
- 工程审查遵守“真实核心风险优先、禁止过度防御、Rubric 不机械化”。
- 治理文档 PR #72 已合并。

## 当前生产路径与积分

- 默认历史批量生产路径：Playwright 浏览器自动化。
- Capture HTTP：默认关闭，仅作为实验/恢复能力。
- 当前没有真实飞影执行授权，不得执行 `MULTI-002`。
- 本轮治理和 VSA-A01 开发均未访问飞影、未消耗积分。

## 关键历史批次

| 批次 ID | 状态 | 说明 |
|---|---|---|
| `batch-ec174f28-e9b8-4541-b2e7-c60b10e22474` | `real_batch_completed` | MULTI-001 完成；MULTI-002 pending |
| `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` | 混合态 | 历史 GUI 排障样本，不重跑 |

## 已知问题与风险

1. Issue #37 的 Windows capture `interrupted_unknown` 具体写入者仍未定位；与 Slice A 独立。
2. Q-018 仍为 Pending Evidence / Open；HIFLY-001 与 SPK-018 未执行，不阻塞 Slice A 人工闭环。
3. A01 登录限流当前为单进程最小实现，多实例生产前需共享网关或数据库策略。
4. 仓库依赖审计存在既有告警，跨主版本修复需独立回归，不搭车进入后续 Slice。

## 下一步

1. 主控对 A10 worktree 做独立 Review，随后自行 commit、push、创建 PR 并等待 CI；实现者不批准或合并自己的 PR。
2. PostgreSQL clean migration/integration 在带测试数据库的 CI 或受控环境执行；本地缺少连接时保持明确 skip。
3. A10 合并后再按既有边界进入 A11-A13 设计与实现；本 worktree 不实现 A11+。
