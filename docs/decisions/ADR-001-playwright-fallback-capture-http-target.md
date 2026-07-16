# ADR-001: Playwright Fallback Until Capture HTTP Is Complete

## Status

Accepted

## Date

2026-07-16

## Context

The project currently has a working GUI-driven Playwright automation flow for Hifly's "手里有货" mode. It can upload product/person images, generate the hands-on asset, confirm, submit the video, and download completed works.

The intended production direction is capture HTTP automation: replay Hifly's underlying HTTP requests instead of relying on page buttons and modal state. Capture HTTP should reduce selector fragility, wrong-click risk, and list-delta ambiguity during download.

However, Hifly's private requests may depend on runtime-generated signatures, one-time tokens, browser session state, or anti-abuse checks. The capture HTTP path is not yet proven to support the full workflow.

## Decision

Keep Playwright as the default production execution backend until capture HTTP is fully validated. Build the GUI capture workflow as an opt-in sidecar first:

- GUI batch creation, execution confirmation, status display, retry, and downloads continue to use the existing Playwright production path.
- When capture is enabled for a batch, Playwright still performs the real generation, but the run records HAR evidence.
- The HAR is processed locally into raw steps, redacted into a sanitized manifest, and verified by offline `capture_http` replay.
- `capture_http` must not become the default backend until it can complete upload, asset generation, submit, query, and download through HTTP for all existing GUI entry points and strategies.

## Alternatives Considered

### Switch immediately to capture HTTP

Pros: removes browser-click fragility sooner.

Cons: high risk because replayability of Hifly private endpoints is unknown; may break production generation and consume points during debugging.

Rejected.

### Stay with Playwright permanently

Pros: already works and requires less protocol research.

Cons: long-term batch reliability remains tied to page layout, modal state, and download-button selectors.

Rejected as the final direction, but accepted as the fallback.

### Hybrid transition

Pros: keeps current production flow available while building evidence for HTTP replacement; avoids wasting points for extraction/redaction/replay tests.

Cons: requires maintaining both paths during the transition.

Accepted.

## Consequences

- Any implementation must preserve `executionBackend: "playwright"` as the default until a later explicit decision changes it.
- GUI capture controls should not imply that capture HTTP is already generating real videos.
- Raw HAR, cookies, authorization headers, tokens, logs, batches, screenshots, and videos remain local-only and must not be committed.
- A later ADR should supersede this one if capture HTTP becomes the default backend.
