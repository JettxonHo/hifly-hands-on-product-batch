# Yingdao RPA Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe first-version Yingdao RPA executor bridge while preserving the verified Playwright Hifly execution path.

**Architecture:** Keep the existing `runBatch` state machine and executor adapter as the integration boundary. Add a separate RPA bridge layer that writes task packages, accepts authenticated localhost callbacks, records RPA state files, and lets a new `YingdaoRpaExecutor` wait for mock or real RPA progress without directly mutating batch JSON.

**Tech Stack:** Node.js ES modules, Fastify routes, Node test runner, current batch store/state machine/executor adapter, local JSON files under `batches/<batch_id>/rpa/`.

## Global Constraints

- Do not delete or rewrite the existing Playwright executor.
- `executionBackend` defaults to `playwright`; no existing GUI or CLI behavior changes unless explicitly configured.
- First implementation is bridge-first and mock-testable; real Hifly execution and Yingdao client integration happen only after user approval because Hifly consumes points.
- RPA callbacks must be localhost-only, token-authenticated, idempotent, execution-key-bound, and unable to regress state.
- `download_dir` must equal the current batch directory; never accept arbitrary output paths from task packages or callbacks.
- RPA timeouts must lead to recoverable state, not an indefinitely active GUI.
- Do not commit batch data, logs, videos, screenshots, `config.local.json`, login state, or Yingdao runtime secrets.

---

## File Structure

- Modify `config.example.json`: add default `executionBackend` and `rpa` timeout/config fields.
- Modify `src/server/start.js`: choose `createLazyHiflyExecutor` or `createYingdaoRpaExecutor` from config.
- Create `src/rpa/rpa-state.js`: safe read/write helpers for `batches/<batch_id>/rpa/state/<task_id>.json`.
- Create `src/rpa/task-package.js`: task package generation, path safety, token creation, and schema helpers.
- Create `src/rpa/callbacks.js`: callback validation, localhost/source checks, state transition guards, and idempotent state writes.
- Create `src/executors/yingdao-rpa-executor.js`: implementation of the existing executor adapter using task packages and RPA state.
- Modify `src/server/app.js`: register RPA callback routes and pass `batchRoot`.
- Create `src/server/routes/rpa-callbacks.js`: `POST /api/rpa/callback`.
- Modify `web/app.js` and `web/index.html` only if an existing detail surface can show execution backend without large UI churn.
- Test `test/rpa-task-package.test.js`: package generation and path safety.
- Test `test/rpa-callbacks.test.js`: callback auth, idempotency, ordering, and state writes.
- Test `test/yingdao-rpa-executor.test.js`: mock callback-driven executor flow and timeout behavior.
- Modify `test/server-api.test.js`: route-level callback tests if not covered by lower-level callback tests.
- Modify docs: `docs/PROJECT_HANDOFF.md`, `docs/ENVIRONMENT.md`, and possibly `docs/CALIBRATION.md`.

---

### Task 1: Execution Backend Configuration

**Files:**
- Modify: `config.example.json`
- Modify: `src/server/start.js`
- Create: `test/execution-backend-config.test.js`

**Interfaces:**
- Produces: `createExecutorForBackend(root, config)` exported from `src/server/start.js`.
- Consumes later: Task 4 uses the `yingdao_rpa` branch to instantiate `createYingdaoRpaExecutor`.

- [ ] **Step 1: Write failing backend selection tests**

Create `test/execution-backend-config.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createExecutorForBackend } from "../src/server/start.js";

test("execution backend defaults to playwright", () => {
  const executor = createExecutorForBackend(process.cwd(), {});
  assert.equal(executor.backend, "playwright");
  assert.equal(typeof executor.createAsset, "function");
});

test("execution backend can select yingdao_rpa", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { callbackBaseUrl: "http://127.0.0.1:4317" }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(typeof executor.createAsset, "function");
});

test("unknown execution backend throws a clear error", () => {
  assert.throws(
    () => createExecutorForBackend(process.cwd(), { executionBackend: "robot_surprise" }),
    /Unsupported executionBackend/
  );
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test test/execution-backend-config.test.js
```

Expected: FAIL because `createExecutorForBackend` is not exported.

- [ ] **Step 3: Add config defaults**

Modify `config.example.json` near the top-level execution/browser fields:

```json
{
  "executionBackend": "playwright",
  "rpa": {
    "callbackBaseUrl": "http://127.0.0.1:4317",
    "assetTimeoutMs": 600000,
    "submitTimeoutMs": 1200000,
    "queryTimeoutMs": 120000,
    "downloadTimeoutMs": 1200000,
    "pollIntervalMs": 1000
  }
}
```

Preserve all existing keys and JSON validity.

- [ ] **Step 4: Export backend selector**

Modify `src/server/start.js`:

```js
import { createYingdaoRpaExecutor } from "../executors/yingdao-rpa-executor.js";
```

Add this exported function above `startServer`:

```js
export function createExecutorForBackend(root, config = {}) {
  const backend = config.executionBackend || "playwright";
  if (backend === "playwright") {
    const executor = createLazyHiflyExecutor(root);
    return Object.assign(executor, { backend: "playwright" });
  }
  if (backend === "yingdao_rpa") {
    const executor = createYingdaoRpaExecutor({ root, config });
    return Object.assign(executor, { backend: "yingdao_rpa" });
  }
  throw new Error(`Unsupported executionBackend: ${backend}`);
}
```

Update direct execution to use it:

```js
const executor = createExecutorForBackend(root, config);
await startServer({
  root,
  executor,
  port: process.env.HIFLY_GUI_PORT ?? config.gui?.port ?? DEFAULT_PORT,
  openBrowser,
  uploadLimits: config.uploadLimits,
  executionLock: config.executionLock,
  pointsEstimate: config.pointsEstimate,
  generationConfig: config
});
```

- [ ] **Step 5: Add temporary executor stub**

Create `src/executors/yingdao-rpa-executor.js` with a minimal adapter so Task 1 passes:

```js
export function createYingdaoRpaExecutor() {
  async function unavailable() {
    const error = new Error("Yingdao RPA executor is not implemented yet");
    error.code = "YINGDAO_RPA_NOT_IMPLEMENTED";
    throw error;
  }
  return {
    createAsset: unavailable,
    submitVideo: unavailable,
    querySubmission: unavailable,
    downloadArtifact: unavailable,
    reconcileSubmission: unavailable
  };
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/execution-backend-config.test.js
npm run check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add config.example.json src/server/start.js src/executors/yingdao-rpa-executor.js test/execution-backend-config.test.js
git commit -m "feat: select execution backend"
```

---

### Task 2: RPA Task Package And State Files

**Files:**
- Create: `src/rpa/task-package.js`
- Create: `src/rpa/rpa-state.js`
- Test: `test/rpa-task-package.test.js`

**Interfaces:**
- Produces: `createRpaTaskPackage({ batch, task, batchDirectory, callbackBaseUrl })`.
- Produces: `writeRpaTaskPackage({ batchDirectory, taskId, packageData })`.
- Produces: `readRpaState(batchDirectory, taskId)` and `writeRpaState(batchDirectory, taskId, update)`.
- Consumes: Task 3 callback route and Task 4 executor.

- [ ] **Step 1: Write failing task package tests**

Create `test/rpa-task-package.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createRpaTaskPackage,
  writeRpaTaskPackage
} from "../src/rpa/task-package.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rpa-package-"));
  const batchDirectory = path.join(root, "batch-1");
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const imagePath = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(imagePath, "image");
  return { root, batchDirectory, imagePath };
}

test("creates package with safe batch download dir and callback token", async () => {
  const f = await fixture();
  try {
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1", person_strategy: "auto_pool", script_strategy: "mixed" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        product_name: "Alpha",
        selling_points: "Useful",
        category: "toy",
        image_path: f.imagePath,
        resolved_script_mode: "hifly_ai"
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });
    assert.equal(pkg.schema_version, 1);
    assert.equal(pkg.batch_id, "batch-1");
    assert.equal(pkg.download_dir, f.batchDirectory);
    assert.match(pkg.callback_url, /^http:\/\/127\.0\.0\.1:4317\/api\/rpa\/callback$/);
    assert.equal(typeof pkg.callback_token, "string");
    assert.equal(pkg.callback_token.length > 20, true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects product paths outside the batch directory", async () => {
  const f = await fixture();
  try {
    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: path.join(f.root, "outside.png") },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /outside batch directory/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("writes package and rpa state under rpa directory", async () => {
  const f = await fixture();
  try {
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: f.imagePath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });
    const packagePath = await writeRpaTaskPackage({ batchDirectory: f.batchDirectory, taskId: "task-1", packageData: pkg });
    assert.equal(JSON.parse(await readFile(packagePath, "utf8")).task_id, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", { status: "submitted", remote_evidence: { remote_id: "1" } });
    const state = await readRpaState(f.batchDirectory, "task-1");
    assert.equal(state.status, "submitted");
    assert.equal(state.remote_evidence.remote_id, "1");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test test/rpa-task-package.test.js
```

Expected: FAIL because `src/rpa/task-package.js` and `src/rpa/rpa-state.js` do not exist.

- [ ] **Step 3: Implement state helpers**

Create `src/rpa/rpa-state.js`:

```js
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) {
    throw new Error("Invalid RPA task id");
  }
}

function statePath(batchDirectory, taskId) {
  assertTaskId(taskId);
  return path.join(batchDirectory, "rpa", "state", `${taskId}.json`);
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.rpa.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readRpaState(batchDirectory, taskId) {
  try {
    return JSON.parse(await readFile(statePath(batchDirectory, taskId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRpaState(batchDirectory, taskId, update) {
  const current = await readRpaState(batchDirectory, taskId);
  const next = {
    ...(current || {}),
    ...structuredClone(update),
    task_id: taskId,
    updated_at: new Date().toISOString()
  };
  await atomicWriteJson(statePath(batchDirectory, taskId), next);
  return next;
}
```

- [ ] **Step 4: Implement task package helpers**

Create `src/rpa/task-package.js`:

```js
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requireInsideBatch(batchDirectory, filePath, label) {
  if (!filePath) return "";
  const absolute = path.resolve(filePath);
  if (!contained(path.resolve(batchDirectory), absolute)) {
    throw new Error(`${label} is outside batch directory`);
  }
  return absolute;
}

function callbackUrl(baseUrl) {
  const url = new URL("/api/rpa/callback", baseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
    throw new Error("RPA callback base URL must be localhost");
  }
  return url.toString();
}

export function createRpaTaskPackage({ batch, task, batchDirectory, callbackBaseUrl }) {
  const productImagePath = requireInsideBatch(batchDirectory, task.image_path, "product_image_path");
  const personImagePath = task.__resolved_person_image_path || task.resolved_person_image_path || task.person_image_path || "";
  return {
    schema_version: 1,
    batch_id: batch.batch_id,
    task_id: task.task_id,
    execution_key: task.execution_key,
    sku: task.sku || "",
    product_name: task.product_name || "",
    selling_points: task.selling_points || "",
    category: task.category || "",
    product_image_path: productImagePath,
    person_image_path: personImagePath ? requireInsideBatch(batchDirectory, personImagePath, "person_image_path") : "",
    person_strategy: batch.person_strategy || "auto_pool",
    script_strategy: batch.script_strategy || "mixed",
    script: task.script || "",
    resolved_script_mode: task.resolved_script_mode || "hifly_ai",
    download_dir: path.resolve(batchDirectory),
    callback_url: callbackUrl(callbackBaseUrl),
    callback_token: randomUUID()
  };
}

export async function writeRpaTaskPackage({ batchDirectory, taskId, packageData }) {
  const dir = path.join(batchDirectory, "rpa", "tasks");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${taskId}.json`);
  await writeFile(filePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");
  return filePath;
}
```

- [ ] **Step 5: Run focused tests**

```bash
node --test test/rpa-task-package.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rpa/task-package.js src/rpa/rpa-state.js test/rpa-task-package.test.js
git commit -m "feat: write rpa task packages"
```

---

### Task 3: RPA Callback Route And State Guards

**Files:**
- Create: `src/rpa/callbacks.js`
- Create: `src/server/routes/rpa-callbacks.js`
- Modify: `src/server/app.js`
- Test: `test/rpa-callbacks.test.js`

**Interfaces:**
- Produces: `applyRpaCallback({ batchDirectory, currentTask, callback, token, requestIp })`.
- Produces: Fastify route `POST /api/rpa/callback`.
- Consumes: Task 4 executor reads callback state.

- [ ] **Step 1: Write failing callback tests**

Create `test/rpa-callbacks.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyRpaCallback } from "../src/rpa/callbacks.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rpa-callback-"));
  const batchDirectory = path.join(root, "batch-1");
  await mkdir(batchDirectory, { recursive: true });
  const task = { task_id: "task-1", execution_key: "key-1", status: "asset_confirmed" };
  await writeRpaState(batchDirectory, "task-1", { callback_token: "token-1", status: "asset_confirmed" });
  return { root, batchDirectory, task };
}

test("accepts valid submitted callback and writes rpa state", async () => {
  const f = await fixture();
  try {
    const result = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: "task-1",
        execution_key: "key-1",
        status: "submitted",
        phase: "remote_submit",
        remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
      }
    });
    assert.equal(result.accepted, true);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "submitted");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects wrong token, remote source, and stale execution key", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "wrong",
      requestIp: "127.0.0.1",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "key-1", status: "submitted" }
    }), /Invalid RPA callback token/);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "10.0.0.8",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "key-1", status: "submitted" }
    }), /localhost/);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "old", status: "submitted" }
    }), /execution_key/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("duplicate callback is idempotent and older callback does not regress", async () => {
  const f = await fixture();
  try {
    const submitted = {
      schema_version: 1,
      batch_id: "batch-1",
      task_id: "task-1",
      execution_key: "key-1",
      status: "submitted",
      phase: "remote_submit",
      remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
    };
    await applyRpaCallback({ batchDirectory: f.batchDirectory, currentTask: f.task, token: "token-1", requestIp: "::1", callback: submitted });
    const duplicate = await applyRpaCallback({ batchDirectory: f.batchDirectory, currentTask: f.task, token: "token-1", requestIp: "::1", callback: submitted });
    assert.equal(duplicate.duplicate, true);
    const older = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: { ...f.task, status: "submitted" },
      token: "token-1",
      requestIp: "::1",
      callback: { ...submitted, status: "asset_confirmed", phase: "asset_generation" }
    });
    assert.equal(older.accepted, false);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "submitted");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test test/rpa-callbacks.test.js
```

Expected: FAIL because `src/rpa/callbacks.js` does not exist.

- [ ] **Step 3: Implement callback guard**

Create `src/rpa/callbacks.js`:

```js
import { readRpaState, writeRpaState } from "./rpa-state.js";

const ORDER = new Map([
  ["generating_asset", 1],
  ["asset_confirmed", 2],
  ["submitted", 3],
  ["download_pending", 4],
  ["completed", 5],
  ["failed_pre_submit", 90],
  ["failed_remote", 91],
  ["interrupted_unknown", 92]
]);

function isLocalhost(ip) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function applyRpaCallback({ batchDirectory, currentTask, callback, token, requestIp }) {
  if (!isLocalhost(requestIp)) throw new Error("RPA callback must come from localhost");
  const state = await readRpaState(batchDirectory, callback?.task_id);
  if (!state || state.callback_token !== token) throw new Error("Invalid RPA callback token");
  if (callback.execution_key !== currentTask.execution_key) throw new Error("RPA callback execution_key mismatch");
  if (callback.task_id !== currentTask.task_id) throw new Error("RPA callback task_id mismatch");
  if (!ORDER.has(callback.status)) throw new Error(`Invalid RPA callback status: ${callback.status}`);

  if (state.last_callback && sameJson(state.last_callback, callback)) {
    return { accepted: true, duplicate: true, state };
  }

  const currentRank = ORDER.get(state.status || currentTask.status) || 0;
  const nextRank = ORDER.get(callback.status);
  if (nextRank < currentRank) {
    const nextState = await writeRpaState(batchDirectory, currentTask.task_id, {
      ignored_callback: callback,
      ignored_reason: "status_regression"
    });
    return { accepted: false, ignored: true, state: nextState };
  }

  const nextState = await writeRpaState(batchDirectory, currentTask.task_id, {
    status: callback.status,
    phase: callback.phase || null,
    remote_evidence: callback.remote_evidence || state.remote_evidence || null,
    artifact: callback.artifact || state.artifact || null,
    error: callback.error || null,
    last_callback: callback
  });
  return { accepted: true, duplicate: false, state: nextState };
}
```

- [ ] **Step 4: Implement route**

Create `src/server/routes/rpa-callbacks.js`:

```js
import path from "node:path";
import { applyRpaCallback } from "../../rpa/callbacks.js";

export async function registerRpaCallbackRoutes(app, { batchRoot, store }) {
  app.post("/api/rpa/callback", async (request, reply) => {
    const body = request.body || {};
    const batch = await store.read(body.batch_id);
    const task = batch.items.find((item) => item.task_id === body.task_id);
    if (!task) {
      reply.code(404);
      return { error: "TASK_NOT_FOUND" };
    }
    const result = await applyRpaCallback({
      batchDirectory: path.join(batchRoot, body.batch_id),
      currentTask: task,
      callback: body,
      token: request.headers["x-rpa-callback-token"],
      requestIp: request.ip
    });
    return { ok: true, result };
  });
}
```

Modify `src/server/app.js`:

```js
import { registerRpaCallbackRoutes } from "./routes/rpa-callbacks.js";
```

Register before static files:

```js
await registerRpaCallbackRoutes(app, { batchRoot, store });
```

- [ ] **Step 5: Add route error code if needed**

If callback route errors appear as `INTERNAL_ERROR`, add client codes to `CLIENT_ERROR_CODES` in `src/server/app.js`:

```js
"INVALID_RPA_CALLBACK",
"TASK_NOT_FOUND"
```

Use `Object.assign(error, { code: "INVALID_RPA_CALLBACK", statusCode: 400 })` inside callback helpers if route tests require precise 400s.

- [ ] **Step 6: Run focused tests**

```bash
node --test test/rpa-callbacks.test.js test/server-api.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/rpa/callbacks.js src/server/routes/rpa-callbacks.js src/server/app.js test/rpa-callbacks.test.js
git commit -m "feat: accept rpa callbacks safely"
```

---

### Task 4: Yingdao RPA Executor Mock Flow

**Files:**
- Modify: `src/executors/yingdao-rpa-executor.js`
- Test: `test/yingdao-rpa-executor.test.js`

**Interfaces:**
- Produces: `createYingdaoRpaExecutor({ root, config })`.
- Consumes: Task 2 task packages and state files; Task 3 callbacks/state.
- Produces executor methods required by `src/core/executor-adapter.js`.

- [ ] **Step 1: Write failing executor tests**

Create `test/yingdao-rpa-executor.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createYingdaoRpaExecutor } from "../src/executors/yingdao-rpa-executor.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "yingdao-executor-"));
  const batchDirectory = path.join(root, "batches", "batch-1");
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const image = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(image, "image");
  const task = {
    task_id: "task-1",
    execution_key: "key-1",
    sku: "SKU-1",
    image_path: image,
    status: "confirmed",
    resolved_script_mode: "hifly_ai"
  };
  const executor = createYingdaoRpaExecutor({
    root,
    config: {
      rpa: {
        callbackBaseUrl: "http://127.0.0.1:4317",
        assetTimeoutMs: 500,
        submitTimeoutMs: 500,
        queryTimeoutMs: 500,
        downloadTimeoutMs: 500,
        pollIntervalMs: 10
      }
    }
  });
  return { root, batchDirectory, task, executor };
}

test("createAsset writes package and resolves after asset_confirmed state", async () => {
  const f = await fixture();
  try {
    const pending = f.executor.createAsset(f.task, {
      batchId: "batch-1",
      checkpoint: async () => {}
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const state = await readRpaState(f.batchDirectory, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "asset_confirmed",
      asset: { asset_id: "rpa-asset-task-1" }
    });
    const asset = await pending;
    assert.equal(asset.asset_id, "rpa-asset-task-1");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("submitVideo returns direct submission evidence from rpa state", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", { callback_token: "token", status: "asset_confirmed" });
    const pending = f.executor.submitVideo(f.task, { asset_id: "asset" }, {
      batchId: "batch-1",
      checkpoint: async () => {}
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "submitted",
      remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
    });
    const result = await pending;
    assert.equal(result.status, "submitted");
    assert.equal(result.remoteEvidence.remote_id, "632410");
    assert.equal(result.remoteEvidence.evidence_source, "direct_submission");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("downloadArtifact returns artifact from completed rpa state", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "completed",
      artifact: { artifact_id: "632410", relative_path: "batches/batch-1/632410.mp4" }
    });
    const artifact = await f.executor.downloadArtifact({ remote_id: "632410", task_id: "task-1" }, f.batchDirectory, { batchId: "batch-1", taskId: "task-1" });
    assert.equal(artifact.artifact_id, "632410");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test test/yingdao-rpa-executor.test.js
```

Expected: FAIL because executor methods still throw not implemented.

- [ ] **Step 3: Implement polling utilities**

Replace `src/executors/yingdao-rpa-executor.js` with:

```js
import path from "node:path";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutError(phase) {
  const error = new Error(`Yingdao RPA timed out at ${phase}`);
  error.code = "YINGDAO_RPA_TIMEOUT";
  return error;
}

function directEvidence(remoteEvidence) {
  return {
    ...remoteEvidence,
    evidence_source: "direct_submission"
  };
}

export function createYingdaoRpaExecutor({ root, config = {} } = {}) {
  const rpa = config.rpa || {};
  const pollIntervalMs = rpa.pollIntervalMs ?? 1000;
  const callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";

  function batchDirectory(batchId) {
    return path.join(root, "batches", batchId);
  }

  async function waitFor(batchDir, taskId, predicate, timeoutMs, phase) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const state = await readRpaState(batchDir, taskId);
      if (state && predicate(state)) return state;
      await sleep(pollIntervalMs);
    }
    throw timeoutError(phase);
  }

  return {
    async createAsset(task, context = {}) {
      const dir = batchDirectory(context.batchId);
      const packageData = createRpaTaskPackage({
        batch: { batch_id: context.batchId, person_strategy: "auto_pool", script_strategy: "mixed" },
        task,
        batchDirectory: dir,
        callbackBaseUrl
      });
      const packagePath = await writeRpaTaskPackage({ batchDirectory: dir, taskId: task.task_id, packageData });
      await writeRpaState(dir, task.task_id, {
        status: "generating_asset",
        callback_token: packageData.callback_token,
        package_path: packagePath
      });
      const state = await waitFor(
        dir,
        task.task_id,
        (candidate) => ["asset_confirmed", "failed_pre_submit", "interrupted_unknown"].includes(candidate.status),
        rpa.assetTimeoutMs ?? config.batch?.defaultTimeoutMs ?? 600000,
        "asset_generation"
      );
      if (state.status !== "asset_confirmed") throw new Error(state.error?.message || `RPA asset failed with ${state.status}`);
      return state.asset || { asset_id: `rpa-asset-${task.task_id}` };
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "yingdao_rpa" } });
      const state = await waitFor(
        dir,
        task.task_id,
        (candidate) => ["submitted", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.submitTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "remote_submit"
      );
      if (state.status !== "submitted" || !state.remote_evidence?.remote_id) {
        return { status: "ambiguous", candidates: state.remote_candidates || [] };
      }
      return { status: "submitted", remoteEvidence: directEvidence(state.remote_evidence) };
    },

    async querySubmission(remoteEvidence, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const state = await waitFor(
        dir,
        taskId,
        (candidate) => ["download_pending", "completed", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.queryTimeoutMs ?? 120000,
        "remote_query"
      ).catch(() => null);
      if (!state) return { status: "submitted", remoteEvidence };
      if (state.status === "failed_remote") return { status: "failed" };
      if (state.status === "interrupted_unknown") return { status: "unknown" };
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const state = await waitFor(
        dir,
        taskId,
        (candidate) => candidate.status === "completed" && candidate.artifact,
        rpa.downloadTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "download"
      );
      return state.artifact;
    },

    async reconcileSubmission(task, checkpoint, context = {}) {
      const dir = batchDirectory(context.batchId);
      const state = await readRpaState(dir, task.task_id);
      const evidence = state?.remote_evidence ? [state.remote_evidence] : [];
      return { candidates: evidence };
    }
  };
}
```

- [ ] **Step 4: Run focused tests**

```bash
node --test test/yingdao-rpa-executor.test.js test/rpa-task-package.test.js test/rpa-callbacks.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/executors/yingdao-rpa-executor.js test/yingdao-rpa-executor.test.js
git commit -m "feat: add yingdao rpa executor skeleton"
```

---

### Task 5: End-To-End Mock State Machine And Timeout Recovery

**Files:**
- Modify: `src/executors/yingdao-rpa-executor.js`
- Modify: `src/core/batch-runner.js` only if timeout errors are not mapped to `interrupted_unknown`
- Test: `test/batch-runner.test.js`
- Test: `test/yingdao-rpa-executor.test.js`

**Interfaces:**
- Consumes: `YingdaoRpaExecutor` methods from Task 4.
- Produces: batch runner behavior where RPA timeout lands in `interrupted_unknown` and does not stay permanently active.

- [ ] **Step 1: Add failing timeout integration test**

Append to `test/batch-runner.test.js`:

```js
test("rpa timeout becomes interrupted_unknown instead of hanging active forever", async () => {
  const fixture = await fixtureRun({
    executor: {
      async createAsset() {
        const error = new Error("Yingdao RPA timed out at asset_generation");
        error.code = "YINGDAO_RPA_TIMEOUT";
        throw error;
      },
      async submitVideo() {},
      async querySubmission() {},
      async downloadArtifact() {},
      async reconcileSubmission() { return { candidates: [] }; }
    }
  });
  try {
    const result = await runBatch(fixture);
    assert.equal(result.items[0].status, "failed_pre_submit");
    assert.equal(result.items[0].error_phase, "asset_generation");
  } finally {
    await fixture.cleanup();
  }
});
```

If product decision says asset timeout should be `interrupted_unknown`, use this assertion instead:

```js
assert.equal(result.items[0].status, "interrupted_unknown");
```

Make the test match the final decision in `docs/superpowers/specs/2026-07-16-yingdao-rpa-executor-design.md`: RPA timeout at side-effecting RPA stages should be recoverable and not silently retry.

- [ ] **Step 2: Run test and verify current behavior**

```bash
node --test test/batch-runner.test.js --test-name-pattern "rpa timeout"
```

Expected: Either FAIL or reveal the current state mapping. Keep the expected status aligned with the spec.

- [ ] **Step 3: Map RPA timeout to recoverable state**

If the test requires `interrupted_unknown`, modify `pauseOrFailPreSubmit` in `src/core/batch-runner.js`:

```js
function isRecoverableRpaTimeout(error) {
  return error?.code === "YINGDAO_RPA_TIMEOUT";
}
```

Then update `pauseOrFailPreSubmit`:

```js
async function pauseOrFailPreSubmit(task, error, phase) {
  if (isPause(error)) {
    return annotate(task, { paused_auth: true, error_message: error.message }, phase);
  }
  if (isRecoverableRpaTimeout(error)) {
    return interruptUnknown(task, error, phase);
  }
  return transition(task, {
    type: "FAIL_PRE_SUBMIT",
    changes: { error_message: error.message, error_phase: phase }
  }, phase);
}
```

- [ ] **Step 4: Add completed mock flow test through `runBatch`**

Add a new helper executor in `test/batch-runner.test.js`:

```js
function createScriptedRpaExecutor() {
  return {
    async createAsset(task) {
      return { asset_id: `rpa-asset-${task.task_id}` };
    },
    async submitVideo() {
      return {
        status: "submitted",
        remoteEvidence: {
          evidence_source: "direct_submission",
          remote_id: "rpa-remote-1",
          work_key: "rpa-remote-1"
        }
      };
    },
    async querySubmission(remoteEvidence) {
      return { status: "ready", remoteEvidence };
    },
    async downloadArtifact(remoteEvidence) {
      return { artifact_id: remoteEvidence.remote_id, relative_path: "downloads/rpa-remote-1.mp4" };
    },
    async reconcileSubmission() {
      return { candidates: [] };
    }
  };
}
```

Add test:

```js
test("rpa executor can drive the normal runBatch lifecycle", async () => {
  const fixture = await fixtureRun({ executor: createScriptedRpaExecutor() });
  try {
    const result = await runBatch(fixture);
    assert.deepEqual(fixture.store.statusHistory("task-1"), [
      "confirmed", "generating_asset", "asset_confirmed",
      "submitted", "download_pending", "completed"
    ]);
    assert.equal(result.items[0].output_path, "downloads/rpa-remote-1.mp4");
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 5: Run focused tests**

```bash
node --test test/batch-runner.test.js test/yingdao-rpa-executor.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/batch-runner.js test/batch-runner.test.js test/yingdao-rpa-executor.test.js
git commit -m "fix: recover from rpa execution timeouts"
```

---

### Task 6: GUI Visibility, Docs, And Verification

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `docs/ENVIRONMENT.md`
- Modify: `docs/CALIBRATION.md`
- Modify: `docs/PROJECT_HANDOFF.md`
- Test: `test/server-api.test.js` or `test/gui-smoke.test.js` if UI text is testable without real Hifly

**Interfaces:**
- Consumes: `executionBackend` config and RPA state/callback files.
- Produces: user-visible execution backend and RPA troubleshooting docs.

- [ ] **Step 1: Add backend value to public status if needed**

If the GUI currently has no access to backend information, expose it in `buildApp` decoration or a lightweight endpoint. Preferred minimal route:

```js
app.get("/api/runtime", async () => ({
  executionBackend: generationConfig.executionBackend || "playwright"
}));
```

Add it in `src/server/app.js` before static registration.

- [ ] **Step 2: Add server API test**

Append to `test/server-api.test.js`:

```js
test("runtime endpoint exposes execution backend", async (t) => {
  const { app, root } = await fixture(createFakeExecutor(), {
    generationConfig: { executionBackend: "yingdao_rpa" }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/runtime", headers: { host: HOST } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().executionBackend, "yingdao_rpa");
});
```

- [ ] **Step 3: Render backend in GUI**

In `web/index.html`, add a small runtime badge near the batch/run controls:

```html
<span id="runtimeBackendBadge" class="runtime-badge">执行引擎：检测中</span>
```

In `web/app.js`, load `/api/runtime` on startup:

```js
async function loadRuntimeInfo() {
  const badge = document.querySelector("#runtimeBackendBadge");
  if (!badge) return;
  try {
    const runtime = await api.getRuntime();
    badge.textContent = `执行引擎：${runtime.executionBackend === "yingdao_rpa" ? "影刀 RPA" : "Playwright"}`;
  } catch {
    badge.textContent = "执行引擎：未知";
  }
}
```

In `web/api.js`, add:

```js
export async function getRuntime() {
  return request("/api/runtime");
}
```

Call `loadRuntimeInfo()` in the same startup section that loads batches.

- [ ] **Step 4: Document setup and current limits**

Update `docs/ENVIRONMENT.md` with:

```md
## 影刀 RPA 执行器

默认执行器仍是 Playwright。要启用影刀桥接版本，在 `config.local.json` 设置：

```json
{
  "executionBackend": "yingdao_rpa"
}
```

第一版只保证本地任务包、回调和 mock 流程。真实影刀客户端联调前需要：

1. 安装并登录影刀客户端。
2. 确认影刀流程能读取 `batches/<batch_id>/rpa/tasks/<task_id>.json`。
3. 确认影刀流程能 POST 到 `http://127.0.0.1:<port>/api/rpa/callback`。
4. 用户明确允许消耗飞影积分后再跑真实商品。
```
```

Update `docs/CALIBRATION.md` with:

```md
## 影刀 / 抓包校准

影刀版先跑 mock 回调，不直接消耗飞影积分。抓包 HTTP 化需要先采集飞影上传、手持图生成、视频提交、状态轮询和下载请求。若任一请求依赖动态签名、一次性 token 或风控，保持网页自动化兜底。
```

Update `docs/PROJECT_HANDOFF.md` with the completed implementation status, validation commands, and note that real Hifly was not run.

- [ ] **Step 5: Run full local verification**

Run:

```bash
node --test test/rpa-task-package.test.js test/rpa-callbacks.test.js test/yingdao-rpa-executor.test.js test/batch-runner.test.js test/server-api.test.js
npm run check
git diff --check
```

Expected: PASS. Record the exact counts in `docs/PROJECT_HANDOFF.md`.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/app.js web/api.js src/server/app.js test/server-api.test.js docs/ENVIRONMENT.md docs/CALIBRATION.md docs/PROJECT_HANDOFF.md
git commit -m "docs: document yingdao rpa bridge"
```

---

## Self-Review Checklist

- Spec coverage: execution backend, task package, callback auth, idempotency, status ordering, timeouts, recovery, GUI visibility, and docs are each mapped to a task.
- No real Hifly generation appears in this plan; all verification is local/mock until the user separately approves point consumption.
- Type consistency: plan uses `batch_id`, `task_id`, `execution_key`, `callback_token`, `remote_evidence`, and `artifact` consistently with the spec.
- Existing Playwright path remains default through `executionBackend: "playwright"`.
- The implementation order builds the bridge before any HAR/private API work.
