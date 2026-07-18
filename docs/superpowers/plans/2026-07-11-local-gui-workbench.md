# 飞影本地 GUI 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有飞影 Playwright 自动化上交付一个 Mac/Windows 通用的本地网页工作台，支持单条录入、CSV/XLSX 批量导入、素材上传、校验、积分确认、安全的一键运行、恢复和成片下载。

**Architecture:** 将现有 CLI 重构为无进程副作用的业务模块，并通过可替换 executor adapter 连接真实飞影或假执行器。Fastify 本地服务仅监听 `127.0.0.1`，以批次 JSON 文件持久化状态，使用全局排他锁和幂等快照保护积分操作；原生 HTML/CSS/JavaScript 工作台调用同源 JSON API。

**Tech Stack:** Node.js 20+、ES modules、Node test runner、Fastify、`@fastify/multipart`、`@fastify/static`、ExcelJS、`csv-parse`、`file-type`、Sharp、Playwright、原生 HTML/CSS/JavaScript。

## Global Constraints

- 服务只监听 `127.0.0.1`，不能绑定 `0.0.0.0`。
- 最低环境为 Node.js 20、macOS 12+、Windows 10+；统一启动命令为 `npm run gui`。
- GUI 业务模块不得通过 shell 拼接用户输入，不得解析 CLI 控制台文本。
- 飞影账号密码、浏览器登录态和会话令牌不得进入页面数据、URL、日志或 Git。
- 未通过校验、未确认积分快照或未获得全局排他锁时，不得启动 Playwright。
- 同一时刻只允许一个批次使用飞影登录态；未知提交边界不得自动重试生成。
- 测试默认注入假执行器，不访问飞影、不消耗积分。
- 验收与测试阶段必须由未参与实现的独立 subagent 执行并提供证据。

## File Structure

- `src/core/project-root.js`：与当前工作目录无关的项目根目录解析。
- `src/core/product-validation.js`：共享商品校验和结构化结果。
- `src/core/batch-runner.js`：共享批处理编排与结构化事件。
- `src/core/executor-adapter.js`：真实/假执行器契约与事件校验。
- `src/core/batch-store.js`：批次目录、原子 JSON 持久化和 artifact 清单。
- `src/core/state-machine.js`：任务转移和批次汇总。
- `src/core/execution-lock.js`：跨进程排他锁、心跳和释放。
- `src/core/execution-snapshot.js`：积分快照、内容摘要和幂等 key。
- `src/import/import-table.js`：CSV/XLSX 确定性解析。
- `src/import/match-uploads.js`：上传图片与任务匹配。
- `src/server/app.js`：Fastify app、同源安全和 API 组装。
- `src/server/start.js`：端口选择、浏览器打开和优雅退出。
- `src/server/upload-service.js`：流式上传、文件签名/解码及安全命名。
- `src/server/routes/*.js`：批次、导入、执行和 artifact 路由。
- `src/executors/hifly-executor.js`：现有飞影页面对象 adapter。
- `src/executors/fake-executor.js`：无积分测试 adapter。
- `web/index.html`、`web/styles.css`、`web/app.js`：本地工作台。
- `test/**/*.test.js`：单元与集成测试。
- `test/fixtures/`：受控图片、CSV/XLSX 和假执行事件。

---

### Task 1: 建立测试与跨平台基础

**Files:**
- Modify: `package.json`
- Create: `src/core/project-root.js`
- Create: `test/project-root.test.js`

**Interfaces:**
- Produces: `getProjectRoot(metaUrl?) -> string`、`resolveProjectPath(...segments) -> string`。
- Consumes: Node.js `fileURLToPath`、`path.dirname`、`path.resolve`。

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getProjectRoot, resolveProjectPath } from "../src/core/project-root.js";

test("project root is independent of process.cwd", () => {
  const root = getProjectRoot();
  assert.equal(resolveProjectPath("products"), path.join(root, "products"));
  assert.equal(path.basename(root), "Product Recommendation clip");
});
```

- [ ] **Step 2: 运行红灯**

Run: `node --test test/project-root.test.js`  
Expected: FAIL，提示 `src/core/project-root.js` 不存在。

- [ ] **Step 3: 实现根目录模块**

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export function getProjectRoot() { return ROOT; }
export function resolveProjectPath(...segments) { return path.join(ROOT, ...segments); }
```

在 `package.json` 添加：

```json
"scripts": {
  "test": "node --test",
  "gui": "node src/server/start.js"
}
```

并安装固定主版本依赖：`fastify`、`@fastify/multipart`、`@fastify/static`、`exceljs`、`csv-parse`、`file-type`、`sharp`、`open`。

- [ ] **Step 4: 运行绿灯和现有检查**

Run: `npm test`  
Expected: PASS，1 test。  
Run: `npm run check`  
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/core/project-root.js test/project-root.test.js
git commit -m "build: add local GUI runtime foundation"
```

### Task 2: 抽取共享校验与执行器接口

**Files:**
- Create: `src/core/product-validation.js`
- Create: `src/core/executor-adapter.js`
- Modify: `src/validate-products.js`
- Modify: `src/run-batch.js`
- Test: `test/product-validation.test.js`
- Test: `test/executor-adapter.test.js`

**Interfaces:**
- Produces: `validateProducts({products, config, batchPaths}) -> {valid, items, errors, warnings}`。
- Produces: `assertExecutorAdapter(adapter)`、`emitExecutionEvent(onEvent, event)`。
- Consumes: 现有 `loadProducts`、`assignPersonImages`、`resolveFromRoot`。

- [ ] **Step 1: 写结构化校验失败测试**

```js
test("validation returns field errors without exiting", () => {
  const result = validateProducts({
    products: [{ sku: "A", product_name: "", category: "beauty", image_path: "missing.png" }],
    config: fixtureConfig,
    batchPaths: fixturePaths
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(x => x.code), ["PRODUCT_NAME_REQUIRED", "IMAGE_NOT_FOUND"]);
});
```

- [ ] **Step 2: 写 adapter 契约失败测试**

```js
test("adapter requires every recovery method", () => {
  assert.throws(() => assertExecutorAdapter({ createAsset() {} }), /submitVideo/);
});
```

- [ ] **Step 3: 运行红灯**

Run: `node --test test/product-validation.test.js test/executor-adapter.test.js`  
Expected: FAIL，两个核心模块不存在。

- [ ] **Step 4: 实现共享模块和薄 CLI**

`executor-adapter.js` 固定方法：

```js
export const EXECUTOR_METHODS = [
  "createAsset", "submitVideo", "querySubmission",
  "downloadArtifact", "reconcileSubmission"
];
```

事件必须包含：`type`、`batchId`、`taskId`、`executionKey`、`phase`、`timestamp`。`validate-products.js` 只加载文件、调用 `validateProducts`、打印错误并设置 `process.exitCode`；`run-batch.js` 只解析 CLI 选择项并调用后续 `runBatch`。

- [ ] **Step 5: 验证 CLI 回归**

Run: `npm run validate`  
Expected: `Validated 3 product row(s)`，exit 0。  
Run: `npm test`  
Expected: 所有测试通过。

- [ ] **Step 6: Commit**

```bash
git add src/core/product-validation.js src/core/executor-adapter.js src/validate-products.js src/run-batch.js test/product-validation.test.js test/executor-adapter.test.js
git commit -m "refactor: expose shared validation and executor contracts"
```

### Task 3: 状态机、批次存储、积分快照与全局锁

**Files:**
- Create: `src/core/state-machine.js`
- Create: `src/core/batch-store.js`
- Create: `src/core/execution-snapshot.js`
- Create: `src/core/execution-lock.js`
- Test: `test/state-machine.test.js`
- Test: `test/batch-store.test.js`
- Test: `test/execution-lock.test.js`

**Interfaces:**
- Produces: `transitionTask(task, event) -> task`、`summarizeBatch(items) -> status`。
- Produces: `createBatchStore(root)`，含 `create/read/update/list/registerArtifact`。
- Produces: `createExecutionSnapshot(items, estimateConfig) -> {executionKey, digest, estimate}`。
- Produces: `acquireExecutionLock({root,batchId,instanceId}) -> lockHandle`。

- [ ] **Step 1: 写状态转移与幂等测试**

```js
test("editing a confirmed task invalidates confirmation", () => {
  const next = transitionTask({ status: "confirmed", execution_key: "x" }, { type: "EDIT" });
  assert.equal(next.status, "pending");
  assert.equal(next.execution_key, null);
});

test("ambiguous recovery cannot become pending", () => {
  assert.throws(() => transitionTask({ status: "interrupted_unknown" }, { type: "RETRY_GENERATION" }));
});
```

- [ ] **Step 2: 写原子存储与锁竞争测试**

```js
test("only one process-level lock acquisition succeeds", async () => {
  const [a, b] = await Promise.allSettled([
    acquireExecutionLock(opts), acquireExecutionLock(opts)
  ]);
  assert.equal([a, b].filter(x => x.status === "fulfilled").length, 1);
});
```

- [ ] **Step 3: 运行红灯**

Run: `node --test test/state-machine.test.js test/batch-store.test.js test/execution-lock.test.js`  
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现状态表和批次汇总**

用显式对象定义允许转移，不在路由中散落状态判断。批次优先级：`interrupted_unknown`、活跃执行、`paused_auth`、失败、待输入/待执行、全部完成。`batch-store` 使用同目录临时文件 + `rename` 原子替换 `batch.json`。

- [ ] **Step 5: 实现排他锁与快照**

锁使用 `fs.open(path, "wx")` 获取，5 秒心跳、30 秒可疑阈值；释放核对 `instanceId` 和 `batchId`。快照使用排序后的任务执行字段和图片摘要生成 SHA-256；未知积分返回 `known: false`，不按零计算。

- [ ] **Step 6: 运行绿灯**

Run: `node --test test/state-machine.test.js test/batch-store.test.js test/execution-lock.test.js`  
Expected: PASS。  
Run: `npm test`  
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/core/state-machine.js src/core/batch-store.js src/core/execution-snapshot.js src/core/execution-lock.js test/state-machine.test.js test/batch-store.test.js test/execution-lock.test.js
git commit -m "feat: persist safe batch execution state"
```

### Task 4: 安全上传、CSV/XLSX 解析和图片匹配

**Files:**
- Create: `src/server/upload-service.js`
- Create: `src/import/import-table.js`
- Create: `src/import/match-uploads.js`
- Create: `test/fixtures/products.csv`
- Create: `test/import-table.test.js`
- Create: `test/match-uploads.test.js`
- Create: `test/upload-service.test.js`

**Interfaces:**
- Produces: `storeUpload(stream, metadata, batchPaths) -> UploadRecord`。
- Produces: `importProductTable(filePath) -> {sheetName, rows, errors, unknownColumns}`。
- Produces: `matchUploads(rows, uploads) -> {items, errors}`。

- [ ] **Step 1: 写恶意上传与歧义匹配测试**

```js
test("rejects traversal and forged image content", async () => {
  await assert.rejects(() => storeUpload(streamOf("not png"), {
    filename: "../SKU001.png", declaredMime: "image/png"
  }, paths), /INVALID_IMAGE/);
});

test("two extensions for one SKU are ambiguous", () => {
  const result = matchUploads([{ sku: "SKU001", image_path: "" }], [
    upload("SKU001.jpg"), upload("sku001.png")
  ]);
  assert.equal(result.errors[0].code, "AMBIGUOUS_PRODUCT_IMAGE");
});
```

- [ ] **Step 2: 写 CSV/XLSX 规则测试**

覆盖 UTF-8 BOM、重复表头、前导零 SKU、首个可见 sheet、公式无缓存值和未知列。每个测试断言具体错误码，不匹配错误文案。

- [ ] **Step 3: 运行红灯**

Run: `node --test test/upload-service.test.js test/import-table.test.js test/match-uploads.test.js`  
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现流式上传和文件边界**

图片最大 10MB、表格最大 20MB、批次最大 500 文件/1GB；先写 `.uploading` 临时文件，使用 `file-type` 检查签名并由 Sharp 读取元数据，限制像素数，成功后用 UUID 内部名原子改名。拒绝目录、symlink、绝对路径和父目录。artifact 只返回 ID，不返回任意磁盘路径。

- [ ] **Step 5: 实现确定性导入和匹配**

CSV 使用 `csv-parse` 的 BOM 和列模式；ExcelJS 读取第一个可见工作表和已保存值。规范化函数：`trim()` + Unicode NFC + 小写仅用于比较；实际 SKU 保留原大小写与前导零。优先精确逻辑名称，再匹配 SKU 文件名主体；歧义即报错。

- [ ] **Step 6: 运行绿灯**

Run: `node --test test/upload-service.test.js test/import-table.test.js test/match-uploads.test.js`  
Expected: PASS。  
Run: `npm test`  
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/server/upload-service.js src/import test/fixtures test/upload-service.test.js test/import-table.test.js test/match-uploads.test.js
git commit -m "feat: add secure product import pipeline"
```

### Task 5: 真实与假飞影执行器、检查点和恢复

**Files:**
- Create: `src/executors/hifly-executor.js`
- Create: `src/executors/fake-executor.js`
- Create: `src/core/batch-runner.js`
- Modify: `src/hifly-page.js`
- Modify: `src/run-batch.js`
- Test: `test/batch-runner.test.js`
- Test: `test/recovery.test.js`

**Interfaces:**
- Consumes: Task 2 adapter、Task 3 store/state/lock/snapshot。
- Produces: `createHiflyExecutor(config)`、`createFakeExecutor(scenario)`。
- Produces: `runBatch({batchId,items,config,paths,signal,onEvent,executor,store,lock})`。

- [ ] **Step 1: 写无积分正常链路测试**

```js
test("persists checkpoints around submit and download", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  await runBatch(fixtureRun({ executor }));
  assert.deepEqual(store.statusHistory("task-1"), [
    "confirmed", "generating_asset", "asset_confirmed",
    "submitted", "download_pending", "completed"
  ]);
});
```

- [ ] **Step 2: 写崩溃与远端歧义测试**

```js
test("crash at submit boundary never auto-regenerates", async () => {
  const recovered = await recoverBatch(fixtureInterruptedAtSubmit());
  assert.equal(recovered.items[0].status, "interrupted_unknown");
  assert.equal(recovered.executorCalls.submitVideo, 0);
});
```

另测：远端 ID 精确恢复、多个候选作品转 `interrupted_unknown`、`download_pending` 仅调用 `downloadArtifact`。

- [ ] **Step 3: 运行红灯**

Run: `node --test test/batch-runner.test.js test/recovery.test.js`  
Expected: FAIL，runner/executor 不存在。

- [ ] **Step 4: 包装现有页面对象为 adapter**

将 `hifly-page.js` 的大步骤拆成明确方法，并在提交前获取作品集合摘要；优先捕获页面可观察远端 ID。不得继续使用“最后一个下载按钮即当前任务”的无条件假设；无唯一匹配时返回歧义结果。

- [ ] **Step 5: 实现 runner 与假执行器**

runner 在每次 adapter 调用前后持久化状态，统一发结构化事件；只有获得全局锁且 `executionKey` 与当前摘要一致才执行。假执行器支持 `failAt`、`pauseAt`、`remoteCandidates` 和 `downloadFailure` 场景。

- [ ] **Step 6: 运行绿灯和 CLI 回归**

Run: `node --test test/batch-runner.test.js test/recovery.test.js`  
Expected: PASS。  
Run: `npm run validate`  
Expected: 3 rows valid。  
Run: `npm run check`  
Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add src/executors src/core/batch-runner.js src/hifly-page.js src/run-batch.js test/batch-runner.test.js test/recovery.test.js
git commit -m "refactor: run Hifly through recoverable executor"
```

### Task 6: 安全本地 HTTP 服务和 API

**Files:**
- Create: `src/server/app.js`
- Create: `src/server/start.js`
- Create: `src/server/request-security.js`
- Create: `src/server/routes/batches.js`
- Create: `src/server/routes/imports.js`
- Create: `src/server/routes/executions.js`
- Create: `src/server/routes/artifacts.js`
- Test: `test/server-security.test.js`
- Test: `test/server-api.test.js`

**Interfaces:**
- Produces: `buildApp({root, executor, openBrowser}) -> FastifyInstance`。
- Produces: 同源 API `/api/session`、`/api/batches`、`/api/imports`、`/api/executions`、`/api/artifacts/:batchId/:artifactId`。

- [ ] **Step 1: 写请求真实性失败测试**

```js
test("rejects cross-origin execution request", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "POST", url: "/api/executions",
    headers: { host: "127.0.0.1:4317", origin: "https://evil.example" },
    payload: { batchId: "b1" }
  });
  assert.equal(response.statusCode, 403);
});
```

另测非法 Host、`Origin: null`、无会话 cookie/自定义头、错误 content-type、artifact 越权、重复幂等 key 和并发批次冲突。

- [ ] **Step 2: 运行红灯**

Run: `node --test test/server-security.test.js test/server-api.test.js`  
Expected: FAIL，server 模块不存在。

- [ ] **Step 3: 实现会话与响应头**

启动生成 32 字节随机 token，首次同源引导建立 `HttpOnly; SameSite=Strict` cookie；变更请求同时校验 cookie、内存 token 对应的自定义头、精确 Host/Origin 和 JSON/multipart content type。设置 CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'`。不启用开放 CORS。

- [ ] **Step 4: 实现 API 和端口策略**

路由仅调用核心函数，不接受磁盘路径。`start.js` 从默认端口开始寻找可用端口，只监听 `127.0.0.1`；浏览器打开失败时输出 URL；SIGINT/SIGTERM 停止新请求、等待安全检查点并释放锁。

- [ ] **Step 5: 运行绿灯**

Run: `node --test test/server-security.test.js test/server-api.test.js`  
Expected: PASS。  
Run: `npm test`  
Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/server test/server-security.test.js test/server-api.test.js
git commit -m "feat: expose protected localhost workbench API"
```

### Task 7: 构建本地工作台界面

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/app.js`
- Create: `web/api.js`
- Create: `test/gui-smoke.test.js`

**Interfaces:**
- Consumes: Task 6 同源 API。
- Produces: 新建商品、批量导入、待执行、运行记录四个视图。

- [ ] **Step 1: 写浏览器冒烟测试**

使用 Node test runner、Playwright 和假执行器启动测试服务，断言：

```js
assert.equal(await page.getByRole("heading", { name: "飞影批量工作台" }).isVisible(), true);
await page.getByRole("tab", { name: "新建商品" }).click();
await page.getByLabel("产品名称").fill("云感保湿乳");
await page.getByRole("button", { name: "加入待执行" }).click();
assert.equal(await page.getByText("待执行").isVisible(), true);
```

- [ ] **Step 2: 运行红灯**

Run: `node --test test/gui-smoke.test.js`  
Expected: FAIL，`web/index.html` 不存在。

- [ ] **Step 3: 实现四视图与稳定布局**

第一屏为工作台，不做营销页。顶部显示服务/登录/全局执行状态；导航使用 tabs；主区使用紧凑任务表格与右侧编辑抽屉。单条表单包含 SKU、名称、卖点、品类、商品图、可选人物图；批量导入提供表格和图片选择及逐行错误；运行记录显示阶段、证据和下载入口。

- [ ] **Step 4: 实现积分确认和危险操作**

“开始生成”只在选中且校验通过时启用。确认 dialog 展示任务清单、人物图、估算版本、已知/未知积分和确认按钮；确认后禁止重复点击。`interrupted_unknown` 仅显示“核对飞影作品”，`download_pending` 仅显示“重试下载”。

- [ ] **Step 5: 实现响应式与可访问性**

桌面任务表使用稳定列宽；390px 下切换为任务列表，文本不溢出。所有输入有 label、状态有文本和图标、dialog 管理焦点、键盘可操作；图标按钮带 tooltip/aria-label。

- [ ] **Step 6: 运行绿灯和截图检查**

Run: `node --test test/gui-smoke.test.js`  
Expected: PASS。  
使用 Playwright 生成桌面 1440×900 和移动 390×844 截图，检查无重叠、无空白画面、表格/抽屉/dialog 可用。

- [ ] **Step 7: Commit**

```bash
git add web test/gui-smoke.test.js
git commit -m "feat: add local Hifly batch workbench"
```

### Task 8: 跨平台启动、打包和文档

**Files:**
- Modify: `README.md`
- Modify: `docs/新人培训使用手册.html`
- Modify: `docs/ENVIRONMENT.md`
- Modify: `scripts/package-artifacts.mjs`
- Modify: `config.example.json`
- Test: `test/startup.test.js`

**Interfaces:**
- Consumes: `npm run gui`、Task 6 `start.js`。
- Produces: Mac/Windows 相同启动流程和包含 GUI 的交付包。

- [ ] **Step 1: 写启动和打包失败测试**

测试从非项目目录调用根目录解析；模拟默认端口占用并断言选择下一个端口；检查打包清单包含 `web/`、核心模块和 GUI 文档，不包含 `workspace/`、登录态、下载、日志或 `config.local.json`。

- [ ] **Step 2: 运行红灯**

Run: `node --test test/startup.test.js`  
Expected: FAIL，文档/打包/端口行为尚未完成。

- [ ] **Step 3: 更新配置和交付文档**

配置增加 `gui.host`、`gui.port`、上传上限、像素上限、锁心跳/阈值和版本化积分估算。README 和新人手册将原终端步骤改为优先 `npm run gui`，保留 CLI 作为高级排障；明确首次安装 Chromium 和登录步骤。

- [ ] **Step 4: 更新打包脚本**

加入 `web/`、新增 `src/` 模块、测试说明和文档；继续排除真实素材、`workspace/`、profile、auth、downloads、logs、screenshots、outputs 和本地配置。

- [ ] **Step 5: 验证**

Run: `node --test test/startup.test.js`  
Expected: PASS。  
Run: `npm run package`  
Expected: 生成 tar.gz，清单无敏感目录。  
Run: `npm test && npm run check && npm run validate`  
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add README.md docs/新人培训使用手册.html docs/ENVIRONMENT.md scripts/package-artifacts.mjs config.example.json test/startup.test.js
git commit -m "docs: package cross-platform GUI workflow"
```

### Task 9: 独立 subagent 验收与真实小批次回归

**Files:**
- Create: `reviews/gui-acceptance-report.md`
- Verify: all implementation files

**Interfaces:**
- Consumes: 已完成实现、最终设计规格、假执行器和测试矩阵。
- Produces: 独立 subagent 的带证据验收报告；主代理复核结果。

- [ ] **Step 1: 启动未参与实现的 subagent**

明确要求它不修改实现，读取规格并执行：`npm test`、`npm run check`、`npm run validate`、`npm run package`；检查测试数量、失败数、截图、tar 清单和 Git diff。报告每项输入、操作、预期、实际和证据路径。

- [ ] **Step 2: subagent 执行安全与恢复矩阵**

必须包含：非法 Host/Origin/令牌、恶意上传、歧义匹配、并发锁、相同幂等 key、确认后编辑、提交边界崩溃、远端歧义、下载专用重试和服务重启恢复。全部使用假执行器，不消耗积分。

- [ ] **Step 3: subagent 执行视觉和跨平台验收**

检查 1440×900 与 390×844 截图，无空白、溢出、遮挡和按钮状态错误。在当前 macOS 做真实启动；通过 GitHub Actions 或可用 Windows 机器运行 Windows Node 测试和启动冒烟，并在报告中区分 CI 与实机证据。

- [ ] **Step 4: 主代理复核 findings**

主代理逐条复现高/中问题；有问题则回到对应任务修复、运行相关测试，并重新启动新的独立 subagent 验收。不得在存在未解决阻断或高风险问题时宣布完成。

- [ ] **Step 5: 获得授权后运行真实飞影小批次**

只在用户明确授权消耗积分后，使用 1 至 3 条测试商品验证登录、弹窗生成后“确认”、外层生成、远端唯一关联和下载。未授权时报告此项未执行，不影响无积分测试结论，但不能宣称真实飞影回归通过。

- [ ] **Step 6: 写验收报告并 Commit**

```bash
git add reviews/gui-acceptance-report.md
git commit -m "test: record independent GUI acceptance"
```
