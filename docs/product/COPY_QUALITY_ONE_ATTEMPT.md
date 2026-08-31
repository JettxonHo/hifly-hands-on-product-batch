# Copy Quality One-Attempt Contract (Issue #273)

> 状态：bounded engineering candidate；真实 Provider 运行仍需新的 Owner Authorization
> 适用：正式 Copy Quality path 的 provider-at-most-once execution contract
> 关联：RBV-GOAL-001、D-037、`REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`

本文件只固化 Issue #273 的最小产品/执行边界，不代表 DeepSeek 已调用、QualityRun 已在生产环境执行，或 RBV/MBL 已完成。

## 1. Logical Run and policy

新 QualityRun 默认使用 `attempt_policy=provider_at_most_once_v1` 与 `max_attempts=1`。一个 CopyVersion 只能存在一个 strict run；同一授权 receipt 重放、不同 start key 或 retry endpoint 都不能创建第二个 strict logical run。历史数据库行迁移后显式标记为 `legacy`，未观测到的 dispatch/HTTP count 保持 `NULL`/UNKNOWN，不得把历史运行补写成数字 0 或严格一次；迁移会将遗留 queued/running 行 fail-closed 终止，避免新 Worker reclaim 它们。

Rewrite job 的 `max_attempts=3` 与 QualityRun policy 分离；这条 bounded contract 不改变 Rewrite Provider 的既有边界。

## 2. Durable provider state

QualityRun 持久化 Provider identity/model、dispatch permit 与真实 HTTP invocation 的分离事实：

- `provider_dispatch_count`：事务提交的 Provider dispatch permit，最多 `1`；
- `provider_http_request_count`：客户端 HTTP invocation marker，最多 `1` 且不得超过 dispatch count；
- `provider_request_state`：`not_started → reserved → started → response_received/terminal/unknown`；
- request lifecycle timestamps、stable outcome、usage/token、charge/currency 与 local-cost 状态。

执行顺序固定为：

```text
RUN_CREATED
  → DISPATCH_RESERVED (dispatch=1, http=0)
  → HTTP_REQUEST_STARTED (dispatch=1, http=1)
  → RESPONSE_RECEIVED
  → QUALITY_RESULT or TERMINAL_FAILURE
```

`DISPATCH_RESERVED` 在调用 Provider 前独立提交；`HTTP_REQUEST_STARTED` 在调用客户端前独立提交。数据库约束保证 `0 ≤ provider_http_request_count ≤ provider_dispatch_count ≤ 1`。重复 Worker 没有第二个 permit；任何 late/stale worker 不能覆盖已终止的事实。

## 3. Unknown and fail-closed semantics

当前 transport 无法证明“肯定未发送”时，一律按 possibly-sent 处理：不自动重试，usage 与 charge 持久化为 `unknown`。Provider response malformed JSON、schema mismatch、semantic validation、HTTP error、timeout、network error、进程崩溃和 lease expiration 都只能形成一次 invocation，并进入可审计终态。

若 Worker 在 dispatch reservation 后、HTTP marker 前崩溃，run 终止为 `not_dispatched`，不能获得替代 permit；若 HTTP marker 已提交而结果/费用不确定，run 终止为 `unknown`，不能 reclaim 或 resume。Unknown 不等于安全重试。

Provider 未返回 token 或 charge 字段时，token 列保持 `NULL` 并由 `provider_usage_status=unknown` 表示；charge 使用 `provider_charge_status=unknown` 与 nullable amount/currency。没有可靠价格表时 local cost 保持 `not_calculated`；不调用 billing API，不把缺失值写成 0。

## 4. Copy lifecycle boundary

Quality 评估需要稳定的待评字节，因此允许 `CopyVersion draft → frozen`。Quality start 通过 additive `supersedeParent=false` 调用 freeze seam；它不得把 parent Copy v1 从 `frozen` 改为 `superseded`，也不得改变 parent body 或 row version。旧的显式 freeze/promotion 命令保留既有 parent transition 行为；本 Stage 不重新设计 promotion 模型。

Quality result、Human Review、Rewrite、Avatar、VideoPlan、ProductionOrder 和 Attempt 仍是独立阶段，不由本 contract 自动创建或激活。

## 5. Retry and API projection

`POST /api/quality-runs/:id/retry` 对 strict run 返回 `QUALITY_ONE_ATTEMPT_RETRY_BLOCKED`。Public QualityRun projection 仅暴露脱敏 Provider facts、counts、states、usage/charge statuses 和 stable failure code；不暴露 key、cookie、raw prompt、raw response 或永久 URL。Operator workspace 与 Copy 页面在 strict failure/unknown 后显示 Owner-gated stop，隐藏 retry/start action。

## 6. Validation and gate

A–J 由 fake/stub/fault-injection 覆盖：success、malformed/schema/semantic failure、timeout/network ambiguity、crash before/after dispatch, lease/reclaim, duplicate workers, logical-run uniqueness 与 parent-preserving lifecycle。Provider-free tests 只能证明工程 contract，不是 Real Batch business evidence。

完成本 Stage 后必须停止在：

```text
NEXT_GATE: OWNER_AUTHORIZATION_REQUIRED_FOR_SINGLE_REAL_COPY_V2_QUALITY_EVALUATION
```

真实 DeepSeek 请求、成本/积分、生产部署、下游视频链路和 RBV Calibration 仍需独立授权与相应门禁。
