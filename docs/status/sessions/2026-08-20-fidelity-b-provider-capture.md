# Fidelity-B Provider capture 实现会话

> 日期：2026-08-20
> 基线：`origin/main@153c249c7da41e9e47982ceaa9c87cbc21227f4a`
> 跟踪：Issue #214
> 生命周期：本实现只有随对应 PR 合并进入 `main` 才计为 repository implemented；本记录不表示部署或真实 Provider 验收

## 目标与边界

本会话实现 Fidelity-A 已接受合同中的 Fidelity-B：在 `ProductionOrder` 之前，以独立、短生命周期、默认关闭的
capture request 保存精确源图与上游绑定，把经校验的候选 bytes 原子写入内部 AssetVersion，并形成不可变 Candidate、
可变 CandidateState 与 append-only ProviderReferenceObservation。

本会话没有访问 `hifly.cc`，没有使用真实 Provider、Cookie、Token 或浏览器 Profile，没有启动 Cloud Executor / Local
Agent，没有创建生产工单、修改生产数据、生成候选或视频、消耗积分、SSH 或部署。Fidelity-C 自动检查/人工审核、
Fidelity-D Production create/eligible/claim/handoff 和 Fidelity-E 真实验收均未开始。

## Agent 路由

- 逻辑角色：`IMPLEMENTER`
- 自定义 Agent：`luna-worker`
- 配置文件：`~/.codex/agents/luna-worker.toml`
- 配置模型：`gpt-5.6-luna`
- 配置推理强度：`max`
- 运行时模型：当前环境未提供可独立核验的运行时标识
- 验证状态：`CONFIG_VERIFIED / UNVERIFIED_RUNTIME_MODEL`
- 未使用 Terra 回退；完成或无产出的子任务均已及时关闭。

## Product/API/Provider gate

只读审计确认：

1. 现有 ProductRevision、Copy review、AvatarSelection、VideoPlan review/preflight 与 AssetVersion seam 能提供当前上游和
   精确 `source_asset_version_id`；不需要修改这些领域状态。
2. 现有 Asset service 已提供组织作用域、受控对象存储、服务端 media/size/SHA-256 核验和短时下载授权，可扩展一个
   默认不进入通用 `/api/assets` 列表的内部 `appearance_candidate_image` kind。
3. Fidelity-0 只证明同一受控 Profile 的即时恢复，没有证明长期/跨设备引用有效期或 claim-side 无副作用再观察。
   因此本实现不发明正 TTL，初始 Observation 固定 `valid_until=observed_at`，只能证明同一 capture gate 的瞬时状态。
4. 真实 Provider Adapter 不在本轮能力范围。Adapter 采用依赖注入，默认实现 disabled/fail-closed；测试只用不触网 fake。
5. Fidelity-C workspace/check/review 与 Fidelity-D Production 接入不是本轮端点，不提前实现。

## TDD 纵向证据

### 1. Capture request 与精确源图

RED：service/memory seam 缺少 capture request、当前上游冻结、精确 source AssetVersion 读取和 active request 唯一性。

GREEN：

- 创建 request 只保存 exact current ProductRevision、approved Copy/review、confirmed AvatarSelection、
  frozen/approved VideoPlan/review/preflight、`presentation_size_code` 与唯一 `source_asset_version_id`；不调用 Adapter。
- source 必须同组织、父 Asset `active + product_image`、AssetVersion `available`，并从受控存储复核 bytes/media/size/SHA-256。
- `Idempotency-Key` 按 organization + actor 隔离；相同 payload replay，不同 payload 409。
- 同 organization/upstream fingerprint 最多一个 `awaiting_authorization|queued|running` request。

### 2. 授权、取消与短任务

RED：缺少 admin authorize、一次上限、expected revision、creator/admin cancel 与 terminal no-retry 合同。

GREEN：

- authorize 仅 admin，必须 `expected_revision` 和 actor-scoped `Idempotency-Key`，且
  `max_candidate_generations` 严格等于 1。
- creator 或 admin 只能取消 `awaiting_authorization|queued`；`running|succeeded|failed|cancelled` 不可取消或恢复。
- system actor 串行 claim；Worker 默认 stopped，首个失败后 halted，不自动 retry/resume，也不领取下一项。

### 3. 不可信 Provider 输出与原子完成

RED：缺少候选 response binding、文件真实性、受控对象键，以及 Candidate/Asset/request 的统一事务边界。初始实现还曾在
Candidate completion 失败后留下已登记的候选 Asset/Version。

GREEN：

- 每个授权 request 最多调用一次 injected Adapter generation；request/source/generation context/reference 必须精确绑定。
- 当前受证据支持的 Hifly private reference 只接受受控 `generation_id`；包含 URL、Token、Cookie、Profile path 或额外
  Provider 对象字段的 reference 在持久化前失败关闭。
- 候选只允许 PNG/JPEG/WebP，限制 10 MiB，校验 magic bytes 与声明 media，服务端计算 size/SHA-256，忽略第三方文件名，
  使用组织与 candidate ID 生成受控对象键。
- 候选 AssetVersion verified 后，Candidate、CandidateState、Provider Observation、request succeeded、事件与审计在同一
  PostgreSQL transaction 完成；任一步失败回滚 DB 行并删除暂存对象。
- Candidate 与 Observation append-only；CandidateState 以 row version 和固定优先级禁止状态回退；unknown/transient read
  不持久改写为 available/unavailable。

### 4. 组织作用域 REST 与下载

RED：Fidelity-B accepted endpoints 不存在；候选列表最初也没有执行 opaque pagination。

GREEN：

- 实现 capture request create/exact/list、authorize、cancel，以及 candidate exact/list/download authorization。
- 列表限制 1..100，cursor 为不透明、类型绑定的 base64url envelope；错误 cursor fail-visible。
- 复用现有 identity/CSRF/session guard；cross-org/invisible/missing 由组织作用域查询统一为 404，不接收客户端
  organization ID。
- 公共投影不返回 object key、reference fingerprint、Provider URL/reference、method 内情、Cookie、Token、Profile path、
  第三方正文或 stack。
- 下载授权绑定 exact organization + candidate + AssetVersion，返回服务端 filename/media/size/checksum；下载响应使用安全
  `Content-Disposition` 和真实 bytes。

### 5. PostgreSQL 真值

RED：PostgreSQL repository/migration 不存在，无法证明并发 claim、原子候选完成、组织隔离和 append-only 约束。

GREEN：在一次性 PostgreSQL 16 容器中验证：

- Identity 与 Asset 旧数据先存在，再执行 Fidelity-B migration；重复执行不重复版本且旧 product image 保持可读；
- 参数化查询、organization scope、actor-scoped receipts、active upstream 唯一索引、optimistic revision；
- 全局串行 claim 使用 advisory transaction lock + `FOR UPDATE SKIP LOCKED`，两次并发 run 只调用一次 fake Adapter；
- Candidate/State/Observation/内部 Asset/request/events/audit 原子提交；强制失败后 Candidate 和新增 Asset 行均回滚，request
  保持 running；
- Candidate、Observation、events、audit、receipts append-only，terminal request 与 CandidateState 不可回退；
- migration 没有 destructive backfill 或 down migration；生产回滚仍由部署前数据库备份与旧 App 镜像 gate 管理。

### 6. 独立审阅后的必需纠偏

PR #215 第一轮独立审阅在 fixed head `41dc4bd97a259342eb97eb3c2bee46dc8bea2d14` 发现四项 P1。修复保持
Fidelity-B 边界，没有新增真实 Provider、Production 或 UI 能力：

- 默认 `buildApp` 装配现在以 Asset service 的真实 `sourceProductImagePort` 直接接收 Fidelity service 的
  `sourceAssetVersionId`；真实 memory Asset upload/verification + 默认 App 接线回归证明 request 进入
  `awaiting_authorization`，Provider generation/observation 均为 0 次。PostgreSQL 测试不再依赖专用参数 remap。
- Provider 回传的 `observed_at/valid_until` 仍按不可信输入校验；未来时间或非零窗口失败关闭。持久化 observation 绑定
  服务端同一 gate 的可信时间，并继续令 `valid_until=observed_at`，没有产生正 TTL。
- 内部 `appearance_candidate_image` 只能经 Fidelity 专用 Asset port 使用。通用 Assets 的列表、精确 AssetVersion 读取、
  重命名、禁用、删除与下载授权均失败关闭；内部候选下载仍以 exact candidate + organization + AssetVersion 绑定。
- memory repository 与 PostgreSQL 对齐：create/authorize/cancel 均追加 event/audit，Candidate exact read 取最新 append-only
  observation；memory repository 也提供与 App 装配一致的 initialize/close 生命周期接口。
- PostgreSQL capture request trigger 收紧冻结证据、请求/授权身份、一次生成上限和 terminal truth；direct SQL 回归覆盖
  active request 改源图/上游快照，以及 succeeded 同状态改证据、失败码或候选绑定均被拒绝，同时正常
  authorize/claim/complete/fail 路径保持可用。

## 配置与兼容边界

- `APPEARANCE_FIDELITY_ENABLED` 默认 `false`。
- 默认 Adapter 是 disabled/fail-closed；生产配置不提供真实 Hifly Adapter，也不自动启动 Fidelity Worker。
- 内部 `appearance_candidate_image` 不进入现有三类 Assets 业务列表，不能经通用素材上传或通用下载 API访问。
- 现有 auth、CSRF、CSP、CORS、角色、Production、ManualHandoff、Cloud Executor 与 Local Agent 合同未放宽。
- production migrations 以 additive step 加入，PostgreSQL CI 串行执行真实 Fidelity-B integration。

## 验证

开发中已完成：

- service/API/assets 与默认 App 装配聚焦矩阵：57/57；
- production config/deployment 受影响矩阵：21/21；
- PostgreSQL 16 integration：1/1，临时容器已删除；
- `npm run check`：237 个 JavaScript 文件通过；
- `git diff --check`：通过；
- default `npm test` 本地复跑已输出 613 个通过后停留在既有
  `operator-workbench-v2-assets-browser.test.js` 子进程约 9 分钟且无新增 TAP 输出，因此人工终止，不能记为本地通过；
  最终全量结论须以 fixed-head GitHub CI 为准。审阅前 fixed head 的 CI 曾完成默认全量，本次修复没有改动该浏览器 seam；
- `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high`：0 high / 0 critical / 2 moderate。
  两项 moderate 均来自 ExcelJS 间接依赖 uuid；npm 只建议 breaking 的 ExcelJS 3.4.0 回退，本轮没有执行
  `audit fix --force`，依赖也不在 Fidelity-B allowlist。
- strict allowlist 最终为 24 个文件；独立审阅纠偏只新增 `test/assets-api.test.js`，用于证明内部候选在公共
  Assets HTTP API 的读取、改名、停用、删除与下载授权边界均失败关闭。
- GitHub CI run `32335264379` 在代码 head `c1be30c25750d0aa48ede591b4a95946292f421e` 上：Windows 与
  identity-postgres 首次通过；Ubuntu 首次唯一失败是既有 Cloud Executor deployment test 偶发多记录一次
  `xdpyinfo` 探测，其余 1069 项没有失败。未改代码、同 head 重跑 Ubuntu 后通过，run 最终三组均为 SUCCESS。

最终 doc-only evidence head 仍须通过 GitHub CI。绿色 CI 只是仓库证据，不是主控批准、部署或 Provider 验收。

## 后续停止条件

1. 对应 PR 未合并前，Fidelity-B 不计 repository implemented。
2. 不开始 Fidelity-C，直到 #214 独立 Review/merge 后另行派发。
3. 真实 Hifly capture/observe、正 TTL、跨节点恢复或 claim-side 无副作用再观察需要新的 Provider Evidence；不能用 fake、
   `gen_id`、旧 `observed_at` 或本次 same-gate Observation 替代。
4. Fidelity-D 必须在 Observation 有效期与 claim-side 再观察证据不足时停止；不得接 Production create/eligible/claim。
5. 任何真实候选或视频动作仍需当次明确单条积分授权。
