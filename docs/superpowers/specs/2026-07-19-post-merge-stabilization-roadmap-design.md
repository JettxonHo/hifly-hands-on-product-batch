# Post-Merge Stabilization and Capture HTTP Roadmap Design

## Status

Accepted for handoff planning on 2026-07-19.

## Context

The GUI production workflow has already reached a usable baseline:

- The default Playwright path can complete the business flow: local GUI import or entry, one product per video, Hifly "手里有货" automation, generated image confirmation, video submit, download, GUI state, and retry handling.
- Capture HTTP has completed a single real Hifly live run, but it is not yet the default batch backend.
- PR #3 "Add safe GUI artifact downloads" and PR #4 "Add capture HTTP small-batch preview queue" have been merged into `main`.
- The capture HTTP small-batch queue currently supports local fake/mock preview only. It does not contact Hifly, does not use runtime auth, and does not consume points.

The next phase should stabilize what has already landed before opening a wider real HTTP batch path.

## Decision

Use a staged roadmap:

1. P0 protects the existing Playwright production path and the explicit point-consumption authorization rule.
2. P1 verifies the merged `main`, updates durable handoff state, and performs GUI-oriented no-network or explicitly-authorized smoke checks.
3. P2 designs real capture HTTP small-batch execution but keeps it disabled until point budget, stop rules, retry semantics, and user authorization are explicit.
4. P3 remains enhancement backlog and must not distract from GUI reliability.

## Goals

- Keep the GUI reliable after PR #3 and PR #4 merges.
- Make the project state clear to Codex, Claude Code, and future agents.
- Prevent accidental Hifly point consumption.
- Preserve Playwright as the default production backend until capture HTTP proves safe for batch use.
- Define a concrete next-step plan that Claude Code can execute without needing chat history.

## Non-Goals

- Do not switch default batch generation from Playwright to capture HTTP.
- Do not implement real capture HTTP small-batch generation in this stabilization pass.
- Do not run real Hifly generation unless the user gives explicit authorization in the current session.
- Do not clean unrelated local files unless the user asks for that specific cleanup.

## Requirements

### P0 Safety Requirements

- `npm run gui` and default GUI "开始生成" must continue to use the existing Playwright production route unless configuration explicitly says otherwise.
- Real Playwright generation, real capture HTTP live run, and any Hifly operation that may consume points require explicit user authorization.
- Failed or interrupted batches must remain recoverable from the GUI without re-entering product data.
- Project state, verification, and handoff notes must be written to `docs/PROJECT_HANDOFF.md`.
- Do not commit local runtime state: `config.local.json`, browser login state, `batches/`, `outputs/`, videos, HARs, logs, screenshots, `node_modules/`, or raw capture files.

### P1 Stabilization Requirements

- Record in `docs/PROJECT_HANDOFF.md` that PR #3 and PR #4 are merged.
- Run post-merge verification from a branch based on `origin/main`:
  - `npm run check`
  - `npm test`
  - `git diff --check`
- Confirm the GUI surface still distinguishes:
  - Playwright/default batch production.
  - Capture HTTP single-item live run.
  - Capture HTTP fake small-batch preview.
  - Safe artifact download buttons.
- Confirm any existing unrelated dirty files are not staged or committed.

### P2 Capture HTTP Real Batch Design Requirements

Before any real HTTP small-batch implementation, produce a separate design covering:

- Serial execution only for the first real batch version.
- Hard item limit and explicit point budget.
- Stop on first failure.
- Resume semantics for failed and interrupted items.
- Duplicate submit protection.
- Download verification and artifact registration.
- Auth-expired detection.
- API drift handling.
- GUI copy that makes point risk obvious.
- Tests using fake transport before any real Hifly run.

### P3 Backlog Requirements

Keep these as backlog unless the user explicitly reprioritizes:

- Multi-account or multi-browser-profile operation.
- Cross-platform packaging and customer-side lightweight distribution.
- Person pool and background pool recommendation strategy.
- Video repetition and pose/product-recognition quality checks.

## Acceptance Criteria

- A future agent can open this spec and know that Playwright remains the production default.
- A future agent can identify which tasks can run without points and which require explicit authorization.
- P1 can be executed without real Hifly access.
- P2 real HTTP batch work cannot accidentally start from this spec alone; it requires a separate implementation plan and user approval.

## Risks

- **Stacked PR confusion:** PR #3 and PR #4 have merged, but local branches may still point to old feature branches. Agents must verify branch and remote state before editing.
- **Accidental real generation:** GUI or API tests must not click real Hifly generation controls unless authorized.
- **Dirty worktree contamination:** Existing local dirty files may be unrelated. Agents must stage only files for the current task.
- **Capture HTTP overconfidence:** A fake queue passing does not mean real HTTP batch generation is production-ready.

## Verification Strategy

- Use local tests and static checks for P1.
- Use GUI smoke tests or manual GUI inspection without real generation for P1.
- Use fake transport for P2 tests until the user separately authorizes a real Hifly sample.

