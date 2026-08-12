# Cloud Executor P0 Design

> Status: Accepted design; implementation pending
> Product contract: `docs/product/CLOUD_EXECUTOR_P0.md`
> Decision: D-034

## 1. Context

The current system has a working Cloud Control Plane and a real, evidence-backed Mac Local Agent path. That path proves the Hifly Playwright core and the A10/A11/A12/Work contracts, but it does not satisfy the Owner's P0 requirement: production must continue without a personal computer online.

The correction introduces a cloud-resident browser worker while preserving the domain contracts and historical Local Agent implementation.

## 2. Architecture

```text
Browser
  │ authenticated Web/API
  ▼
Cloud Control Plane
  ├─ PostgreSQL: Product/Copy/Avatar/VideoPlan/ProductionOrder/Attempt/Work
  ├─ authenticated artifact API
  └─ Cloud Executor coordination port
         │ claim / start / heartbeat / checkpoint / result
         ▼
Cloud Executor Worker (one replica, concurrency=1)
  ├─ package compiler / asset materializer
  ├─ existing Hifly Playwright executor core
  ├─ persistent Chrome profile
  ├─ persistent assets / outputs / evidence
  └─ Chrome + Xvfb; controlled noVNC for login only
```

The Web/API process never owns the long-running browser lifecycle. The Worker is a separate process/service in the same modular-monolith repository.

## 3. Reuse and change boundaries

### Reuse

- ProductionOrder and ManualHandoffPackage readiness gates.
- ExecutionAttempt status, lease, heartbeat, checkpoint, report and candidate artifact concepts.
- A12 verification and Work creation.
- Hifly Playwright page/executor modules.
- Authenticated artifact response patterns.
- Existing idempotency and fail-closed conventions.

### Change

- Add `cloud_executor` as a distinct runtime/executor identity.
- Add a Cloud Executor service/port rather than calling Local Agent HTTP routes with a fake identity.
- Add a worker entrypoint and production service wiring.
- Add persistent cloud workspace and Profile configuration.
- Add cloud readiness and progress projections to the GUI.

### Preserve

- Local Agent code and historical migrations.
- Manual execution path.
- Default `PRODUCTION_EXECUTOR=fail_closed` until the cloud worker is explicitly enabled.
- Existing real-generation authorization gates.

## 4. Runtime identity and ownership

The minimum data-model change permits `executor_type = cloud_executor` and binds the attempt to a server-side executor id. Cloud Executor mutations are internal service calls or a private service API; they do not reuse a member session and do not accept the Local Agent bearer token.

Repository invariants:

- manual: member operator set, executor agent id absent;
- local_agent: member absent, Local Agent id set;
- cloud_executor: member absent, Cloud Executor id set;
- only one active attempt per ProductionOrder across all executor types.

Migration changes must be additive and versioned. Existing applied migrations are never edited.

## 5. Claim and execution loop

The Worker loop is explicit and bounded:

```text
readiness
→ expire only this worker's stale lease if necessary
→ claim at most one eligible order
→ start attempt
→ materialize package into persistent workspace
→ execute Playwright with periodic heartbeat/checkpoint
→ persist candidate output
→ submit one terminal report
→ trigger A12
→ standby
```

Readiness precedes claim. `disabled`, missing Profile, login required, unwritable storage and low disk all return standby/requires_action without creating an attempt.

No generic automatic retry loop is allowed around Provider submission. A crash or uncertain post-submit state is surfaced for human reconciliation.

## 6. Playwright composition

CE-03 adds an adapter around the existing Hifly executor and page modules. It must not fork selectors or reproduce the upload/generate/confirm/download flow. Environment-specific differences are supplied as configuration:

- persistent `profileDir`;
- cloud workspace root;
- headful display configuration;
- download/evidence destinations;
- readiness inspection.

Fake executor and fake transport cover all implementation tests before CE-08. CE-03 does not visit Hifly.

## 7. Persistent workspace

One root is mounted from the host or a named volume. Child directories are fixed by configuration and created at startup:

```text
profile/
assets/<attempt-id>/
outputs/<attempt-id>/
evidence/<attempt-id>/
```

The database and public API store internal ids and controlled metadata, never absolute paths. Artifact streaming resolves ids through a server-side storage port and rechecks organization access.

The disk gate uses one practical configurable threshold. Below the threshold, readiness becomes `storage_blocked`; the Worker does not claim. P0 does not add tiering, deduplication, or speculative hashing.

## 8. Login surface

The browser login service is operational tooling, not a public product page:

- Chrome runs headful under Xvfb.
- noVNC is bound to loopback/private network only.
- operators enter through SSH tunnel/VPN/restricted management ingress.
- login mode disables claim polling.
- closing/restarting the Worker preserves Profile volume.
- readiness reports only `ready` or `requires_login`; no cookies or page data leave the Worker.

## 9. Control-plane projection

The production page receives a provider-neutral Cloud Executor view:

- online/offline;
- available/busy/requires_login/storage_blocked/requires_action/disabled;
- last heartbeat;
- current ProductionOrder and attempt;
- controlled progress phase;
- controlled failure code/message;
- verified Work/artifact preview and download action.

The UI must not render host paths, Profile location, cookies, VNC credentials or raw Playwright exceptions.

## 10. Deployment

The production Compose deployment gains a Cloud Executor service, Chrome/Xvfb runtime and persistent mounts. The 2C4G pilot uses one Worker replica and concurrency 1. App, database and proxy remain separate services. CE-07 validates migration and rollback readiness, disabled/fail-closed startup, login readiness without claiming, standby without Provider access, container restart persistence, and memory/disk observations.

No real generation occurs in CE-02 through CE-07.

## 11. Test strategy

- service tests: identity invariants, one active attempt, lease/heartbeat, no retry;
- system tests: fake Worker claim → fake output → report → A12/Work;
- restart tests: persistent workspace and uncertain state fail closed;
- API tests: safe projection and authenticated artifact access;
- browser tests: Cloud Executor status replaces Local Agent primary guidance;
- deployment tests: service, volume, resource and ingress contracts;
- CE-08: one separately authorized real zero-attempt order.

## 12. Rejected alternatives

- Keep Mac Local Agent as P0: fails the no-personal-computer requirement.
- Run Playwright inside Web request handling: unsafe for long-running work and restart behavior.
- Call Local Agent endpoints from a cloud container under a Local Agent id: hides the actual runtime and corrupts product semantics.
- Copy the Hifly DOM automation: creates two selector stacks and doubles drift risk.
- Add Kubernetes/object storage first: unnecessary for one-worker P0 validation.
