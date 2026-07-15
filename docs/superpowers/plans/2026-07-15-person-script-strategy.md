# Person And Script Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GUI-visible person sourcing and script sourcing strategies without breaking the verified Hifly “手里有货” batch flow.

**Architecture:** Keep strategy resolution in small core modules that run before browser automation. The GUI stores batch-level strategy fields, import/API routes persist them, and `src/hifly-page.js` only receives resolved task fields such as `resolved_person_image_path`, `resolved_person_source`, and `resolved_script_mode`.

**Tech Stack:** Node.js ES modules, Fastify server routes, vanilla browser JavaScript GUI, Node test runner, Playwright automation.

## Global Constraints

- Preserve the verified default path: if no person and no script are provided, existing batches continue to use person pool/Hifly recommendation and Hifly AI script generation.
- Do not call unpublished Hifly APIs.
- Real Hifly validation consumes points; do not run real generation without explicit user confirmation.
- Custom script failures must stop before outer “立即生成” and land in `failed_pre_submit`.
- Batch-level strategies apply to the whole batch in V1; no per-row strategy toggles in the GUI.
- Existing `person_image_path` remains highest priority for a single item.

---

## File Structure

- Create `src/core/person-strategy.js`: resolve batch/person strategy into per-item person fields.
- Create `src/core/script-strategy.js`: resolve batch/script strategy into per-item script mode and validate required script text.
- Modify `src/person-pool.js`: delegate to `person-strategy.js` while preserving existing exported behavior.
- Modify `src/core/product-validation.js`: include strategy-aware validation errors for required script and unavailable person source.
- Modify `src/server/routes/batches.js`: persist batch-level strategy fields and fixed person image artifact IDs.
- Modify `src/server/routes/imports.js`: accept strategy metadata and script column without changing the secure upload model.
- Modify `src/server/routes/executions.js`: pass batch strategies into execution preparation.
- Modify `src/hifly-page.js`: add custom script mode handling and AI toggle control before filling script text.
- Modify `web/index.html`, `web/app.js`, `web/api.js`, `web/styles.css`: expose strategy controls and script fields.
- Modify docs: `docs/SOP.md`, `docs/CALIBRATION.md`, `docs/PROJECT_HANDOFF.md`.
- Add tests: `test/person-strategy.test.js`, `test/script-strategy.test.js`, plus focused additions to `test/server-api.test.js`, `test/batch-runner.test.js`, and GUI-adjacent API tests.

---

### Task 1: Core Strategy Resolution

**Files:**
- Create: `src/core/person-strategy.js`
- Create: `src/core/script-strategy.js`
- Modify: `src/person-pool.js`
- Test: `test/person-strategy.test.js`
- Test: `test/script-strategy.test.js`

**Interfaces:**
- Produces: `resolvePersonStrategies(products, config, batchOptions = {}, logger)` returns products with `__resolved_person_image_path` and `resolved_person_source`.
- Produces: `resolveScriptStrategies(products, batchOptions = {})` returns products with `resolved_script_mode`.
- Produces: `validateScriptStrategy(product, scriptStrategy, row)` returns an array of validation issue objects.

- [ ] **Step 1: Write failing person strategy tests**

Add `test/person-strategy.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePersonStrategies } from "../src/core/person-strategy.js";

async function withPool(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-"));
  try {
    await fs.mkdir(path.join(root, "toy"), { recursive: true });
    await fs.mkdir(path.join(root, "default"), { recursive: true });
    await fs.writeFile(path.join(root, "toy", "toy-a.jpg"), "x");
    await fs.writeFile(path.join(root, "toy", "toy-b.jpg"), "x");
    await fs.writeFile(path.join(root, "default", "host.jpg"), "x");
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("explicit person image wins over batch strategy", async () => {
  await withPool(async (poolRoot) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy", person_image_path: "uploads/person.jpg" }
    ], {
      personPool: { enabled: true, rootDir: poolRoot, defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "hifly_recommended" });
    assert.equal(products[0].__resolved_person_image_path, "uploads/person.jpg");
    assert.equal(products[0].resolved_person_source, "explicit");
  });
});

test("auto_pool rotates category images and falls back to default", async () => {
  await withPool(async (poolRoot) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy" },
      { sku: "B", category: "toy" },
      { sku: "C", category: "beauty" }
    ], {
      personPool: { enabled: true, rootDir: poolRoot, defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "auto_pool" });
    assert.match(products[0].__resolved_person_image_path, /toy-a\.jpg$/);
    assert.match(products[1].__resolved_person_image_path, /toy-b\.jpg$/);
    assert.match(products[2].__resolved_person_image_path, /default\/host\.jpg$/);
    assert.equal(products[0].resolved_person_source, "category_pool");
    assert.equal(products[2].resolved_person_source, "default_pool");
  });
});

test("hifly_recommended leaves path empty and records source", async () => {
  const products = resolvePersonStrategies([
    { sku: "A", category: "toy" }
  ], {
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: { enabled: true, fallbackToRecommended: true }
  }, { person_strategy: "hifly_recommended" });
  assert.equal(products[0].__resolved_person_image_path, undefined);
  assert.equal(products[0].resolved_person_source, "hifly_recommended");
});

test("fixed_upload applies the fixed batch person unless item has explicit person", async () => {
  const products = resolvePersonStrategies([
    { sku: "A", category: "toy" },
    { sku: "B", category: "toy", person_image_path: "uploads/own.jpg" }
  ], {}, {
    person_strategy: "fixed_upload",
    fixed_person_image_path: "uploads/fixed.jpg"
  });
  assert.equal(products[0].__resolved_person_image_path, "uploads/fixed.jpg");
  assert.equal(products[0].resolved_person_source, "fixed_upload");
  assert.equal(products[1].__resolved_person_image_path, "uploads/own.jpg");
  assert.equal(products[1].resolved_person_source, "explicit");
});
```

- [ ] **Step 2: Write failing script strategy tests**

Add `test/script-strategy.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveScriptStrategies, validateScriptStrategy } from "../src/core/script-strategy.js";

test("hifly_ai ignores provided script and keeps AI mode", () => {
  const [item] = resolveScriptStrategies([
    { sku: "A", script: "请按品牌话术介绍。" }
  ], { script_strategy: "hifly_ai" });
  assert.equal(item.resolved_script_mode, "hifly_ai");
});

test("provided_script requires script and marks custom mode", () => {
  const [item] = resolveScriptStrategies([
    { sku: "A", script: "这是一条指定口播。" }
  ], { script_strategy: "provided_script" });
  assert.equal(item.resolved_script_mode, "custom");
  assert.deepEqual(validateScriptStrategy(item, "provided_script", 2), []);
  const errors = validateScriptStrategy({ sku: "B", script: "" }, "provided_script", 3);
  assert.equal(errors[0].code, "SCRIPT_REQUIRED");
  assert.equal(errors[0].row, 3);
});

test("mixed mode uses custom only when script exists", () => {
  const items = resolveScriptStrategies([
    { sku: "A", script: "指定口播。" },
    { sku: "B", script: "   " }
  ], { script_strategy: "mixed" });
  assert.equal(items[0].resolved_script_mode, "custom");
  assert.equal(items[1].resolved_script_mode, "hifly_ai");
});
```

- [ ] **Step 3: Run tests and confirm they fail**

Run:

```bash
node --test test/person-strategy.test.js test/script-strategy.test.js
```

Expected: FAIL because `src/core/person-strategy.js` and `src/core/script-strategy.js` do not exist.

- [ ] **Step 4: Implement `script-strategy.js`**

Create `src/core/script-strategy.js`:

```js
export const SCRIPT_STRATEGIES = new Set(["hifly_ai", "provided_script", "mixed"]);

export function normalizeScriptStrategy(value) {
  return SCRIPT_STRATEGIES.has(value) ? value : "mixed";
}

export function resolveScriptStrategies(products, batchOptions = {}) {
  const scriptStrategy = normalizeScriptStrategy(batchOptions.script_strategy);
  return products.map((product) => ({
    ...product,
    resolved_script_mode: resolveScriptMode(product, scriptStrategy)
  }));
}

export function resolveScriptMode(product, scriptStrategy) {
  if (scriptStrategy === "hifly_ai") return "hifly_ai";
  if (scriptStrategy === "provided_script") return "custom";
  return String(product.script || "").trim() ? "custom" : "hifly_ai";
}

export function validateScriptStrategy(product, scriptStrategy, row) {
  const normalized = normalizeScriptStrategy(scriptStrategy);
  if (normalized !== "provided_script") return [];
  if (String(product.script || "").trim()) return [];
  return [{
    code: "SCRIPT_REQUIRED",
    message: `row ${row}: script is required when script_strategy is provided_script.`,
    row,
    field: "script",
    sku: product.sku || ""
  }];
}
```

- [ ] **Step 5: Implement `person-strategy.js`**

Create `src/core/person-strategy.js`:

```js
import fs from "node:fs";
import path from "node:path";

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const PERSON_STRATEGIES = new Set(["auto_pool", "fixed_upload", "hifly_recommended"]);

export function normalizePersonStrategy(value) {
  return PERSON_STRATEGIES.has(value) ? value : "auto_pool";
}

export function resolvePersonStrategies(products, config = {}, batchOptions = {}, logger) {
  const strategy = normalizePersonStrategy(batchOptions.person_strategy);
  const counters = new Map();
  return products.map((product) => {
    if (product.person_image_path) {
      return withPerson(product, product.person_image_path, "explicit");
    }
    if (strategy === "fixed_upload" && batchOptions.fixed_person_image_path) {
      return withPerson(product, batchOptions.fixed_person_image_path, "fixed_upload");
    }
    if (strategy === "hifly_recommended") {
      return withRecommended(product, config);
    }
    const pooled = choosePoolImage(product.category, config, counters);
    if (pooled) return withPerson(product, pooled.path, pooled.source);
    logger?.info?.("person_pool_fallback_to_recommended", { sku: product.sku, category: product.category });
    return withRecommended(product, config);
  });
}

function withPerson(product, personPath, source) {
  return {
    ...product,
    __resolved_person_image_path: personPath,
    resolved_person_image_path: personPath,
    resolved_person_source: source
  };
}

function withRecommended(product, config) {
  const canUseRecommended = config.personPool?.fallbackToRecommended !== false
    && config.behavior?.useRecommendedPersonWhenMissing !== false;
  return {
    ...product,
    __resolved_person_image_path: undefined,
    resolved_person_image_path: "",
    resolved_person_source: canUseRecommended ? "hifly_recommended" : "unresolved"
  };
}

function choosePoolImage(category, config, counters) {
  if (!config.personPool?.enabled) return null;
  const categoryName = normalizePathSegment(category || config.personPool.defaultCategory || "default");
  const defaultCategory = normalizePathSegment(config.personPool.defaultCategory || "default");
  const categoryImages = listPoolImages(config, categoryName);
  if (categoryImages.length) {
    return { path: nextImage(categoryImages, categoryName, counters), source: "category_pool" };
  }
  const defaultImages = categoryName === defaultCategory ? [] : listPoolImages(config, defaultCategory);
  if (defaultImages.length) {
    return { path: nextImage(defaultImages, defaultCategory, counters), source: "default_pool" };
  }
  return null;
}

function nextImage(images, key, counters) {
  const index = counters.get(key) || 0;
  counters.set(key, index + 1);
  return images[index % images.length];
}

function listPoolImages(config, category) {
  const rootDir = config.personPool?.rootDir || "assets/person_pool";
  const dir = path.join(rootDir, category);
  if (!fs.existsSync(dir)) return [];
  const allowed = new Set((config.personPool?.allowedExtensions || DEFAULT_EXTENSIONS).map((ext) => ext.toLowerCase()));
  return fs.readdirSync(dir)
    .filter((file) => allowed.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => path.join(dir, file));
}

function normalizePathSegment(value) {
  return String(value || "default")
    .trim()
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}
```

- [ ] **Step 6: Update `src/person-pool.js` to delegate**

Replace its internal selection with:

```js
import { resolvePersonStrategies } from "./core/person-strategy.js";

export function assignPersonImages(products, config, logger) {
  return resolvePersonStrategies(products, config, {
    person_strategy: config.personPool?.strategy || "auto_pool"
  }, logger);
}
```

Keep any existing named exports that tests still import by re-exporting or preserving wrappers.

- [ ] **Step 7: Run core tests**

Run:

```bash
node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/person-strategy.js src/core/script-strategy.js src/person-pool.js test/person-strategy.test.js test/script-strategy.test.js
git commit -m "feat: resolve person and script strategies"
```

---

### Task 2: Persist Strategies Through GUI/API Imports

**Files:**
- Modify: `src/server/routes/batches.js`
- Modify: `src/server/routes/imports.js`
- Modify: `src/server/routes/executions.js`
- Modify: `web/api.js`
- Test: `test/server-api.test.js`

**Interfaces:**
- Consumes: `person_strategy`, `script_strategy`, `fixed_person_image_artifact_id` from GUI requests.
- Produces: public batch JSON containing those fields.

- [ ] **Step 1: Add failing server API tests**

Append to `test/server-api.test.js`:

```js
test("creates batches with person and script strategies", async () => {
  const { app } = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/batches",
      payload: {
        name: "Strategy batch",
        person_strategy: "hifly_recommended",
        script_strategy: "mixed"
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.batch.person_strategy, "hifly_recommended");
    assert.equal(body.batch.script_strategy, "mixed");
  } finally {
    await app.close();
  }
});

test("rejects invalid strategy values", async () => {
  const { app } = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/batches",
      payload: {
        person_strategy: "surprise",
        script_strategy: "robot"
      }
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run focused API tests and confirm fail**

Run:

```bash
node --test test/server-api.test.js
```

Expected: FAIL because `/api/batches` ignores or rejects the new fields incorrectly.

- [ ] **Step 3: Add strategy normalization in `batches.js`**

Modify `src/server/routes/batches.js`:

```js
const PERSON_STRATEGIES = new Set(["auto_pool", "fixed_upload", "hifly_recommended"]);
const SCRIPT_STRATEGIES = new Set(["hifly_ai", "provided_script", "mixed"]);

function normalizeBatchStrategies(body) {
  const person_strategy = body.person_strategy || "auto_pool";
  const script_strategy = body.script_strategy || "mixed";
  if (!PERSON_STRATEGIES.has(person_strategy)) {
    throw Object.assign(new Error("Invalid person_strategy"), { code: "INVALID_BATCH", statusCode: 400 });
  }
  if (!SCRIPT_STRATEGIES.has(script_strategy)) {
    throw Object.assign(new Error("Invalid script_strategy"), { code: "INVALID_BATCH", statusCode: 400 });
  }
  return {
    person_strategy,
    script_strategy,
    fixed_person_image_artifact_id: body.fixed_person_image_artifact_id || null
  };
}
```

When creating the batch, include:

```js
const strategies = normalizeBatchStrategies(request.body);
const batch = await store.create({
  batch_id: batchId,
  status: "needs_input",
  items: [],
  uploads: [],
  ...strategies
});
```

Ensure `publicBatch` includes these fields.

- [ ] **Step 4: Extend imports route to preserve strategies**

In `src/server/routes/imports.js`, read multipart fields:

```js
const metadata = {
  person_strategy: "auto_pool",
  script_strategy: "mixed",
  fixed_person_image_artifact_id: null
};
```

When a non-file multipart field arrives, set safe values:

```js
if (part.type === "field") {
  if (part.fieldname === "person_strategy") metadata.person_strategy = String(part.value || "auto_pool");
  if (part.fieldname === "script_strategy") metadata.script_strategy = String(part.value || "mixed");
  continue;
}
```

When updating the batch after import, persist:

```js
person_strategy: metadata.person_strategy,
script_strategy: metadata.script_strategy,
fixed_person_image_artifact_id: metadata.fixed_person_image_artifact_id
```

- [ ] **Step 5: Pass strategy fields into execution preparation**

In `src/server/routes/executions.js`, when preparing execution items, include batch strategy metadata in the context passed to validation/resolution:

```js
const batchOptions = {
  person_strategy: batch.person_strategy || "auto_pool",
  script_strategy: batch.script_strategy || "mixed",
  fixed_person_image_artifact_id: batch.fixed_person_image_artifact_id || null
};
```

Use this object in the task preparation call added in later tasks.

- [ ] **Step 6: Update browser API helper**

In `web/api.js`, when creating/importing batches, send strategy values:

```js
async function createBatch(payload) {
  return requestJson("/api/batches", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
```

For import multipart form:

```js
formData.append("person_strategy", options.person_strategy || "auto_pool");
formData.append("script_strategy", options.script_strategy || "mixed");
```

- [ ] **Step 7: Run API tests**

Run:

```bash
node --test test/server-api.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/batches.js src/server/routes/imports.js src/server/routes/executions.js web/api.js test/server-api.test.js
git commit -m "feat: persist batch generation strategies"
```

---

### Task 3: GUI Strategy Controls And Script Entry

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Test: `test/server-api.test.js`

**Interfaces:**
- Consumes: strategy fields supported by Task 2.
- Produces: single, bulk, and import batch requests containing `person_strategy`, `script_strategy`, and item `script`.

- [ ] **Step 1: Update HTML forms**

Add a strategy fieldset to each input panel:

```html
<fieldset class="strategy-panel">
  <legend>生成策略</legend>
  <label>
    <span>人物来源</span>
    <select name="personStrategy">
      <option value="auto_pool" selected>自动匹配人物池</option>
      <option value="fixed_upload">固定人物</option>
      <option value="hifly_recommended">飞影推荐人物</option>
    </select>
  </label>
  <label>
    <span>文案来源</span>
    <select name="scriptStrategy">
      <option value="mixed" selected>混合模式</option>
      <option value="hifly_ai">飞影 AI 自动文案</option>
      <option value="provided_script">使用导入文案</option>
    </select>
  </label>
</fieldset>
```

Add single script field:

```html
<label class="wide">
  <span>口播文案</span>
  <textarea id="script" name="script" rows="4" placeholder="可选。填写后可按文案策略提交给飞影。"></textarea>
</label>
```

Add bulk row script textarea in the row template created by `web/app.js`.

- [ ] **Step 2: Update `makeCsv` to include script**

In `web/app.js`:

```js
function makeCsv(rows) {
  const fields = ["sku", "product_name", "selling_points", "category", "image_path", "script"];
  return [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))
  ].join("\n");
}
```

- [ ] **Step 3: Include strategy and script in single submit**

In the single form submit handler, build row data with:

```js
const script = formData.get("script");
const person_strategy = formData.get("personStrategy") || "auto_pool";
const script_strategy = formData.get("scriptStrategy") || "mixed";
```

Send `person_strategy` and `script_strategy` to `api.createBatch`, and include `script` in the generated CSV row.

- [ ] **Step 4: Include script in bulk row serialization**

When reading each bulk row:

```js
script: row.querySelector("[name='script']").value.trim()
```

Use the top-level bulk form strategy fields for the batch.

- [ ] **Step 5: Include strategies in import submit**

Before calling API import:

```js
const options = {
  person_strategy: formData.get("personStrategy") || "auto_pool",
  script_strategy: formData.get("scriptStrategy") || "mixed"
};
await api.importBatch(batchId, tableFile, imageFiles, options);
```

- [ ] **Step 6: Add basic styling**

In `web/styles.css`:

```css
.strategy-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 16px;
  grid-column: 1 / -1;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin: 0;
  padding: 16px;
}

.strategy-panel legend {
  color: var(--muted);
  font-size: 13px;
  padding: 0 6px;
}
```

- [ ] **Step 7: Run checks**

Run:

```bash
npm run check
node --test test/server-api.test.js
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/app.js web/styles.css test/server-api.test.js
git commit -m "feat: add GUI strategy controls"
```

---

### Task 4: Validation And Execution Preparation

**Files:**
- Modify: `src/core/product-validation.js`
- Modify: `src/core/batch-runner.js`
- Modify: `src/server/routes/executions.js`
- Test: `test/product-validation.test.js`
- Test: `test/batch-runner.test.js`

**Interfaces:**
- Consumes: `resolvePersonStrategies` and `resolveScriptStrategies`.
- Produces: execution tasks with resolved person/script fields before browser automation starts.

- [ ] **Step 1: Add validation tests**

In `test/product-validation.test.js`, add:

```js
test("provided_script strategy requires script before execution", () => {
  const result = validateProducts([
    { sku: "A", product_name: "Alpha", selling_points: "One", category: "toy", image_path: "products/a.png", script: "" }
  ], testConfig(), { script_strategy: "provided_script" });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "SCRIPT_REQUIRED");
});
```

- [ ] **Step 2: Run validation test and confirm fail**

Run:

```bash
node --test test/product-validation.test.js
```

Expected: FAIL until validation accepts batch options.

- [ ] **Step 3: Update product validation signature**

Modify `src/core/product-validation.js` function signature:

```js
export function validateProducts(products, config, options = {}) {
```

After existing row validation, append:

```js
for (const issue of validateScriptStrategy(product, options.script_strategy || "mixed", row)) {
  errors.push(issue);
}
```

Also validate unresolved person source after resolution:

```js
if (product.resolved_person_source === "unresolved") {
  errors.push(issue("PERSON_SOURCE_REQUIRED", `row ${row}: no person source is available.`, {
    row,
    field: "person_image_path",
    sku: product.sku || ""
  }));
}
```

- [ ] **Step 4: Resolve strategies before execution snapshot**

In `src/server/routes/executions.js`, before creating the execution snapshot, transform items:

```js
let items = batch.items.map((item) => ({ ...item }));
items = resolvePersonStrategies(items, config, {
  person_strategy: batch.person_strategy || "auto_pool",
  fixed_person_image_path: resolveFixedPersonPath(batch)
}, logger);
items = resolveScriptStrategies(items, {
  script_strategy: batch.script_strategy || "mixed"
});
```

Define `resolveFixedPersonPath(batch)` to return an upload path for `fixed_person_image_artifact_id` only if that artifact belongs to the batch.

- [ ] **Step 5: Preserve resolved fields in batch runner**

In `src/core/batch-runner.js`, ensure state updates keep:

```js
resolved_person_image_path
resolved_person_source
resolved_script_mode
```

These fields must be included in execution snapshot inputs so editing them invalidates a confirmed execution.

- [ ] **Step 6: Run execution tests**

Run:

```bash
node --test test/product-validation.test.js test/batch-runner.test.js test/state-machine.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/product-validation.js src/core/batch-runner.js src/server/routes/executions.js test/product-validation.test.js test/batch-runner.test.js
git commit -m "feat: validate resolved generation strategies"
```

---

### Task 5: Hifly Custom Script Automation

**Files:**
- Modify: `src/hifly-page.js`
- Test: `test/batch-runner.test.js`

**Interfaces:**
- Consumes: task field `resolved_script_mode`.
- Produces: pre-submit failure if custom script cannot be applied.

- [ ] **Step 1: Add adapter tests for script mode**

In `test/batch-runner.test.js`, add a focused fake page test:

```js
test("fillProduct applies custom script mode before submit", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage(fakePage(), {
    hiflyUi: { productNameLabel: "产品名称", sellingPointsLabel: "核心卖点", scriptLabel: "文案" },
    behavior: {},
    batch: { defaultTimeoutMs: 1000 },
    debug: { captureSteps: false }
  }, { info() {} });
  adapter.resetExistingUpload = async () => calls.push("reset");
  adapter.createHandsOnImage = async () => calls.push("asset");
  adapter.fillOptionalField = async (_label, _value, field) => calls.push(`fill:${field}`);
  adapter.applyScriptMode = async (product) => calls.push(`script:${product.resolved_script_mode}`);
  await adapter.fillProduct({
    sku: "A",
    product_name: "Alpha",
    selling_points: "Useful",
    script: "指定口播。",
    resolved_script_mode: "custom"
  });
  assert.deepEqual(calls, ["reset", "asset", "fill:product_name", "fill:selling_points", "script:custom"]);
});
```

- [ ] **Step 2: Run test and confirm fail**

Run:

```bash
node --test test/batch-runner.test.js
```

Expected: FAIL because `fillProduct` does not call `applyScriptMode`.

- [ ] **Step 3: Update `fillProduct`**

In `src/hifly-page.js`, replace direct script fill with:

```js
await this.applyScriptMode(product);
```

Add method:

```js
async applyScriptMode(product) {
  const mode = product.resolved_script_mode || (product.script ? "custom" : "hifly_ai");
  if (mode === "hifly_ai") return;
  if (!String(product.script || "").trim()) {
    throw new Error("Custom script mode requires product.script before Hifly submission.");
  }
  await this.disableAiScriptGeneration(product);
  await this.fillOptionalField(this.config.hiflyUi.scriptLabel, product.script, "script");
  await this.verifyScriptText(product);
}
```

- [ ] **Step 4: Implement AI switch control**

Add methods:

```js
async disableAiScriptGeneration(product) {
  const timeout = this.config.batch.defaultTimeoutMs;
  const section = this.page.locator("xpath=.//*[contains(normalize-space(.), 'AI 自动生成')]/ancestor::*[self::div or self::section][1]").first();
  const toggle = section.getByRole("switch").first();
  if (!await toggle.count().catch(() => 0)) {
    await this.captureStep(product, "script-ai-toggle-missing");
    throw new Error("Could not find AI 自动生成 switch before filling custom script.");
  }
  const checked = await toggle.getAttribute("aria-checked").catch(() => null);
  if (checked !== "false") {
    await toggle.click({ timeout, force: true });
    await this.page.waitForTimeout(500);
  }
  const after = await toggle.getAttribute("aria-checked").catch(() => null);
  if (after !== "false") {
    await this.captureStep(product, "script-ai-toggle-not-disabled");
    throw new Error("AI 自动生成 switch did not turn off before filling custom script.");
  }
}

async verifyScriptText(product) {
  const label = this.config.hiflyUi.scriptLabel;
  if (!label) throw new Error("hiflyUi.scriptLabel is required for custom script mode.");
  const expected = String(product.script || "").trim();
  const value = await this.readFieldValue(label).catch(() => "");
  if (!String(value || "").includes(expected.slice(0, Math.min(20, expected.length)))) {
    await this.captureStep(product, "script-fill-not-verified");
    throw new Error("Custom script text could not be verified after filling.");
  }
  await this.captureStep(product, "script-filled");
}

async readFieldValue(label) {
  const byLabel = this.page.getByLabel(label, { exact: false }).first();
  if (await byLabel.count()) return await byLabel.inputValue();
  const byPlaceholder = this.page.getByPlaceholder(label, { exact: false }).first();
  if (await byPlaceholder.count()) return await byPlaceholder.inputValue();
  throw new Error(`Could not find input for label or placeholder: ${label}`);
}
```

If real Hifly uses a non-standard switch, adjust selectors after no-point calibration, but keep the failure before submit.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/batch-runner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hifly-page.js test/batch-runner.test.js
git commit -m "feat: apply custom Hifly scripts safely"
```

---

### Task 6: Documentation, Handoff, And Verification

**Files:**
- Modify: `docs/SOP.md`
- Modify: `docs/CALIBRATION.md`
- Modify: `docs/PROJECT_HANDOFF.md`

**Interfaces:**
- Produces: operator instructions for person pools, script strategies, and calibration.

- [ ] **Step 1: Update SOP**

Add to `docs/SOP.md`:

```markdown
## 人物与文案策略

默认使用“自动匹配人物池 + 混合文案模式”。

- 人物池按 `category` 轮换，找不到品类池时使用 `default`，仍找不到时使用飞影推荐人物。
- 商品表或 GUI 中填写 `script` 时，混合模式会尝试关闭飞影“AI 自动生成”并填入自定义口播。
- 若客户没有合规话术要求，可以留空 `script`，继续使用飞影 AI 自动文案。
```

- [ ] **Step 2: Update calibration doc**

Add to `docs/CALIBRATION.md`:

```markdown
## 自定义文案校准

自定义文案依赖飞影页面的“AI 自动生成”开关。首次使用前只跑 1 条校准样片：

1. 设置文案策略为“使用导入文案”。
2. 填入 50-80 字口播。
3. 确认截图中 `script-filled` 出现，并且外层提交前没有报错。

如果开关定位失败，任务会停在 `failed_pre_submit`，不会继续消耗外层视频生成积分。
```

- [ ] **Step 3: Update handoff**

Add a latest section to `docs/PROJECT_HANDOFF.md` with:

```markdown
2026-07-15：已实现 GUI 人物与文案策略。默认仍为 auto_pool + mixed。自定义文案真实飞影链路尚需 1 条积分样片校准。
```

- [ ] **Step 4: Run full local verification**

Run:

```bash
node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js
npm run check
```

Expected: all tests PASS and `Checked 41 JavaScript file(s).`

- [ ] **Step 5: Commit**

```bash
git add docs/SOP.md docs/CALIBRATION.md docs/PROJECT_HANDOFF.md
git commit -m "docs: document generation strategies"
```

---

## Final Acceptance

After all tasks:

```bash
git status --short --branch
node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js
npm run check
```

Acceptance criteria:

- Existing default flow remains unchanged for products without script/person overrides.
- GUI can create/import a batch with `person_strategy` and `script_strategy`.
- GUI can capture `script` for single and bulk rows.
- Custom script mode refuses to continue when AI auto generation cannot be disabled.
- No real Hifly run is performed without explicit user approval.
