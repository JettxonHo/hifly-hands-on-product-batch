# Issue #275 VideoPlan Create Idempotency-Key Seam

> 日期：2026-09-01
> 角色：IMPLEMENTER（自定义 Agent `luna-worker`；配置 `gpt-5.6-luna` / Max，`CONFIG_VERIFIED`；运行时模型元数据 `UNVERIFIED_RUNTIME_MODEL`）
> Goal：`RBV-GOAL-001`
> 当前 Stage：Issue #275 VideoPlan Create Idempotency-Key Seam
> 分支：`codex/videoplan-precommitted-idempotency-seam`
> 基准：`69558fdb38e83eadee6e3ab187ba09cc6da22300`
> 真实 Provider/Hifly/积分：未调用，积分消耗 `0`

## Scope and result

本轮只实现两个 VideoPlan Create UI 的可选、可审计 Idempotency-Key seam，未修改服务端 API、数据库或其他生产命令：

- 新增 `web/video-plan-create-idempotency.js`。`undefined`、`null`、exact empty string 使用 `crypto.randomUUID()`；供给或生成的 key 必须是非空字符串、长度 `<=128`，并经运行时 `Headers` round-trip 后逐字节相同才原样返回，不 trim、不 hash；leading/trailing OWS、header-invalid controls、超长或非字符串同步抛出 `VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID`。
- `web/plan.html` 与 `web/workspace.html` 的创建表单均展示 `创建请求标识（可选）`，`maxlength=128`、`autocomplete=off`、`autocapitalize=off`、`spellcheck=false`，并说明留空自动生成；结果不明确时保留该标识并先只读核对结果，未经授权不要更改标识或再次创建。
- `web/plan.js` 与 `web/workspace-plan.js` 仅在 create command 使用 resolver 结果；生成 key 会回填输入框。保存、派生、预检、审核等其他命令仍走原有生成 key，auth/org/product/server headers 保持原合同。服务端 exact caller key 仅通过现有组织/成员/命令作用域的幂等 receipt 持久化供审计，不写日志、不放入 public response。
- 无 secret/payload 日志或额外持久化；invalid key 在 busy/fetch 前失败，页面显示可理解的阻断提示。

## TDD evidence

先写测试再改生产文件：

1. RED：`node --test test/video-plan-create-idempotency.test.js` 在 helper 文件尚不存在时 `2 fail`（`ENOENT`）。
2. RED：依赖安装前执行 `node --test test/video-planning-browser.test.js`，首个 blocker 为工作树缺少 `playwright`（`ERR_MODULE_NOT_FOUND`）；没有把该外部依赖错误记录为旧生产代码的浏览器失败，也没有补造结果。
3. Owner 授权后运行 `npm ci --ignore-scripts`（250 packages；未改变 `package-lock.json` 或其他 tracked files）。
4. GREEN：`node --test test/video-plan-create-idempotency.test.js` → `3 pass`；覆盖 fallback 非空/`<=128`、运行时 `Headers` round-trip 不通过的 OWS/control 值、生成结果 whitespace/overlong/non-string 同步拒绝且不进入 request seam、supplied key 原样、invalid 同步拒绝。
5. GREEN：`node --test test/video-planning-browser.test.js` → `1 pass`；legacy create field 可见、invalid whitespace 不发请求、supplied `K1` 原样出站，并用 409/422/network route fixtures 验证 create notice、key 保留和单次请求。
6. GREEN：`node --test test/operator-single-workspace-stage-4-browser.test.js` → `9 pass`；integrated workspace create field 可见、supplied key 原样出站，并用 409/422/network route fixtures 验证 create notice、key 保留和单次请求，既有 409/预检/审核/响应式回归保持通过。
7. GREEN：`node --test test/video-planning-api.test.js test/video-planning-service.test.js` → `26 pass`；既有 same-key/same-payload replay 与 same-key/different-payload conflict 保持通过。
8. GREEN：`node --test test/real-batch-calibration-readiness-governance.test.js test/real-batch-validation-governance.test.js` → `30 pass`；#275 current pointers、#273 historical preservation、Readiness Freeze `BLOCKED_PRE_REAL_RUN` 与 Stage 1 history 均受治理测试约束。

9. 全量 `npm test` → `1292 pass / 16 skipped / 0 fail`（总计 1308 tests）。
10. `npm run check` → `Checked 250 JavaScript file(s)`；`git diff --check` → pass；mechanical allowlist audit → pass（仅授权文件变更）。

候选等待独立 Review 与 exact-head CI；两者通过后可按现有 Owner 工程授权合并并执行零业务变更部署。真实 Plan Create、Provider/Hifly、登录与积分动作仍禁止，下一 Owner Gate 仅为一次真实 Plan Create。实现 Agent 不自审、不提交。

## Governance and next step

- `AGENTS.md`、`docs/status/CURRENT.md`、`docs/ROADMAP.md`、`docs/agent-collaboration.md` 的 current pointer 已切换至 Issue #275；Issue #273 工程阶段为已完成并已合并/部署的历史/非当前，但 GitHub Issue 仍 OPEN。
- `RBV-CAL-001`、历史 GUI/Capture 批次和任何下载产物未访问、未修改；没有登录、Provider 请求、外部请求、真实业务对象或积分动作。
- 下一步由 ORCHESTRATOR_REVIEWER 独立读取实际 diff、测试和静态检查结果；通过 Independent Review 与 exact-head CI 后可依现有 Owner 工程授权合并并执行零业务变更部署。真实 Plan Create/Provider/Hifly 仍保持禁止，下一 Owner Gate 仅为一次真实 Plan Create。

## Independent review follow-up (2026-09-01)

Review `CHANGES_REQUESTED` items were addressed without expanding the allowlist:

- `resolve` now validates supplied and generated results with the nonblank-string/`<=128` contract plus runtime `Headers` byte-for-byte roundtrip; helper tests cover OWS, controls, whitespace, overlong, non-string output and prove the request seam is not entered.
- Both UI hints now require read-only reconciliation first and explicitly prohibit changing the key or creating again without authorization. Key inputs set `spellcheck=false` and `autocapitalize=off` in addition to `autocomplete=off` and `maxlength=128`.
- CURRENT/ROADMAP/session state that exact caller keys are persisted only by the existing scoped idempotency receipt for audit, never logged or returned in the public response.
- Engineering status now waits for Independent Review and exact-head CI; existing Owner engineering authorization permits merge and zero-business-mutation deployment after both pass. Real Plan Create/Provider/Hifly remains forbidden until the next Owner Gate.
- Issue #273 is described as an OPEN GitHub Issue with a completed, merged/deployed historical engineering stage; it is not the current stage and is not described as closed/archived.

Post-fix reruns: helper `3 pass`; legacy browser `1 pass`; integrated Stage 4 browser `9 pass`; governance `30 pass`; `npm run check` checked `250` JavaScript files; `git diff --check` and allowlist audit passed. Worktree remains uncommitted for final independent review.

## Second independent review follow-up (2026-09-01)

Review `CHANGES_REQUESTED` P1-A/P1-B/P2 items were handled test-first:

- RED before production edits: the expanded helper suite had `2 fail` (`Missing expected exception`) for non-round-trippable supplied/generated values; legacy browser stopped at the first create-error fixture waiting for `创建未完成` (30s timeout); integrated Stage 4 similarly stopped at its first create-error fixture (30s timeout). These were the first product failures after the new tests; no failure was hidden or retried into a pass.
- An intermediate `npm run check` caught a mismatched quote/backtick in the integrated create-error notice; it was corrected immediately with `apply_patch` before the GREEN reruns.
- GREEN implementation now uses the runtime `Headers` roundtrip as the only supplied/generated header validity check (no invented regex), before `busy`/`fetch`; leading/trailing OWS and header-invalid controls are rejected synchronously while whatever Unicode the runtime preserves remains eligible.
- Create-only `409`/`422`/network/unknown failures now stay visible in the create notice, preserve the exact key field, and instruct read-only reconciliation without retry language. Existing non-create error projection remains unchanged.
- Final post-fix reruns: helper `3 pass`; legacy browser `1 pass`; integrated Stage 4 browser `9 pass`; governance `30 pass`; `npm run check` checked `250` JavaScript files; `git diff --check` and allowlist audit passed. No Provider/Hifly/login/deployment/points actions occurred.

## Final independent review (2026-09-01)

- Verdict: `APPROVED`; no remaining P0/P1/P2 findings.
- Final evidence counts: helper `3 pass`; legacy browser `1 pass`; integrated Stage 4 browser `9 pass`; VideoPlanning API/service `26 pass`; governance `30 pass`; full suite `1292 pass / 16 skipped / 0 fail` out of `1308`; `npm run check` checked `250` JavaScript files; `git diff --check` and mechanical allowlist audit passed.
- Review confirms the candidate is ready for the existing engineering path: after exact-head CI remains green, Owner authorization permits merge and zero-business-mutation deployment. Real Plan Create, Provider/Hifly, login, and points remain forbidden until the next Owner Gate.
