# Cloud Executor persistent media contract

Status: CE-05 local contract only. This document does not prove a deployed
worker, a restart in production, or a real Hifly generation.

The Cloud Executor workspace has explicit writable directories. They may share
one filesystem locally or be separate volume/bind mounts in deployment:

```text
<root>/profile
<root>/assets
<root>/outputs
<root>/evidence
<root>/batches
<root>/locks
```

The Profile mount and login lifecycle remain the CE-04 contract. CE-05 adds
the `assets`, `outputs`, and `evidence` mounts in
`deploy/cloud-executor-storage.yml`; the fragment uses named Docker volumes
and may be replaced by explicit host bind sources during CE-07 deployment.

The standalone runtime creates the workspace directories before readiness. If
the caller does not inject a candidate store, it reuses the existing local
object-store contract rooted at `outputs`. A production composition that
injects the manual-execution candidate store must use the same persistent
store for Cloud Executor output, A12 object verification, verified output
`AssetVersion` registration, and the existing authenticated Work delivery
download. Cloud Executor does not add a file route or expose a storage key.

`CLOUD_EXECUTOR_MIN_FREE_BYTES` configures one threshold applied to every
writable workspace location: the configured root plus `assets`, `outputs`,
`evidence`, `batches`, and `locks`. The gate uses `statfs` (or the injected
equivalent) and runs before order listing or attempt creation. An error or a
below-threshold result from any checked location returns the controlled,
path-free `storage_blocked` readiness state. Profile capacity remains part of
the CE-04 login/readiness lifecycle.

Public Cloud Executor results contain ids and controlled output metadata only.
Absolute paths, signed URLs, raw object keys, cookies, and tokens remain
server-side. Videos are delivered only by the existing authenticated Work
download contract.

The CE-05 restart test creates a second runtime and filesystem-backed store
over the same temporary root, confirms assets/output/evidence and candidate
bytes survive, registers the verified output through the existing A12 asset
port, and serves those bytes through the authenticated Work route. No Hifly,
Provider, browser, HTTP, points, or deployment action is part of CE-05.
