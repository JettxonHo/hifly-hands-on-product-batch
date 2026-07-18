# ADR-002: Gate Capture HTTP Real Client Behind Mock, Dry-Run, and Live Modes

## Status

Accepted

## Date

2026-07-16

## Context

The GUI capture workflow can now record a real Hifly HAR during a Playwright generation run, extract request steps, redact sensitive data into a sanitized manifest, and pass offline replay.

The next product direction is to reduce reliance on fragile page/button automation by executing Hifly's underlying HTTP workflow directly. However, the sanitized manifest intentionally excludes cookies, authorization headers, CSRF tokens, signatures, and other runtime credentials. Hifly's private endpoints may also rely on one-time parameters, browser session state, or anti-abuse checks. Sending real HTTP requests prematurely could consume points, fail unpredictably, or create account risk.

## Decision

Add capture HTTP real-client work behind three explicit modes:

- `mock`: the default mode. It only replays sanitized manifest responses locally and never accesses the network.
- `real_dry_run`: builds and validates the real request plan from the manifest, but never sends network requests.
- `real_live`: sends real Hifly HTTP requests. This mode is reserved for a later implementation and requires explicit user authorization before any run.

Playwright remains the default production backend. `capture_http` must not become the default until a later decision supersedes ADR-001 and this ADR.

## Alternatives Considered

### Directly replay captured HAR requests

Pros: fastest path to a one-off proof.

Cons: raw HAR contains sensitive session material and often includes one-time or expiring fields. It would be difficult to version safely and could be less reliable than the current Playwright fallback.

Rejected.

### Keep only mock replay

Pros: safest and already implemented.

Cons: does not advance toward replacing button automation.

Rejected as the final direction, accepted as the current fallback.

### Three-mode gated rollout

Pros: lets the project introduce real-client boundaries, request-plan validation, GUI status, and error handling without network or point consumption. It keeps a clear safety line before live requests.

Cons: requires an additional dry-run layer before real generation.

Accepted.

## Consequences

- Missing or invalid mode must fail safely instead of sending network requests.
- Dry-run success means "request plan is constructible", not "real HTTP generation works".
- Live mode must require explicit user authorization and should start with one product only.
- Runtime authentication must come from a controlled local runtime source, never from committed manifest files.
- GUI copy and handoff docs must keep distinguishing Playwright real generation, capture mock replay, capture dry-run, and future live HTTP execution.
