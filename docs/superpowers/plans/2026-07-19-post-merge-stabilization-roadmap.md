# Post-Merge Stabilization and Capture HTTP Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the merged GUI and capture HTTP work, update durable handoff state, and prepare the next real capture HTTP batch design without consuming Hifly points.

**Architecture:** This plan is documentation and verification first. It does not change the default Playwright production path and does not implement real capture HTTP batch generation. Any code change that emerges during verification must be handled as a separate focused fix with tests and user-visible handoff notes.

**Tech Stack:** Node.js, npm scripts, GitHub PR state via `gh`, local GUI docs, existing project test suite.

## Global Constraints

- Default production generation remains Playwright.
- Do not run real Hifly generation or real capture HTTP live requests unless the user explicitly authorizes point risk in the current session.
- Capture HTTP small-batch is currently fake/mock preview only; do not present it as production-ready real batch generation.
- Do not commit `config.local.json`, login state, `batches/`, HAR/logs/videos/outputs/node_modules, screenshots, raw capture, or unrelated dirty files.
- Existing unrelated files `.superpowers/sdd/task-6-report.md` and `docs/resume/` must not be staged unless the user explicitly asks to handle them.
- Update `docs/PROJECT_HANDOFF.md` after completing this plan.

---

### Task 1: Sync Branch State and Record Merged PRs

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

**Interfaces:**
- Consumes: GitHub PR state for PR #3 and PR #4.
- Produces: A top-of-file handoff entry recording the merged state and next operating mode.

- [ ] **Step 1: Confirm current branch and dirty files**

Run:

```bash
git status --short --branch
```

Expected:

```text
## <branch-name>
 M .superpowers/sdd/task-6-report.md
?? docs/resume/
```

If additional project files are dirty, inspect them before continuing.

- [ ] **Step 2: Confirm PR #3 and PR #4 merge state**

Run:

```bash
gh pr view 3 --json number,state,isDraft,mergedAt,title,url
gh pr view 4 --json number,state,isDraft,mergedAt,title,url
```

Expected:

```text
"state":"MERGED"
```

for both PRs.

- [ ] **Step 3: Add a new top entry to `docs/PROJECT_HANDOFF.md`**

Insert this entry above the current first dated section, adjusting command results only if local verification differs:

```markdown
## 2026-07-19 P1 接力：PR #3/#4 已合并，进入合并后稳定性验证

- GitHub 状态已确认：PR #3 `Add safe GUI artifact downloads` 已合并；PR #4 `Add capture HTTP small-batch preview queue` 已合并。
- 当前生产建议不变：默认批量生产继续使用 Playwright；抓包 HTTP 小批量仍只是 fake/mock 预演，不访问飞影、不消耗积分。
- 下一步优先做合并后主分支回归：`npm run check`、`npm test`、`git diff --check`。
- 不要误提交既有无关文件 `.superpowers/sdd/task-6-report.md` 与 `docs/resume/`。
- 真实飞影生成、真实 HTTP live-run 或任何可能消耗积分的动作，仍必须先获得用户明确授权。
```

- [ ] **Step 4: Verify only the handoff file is staged later**

Do not stage yet. Run:

```bash
git diff -- docs/PROJECT_HANDOFF.md
```

Expected: only the new top handoff entry appears.

### Task 2: Run Post-Merge Local Verification

**Files:**
- No source file changes expected.
- Modify: `docs/PROJECT_HANDOFF.md` only to record verification results.

**Interfaces:**
- Consumes: project npm scripts.
- Produces: durable verification record.

- [ ] **Step 1: Fetch latest main**

Run:

```bash
git fetch origin main
```

Expected: command exits 0.

- [ ] **Step 2: Confirm the working branch is based on current main**

Run:

```bash
git merge-base --is-ancestor origin/main HEAD; echo main_in_head=$?
```

Expected:

```text
main_in_head=0
```

If the result is `1`, either rebase the documentation branch onto `origin/main` or stop and report the mismatch.

- [ ] **Step 3: Run static check**

Run:

```bash
npm run check
```

Expected:

```text
Checked 65 JavaScript file(s).
```

- [ ] **Step 4: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 5: Run full test suite**

Run:

```bash
npm test
```

Expected:

```text
# pass 368
# fail 0
```

If test counts differ because new tests were added after this plan, accept the new count only when all tests pass and record the actual count.

- [ ] **Step 6: Record results in `docs/PROJECT_HANDOFF.md`**

Append these bullets to the top handoff entry:

```markdown
- 合并后本地验证：`npm run check` 通过；`git diff --check` 通过；`npm test` 为 368/368 通过。
- 本轮未访问飞影、未运行真实 HTTP、未生成视频、未消耗新增积分。
```

Use the actual test count if it differs.

### Task 3: GUI Surface Smoke Without Point Consumption

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`
- Optional Modify: `docs/SOP.md` if visible GUI labels no longer match the SOP.

**Interfaces:**
- Consumes: local GUI at `npm run gui`.
- Produces: recorded manual or automated GUI smoke result.

- [ ] **Step 1: Start GUI**

Run:

```bash
npm run gui
```

Expected: terminal prints a local URL such as:

```text
Local workbench: http://127.0.0.1:<port>
```

- [ ] **Step 2: Inspect GUI labels without starting real generation**

Open the printed local URL. Confirm the GUI clearly distinguishes these areas:

```text
批量生成：Playwright
抓包 HTTP：单条联调
抓包 HTTP 小批量预演
下载产物
```

Do not click a real generation button. Do not click any Hifly action that may consume points.

- [ ] **Step 3: Record smoke result**

Add this bullet to the top `docs/PROJECT_HANDOFF.md` entry:

```markdown
- GUI 无积分冒烟：本地页面能区分 Playwright 批量、抓包 HTTP 单条联调、抓包 HTTP 小批量 fake 预演和安全下载入口；未点击真实生成。
```

If any label differs, record the actual label and update `docs/SOP.md` only if the SOP is now inaccurate.

- [ ] **Step 4: Stop GUI**

Return to the terminal running `npm run gui` and stop it with `Ctrl+C`.

Expected: server exits. Do not leave the GUI server running at the end of the task.

### Task 4: Dirty Worktree Decision Gate

**Files:**
- No edits expected unless the user asks to handle unrelated files.

**Interfaces:**
- Consumes: `git status`.
- Produces: a clear report of unrelated local files.

- [ ] **Step 1: Check current dirty files**

Run:

```bash
git status --short --branch
```

Expected unrelated files may still include:

```text
 M .superpowers/sdd/task-6-report.md
?? docs/resume/
```

- [ ] **Step 2: Do not stage unrelated files**

When committing this plan's results, stage only files intentionally modified by this plan. Use an explicit path list:

```bash
git add docs/PROJECT_HANDOFF.md docs/SOP.md docs/superpowers/specs/2026-07-19-post-merge-stabilization-roadmap-design.md docs/superpowers/plans/2026-07-19-post-merge-stabilization-roadmap.md
```

If `docs/SOP.md` was not modified, omit it from the command.

- [ ] **Step 3: Report unrelated files**

In the final response, include this note if the files remain:

```text
Unrelated local files remain uncommitted: .superpowers/sdd/task-6-report.md and docs/resume/.
```

### Task 5: Create the Next Real Capture HTTP Batch Spec Before Implementation

**Files:**
- Create: `docs/superpowers/specs/YYYY-MM-DD-capture-http-real-small-batch-design.md`
- Create: `docs/superpowers/plans/YYYY-MM-DD-capture-http-real-small-batch.md`
- Modify: `docs/PROJECT_HANDOFF.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-19-post-merge-stabilization-roadmap-design.md`
- Produces: a separate implementation-ready design for real capture HTTP small-batch work.

- [ ] **Step 1: Do not implement real HTTP batch code in this task**

This task is design-only. Do not modify these files in this task:

```text
src/server/routes/capture.js
src/executors/capture-http-executor.js
web/app.js
web/api.js
```

- [ ] **Step 2: Write the real HTTP small-batch spec**

Create `docs/superpowers/specs/YYYY-MM-DD-capture-http-real-small-batch-design.md` with these required sections:

```markdown
# Capture HTTP Real Small-Batch Design

## Status
Proposed.

## Context
Playwright remains the production default. Capture HTTP has one successful real single-item live run and fake small-batch preview, but no authorized real batch mode.

## Required Safety Gates
- Explicit user authorization per run.
- Operator-visible point budget.
- Serial execution only.
- Stop on first failure.
- Per-item idempotency key or duplicate-submit guard.
- Resume only from safe failed/interrupted states.
- Runtime auth never written to disk.
- CDN or artifact URL never written to public batch JSON.

## API Shape
Define a disabled-by-default endpoint or mode. The first real version must limit item count and require point-risk acknowledgement.

## GUI Shape
Define copy that separates Playwright production, fake preview, and real HTTP point-risk execution.

## Tests Before Real Hifly
List fake transport tests for success, failure, auth expired, duplicate submit prevention, download missing, and resume.

## Real Hifly Validation
Only after user authorization: one item, then at most three items, with batch id, SKU, output path, remote id, and point-risk note recorded.
```

- [ ] **Step 3: Write the real HTTP small-batch implementation plan**

Create `docs/superpowers/plans/YYYY-MM-DD-capture-http-real-small-batch.md` using the plan header required by `writing-plans`. Split the implementation into at least these tasks:

```text
Task 1: API gate and config flag, disabled by default.
Task 2: fake transport real-batch state machine tests.
Task 3: duplicate-submit guard and resume behavior.
Task 4: GUI copy and explicit authorization controls.
Task 5: docs and one-item authorized validation checklist.
```

- [ ] **Step 4: Record that P2 remains design-only**

Add this bullet to `docs/PROJECT_HANDOFF.md`:

```markdown
- P2 真实抓包 HTTP 小批量仍未实现；如需推进，先执行 `docs/superpowers/specs/YYYY-MM-DD-capture-http-real-small-batch-design.md` 和对应 plan，且真实联调前必须重新获得用户明确授权。
```

### Task 6: Final Review, Commit, and Push

**Files:**
- All files modified intentionally by this plan.

**Interfaces:**
- Produces: clean commit or clear report if user chooses not to commit.

- [ ] **Step 1: Review staged diff**

Run:

```bash
git diff --staged
```

Expected: only documentation files from this plan appear.

- [ ] **Step 2: Run final checks**

Run:

```bash
npm run check
git diff --check
npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

Run:

```bash
git commit -m "docs: plan post-merge stabilization roadmap"
```

Expected: commit succeeds.

- [ ] **Step 4: Push branch**

Run:

```bash
git push -u origin <current-branch>
```

Expected: branch is pushed. If opening a PR, keep it draft until the user confirms.

## Self-Review Checklist

- Every real Hifly or point-consuming action requires explicit user authorization.
- P1 can be executed without real Hifly access.
- P2 real batch work is separated from this stabilization plan.
- Unrelated dirty files are not staged.
- `docs/PROJECT_HANDOFF.md` is updated with actual verification results.

