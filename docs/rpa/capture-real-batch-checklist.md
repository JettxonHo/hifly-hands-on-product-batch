# 抓包 HTTP 真实小批量授权验证 Checklist

> 本 checklist 仅用于「已获得用户当次明确授权、可能消耗飞影积分」的真实 HTTP 小批量联调。
> 默认批量生产仍是 Playwright；未授权前不要执行任何真实请求。real_batch 默认禁用（`rpa.realLive.batch.enabled=false`）。

## 前置门槛（全部必须满足，缺一不可）

1. 已获得用户当前会话的明确授权，并确认可能消耗飞影积分。
2. 配置开启 `rpa.realLive.batch.enabled = true`，并设定 `maxItems`（默认硬上限 3）。
3. fake transport 测试全绿：
   ```bash
   node --test test/server-capture-api.test.js   # 含 real-batch success / stop-on-failure / auth-expired / download-missing / budget / resume / idempotency
   npm run check
   ```
4. 批次已脱敏、离线回放通过、`real_dry_run`（真实请求预演）通过，即 `capture.status = dry_run_passed`（或 `real_batch_failed` 续跑）。
5. Playwright 登录态有效（`npm run login`），runtime auth provider 能读到 cookie + bearer。

## 第一次：只跑 1 条（pointBudget = 1）

- 选一个单商品 capture 批次，pointBudget = 1。
- 记录：batch id、SKU、output_path、remote_id、是否消耗积分（以飞影后台为准）、失败阶段与错误码。
- 停机条件（任一即停，不要盲目重试）：
  - `CAPTURE_HTTP_REMOTE_REJECTED`：登录态失效或飞影业务拒绝。
  - `CAPTURE_HTTP_ARTIFACT_MISSING`：下载阶段未拿到视频 bytes。
  - `CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT`：幂等保护触发（该条已有 remote_id 但无 artifact），不要重提。

## 第二次：最多 3 条（仅当 1 条成功）

- 同一批次或新批次，pointBudget ≤ maxItems（默认 3）。
- 逐条记录每条的 remote_id、output_path、积分消耗。
- 任一条失败即停（stop-on-first-failure）；失败条目可用 `resume: true` 续跑，但已有 remote_id 的条目不会重提（幂等防重复扣分）。

## 禁止

- 未授权跑真实小批量。
- 超过 maxItems，或一次提交超过 pointBudget 的条目数。
- 对已有 remote_id 的条目强制重提（会重复扣分，已被幂等保护拦截为 `CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT`）。
- 把 runtime cookie / bearer / CDN 或签名 URL 写入批次、RPA state、manifest、日志或截图。

## 失败记录模板

```
batch_id:
sku:
capture.status:
remote_id:（如有）
output_path:（如有）
error_phase: capture_http_real_batch
last_error.code:
是否消耗积分（飞影后台）:
```
