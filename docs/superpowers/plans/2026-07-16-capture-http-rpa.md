# Capture HTTP RPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动 Playwright 默认主链路的前提下，为 `yingdao_rpa` bridge 增加 `rpa.mode: "capture_http"` 抓包回放分支，第一版只做无积分本地实现（manifest parser、脱敏规则、mock HTTP client、capture flow 测试）。

**Architecture:** 抓包能力作为 `yingdao_rpa` 下的模式分支接入，复用现有 task package、callback token、rpa-state、executor adapter 五方法契约。capture executor 用 mock HTTP client 回放脱敏 manifest 里的飞影请求步骤，把结果写进 rpa-state，推进 `asset_confirmed → submitted → completed`，绝不发起真实网络请求、不消耗积分。

**Tech Stack:** Node.js（ES modules）、`node --test`、`node:assert/strict`、`node:fs/promises`、`node:path`。无新依赖。

## Global Constraints

- 不改默认 `executionBackend: "playwright"` 路径；`createExecutorForBackend` 缺省仍返回 playwright executor。
- 不删除、不重写 `src/executors/hifly-executor.js`、`src/executors/yingdao-rpa-executor.js`、`src/rpa/task-package.js`、`src/rpa/callbacks.js`、`src/rpa/rpa-state.js`。
- 不做 TagUI，不安装或开发 `tagui_rpa`。
- 不把原始 HAR、cookie、authorization、CSRF token、登录态、批次数据、下载视频、日志、截图、outputs、node_modules 提交到 git。
- 第一版 mock HTTP client 绝不调用 `fetch`/`http`/`https`/`net`，只回放已录制响应。
- 每个切片提交前至少跑：
  `node --test test/execution-backend-config.test.js test/rpa-task-package.test.js test/rpa-callbacks.test.js test/yingdao-rpa-executor.test.js test/batch-runner.test.js`
  再 `npm run check`、`git diff --check`。
- 真实飞影抓包或生成前必须先向用户确认会消耗积分，并只跑 1 条商品（不在本计划范围内）。
- 设计依据：`docs/superpowers/specs/2026-07-16-capture-http-rpa-design.md`。

## File Structure

新增文件职责：

- `src/rpa/capture/sensitive.js`：敏感键名检测，供 manifest 门禁和 redact 共用。
- `src/rpa/capture/manifest.js`：manifest 解析、加载、脱敏门禁、按阶段选取步骤。
- `src/rpa/capture/redact.js`：把原始抓包清洗成脱敏 manifest + 报告（离线工具，不在执行热路径）。
- `src/rpa/capture/mock-http-client.js`：按 stepId 回放录制响应、变量替换、produces 提取，无网络。
- `src/executors/capture-http-executor.js`：capture_http 执行器，复用 task package/token/state，靠 mock client 推进状态。
- `rpa/capture/fixtures/hifly-goods-sample.json`：脱敏示例 manifest，作为测试 fixture 与配置示例。
- 对应测试：`test/rpa-capture-sensitive.test.js`、`test/rpa-capture-manifest.test.js`、`test/rpa-capture-redact.test.js`、`test/rpa-capture-mock-http.test.js`、`test/capture-http-executor.test.js`。

修改文件：

- `src/server/start.js::createExecutorForBackend`：在 `yingdao_rpa` 分支内按 `config.rpa.mode` 分流 `capture_http`（默认分支不动）。
- `test/execution-backend-config.test.js`：补 capture_http 选择与默认分支回归。
- `config.example.json`：在 `rpa` 注释性示例里补充 `mode` 与 `manifestPath`（保持默认 `playwright` 不变）。
- `docs/PROJECT_HANDOFF.md`：每完成重要切片追加状态章节。

---

### Task 1: 敏感键名检测（shared sensitive-key helper）

**Files:**
- Create: `src/rpa/capture/sensitive.js`
- Test: `test/rpa-capture-sensitive.test.js`

**Interfaces:**
- Produces: `isSensitiveKey(name)`（布尔，大小写不敏感）、`SENSITIVE_KEY_PATTERNS`（字符串数组，供文档引用）、`findSensitiveKeys(value, basePath)`（递归扫描任意 JSON 值，返回命中路径数组）。

- [ ] **Step 1: Write the failing test**

```js
// test/rpa-capture-sensitive.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey, findSensitiveKeys } from "../src/rpa/capture/sensitive.js";

test("flags common secret header names case-insensitively", () => {
  assert.equal(isSensitiveKey("cookie"), true);
  assert.equal(isSensitiveKey("Set-Cookie"), true);
  assert.equal(isSensitiveKey("AUTHORIZATION"), true);
  assert.equal(isSensitiveKey("x-csrf-token"), true);
  assert.equal(isSensitiveKey("X-XSRF-TOKEN"), true);
});

test("does not flag ordinary business field names", () => {
  assert.equal(isSensitiveKey("image_id"), false);
  assert.equal(isSensitiveKey("work_id"), false);
  assert.equal(isSensitiveKey("status"), false);
  assert.equal(isSensitiveKey("content-type"), false);
});

test("flags keys whose names contain token/session/auth/ticket/sign/secret", () => {
  assert.equal(isSensitiveKey("session_id"), true);
  assert.equal(isSensitiveKey("access_token"), true);
  assert.equal(isSensitiveKey("sign"), true);
  assert.equal(isSensitiveKey("signature"), true);
  assert.equal(isSensitiveKey("ticket"), true);
});

test("findSensitiveKeys walks nested objects and arrays", () => {
  const hits = findSensitiveKeys(
    { steps: [{ request: { headers: { cookie: "x" } }, response: { body: { data: { access_token: "y" } } } }] },
    ""
  );
  assert.deepEqual(hits.sort(), ["steps[0].request.headers.cookie", "steps[0].response.body.data.access_token"].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rpa-capture-sensitive.test.js`
Expected: FAIL（`Cannot find module .../sensitive.js`）。

- [ ] **Step 3: Write minimal implementation**

```js
// src/rpa/capture/sensitive.js
const EXACT = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "csrf-token",
  "x-csrf-token",
  "x-xsrf-token"
]);

const SUBSTRING = ["token", "session", "auth", "ticket", "sign", "secret"];

export const SENSITIVE_KEY_PATTERNS = [...EXACT, ...SUBSTRING];

export function isSensitiveKey(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  const lower = name.toLowerCase();
  if (EXACT.has(lower)) return true;
  return SUBSTRING.some((needle) => lower.includes(needle));
}

export function findSensitiveKeys(value, basePath = "") {
  const hits = [];
  walk(value, basePath);
  return hits;

  function walk(node, currentPath) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${currentPath}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        if (isSensitiveKey(key)) hits.push(childPath);
        walk(child, childPath);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rpa-capture-sensitive.test.js`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/sensitive.js test/rpa-capture-sensitive.test.js
git commit -m "feat(rpa capture): add sensitive key detection"
```

---

### Task 2: Capture manifest parser + 脱敏门禁

**Files:**
- Create: `src/rpa/capture/manifest.js`
- Test: `test/rpa-capture-manifest.test.js`

**Interfaces:**
- Consumes: `isSensitiveKey`、`findSensitiveKeys` from `./sensitive.js`。
- Produces: `CAPTURE_PHASES`（`["asset_generation","remote_submit","remote_query","download"]`）、`parseCaptureManifest(input)`（输入对象或 JSON 字符串，返回冻结的校验过的 manifest 对象，命中敏感键或字段非法时抛错）、`loadCaptureManifest(filePath)`（异步读文件再 parse）、`selectStepsByPhase(manifest, phase)`、`findStep(manifest, stepId)`。

- [ ] **Step 1: Write the failing test**

```js
// test/rpa-capture-manifest.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CAPTURE_PHASES,
  parseCaptureManifest,
  loadCaptureManifest,
  selectStepsByPhase,
  findStep
} from "../src/rpa/capture/manifest.js";

const SAMPLE = {
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [
    {
      id: "upload_product_image",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/upload",
      placeholders: ["{{product_image_path}}"],
      response: { status: 200, body: { code: 0, data: { image_id: "img-1" } } },
      produces: { product_image_id: "$response.body.data.image_id" }
    },
    {
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/submit",
      placeholders: ["{{asset_id}}"],
      response: { status: 200, body: { code: 0, data: { work_id: "632410" } } },
      produces: { remote_id: "$response.body.data.work_id" }
    }
  ]
};

test("parses a valid sanitized manifest", () => {
  const manifest = parseCaptureManifest(SAMPLE);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.sanitized, true);
  assert.equal(manifest.steps.length, 2);
  assert.equal(Object.isFrozen(manifest), true);
});

test("selectStepsByPhase and findStep work", () => {
  const manifest = parseCaptureManifest(SAMPLE);
  assert.equal(selectStepsByPhase(manifest, "remote_submit").length, 1);
  assert.equal(findStep(manifest, "submit_video").method, "POST");
  assert.equal(findStep(manifest, "missing"), null);
});

test("rejects unsupported schema version", () => {
  assert.throws(() => parseCaptureManifest({ ...SAMPLE, schema_version: 2 }), /schema_version must be 1/);
});

test("rejects manifest that was not sanitized", () => {
  assert.throws(() => parseCaptureManifest({ ...SAMPLE, sanitized: false }), /sanitized/);
});

test("rejects duplicate step ids", () => {
  const bad = { ...SAMPLE, steps: [SAMPLE.steps[0], { ...SAMPLE.steps[0] }] };
  assert.throws(() => parseCaptureManifest(bad), /duplicate step id/i);
});

test("rejects unknown phase", () => {
  const bad = { ...SAMPLE, steps: [{ ...SAMPLE.steps[0], phase: "unknown_phase" }] };
  assert.throws(() => parseCaptureManifest(bad), /unknown phase/i);
});

test("redaction gate rejects a manifest still carrying cookies", () => {
  const bad = {
    ...SAMPLE,
    steps: [{ ...SAMPLE.steps[0], request: { headers: { cookie: "sid=secret" } } }]
  };
  assert.throws(() => parseCaptureManifest(bad), /sensitive/i);
});

test("loadCaptureManifest reads and parses a file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "capture-manifest-"));
  try {
    const file = path.join(dir, "manifest.json");
    await writeFile(file, JSON.stringify(SAMPLE));
    const manifest = await loadCaptureManifest(file);
    assert.equal(manifest.steps.length, 2);
  } finally {
    await import("node:fs/promises").then((m) => m.rm(dir, { recursive: true, force: true }));
  }
});

test("CAPTURE_PHASES lists the four executor phases", () => {
  assert.deepEqual(CAPTURE_PHASES, ["asset_generation", "remote_submit", "remote_query", "download"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rpa-capture-manifest.test.js`
Expected: FAIL（module not found）。

- [ ] **Step 3: Write minimal implementation**

```js
// src/rpa/capture/manifest.js
import { readFile } from "node:fs/promises";
import { findSensitiveKeys } from "./sensitive.js";

export const CAPTURE_PHASES = Object.freeze(["asset_generation", "remote_submit", "remote_query", "download"]);
const PHASE_SET = new Set(CAPTURE_PHASES);

function fail(message) {
  throw Object.assign(new Error(message), { code: "INVALID_CAPTURE_MANIFEST" });
}

function asObject(input) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      fail("manifest input string is not valid JSON");
    }
  }
  if (input && typeof input === "object") return input;
  fail("manifest input must be an object or JSON string");
}

function validateStep(step, index, seenIds) {
  if (!step || typeof step !== "object") fail(`steps[${index}] must be an object`);
  const { id, phase, method, url_template, response } = step;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) fail(`steps[${index}].id is invalid`);
  if (seenIds.has(id)) fail(`duplicate step id: ${id}`);
  seenIds.add(id);
  if (!PHASE_SET.has(phase)) fail(`unknown phase: ${phase}`);
  if (typeof method !== "string" || method.length === 0) fail(`steps[${index}].method must be a non-empty string`);
  if (typeof url_template !== "string" || url_template.length === 0) fail(`steps[${index}].url_template must be a non-empty string`);
  if (!response || typeof response !== "object") fail(`steps[${index}].response must be an object`);
  if (!Number.isInteger(response.status)) fail(`steps[${index}].response.status must be an integer`);
  if (response.body === undefined) fail(`steps[${index}].response.body is required`);
  if (step.placeholders !== undefined && !Array.isArray(step.placeholders)) fail(`steps[${index}].placeholders must be an array`);
  return {
    id,
    phase,
    method,
    url_template,
    placeholders: Array.isArray(step.placeholders) ? [...step.placeholders] : [],
    response: { status: response.status, body: structuredClone(response.body) },
    produces: step.produces && typeof step.produces === "object" ? { ...step.produces } : {}
  };
}

export function parseCaptureManifest(input) {
  const data = asObject(input);
  if (data.schema_version !== 1) fail("schema_version must be 1");
  if (data.sanitized !== true) fail("manifest must be sanitized before loading");
  if (!Array.isArray(data.steps) || data.steps.length === 0) fail("steps must be a non-empty array");

  const hits = findSensitiveKeys(data, "");
  if (hits.length > 0) fail(`manifest contains sensitive keys: ${hits.join(", ")}`);

  const seenIds = new Set();
  const steps = data.steps.map((step, index) => validateStep(step, index, seenIds));

  return Object.freeze({
    schema_version: 1,
    source: typeof data.source === "string" ? data.source : "",
    captured_at: typeof data.captured_at === "string" ? data.captured_at : null,
    sanitized: true,
    notes: typeof data.notes === "string" ? data.notes : null,
    steps: Object.freeze(steps)
  });
}

export async function loadCaptureManifest(filePath) {
  const raw = await readFile(filePath, "utf8");
  return parseCaptureManifest(JSON.parse(raw));
}

export function selectStepsByPhase(manifest, phase) {
  return manifest.steps.filter((step) => step.phase === phase);
}

export function findStep(manifest, stepId) {
  return manifest.steps.find((step) => step.id === stepId) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rpa-capture-manifest.test.js`
Expected: PASS（9 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/manifest.js test/rpa-capture-manifest.test.js
git commit -m "feat(rpa capture): add manifest parser with redaction gate"
```

---

### Task 3: 脱敏规则工具（offline redact）

**Files:**
- Create: `src/rpa/capture/redact.js`
- Test: `test/rpa-capture-redact.test.js`

**Interfaces:**
- Consumes: `isSensitiveKey`、`findSensitiveKeys` from `./sensitive.js`。
- Produces: `redactCaptureSource({ source, captured_at, steps })`，输入原始 step 数组（每项含 `id`、`phase`、`method`、`url_template`、可选 `request.headers`/`request.body`、`response.status`/`response.body`/`response.headers`、可选 `placeholders`/`produces`），返回 `{ sanitized, report }`：`sanitized` 是可直接 `parseCaptureManifest` 的对象；`report = { removed: string[], masked: string[] }`。

- [ ] **Step 1: Write the failing test**

```js
// test/rpa-capture-redact.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { redactCaptureSource } from "../src/rpa/capture/redact.js";
import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";

const RAW = {
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  steps: [
    {
      id: "upload_product_image",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/upload?sign=abc",
      placeholders: ["{{product_image_path}}"],
      request: { headers: { "content-type": "multipart/form-data", cookie: "sid=x", authorization: "Bearer t" } },
      response: { status: 200, headers: { "set-cookie": "sid=y" }, body: { code: 0, data: { image_id: "img-1", access_token: "secret" } } },
      produces: { product_image_id: "$response.body.data.image_id" }
    }
  ]
};

test("strips sensitive request/response headers", () => {
  const { sanitized, report } = redactCaptureSource(RAW);
  const step = sanitized.steps[0];
  assert.deepEqual(step.request.headers, { "content-type": "multipart/form-data" });
  assert.equal(step.response.headers, undefined);
  assert.ok(report.removed.some((p) => p.includes("cookie")));
  assert.ok(report.removed.some((p) => p.includes("authorization")));
  assert.ok(report.removed.some((p) => p.includes("set-cookie")));
});

test("masks sensitive body fields and records them", () => {
  const { sanitized, report } = redactCaptureSource(RAW);
  assert.equal(sanitized.steps[0].response.body.data.access_token, "[REDACTED]");
  assert.ok(report.masked.some((p) => p.includes("access_token")));
});

test("drops sensitive url query params", () => {
  const { sanitized } = redactCaptureSource(RAW);
  assert.equal(sanitized.steps[0].url_template, "https://hifly.cc/api/goods/upload");
});

test("output is loadable by parseCaptureManifest", () => {
  const { sanitized } = redactCaptureSource(RAW);
  const manifest = parseCaptureManifest(sanitized);
  assert.equal(manifest.sanitized, true);
});

test("report is safe: only paths, no secret values", () => {
  const { report } = redactCaptureSource(RAW);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes("sid=x"), false);
  assert.equal(blob.includes("Bearer t"), false);
  assert.equal(blob.includes("secret"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rpa-capture-redact.test.js`
Expected: FAIL（module not found）。

- [ ] **Step 3: Write minimal implementation**

```js
// src/rpa/capture/redact.js
import { isSensitiveKey } from "./sensitive.js";

const SENSITIVE_QUERY = ["token", "sign", "session", "ticket", "auth", "secret"];

function stripUrl(url) {
  if (typeof url !== "string") return url;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const search = new URLSearchParams(url.slice(queryStart + 1));
  for (const key of [...search.keys()]) {
    if (SENSITIVE_QUERY.some((needle) => key.toLowerCase().includes(needle))) search.delete(key);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function cleanHeaders(headers, basePath, removed) {
  if (!headers || typeof headers !== "object") return undefined;
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      removed.push(`${basePath}.${key}`);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function maskBody(node, basePath, masked) {
  if (Array.isArray(node)) return node.map((entry, i) => maskBody(entry, `${basePath}[${i}]`, masked));
  if (node && typeof node === "object") {
    const next = {};
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${basePath}.${key}`;
      if (isSensitiveKey(key)) {
        masked.push(childPath);
        next[key] = "[REDACTED]";
      } else {
        next[key] = maskBody(value, childPath, masked);
      }
    }
    return next;
  }
  return node;
}

export function redactCaptureSource({ source = "", captured_at = null, steps = [] } = {}) {
  const report = { removed: [], masked: [] };
  const sanitizedSteps = steps.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`steps[${index}] must be an object`);
    const step = {
      id: raw.id,
      phase: raw.phase,
      method: raw.method,
      url_template: stripUrl(raw.url_template),
      placeholders: Array.isArray(raw.placeholders) ? [...raw.placeholders] : [],
      response: {
        status: raw.response?.status,
        body: maskBody(raw.response?.body, `steps[${index}].response.body`, report.masked)
      },
      produces: raw.produces && typeof raw.produces === "object" ? { ...raw.produces } : {}
    };
    const requestHeaders = cleanHeaders(raw.request?.headers, `steps[${index}].request.headers`, report.removed);
    if (requestHeaders && Object.keys(requestHeaders).length > 0) step.request = { headers: requestHeaders };
    return step;
  });

  return {
    sanitized: {
      schema_version: 1,
      source,
      captured_at,
      sanitized: true,
      steps: sanitizedSteps
    },
    report
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rpa-capture-redact.test.js`
Expected: PASS（5 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/redact.js test/rpa-capture-redact.test.js
git commit -m "feat(rpa capture): add offline redaction tool"
```

---

### Task 4: Mock HTTP client（回放录制响应，无网络）

**Files:**
- Create: `src/rpa/capture/mock-http-client.js`
- Test: `test/rpa-capture-mock-http.test.js`

**Interfaces:**
- Consumes: `findStep` from `./manifest.js`。
- Produces: `createMockHttpClient({ manifest })` → `{ async request({ stepId, variables }) -> { status, body, produced } }`。`request` 用 `variables` 替换响应里的 `{{var}}`（仅字符串值），校验 `placeholders` 齐全，按 `produces` 提取变量。缺失/未知抛 `CAPTURE_MISSING_VARIABLE` / `CAPTURE_STEP_NOT_FOUND`。

- [ ] **Step 1: Write the failing test**

```js
// test/rpa-capture-mock-http.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { createMockHttpClient } from "../src/rpa/capture/mock-http-client.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [
    {
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/submit",
      placeholders: ["{{asset_id}}"],
      response: { status: 200, body: { code: 0, data: { work_id: "{{asset_id}}-work", echo: "{{asset_id}}" } } },
      produces: { remote_id: "$response.body.data.work_id" }
    }
  ]
});

test("replays a recorded response with variable substitution", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  const result = await client.request({ stepId: "submit_video", variables: { asset_id: "asset-9" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.work_id, "asset-9-work");
  assert.equal(result.body.data.echo, "asset-9");
  assert.equal(result.produced.remote_id, "asset-9-work");
});

test("throws on unknown step id", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  await assert.rejects(() => client.request({ stepId: "nope", variables: {} }), /CAPTURE_STEP_NOT_FOUND/);
});

test("throws when a declared placeholder variable is missing", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  await assert.rejects(() => client.request({ stepId: "submit_video", variables: {} }), /CAPTURE_MISSING_VARIABLE/);
});

test("does not expose any network-performing method", () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  assert.equal(typeof client.request, "function");
  assert.equal(client.fetch, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rpa-capture-mock-http.test.js`
Expected: FAIL（module not found）。

- [ ] **Step 3: Write minimal implementation**

```js
// src/rpa/capture/mock-http-client.js
import { findStep } from "./manifest.js";

function substitute(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
    );
  }
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, variables)]));
  }
  return value;
}

function extractProduced(produces, body) {
  const result = {};
  for (const [name, path] of Object.entries(produces || {})) {
    if (typeof path !== "string" || !path.startsWith("$response.body.")) {
      throw Object.assign(new Error(`unsupported produces path for ${name}: ${path}`), { code: "CAPTURE_PRODUCES_PATH" });
    }
    const segments = path.replace("$response.body.", "").split(".");
    let current = body;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        throw Object.assign(new Error(`produces path not found for ${name}: ${path}`), { code: "CAPTURE_PRODUCES_MISSING" });
      }
      current = current[segment];
    }
    result[name] = current;
  }
  return result;
}

export function createMockHttpClient({ manifest }) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createMockHttpClient requires a parsed manifest");
  }
  return {
    async request({ stepId, variables = {} }) {
      const step = findStep(manifest, stepId);
      if (!step) throw Object.assign(new Error(`Unknown capture step: ${stepId}`), { code: "CAPTURE_STEP_NOT_FOUND" });
      for (const placeholder of step.placeholders) {
        const name = placeholder.replace(/^\{\{|\}\}$/g, "");
        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          throw Object.assign(new Error(`Missing variable for step ${stepId}: ${name}`), { code: "CAPTURE_MISSING_VARIABLE" });
        }
      }
      const body = substitute(step.response.body, variables);
      const produced = extractProduced(step.produces, body);
      return { status: step.response.status, body, produced };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rpa-capture-mock-http.test.js`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/mock-http-client.js test/rpa-capture-mock-http.test.js
git commit -m "feat(rpa capture): add mock http client for offline replay"
```

---

### Task 5: 示例 fixture manifest（测试与配置共用）

**Files:**
- Create: `rpa/capture/fixtures/hifly-goods-sample.json`
- Test: 复用 Task 6 的集成测试加载它。

**Interfaces:**
- Produces: 一份脱敏示例 manifest，覆盖四个阶段，供 capture executor 集成测试和 `config.example.json` 引用。

- [ ] **Step 1: Write the fixture**

```json
// rpa/capture/fixtures/hifly-goods-sample.json
{
  "schema_version": 1,
  "source": "hifly_goods",
  "captured_at": "2026-07-16T00:00:00Z",
  "sanitized": true,
  "notes": "脱敏示例 manifest，仅用于本地回放测试，不含真实 cookie/token/签名",
  "steps": [
    {
      "id": "upload_product_image",
      "phase": "asset_generation",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/upload",
      "placeholders": ["{{product_image_path}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "image_id": "img-sample-001" } } },
      "produces": { "product_image_id": "$response.body.data.image_id" }
    },
    {
      "id": "create_hands_on_image",
      "phase": "asset_generation",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/hands-on",
      "placeholders": ["{{product_image_id}}", "{{person_image_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "asset_id": "asset-sample-001" } } },
      "produces": { "asset_id": "$response.body.data.asset_id" }
    },
    {
      "id": "submit_video",
      "phase": "remote_submit",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/submit",
      "placeholders": ["{{asset_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "work_id": "632410" } } },
      "produces": { "remote_id": "$response.body.data.work_id" }
    },
    {
      "id": "poll_video_status",
      "phase": "remote_query",
      "method": "GET",
      "url_template": "https://hifly.cc/api/goods/status/{{remote_id}}",
      "placeholders": ["{{remote_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "status": "ready" } } },
      "produces": {}
    },
    {
      "id": "download_video",
      "phase": "download",
      "method": "GET",
      "url_template": "https://hifly.cc/api/goods/download/{{remote_id}}",
      "placeholders": ["{{remote_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "filename": "632410.mp4", "size": 12345 } } },
      "produces": { "artifact_filename": "$response.body.data.filename" }
    }
  ]
}
```

- [ ] **Step 2: Verify the fixture parses**

Run: `node --test test/rpa-capture-manifest.test.js`
Expected: PASS（fixture 不破坏既有测试）。

- [ ] **Step 3: Commit**

```bash
git add rpa/capture/fixtures/hifly-goods-sample.json
git commit -m "feat(rpa capture): add sanitized sample manifest fixture"
```

---

### Task 6: capture_http 执行器分支 + 集成测试

**Files:**
- Create: `src/executors/capture-http-executor.js`
- Modify: `src/server/start.js`（`createExecutorForBackend` 的 `yingdao_rpa` 分支内按 `config.rpa.mode` 分流；默认分支与 playwright 不动）
- Test: `test/capture-http-executor.test.js`
- Modify: `test/execution-backend-config.test.js`（补 capture_http 选择与默认分支回归）

**Interfaces:**
- Consumes: `createRpaTaskPackage`/`writeRpaTaskPackage` from `../rpa/task-package.js`；`registerRpaCallbackToken`/`revokeRpaCallbackToken` from `../rpa/callback-token-registry.js`；`readRpaState`/`writeRpaState` from `../rpa/rpa-state.js`；`loadCaptureManifest`/`selectStepsByPhase` from `../rpa/capture/manifest.js`；`createMockHttpClient` from `../rpa/capture/mock-http-client.js`；`assertExecutorAdapter` from `../core/executor-adapter.js`。
- Produces: `createCaptureHttpExecutor({ root, config })`，满足 executor adapter 五方法；构造时不加载 manifest（懒加载），`createExecutorForBackend` 用 `config.rpa.mode === "capture_http"` 选择它。

- [ ] **Step 1: Write the failing integration test**

```js
// test/capture-http-executor.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptureHttpExecutor } from "../src/executors/capture-http-executor.js";
import { readRpaState } from "../src/rpa/rpa-state.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "..", "rpa", "capture", "fixtures", "hifly-goods-sample.json");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-exec-"));
  const batchId = "batch-cap-1";
  const batchDirectory = path.join(root, "batches", batchId);
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const imagePath = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(imagePath, "image-bytes");
  return { root, batchId, batchDirectory, imagePath, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("capture_http executor drives full asset -> submit -> download flow offline", async () => {
  const f = await fixture();
  try {
    const executor = createCaptureHttpExecutor({
      root: f.root,
      config: { rpa: { mode: "capture_http", manifestPath: FIXTURE, callbackBaseUrl: "http://127.0.0.1:4317" } }
    });
    const task = {
      task_id: "task-cap-1",
      execution_key: "key-1",
      sku: "SKU-1",
      product_name: "Alpha",
      selling_points: "useful",
      category: "toy",
      image_path: f.imagePath,
      resolved_person_image_path: f.imagePath,
      resolved_script_mode: "hifly_ai"
    };
    const context = { batchId: f.batchId, taskId: task.task_id, executionKey: task.execution_key };

    const asset = await executor.createAsset(task, context);
    assert.equal(asset.asset_id, "asset-sample-001");

    const submitted = await executor.submitVideo(task, asset, context);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.remoteEvidence.evidence_source, "direct_submission");
    assert.equal(submitted.remoteEvidence.remote_id, "632410");

    const queried = await executor.querySubmission(submitted.remoteEvidence, context);
    assert.equal(queried.status, "ready");

    const artifact = await executor.downloadArtifact(submitted.remoteEvidence, f.batchDirectory, context);
    assert.equal(artifact.artifact_id, "632410");
    assert.equal(path.isAbsolute(artifact.relative_path), false);
    const fileBuffer = await readFile(path.join(f.batchDirectory, artifact.relative_path));
    assert.ok(fileBuffer.length > 0);

    const state = await readRpaState(f.batchDirectory, task.task_id);
    assert.equal(state.status, "completed");
    assert.equal(state.artifact.relative_path, artifact.relative_path);
  } finally {
    await f.cleanup();
  }
});

test("capture_http executor satisfies the adapter contract", () => {
  const executor = createCaptureHttpExecutor({ root: process.cwd(), config: { rpa: { manifestPath: FIXTURE } } });
  for (const method of ["createAsset", "submitVideo", "querySubmission", "downloadArtifact", "reconcileSubmission"]) {
    assert.equal(typeof executor[method], "function");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/capture-http-executor.test.js`
Expected: FAIL（module not found）。

- [ ] **Step 3: Write the executor implementation**

```js
// src/executors/capture-http-executor.js
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { registerRpaCallbackToken, revokeRpaCallbackToken } from "../rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";
import { loadCaptureManifest, selectStepsByPhase } from "../rpa/capture/manifest.js";
import { createMockHttpClient } from "../rpa/capture/mock-http-client.js";

function batchDirectory(root, batchId) {
  if (typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) {
    throw new TypeError("context.batchId must be a valid local batch id");
  }
  return path.join(root, "batches", batchId);
}

function directEvidence(remoteEvidence) {
  return { ...remoteEvidence, evidence_source: "direct_submission" };
}

export function createCaptureHttpExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createCaptureHttpExecutor requires root");
  const rpa = config.rpa || {};
  const callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";
  let manifestCache = null;
  let clientCache = null;

  async function client() {
    if (!clientCache) {
      if (!manifestCache) {
        if (!rpa.manifestPath) throw Object.assign(new Error("rpa.manifestPath is required for capture_http mode"), { code: "CAPTURE_MANIFEST_MISSING" });
        const resolved = path.isAbsolute(rpa.manifestPath) ? rpa.manifestPath : path.resolve(root, rpa.manifestPath);
        manifestCache = await loadCaptureManifest(resolved);
      }
      clientCache = createMockHttpClient({ manifest: manifestCache });
    }
    return clientCache;
  }

  async function replayPhase(phase, variables) {
    const http = await client();
    const vars = { ...variables };
    for (const step of selectStepsByPhase(manifestCache, phase)) {
      const result = await http.request({ stepId: step.id, variables: vars });
      Object.assign(vars, result.produced);
    }
    return vars;
  }

  const executor = {
    setCallbackBaseUrl(value) {
      // accepted for symmetry with the yingdao bridge; stored on next package build
      this.__callbackBaseUrl = value;
    },

    async createAsset(task, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const baseUrl = this.__callbackBaseUrl || callbackBaseUrl;
      const packageData = createRpaTaskPackage({
        batch: { batch_id: context.batchId },
        task,
        batchDirectory: dir,
        callbackBaseUrl: baseUrl
      });
      const tokenScope = { batchDirectory: dir, taskId: task.task_id, executionKey: task.execution_key, token: packageData.callback_token };
      registerRpaCallbackToken(tokenScope);
      try {
        await writeRpaState(dir, task.task_id, { status: "generating_asset", callback_token: packageData.callback_token });
        await writeRpaTaskPackage({ batchDirectory: dir, taskId: task.task_id, packageData });
      } catch (error) {
        revokeRpaCallbackToken(tokenScope);
        throw error;
      }
      const produced = await replayPhase("asset_generation", {
        product_image_path: packageData.product_image_path,
        person_image_path: packageData.person_image_path
      });
      const asset = { asset_id: produced.asset_id || `capture-asset-${task.task_id}` };
      await writeRpaState(dir, task.task_id, { status: "asset_confirmed", asset, phase: "asset_generation" });
      revokeRpaCallbackToken(tokenScope);
      return asset;
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "capture_http" } });
      const produced = await replayPhase("remote_submit", { asset_id: asset?.asset_id });
      const remoteEvidence = directEvidence({
        remote_id: produced.remote_id,
        work_key: produced.remote_id,
        label: manifestCache?.captured_at || null
      });
      await writeRpaState(dir, task.task_id, { status: "submitted", phase: "remote_submit", remote_evidence: remoteEvidence });
      return { status: "submitted", remoteEvidence };
    },

    async querySubmission(remoteEvidence, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      await replayPhase("remote_query", { remote_id: remoteEvidence?.remote_id });
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const produced = await replayPhase("download", { remote_id: remoteEvidence?.remote_id });
      const filename = produced.artifact_filename || `${remoteEvidence?.remote_id}.mp4`;
      const absolutePath = path.join(dir, filename);
      await writeFile(absolutePath, `capture-http placeholder artifact for ${remoteEvidence?.remote_id}\n`);
      const artifact = { artifact_id: String(remoteEvidence?.remote_id), relative_path: path.relative(dir, absolutePath) };
      await writeRpaState(dir, context.taskId || remoteEvidence?.task_id, {
        status: "completed",
        phase: "download",
        remote_evidence: remoteEvidence,
        artifact
      });
      return artifact;
    },

    async reconcileSubmission(task, checkpoint, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const state = await readRpaState(dir, task.task_id);
      return { candidates: state?.remote_evidence ? [state.remote_evidence] : [] };
    }
  };

  return assertExecutorAdapter(executor);
}
```

- [ ] **Step 4: Wire capture_http into backend selection**

Modify `src/server/start.js` `createExecutorForBackend` (keep playwright default and default yingdao branch unchanged). Replace the `yingdao_rpa` block:

```js
  if (backend === "yingdao_rpa") {
    if (config.rpa?.mode === "capture_http") {
      const executor = createCaptureHttpExecutor({ root, config });
      return Object.assign(executor, { backend: "yingdao_rpa", mode: "capture_http" });
    }
    const executor = createYingdaoRpaExecutor({ root, config });
    return Object.assign(executor, { backend: "yingdao_rpa" });
  }
```

And add the import near the existing `yingdao-rpa-executor` import at the top of `src/server/start.js`:

```js
import { createCaptureHttpExecutor } from "../executors/capture-http-executor.js";
```

- [ ] **Step 5: Add backend selection regression tests**

Append to `test/execution-backend-config.test.js`:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "..", "rpa", "capture", "fixtures", "hifly-goods-sample.json");

test("yingdao_rpa defaults to the existing bridge when rpa.mode is unset", () => {
  const executor = createExecutorForBackend(process.cwd(), { executionBackend: "yingdao_rpa" });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, undefined);
});

test("yingdao_rpa with rpa.mode capture_http selects the capture executor", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { mode: "capture_http", manifestPath: FIXTURE }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, "capture_http");
});

test("playwright default is unaffected by rpa.mode capture_http", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "playwright",
    rpa: { mode: "capture_http", manifestPath: FIXTURE }
  });
  assert.equal(executor.backend, "playwright");
});
```

- [ ] **Step 6: Run the full required test suite + checks**

Run:
```bash
node --test test/execution-backend-config.test.js test/rpa-task-package.test.js test/rpa-callbacks.test.js test/yingdao-rpa-executor.test.js test/batch-runner.test.js test/capture-http-executor.test.js test/rpa-capture-sensitive.test.js test/rpa-capture-manifest.test.js test/rpa-capture-redact.test.js test/rpa-capture-mock-http.test.js
npm run check
git diff --check
```
Expected: 全部测试 PASS；`npm run check` 通过（新增的 `src/rpa/capture/*.js` 与 `src/executors/capture-http-executor.js` 被纳入检查）；`git diff --check` 无空白错误。

- [ ] **Step 7: Commit**

```bash
git add src/executors/capture-http-executor.js src/server/start.js test/capture-http-executor.test.js test/execution-backend-config.test.js
git commit -m "feat(rpa capture): add capture_http executor branch reusing rpa bridge"
```

---

### Task 7: 配置示例 + 文档 + 接力状态

**Files:**
- Modify: `config.example.json`（在 `rpa` 内补 `mode` 与 `manifestPath` 注释性示例，默认仍 `playwright`）
- Modify: `docs/PROJECT_HANDOFF.md`（追加 capture_http Phase 1 完成章节）
- Modify: `docs/CALIBRATION.md`（在「影刀 / 抓包校准」补一句 capture_http 本地回放已具备）

**Interfaces:** 无新代码接口。

- [ ] **Step 1: Update config example**

在 `config.example.json` 的 `rpa` 块内追加（保持 `executionBackend` 为 `playwright`）：

```json
  "rpa": {
    "mode": "default",
    "manifestPath": "rpa/capture/fixtures/hifly-goods-sample.json",
    "callbackBaseUrl": "http://127.0.0.1:4317",
    ...
  }
```

（`mode: "default"` 表示走现有 yingdao bridge；`"capture_http"` 才进入抓包回放分支。）

- [ ] **Step 2: Update PROJECT_HANDOFF**

在 `docs/PROJECT_HANDOFF.md` 最上方新增章节 `## 2026-07-16 抓包 HTTP RPA Phase 1 完成`，记录：新增文件清单、默认 playwright 未变、新增测试数量与命令、未访问飞影/未消耗积分、下一步为真实抓包需用户授权。

- [ ] **Step 3: Update CALIBRATION**

在 `docs/CALIBRATION.md`「影刀 / 抓包校准」段补一句：capture_http 本地回放链路（manifest parser + 脱敏 + mock client + executor）已具备，真实采集仍需先采集 HAR 并脱敏、且需用户授权积分。

- [ ] **Step 4: Run final verification**

Run:
```bash
node --test test/execution-backend-config.test.js test/rpa-task-package.test.js test/rpa-callbacks.test.js test/yingdao-rpa-executor.test.js test/batch-runner.test.js
npm run check
git diff --check
```
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add config.example.json docs/PROJECT_HANDOFF.md docs/CALIBRATION.md
git commit -m "docs: document capture_http rpa phase 1"
```

---

## 真实抓包与真实联调（不在本计划，需用户授权积分后再立新计划）

1. 用户明确授权后，用真实登录态采集「手里有货」HAR（上传、手持图、提交、轮询、下载），只针对 1 条商品。
2. 用 `redactCaptureSource` 清洗成 manifest，人工复核 `report` 无敏感残留，再入库。
3. 把 `rpa.mode` 切到 `capture_http`、`manifestPath` 指向真实 manifest，先验证回放能否复现远端 work_id。
4. 若某步骤依赖动态签名/一次性 token/风控，标记 `api_unavailable` 并保留网页自动化兜底（后续计划）。
5. 每次真实执行后记录批次 ID、SKU、飞影作品时间、下载路径、失败阶段。
