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

The CE-04 login image contract is implemented by
`deploy/cloud-executor-login.Dockerfile` and
`deploy/cloud-executor-login-entrypoint.sh`. The dedicated image installs Playwright
Chromium plus Xvfb, x11vnc, noVNC/websockify and launches them before the login command.
It is a buildable contract for CE-07, not evidence that the image was built or deployed.

The display and ingress contract is:

- Chrome runs headful under Xvfb, default `DISPLAY=:99`.
- x11vnc listens only on container loopback port `5900`. websockify listens on
  container-local `0.0.0.0:6080`, which is required for Docker port forwarding and is
  fixed in the entrypoint rather than controlled by user configuration.
- Compose publishes only `127.0.0.1:6080:6080` on the host. The Cloud Executor product
  configuration remains `access=private` and `public=false`; wildcard/public bind values
  are rejected and cannot change the Compose host mapping.
- An operator reaches noVNC through an SSH tunnel such as
  `ssh -L 6080:127.0.0.1:6080 operator@cloud-host`, then opens
  `http://127.0.0.1:6080/vnc.html`. There is no public host listener.
- Login mode starts no Worker poller, constructs no Cloud Executor claim service, and
  cannot call `runOnce`, `claim`, upload, generation, or points-bearing operations.
- After the operator finishes the browser login, the command reuses the existing Hifly
  page/executor `preflight()` to report readiness. It does not duplicate selectors or
  page flow.

CE-04 validation is fake-only: it checks configuration, private display defaults, login
mode isolation, readiness-before-claim, and Profile marker persistence across a fake
restart. No Hifly page is visited and no server is deployed by this contract.
