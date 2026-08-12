# Cloud Executor login-only deployment contract

Status: CE-04 local contract only. This document does not prove a deployment and must not be used to authorize a real Hifly generation.

The login command is an operational mode for the standalone `cloud_executor` process:

```bash
CLOUD_EXECUTOR_ENABLED=true \
CLOUD_EXECUTOR_MODE=login \
CLOUD_EXECUTOR_ROOT=/var/lib/hifly-executor \
CLOUD_EXECUTOR_PROFILE_DIR=/var/lib/hifly-executor/profile \
npm run cloud-executor:login
```

The Profile directory is the persistent mount. The process creates a fixed, non-secret
`.cloud-executor-profile.marker` in that directory so a restart test can distinguish the
same filesystem from a fresh temporary directory. Chrome owns the remaining Profile
contents; cookies, LocalStorage, tokens and page data are never copied to the repository,
database, public API, logs or snapshots.

The display contract for a future CE-07 deployment is:

- Chrome runs headful under Xvfb, default `DISPLAY=:99`.
- noVNC binds to `127.0.0.1` by default. A private RFC1918 bind address is allowed by
  configuration; a public address, wildcard bind, and public port publishing are rejected.
- The noVNC endpoint is reached only through an SSH tunnel, VPN, or another restricted
  private management path. The login overlay has no public `ports:` mapping.
- Login mode starts no Worker poller, constructs no Cloud Executor claim service, and
  cannot call `runOnce`, `claim`, upload, generation, or points-bearing operations.
- After the operator finishes the browser login, the command reuses the existing Hifly
  page/executor `preflight()` to report readiness. It does not duplicate selectors or
  page flow.

CE-04 validation is fake-only: it checks configuration, private display defaults, login
mode isolation, readiness-before-claim, and Profile marker persistence across a fake
restart. No Hifly page is visited and no server is deployed by this contract.
