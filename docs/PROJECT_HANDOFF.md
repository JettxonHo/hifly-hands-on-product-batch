# 项目接力文档：飞影「手里有货」GUI 跑通优先

## 2026-07-16 影刀 RPA Task 4 完成

- 已提交 `1673503`（`feat: poll yingdao rpa state`）：`src/executors/yingdao-rpa-executor.js` 已由占位错误替换为本地 mock bridge，并满足 `executor-adapter` 的五个方法契约。
- `createAsset` 会落 Task 2 task package 和 `generating_asset` state，随后轮询 Task 3 callback 写入的 state；提交、查询、下载和恢复均仅读取本地 RPA state，不会调用影刀或飞影。
- 成功提交将回调中的远端证据归一为 `evidence_source=direct_submission`，满足 batch runner 的显式提交证据保护；超时可通过短 `rpa.*TimeoutMs` 和 `pollIntervalMs` 配置稳定测试，超时错误码为 `YINGDAO_RPA_TIMEOUT`。
- 验证：`node --test test/yingdao-rpa-executor.test.js test/rpa-task-package.test.js test/rpa-callbacks.test.js` 为 16/16 通过；`npm run check` 通过（48 个 JavaScript 文件）；`git diff --check` 通过。
- 未启动 GUI、未访问飞影或影刀、未执行真实生成、未消耗积分。`docs/resume/` 保持未跟踪且未触碰。下一步为 Task 5，将 timeout 映射到可恢复的 `interrupted_unknown` batch 状态。

## 2026-07-16 影刀 RPA Task 3 完成

- 已提交 `ebc0c3e`、`3cff441`、`acaa2b8`：新增 RPA callback route、状态转换守卫、artifact 路径校验和 token-only 回调安全放行。
- 回调入口为 `POST /api/rpa/callback`，仅该路径允许使用 `callback_token` 绕过普通 GUI session；其他受保护 POST 仍要求正常会话安全头。
- RPA 状态转换改为显式 transition matrix，拒绝非法倒退；下载 artifact 的 `relative_path` 只能落在批次目录下，防止回调路径穿越。
- 验证：`node --test test/rpa-callbacks.test.js test/server-api.test.js` 39/39 通过；`npm run check` 通过；`git diff --check` 通过。完整 `npm test` 仍有既有 `test/gui-smoke.test.js` 标签严格匹配失败，与本轮无关。
- 未启动 GUI、未访问飞影、未执行真实生成、未消耗积分。下一步 Task 4 实现 Yingdao RPA executor 的 mock flow。

## 2026-07-16 影刀 RPA Task 1 完成

- 当前分支：`codex/yingdao-rpa-version`。
- 已提交 `4c21b48`（`feat: select execution backend`）：新增 `executionBackend`/`rpa` 示例配置，导出 `createExecutorForBackend(root, config)`，接入 `yingdao_rpa` 临时 executor stub，并新增后端选择测试。
- 验证：`node --test test/execution-backend-config.test.js` 3/3 通过；`npm run check` 通过（44 个 JavaScript 文件）；`git diff --check` 通过；配置 JSON 解析通过。
- 完整 `npm test` 为 183/184；唯一失败是既有 `test/gui-smoke.test.js` 单条录入 `getByLabel('SKU')` 严格匹配冲突，与本轮改动无关。
- 本轮未启动 GUI、未访问飞影、未执行真实生成、未消耗积分。
- 下一步由后续 Task 实现 Yingdao RPA task package/callback/executor 业务；当前 Task 1 的 adapter 仍会以 `YINGDAO_RPA_NOT_IMPLEMENTED` 明确失败。

## 2026-07-16 影刀 RPA Task 2 完成

- 已提交 `da89eab`、`bb9c912`、`d753b0c` 及对应报告提交：新增 `src/rpa/task-package.js`、`src/rpa/rpa-state.js` 和 `test/rpa-task-package.test.js`。
- Task package 已支持 `schema_version=1`、任务字段、固定 `download_dir=batchDirectory`、本地 callback URL 与 `callback_token`。RPA state 文件写入 `batches/<batch_id>/rpa/state/<task_id>.json`。
- 安全 review 已通过：task ID 防路径穿越、`packageData.task_id === taskId`、product/person 图片 symlink escape 防护、callback URL 仅允许 `http` localhost 并支持 `http://[::1]:4317`。
- 验证：`node --test test/rpa-task-package.test.js` 7/7 通过；`npm run check` 通过；`git diff --check` 通过。
- 未启动 GUI、未访问飞影、未执行真实生成、未消耗积分。下一步 Task 3 实现 RPA callback route 和状态守卫。

## 2026-07-16 影刀 RPA 执行器设计已写入

- 当前分支：`codex/yingdao-rpa-version`。
- 用户已确认影刀版方向：本地 GUI 继续作为任务台，新增影刀 RPA 执行器；抓包/HTTP 请求优先，影刀网页自动化兜底；不删除现有 Playwright 执行器。
- 设计文档：`docs/superpowers/specs/2026-07-16-yingdao-rpa-executor-design.md`。
- 已与本机 Claude Code 2.1.84 做独立审阅。Claude 认可可替换执行器方向，但指出必须补齐超时、回调状态转换、幂等、`download_dir` 安全限制和 `callback_token` 生命周期。
- 设计文档已按上述 review 更新：第一版明确“桥接优先，抓包随后”，先完成执行器选择、RPA 任务包、回调接口、RPA state、mock 无积分测试和超时恢复；真实飞影联调前仍需用户确认消耗积分。
- 用户已确认该 spec，implementation plan 已写入 `docs/superpowers/plans/2026-07-16-yingdao-rpa-executor.md`。计划拆为 6 个任务：执行器配置、RPA 任务包/state、回调接口、Yingdao executor mock flow、超时恢复、GUI/文档验证。当前未实现业务代码，下一步应选择 subagent-driven 或 inline execution 后按计划实施。

## 2026-07-16 自动化路线调整讨论：抓包 / 影刀 RPA

- 用户提出：不要继续只依赖按钮定位方式，希望改为抓包形式输入飞影数据，并明确提出使用影刀 RPA。
- 当前真实情况：项目现有执行器是 Node.js + Playwright 控制飞影网页 DOM，不是直接调用飞影私有 JSON 接口。GUI 本地接口只负责批次、素材、状态管理；飞影端仍通过浏览器页面完成上传、生成、确认、下载。
- 本机检查：`/Applications` 未发现影刀客户端；项目内未发现 HAR/抓包文件。因此目前还没有可直接复用的影刀工程或飞影私有接口映射。
- 建议方向：优先做“抓包优先 + RPA 兜底”的混合方案，而不是纯坐标/按钮方案。先用浏览器真实登录态采集手里有货的上传、生成、轮询、下载请求，确认是否可稳定复放；若私有接口存在签名、一次性 token、风控或不可复放，再由影刀 RPA 接管页面执行，本地 GUI 继续作为任务台。
- 当前批次 `batch-custom-script-20260715155417`：重试后已完成手持图生成与自定义文案填入，日志 `logs/batch-2026-07-15T16-11-40-536Z.jsonl` 出现 `field_filled` / `field_read` / `script-filled`，随后已点击外层「立即生成」。当前 `batch.json` 为 `active`，item 为 `asset_confirmed`，`submit_checkpoint.phase=remote_submit_wait`，说明问题已转移到“远端作品唯一识别/下载”阶段。不要直接把该批次重新生成，否则可能重复消耗积分。

## 2026-07-15 自定义文案真实校准第一次结果

- 批次：`batch-custom-script-20260715155417`
- 商品：`IPAD-CUSTOM-SCRIPT-001` / `便携高清平板电脑`
- 策略：`person_strategy=auto_pool`，`script_strategy=provided_script`
- 结果：`failed_pre_submit`
- 阶段：`asset_generation`
- 错误：`Custom script text could not be verified after filling.`
- 关键结论：真实飞影「手里有货」页面的文案输入区标题为 `文案`，而当时 `config.local.json` / `config.example.json` 的 `hiflyUi.scriptLabel` 为 `脚本文案`，导致自动化无法定位并替换自定义文案。系统按安全策略停在外层视频提交前，没有继续点击外层「立即生成」。
- 证据：
  - 日志：`logs/batch-2026-07-15T15-54-33-449Z.jsonl`
  - 失败截图：`screenshots/2026-07-15T15-57-26-713Z-IPAD-CUSTOM-SCRIPT-001-script-fill-not-verified.png`
  - 商品图已验证截图：`screenshots/2026-07-15T15-56-26-042Z-IPAD-CUSTOM-SCRIPT-001-product-verify.png`
- 已处理：将 `config.local.json`、`config.example.json`、`docs/CALIBRATION.md` 中的 `hiflyUi.scriptLabel` 校准为 `文案`。
- 注意：本次已经完成弹窗内手持商品图生成阶段，可能已消耗图片数字人/手持图部分积分；没有进入外层视频生成和下载。若继续验证，需要用户再次明确允许重跑。

## 2026-07-15 最终 whole-branch review 修复完成

- 提交 `f2b1900` 修复 4 项 review findings：`verifyScriptText()` 现在比较完整规范化文案；后半截不一致会停在 `failed_pre_submit`，回归测试确认 `submitVideo=0`。
- `hifly_ai` 路径现在显式确认“AI 自动生成”开关已开启；自定义文案路径仍在填入前确认开关已关闭。固定人物上传和商品图安全模型未改动。
- `provided_script` 在导入阶段逐行校验空文案，返回 `422/SCRIPT_REQUIRED`，并在批次进入 `pending` 前保持 `needs_input` 和空 items；GUI 单条/批量录入预先提示，文件导入显示明确错误。
- GUI 批次详情与积分确认框显示人物、文案策略的可读名称及持久化枚举值（`auto_pool` / `fixed_upload` / `hifly_recommended`；`hifly_ai` / `provided_script` / `mixed`）。
- 验证：`node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js` 为 106/106 通过；`npm run check` 通过（43 个 JS 文件）；`git diff --check` 通过。
- 本轮未启动 GUI、未访问飞影、未执行真实生成、未消耗积分。
- 当前关键排障批次保持不变：`batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` 仍为 `interrupted_unknown` / `remote_submit`，本轮未触碰该批次。

## 2026-07-15 Task 4/5/6 完成：策略执行、文档与本地验证

- GUI 人物与文案策略已实现：默认仍为 `auto_pool + mixed`；人物按 `category` 轮换并支持 `default` / 飞影推荐兜底，填写 `script` 时尝试使用自定义口播。
- 自定义文案真实飞影链路尚需 1 条积分样片校准，重点确认页面“AI 自动生成”开关、`script-filled` 证据和提交前失败保护。
- 本轮未启动 GUI、未运行真实飞影、未消耗积分。
- 本轮文档覆盖 `docs/SOP.md` 的人物与文案策略、`docs/CALIBRATION.md` 的自定义文案校准，以及本节接力状态。
- 最近实现提交范围：`144314d..716bcb4`，包括执行前策略校验、人物路径加固、自定义飞影口播提交和提交前失败测试；相关提交为 `144314d`、`dc0f2a0`、`aa5949c`、`716bcb4`。
- 当前关键排障批次仍为 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f`：`batch status=interrupted_unknown`、`item status=interrupted_unknown`、`error_phase=remote_submit`、`error_message=Remote submission did not produce unique evidence`；不要将其误判为商品录入失败，也不要为验证按钮重新完整提交。

## 2026-07-15 Task 3 完成：GUI 策略控件与口播文案录入

- `web/index.html`：单条录入、批量录入和批量导入面板均新增人物来源及文案来源选择；单条录入新增口播文案，批量行新增逐商品口播文案。
- `web/app.js`：单条、批量与导入提交均显式传递 `person_strategy` 和 `script_strategy` 至创建和导入 API；批量与单条生成的 CSV 均含 `script` 列。
- `web/styles.css`：策略选择框沿用现有表单样式，批量口播文案占整行，避免压缩既有商品字段。
- `test/server-api.test.js`：新增表格 `script` 列持久化到商品项的覆盖。
- 验证：`npm run check` 通过（43 个 JS 文件）；`node --test test/server-api.test.js` 通过（23/23）；`git diff --check` 通过。
- 未启动 GUI、未运行真实飞影链路、未消耗积分。下一步为 Task 4 的执行前校验与策略冻结。

## 2026-07-15 Task 2 完成：GUI/API 策略持久化

- 用户澄清：Task 2 必须保留既有安全契约，即 `fixture()`/session 鉴权测试、`POST /api/batches` 返回 `201`、不引入 `name`。创建接口白名单仅扩展为 `batchId`、`person_strategy`、`script_strategy`、`fixed_person_image_artifact_id`，其他字段（如 `root`）继续拒绝。
- `src/server/routes/batches.js`：新增严格策略枚举校验与默认值，创建批次持久化人物策略、文案策略、固定人物素材 artifact ID；公共批次 JSON 会返回这些字段。
- `src/server/routes/imports.js`：multipart 在既有安全字段/文件模型内新增可选 `person_strategy`、`script_strategy`；导入时校验并持久化，且保留创建阶段已有的固定人物素材 ID。
- `src/server/routes/executions.js`：执行准备与运行配置携带批次策略元数据，供后续策略解析任务使用。
- `web/api.js`：`createBatch` 接收完整 payload；`importBatch` 发送策略字段及默认值。
- TDD：创建策略测试先以 `400 !== 201` 失败；导入策略测试再以 `400 !== 200` 失败；实现后 `node --test test/server-api.test.js` 为 18/18 通过，`npm run check` 通过（43 个 JS 文件）。
- 未启动 GUI、未运行真实飞影链路、未消耗积分。

## 2026-07-15 Task 2 暂停：需要澄清 API 契约冲突

- 用户要求按 `.superpowers/sdd/task-2-brief.md` 实现 Task 2，并明确规定：若简报与当前代码冲突，返回 `NEEDS_CONTEXT`，不得猜测。
- 已核对当前 `src/server/routes/batches.js` 与 `test/server-api.test.js`。简报要求的新增测试使用不存在的 `buildTestApp()`、不带当前必需的本地会话鉴权、断言创建接口返回 `200`、并发送当前接口明确拒绝的 `name` 字段；现有受保护 API 使用 `fixture()`、会话头、仅接受 `batchId`，并在创建成功时返回 `201`。
- 因此未修改 Task 2 业务或测试文件，未运行飞影，未消耗积分，未创建提交。
- 已写入 `.superpowers/sdd/task-2-report.md`。下一步：请用户确认是保留现有鉴权/`201`/字段白名单并据此适配 Task 2 测试，还是有意改为简报所写的接口契约。

## 2026-07-15 Task 1 re-review 修复

- 修复 `src/core/person-strategy.js` 人物池文件名排序：恢复 legacy `localeCompare(..., "zh-Hans-CN")`，保持中文/非 ASCII 文件名轮换顺序兼容。
- `test/person-strategy.test.js` 新增中文文件名回归测试。
- 验证：人物/文案/产品校验测试 13/13 通过；`npm run check` 通过；`git diff --check` 通过。
- 未执行飞影真实链路，未消耗积分。下一步：提交本次 re-review 修复。

## 2026-07-15 Task 1 核心人物/文案策略解析完成

本轮完成 `.superpowers/sdd/task-1-brief.md` 的 Task 1：

- 新增 `src/core/person-strategy.js`：支持显式人物图、`fixed_upload`、`auto_pool`、`hifly_recommended`，人物池按品类轮换并支持 default fallback，写入 `__resolved_person_image_path`、`resolved_person_image_path`、`resolved_person_source`。
- 新增 `src/core/script-strategy.js`：支持 `hifly_ai`、`provided_script`、`mixed`，写入 `resolved_script_mode`，并提供 `SCRIPT_REQUIRED` 校验。
- `src/person-pool.js` 的 `assignPersonImages` 已委托给核心人物策略；保留 `listPersonPoolFiles`、`normalizeCategory` 等现有导出供产品校验使用。
- 新增 `test/person-strategy.test.js`、`test/script-strategy.test.js`。

验证：先运行 `node --test test/person-strategy.test.js test/script-strategy.test.js`，按预期因模块不存在失败；实现后运行 `node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js`，11/11 通过；`npm run check` 通过（43 个 JavaScript 文件）。完整 `npm test` 为 152/153，通过项包含全部 Task 1 测试；唯一失败是预存在的 `gui-smoke.test.js` 单条录入 `getByLabel('SKU')` 严格匹配冲突（单条和批量两个 SKU 输入框），与本轮改动无关。未执行飞影真实链路，未消耗积分。

当前卡点：无。下一步是 Task 2 的 API/导入持久化，需继续遵守 GUI 优先和真实积分执行前明确确认规则。

## 更新时间

2026-07-15（第十次更新，时区 Asia/Shanghai），**人物/文案策略实现计划已写好**。计划文件为 `docs/superpowers/plans/2026-07-15-person-script-strategy.md`，当前仍未改业务代码；下一步等待用户选择 subagent-driven 或 inline execution。

## 2026-07-15 Codex 人物/文案策略实现计划（最新）

用户已确认 `docs/superpowers/specs/2026-07-15-person-script-strategy-design.md`。Codex 根据 writing-plans 规范拆出实现计划：

```text
docs/superpowers/plans/2026-07-15-person-script-strategy.md
```

计划分为 6 个任务：

1. 核心策略解析：`person-strategy.js`、`script-strategy.js`。
2. API/导入持久化：批次保存 `person_strategy`、`script_strategy`。
3. GUI 控件：人物来源、文案来源、单条/批量 `script` 输入。
4. 校验与执行准备：执行前冻结 resolved person/script。
5. 飞影自定义文案自动化：关闭 AI 自动生成、填入并校验文案；失败停在提交前。
6. 文档与验证。

重要边界：计划仍要求真实飞影验证前必须再次获得用户确认，因为会消耗积分。

## 2026-07-15 Codex 人物/文案策略设计

2026-07-15（第九次更新，时区 Asia/Shanghai），**已进入优化设计阶段**。当前分支 `codex/person-script-strategy` 基于已验证 checkpoint `57f0d3f`，本轮只确定“人物策略 + 文案策略”的设计，不改业务代码。设计文档写入 `docs/superpowers/specs/2026-07-15-person-script-strategy-design.md`。

用户确认 3 条小批量验证成功后，提出两个优化方向：

- 数字人过于单一，是否需要准备更多数字人并根据商品/场景选择。
- GUI 是否应该支持商品文案上传输入，还是继续完全依赖飞影 AI 自动文案。

已用 `grill-me` 拷问设计，结论如下：

- 人物策略第一版采用“本地人物池优先，飞影推荐兜底”，不要完全依赖飞影推荐人物。
- 文案策略第一版采用“默认飞影 AI，允许用户文案覆盖”，不要彻底替代飞影 AI。
- 自定义文案不能只加 GUI 输入框，必须在自动化里可靠关闭飞影“AI 自动生成”开关并确认文本填入；失败时停在 `failed_pre_submit`，不得继续消耗积分。
- 飞影推荐人物适合兜底，不适合作为主策略，因为推荐数量、顺序和品类匹配不可控。

设计文档：

```text
docs/superpowers/specs/2026-07-15-person-script-strategy-design.md
```

下一步：用户 review 设计文档后，再进入 implementation plan；不要在用户确认 spec 前直接改业务代码。

## 2026-07-15 Codex 3 条小批量真实验证

2026-07-15（第八次更新，时区 Asia/Shanghai），**3 条小批量真实验证已跑通**——`batch-small3-v2-20260715173730` 已完成 3/3：吉伊卡哇、玩具熊、iPad 都生成并下载成功。另一个早期小批量 `batch-small3-20260715172622` 是排障中断批次，不要当作成功交付。

用户要求跑 3 条小批量验证后，Codex 先用同一组素材创建了 `batch-small3-20260715172622`，该批次暴露出一个新问题：飞影弹窗在上传商品后偶发直接出现“再次生成 / 重新编辑 / 确认”的已生成态，但这一步发生在脚本点击弹窗内“立即生成”之前，存在误确认旧商品手持图的风险。为避免继续消耗积分，Codex 中途停止 GUI，该批次最终为 `interrupted_unknown`，不要继续混用作验收批次。

针对该问题，`src/hifly-page.js` 已增加一层安全网：

- `createHandsOnImage` 最多尝试 2 次。
- 上传商品并通过 `verifyProductImageReplaced` 后，如果在点击弹窗内“立即生成”之前就检测到 `hasGeneratedImageReady()`，记录 `generated_modal_ready_before_generate`，执行 `resetAndReopenHandsOnModal` 后重新上传当前商品。
- 第二次仍出现同样异常时直接抛错，拒绝确认疑似旧素材。
- `test/batch-runner.test.js` 已补充 `createHandsOnImage retries when a generated modal appears before clicking generate`，覆盖这个防旧图分支。

随后重启 GUI，并创建干净验证批次：

- 批次：`batch-small3-v2-20260715173730`
- 状态：`completed`
- 商品 1：`CHI-SMALL3-001` / `吉伊卡哇毛绒玩偶` / remote_id=`631884`
- 商品 2：`BEAR-SMALL3-002` / `棕色小熊毛绒玩偶` / remote_id=`631921`
- 商品 3：`IPAD-SMALL3-003` / `便携高清平板电脑` / remote_id=`631952`
- 下载文件：
  - `batches/batch-small3-v2-20260715173730/2026-07-15T09-45-48-571Z-631884-未命名.mp4`（约 74 MB）
  - `batches/batch-small3-v2-20260715173730/2026-07-15T09-54-24-257Z-631921-未命名.mp4`（约 65 MB）
  - `batches/batch-small3-v2-20260715173730/2026-07-15T10-01-17-601Z-631952-未命名.mp4`（约 45 MB）

关键截图证据：

- `screenshots/2026-07-15T09-39-37-431Z-CHI-SMALL3-001-modal-ready.png`：右侧商品图为吉伊卡哇。
- `screenshots/2026-07-15T09-47-34-138Z-BEAR-SMALL3-002-modal-ready.png`：右侧商品图为玩具熊。
- `screenshots/2026-07-15T09-56-15-872Z-IPAD-SMALL3-003-modal-ready.png`：右侧商品图为 iPad。

验证命令：

```bash
node --test test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js  # 68/68 pass
npm run check                                                                              # OK，Checked 41 JavaScript file(s)
file batches/batch-small3-v2-20260715173730/*.mp4                                         # 3 个文件均为 MP4
```

积分记录：`batch-small3-v2-20260715173730` 明确消耗 3 条真实生成。前置排障批次 `batch-small3-20260715172622` 中途停止，是否产生部分飞影侧消耗以飞影后台积分流水为准；不要再用它做交付判断。

下一步建议：

1. GUI 自动化主链路已经通过单条 iPad 和 3 条小批量验证。
2. 下一阶段可以从 GUI 侧做“用户可见状态/失败后重跑体验”的收尾验收，而不是继续消耗飞影积分。
3. 若要继续真实批量，建议先把 `outputs/` 或下载目录整理规则确认好，再跑更大批量。

## 2026-07-15 Codex 干净 iPad 单条真实验证

2026-07-15（第七次更新，时区 Asia/Shanghai），**GUI 真实链路已再次用干净 iPad 单条验证成功**——`batch-clean-ipad-mrlv0gkn` / `IPAD-CLEAN-001` 已完成，remote_id=`631762`，本地输出 `batches/batch-clean-ipad-mrlv0gkn/2026-07-15T09-18-30-708Z-631762-未命名.mp4`。商品图残留 bug 仍确认已修复：`product-verify` 截图右侧为 iPad，非白菜。

用户批准消耗飞影积分后，Codex 新建干净单条批次验证 GUI 真实链路：

- 批次：`batch-clean-ipad-mrlv0gkn`
- 商品：`IPAD-CLEAN-001` / `便携高清平板电脑`
- 商品图：`/Users/ketchup/Desktop/test demo/ipad.png`
- 结果：`completed`
- 飞影作品：remote_id=`631762`，作品时间标签 `2026-07-15 17:14:25`
- 下载文件：`batches/batch-clean-ipad-mrlv0gkn/2026-07-15T09-18-30-708Z-631762-未命名.mp4`，大小约 58 MB，`file` 识别为 MP4。
- 积分消耗：1 条真实生成。

关键证据：

- `screenshots/2026-07-15T09-13-21-197Z-IPAD-CLEAN-001-product-verify.png`：右侧商品图为 iPad，证明上传替换成功。
- `screenshots/2026-07-15T09-13-21-285Z-IPAD-CLEAN-001-modal-ready.png`：生成前弹窗仍是 iPad。
- `logs/batch-2026-07-15T08-20-51-720Z.jsonl`：包含 `IPAD-CLEAN-001` 完整链路，最后 `download_button_resolution` clicked=true，remote_id=`631762`。
- 批次状态写盘：`batch-clean-ipad-mrlv0gkn/batch.json` status=`completed`，item status=`completed`。

注意：飞影网页上会先显示「作品已生成」，但本地批次状态要等 `waitForNewLatestWorks` 识别最新作品并完成下载后才从 `asset_confirmed/remote_submit_wait` 变为 `download_pending/completed`。本次 09:18:16 写入 `download_pending`，09:18:37 写入 `completed`。后续排障时不要仅凭页面 toast 判定本地 GUI 已完成，要以 `batch.json` 和下载文件为最终交付状态。

下一步建议：

1. GUI 核心链路已经通过两条真实样例验证：吉伊卡哇 `631486` 和 iPad `631762`。
2. 可以进入 3 条小批量验证（吉伊卡哇、玩具熊、iPad），但会再次消耗 3 条真实生成积分。
3. 如果继续小批量，务必先确认 GUI 当前选中的是新批次，不要继续旧的 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f`，该旧批次含错误白菜作品。

## 2026-07-15 Codex 重新接手核对（当前）

Codex 已按 `AGENTS.md` 重新阅读项目规范、`docs/PROJECT_HANDOFF.md`、`docs/CALIBRATION.md`、`docs/ENVIRONMENT.md`，确认 Claude Code 接手后的主要工作如下：

- 修复 `src/hifly-page.js` 商品图残留问题：reset 后重开 modal、清残留图不误点关闭×、商品图必选上传、上传后 `verifyProductImageReplaced` 安全网。
- 修复 GUI 执行日志：`src/server/start.js` 使用真实 `BatchLogger`，诊断事件落盘到 `logs/batch-*.jsonl`。
- 补充测试：`test/batch-runner.test.js` 覆盖残留图、上传验证、安全网和必选商品图上传。
- 补充文档：`docs/CALIBRATION.md`、`docs/ENVIRONMENT.md` 记录飞影页面行为和 GUI 无热重载/端口自增陷阱。
- 完成实机验证：`batch-0278c0ac-6dba-4fb3-a551-06e559e61c3a` / `VERIFY-001` 已完成，remote_id=`631486`，输出文件 `batches/batch-0278c0ac-6dba-4fb3-a551-06e559e61c3a/2026-07-15T08-27-47-823Z-631486-未命名.mp4`，确认不是白菜。

Codex 重新核对的当前状态：

- GUI 服务仍在运行：`127.0.0.1:4317`，PID `51125`。
- 当前代码无积分验证通过：

```bash
node --test test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js  # 67/67 pass
npm run check                                                                              # OK，Checked 41 JavaScript file(s)
```

当前建议：

1. 不要回滚 Claude Code 的 `hifly-page.js`、`server/start.js`、测试和文档改动。
2. 下一步可以从 GUI 跑一个小批量真实业务验证，建议先 1 条，再 3 条；真实执行前仍需用户明确允许消耗飞影积分。
3. 旧批次 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` 中 CHI-001 的 remote_id=`629439` 是错误白菜素材，不要交付；该批次目前 `failed`，BEAR-001 失败、IPAD-001 pending，不建议直接继续混跑。
4. 调试后如改动 `src/`，必须停掉旧 GUI 并重启，避免跑旧代码。

## 2026-07-15 第四次修复：clearResidual 关弹窗后重开 modal（最新）

### 第三版实机诊断（终于看清，不再是猜）

第三版代码加载后实机跑 VERIFY-001，产出完整证据（`logs/batch-2026-07-15T07-46-02-446Z.jsonl` + 截图）：
- `after-reset-edit`：点「重新编辑」后弹窗是上传界面，**残留白菜（src `5f346e45-...`）占着商品图槽位，没有「上传商品」按钮**（按钮仅 Close/重置/立即生成）。
- `after-modal-trash-clear`：clearResidual 点垃圾桶后，**残留白菜被删了，但「手持商品图」弹窗也关闭了**，回到外层"手里有货"页面。
- `reset-upload-not-visible` + 第二次 dump `visibleModalFound=false`：代码在**已关闭的弹窗里**等「上传商品」按钮 → 超时 30s。没消耗积分（失败在点立即生成之前）。

### 根因（清晰）

clearResidual 删残留图（白菜）这个动作**把弹窗也关了**。代码没料到弹窗会关，继续在已关弹窗里 `getByRole(button, 上传商品).waitFor` → 超时。

### 本次修复（`src/hifly-page.js`）

1. `createHandsOnImage`：reset 块后**重新 `openHandsOnModal`** 打开干净的上传界面（残留已删），才能看到「上传商品」按钮；重开后 `hasGeneratedImageReady` 复查——若仍见残留则抛 `stale generated image persists after reset+reopen`，**避免无限循环**。
2. `clearResidualModalImages`：垃圾桶选择器**去掉 `.anticon-close`**（那是弹窗关闭×，不是删除图），避免误关。

### 验证

```bash
node --test test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js  # 67/67 pass
npm run check                                                                              # OK
```

新增防循环测试（reset+重开仍见残留→抛错）。

### 第四版 GUI 已就绪（PID 51125，16:12 启动）

第三版 GUI（50161）已停，第四版已起、加载第四版代码。**浏览器刷新 `http://127.0.0.1:4317`** 再跑 VERIFY-001。

### ✅ 实机验证成功（2026-07-15 16:22-16:27）

用户跑 VERIFY-001，**第四版修复完全走通，吉伊卡哇正确生成（不是白菜）**：

- 截图序列完整：`modal-open → after-reset-edit → after-modal-trash-clear → modal-reset → modal-reopen → product-verify → modal-ready → modal-after-generate → after-upload → before-submit → after-submit`。**`modal-reopen` 走通**（第四版「reset 后重开干净上传界面」生效，这是之前缺的关键一步）。
- `modal-ready` 右侧 = 吉伊卡哇（用户确认 + 视觉复核）；安全网 `verifyProductImageReplaced` 通过。
- 批次 `batch-0278c0ac-6dba-4fb3-a551-06e559e61c3a` status=`completed`。
- 远端作品 remote_id=`631486`（observed 2026-07-15T08:27:27），下载 `batches/batch-0278c0ac.../2026-07-15T08-27-47-823Z-631486-未命名.mp4`。
- 积分消耗：1 条（手持图 150 + 视频创作），VERIFY-001 首次成功生成的合理成本。

**结论：商品图残留 bug 已修复。** 可放心跑真实业务批次（多商品）。仍建议：跑前确认登录态、headed 运行别关浏览器；遇残留图时代码会自动「清残留 → 重开 → 上传 → 验证」。

**遗留清理（非阻塞）**：`batch-8f9f17b3`、`batch-ac99559a` 还 `pending`（调试中新建的重复批次），可在 GUI 删除；`batch-29b7d335`、`batch-2b42bb68` 是前几次失败的 VERIFY-001，可归档。旧的错误白菜作品 `629439`（CHI-001）及对应 mp4 不要交付客户。

---

## 2026-07-15 第三次修复：诊断 + 残留图清除 + 上传验证安全网（历史，代码已被第四次扩展）

### 用户再次实机测试的结果

- **第二次修复的代码根本没被加载**：批次错误文本仍是第一版的 `could not reveal the product upload button (modal is likely still showing a stale product)`，而磁盘 `src/hifly-page.js` 已是第二版（`clicked 重新编辑 but...`）；`screenshots/` 里 **0 张 `*-after-reset-edit.png`**（第二版必产出的诊断截图）。原因：GUI 服务在改代码前已启动，Node 的 ES module import 缓存了旧代码。**不重启 GUI，改什么都没用。**
- **用户手动截图揭示真相**：点「重新编辑」后弹窗确实回到**上传界面**（没关闭），但**残留的人物图(左) + 白菜商品图(右)都还在**，界面是「图片 + 右上角垃圾桶 + 中间紫色+号 + 底部重置/立即生成」，**没有「上传商品」文字按钮**。

### 对抗验证纠正了之前的两个错误判断（重要，方法论教训）

用多 agent 工作流做了对抗验证（1 refuted + 2 uncertain），纠正了我之前的过度自信：
1. **「视觉模型看不到上传商品文字 → getByRole 匹配不到」是错的**。`getByRole` 匹配的是 accessible name（aria-label / innerText），不是可见像素。光看截图无法判定 `getByRole` 会不会失败。
2. **漏看了截图里中间的紫色「+」号**——它很可能是真正的上传入口（图标按钮，无文字），而代码用 `getByRole("上传商品")` 按文字匹配，匹配不到图标按钮。这是定位策略 bug，是近因候选。

被确认的：账号级残留成立、商品图从未被真正替换过、第二版代码从未加载。

### 本次修复（`src/hifly-page.js` + `src/server/start.js`）

`src/hifly-page.js`：
1. **新增 `dumpModalDomSnapshot(product)`**：reset 后把当前所有可见 modal 的 text、所有按钮的 accessible name + aria-label、所有图片 src 落盘日志。判定「重新编辑后真实 DOM」的决定性证据。
2. **新增 `clearResidualModalImages(product)`**：残留图占槽、上传按钮不出现时先清残留——先点底部「重置」，再逐个点垃圾桶兜底。选择器基于截图推断，全部带 `.catch` 兜底不崩，每步截图。
3. **新增 `captureProductImageSrc()` + `verifyProductImageReplaced(staleSrc, product)`（安全网）**：上传前抓右侧商品图 src，上传后强制验证 src 已变 + naturalWidth>0；残留没换或没加载就在上传阶段抛错。
4. `resetGeneratedHandsOnImage`：点「重新编辑」后 dump；上传按钮不可见先 `clearResidualModalImages`；最终失败再 dump + 抛错。
5. `createHandsOnImage`：上传商品图前抓 `staleProductSrc`，上传后调 `verifyProductImageReplaced`。
6. `uploadModalFile`：按钮不可见时先尝试 `input[type='file']` 兜底（上传入口可能是图标「+」），再走 required 抛错。

`src/server/start.js`：
7. **GUI logger 从空实现改成真 `BatchLogger`**（写 `logs/batch-<ts>.jsonl`）——`dumpModalDomSnapshot` 等诊断终于能落盘。
8. launch 参数加 `--disable-session-crashed-bubble`、`--no-default-browser-check`，抑制 `profile.exit_type=Crashed` 导致的「Restore pages?」提示。

### 验证

```bash
node --test test/batch-runner.test.js test/state-machine.test.js test/server-api.test.js  # 66/66 pass
npm run check                                                                              # OK
npm test                                                                                   # 144/144，唯一失败 = 预存在的 gui-smoke SKU selector（与本次无关）
```

新增 3 个 `verifyProductImageReplaced` 安全网测试（src 未变→抛错 / 新图加载→通过 / 找不到图→抛错）。

### 安全网如何保证不消耗积分（关键）

`verifyProductImageReplaced` 在「上传商品图之后、点立即生成之前」强制验证右侧商品图确实被替换。残留白菜没换掉（src 未变）或新图没加载（naturalWidth=0）→ **立即抛错**，流程停在上传阶段。最坏情况：跑一次 VERIFY-001，要么成功（吉伊卡哇），要么安全网拦住（抛错，0 积分）+ 留完整诊断。**不会拿白菜错误生成。**

### 下一步（必须先重启 GUI）

1. 停旧 GUI：`lsof -nP -iTCP:4317 -sTCP:LISTEN` 找 PID `kill`；确认 Chrome for Testing 退出。
2. **重启**：`npm run gui`（关键，否则跑旧码）。注意端口自增陷阱：先确认 4317 空闲，否则新实例落到 4318 加载新码、浏览器标签还指 4317 跑旧码。
3. 跑 VERIFY-001（`tmp/verify-fix/` 素材包，只用 GUI）。
4. 跑后看诊断：成功 → `*-modal-ready.png` 右侧吉伊卡哇；安全网拦住（product image NOT replaced）→ 看 `*-product-verify.png` + `*-after-reset-edit.png` + `logs/` 的 `modal_dom_snapshot`；reset 失败 → 看 `*-after-reset-edit.png` + dump 日志。

### 关键诊断文件清单（跑完一次 VERIFY-001 后）

| 文件 | 含义 |
|------|------|
| `screenshots/*-VERIFY-001-after-reset-edit.png` | 点「重新编辑」后弹窗真实状态（分水岭，之前 0 张） |
| `screenshots/*-VERIFY-001-after-modal-reset-clear.png` / `after-modal-trash-clear.png` | 清除残留图后的状态 |
| `screenshots/*-VERIFY-001-product-verify.png` | 上传后右侧商品图（安全网验证点） |
| `screenshots/*-VERIFY-001-modal-ready.png` | 上传成功、生成前（右侧应是吉伊卡哇） |
| `logs/batch-<ts>.jsonl` 里 `modal_dom_snapshot` | 重新编辑后弹窗 DOM + 所有按钮 accessible name（决定性） |

---

## 2026-07-15 第二次修复：残留手持图重置失败（历史，代码已被第三次覆盖）

### 实机测试结果（推翻首次修复的假设）

用户用 GUI 跑了 `VERIFY-001`（吉伊卡哇图）实机验证（批次 `batch-2b42bb68-7ef7-4a4d-b731-e1409af40c77`）。结果：

- VERIFY-001 仍失败（`failed_pre_submit`），**没消耗积分**（失败在点「立即生成」之前）。
- 失败原因不是商品图上传被跳过，而是**更早的「重置残留已生成图」步骤挂了**。
- 截图 `screenshots/2026-07-14T20-11-54-464Z-VERIFY-001-modal-open.png` 复核：弹窗打开就是「已生成残留图」状态（有再次生成/重新编辑/确认按钮），残留图是**人物手持青菜**。
- 商品图本身正确：批次 uploads 里的图 md5 与 `tmp/verify-fix/VERIFY-001.jpeg` 完全一致（吉伊卡哇）。
- 即：**首次修复（`uploadModalFile required`）是对的但根本没被执行到**——流程在 `resetGeneratedHandsOnImage` 就失败了。

### 真正根因（已确认）

1. 飞影账号残留了上一个商品（青菜 / `products.csv` 的 `SKU001`）的已生成手持图。这是**账号级持久化**，页面 reload 清不掉（`resetExistingUpload` 已经 reload 过）。
2. 每个新商品打开「手持商品图」弹窗，看到的是这个残留的青菜已生成图。
3. `createHandsOnImage` 检测到残留（`hasGeneratedImageReady=true`）→ 调 `resetGeneratedHandsOnImage` 点「重新编辑」想回到上传状态。
4. **点「重新编辑」后弹窗 DOM 变化，`dialogLocator()`（`.ant-modal:visible` filter `hasText:'手持商品图'`）定位不到弹窗**，`waitFor(visible)` 超时 30s（错误：`locator.waitFor: Timeout 30000ms exceeded`）。
5. reset 失败 → `failed_pre_submit`，`asset_generation`。

附带发现：**GUI 模式 logger 是空实现**（`src/server/start.js:35` `const logger = { info(){}, error(){} }`），所以 `hifly-page` 所有 `logger.info` 诊断都被吞掉——这是 VERIFY-001 没有任何轨迹日志的原因。

### 本次修复（`src/hifly-page.js`）

1. `resetGeneratedHandsOnImage(product)`：
   - 点「重新编辑」后**立即截图 `after-reset-edit`**（关键诊断：捕获「重新编辑」后真实 DOM）。
   - 改用**页面级** `page.getByRole(button, 上传商品)` 等上传按钮出现，不再依赖 dialog 的 `手持商品图` 文本过滤（这是失效点）。
   - 移除原来的 `clickModalEditFallback` 二次兜底（它在 dialog 失效时必触发 `waitFor` 超时，是失败源）。
   - 失败时再截 `reset-upload-not-visible`，抛带诊断提示的错误。
2. `createHandsOnImage`：把 `product` 传给 `resetGeneratedHandsOnImage`（用于诊断截图命名）。

### 验证

```bash
node --test test/batch-runner.test.js                              # 41/41 pass
node --test test/state-machine.test.js test/server-api.test.js     # 22/22 pass
npm run check                                                       # OK
```

更新了两个 reset 相关测试：成功路径（点重新编辑→截图→上传按钮出现）和失败路径（上传按钮不出现→截图+抛错）。首次修复的 `uploadModalFile required` 及其测试保留（仍是正确的防御，只是这次没被触发到）。

### 下次实机的两种可能结果（本次是「带诊断兜底的健壮化」，不是确定修复）

我无法在沙箱看「重新编辑」后的飞影 DOM，所以这次要么直接修好、要么靠新截图精准修，两种都不消耗视频积分（都在点「立即生成」之前）：

- **情况 A（乐观）**：「重新编辑」后弹窗仍是上传界面、只是 `dialogLocator` 文本过滤失效 → 页面级定位找到上传按钮 → 流程继续，吉伊卡哇正确上传。`*-modal-ready.png` 右侧应是吉伊卡哇。
- **情况 B**：「重新编辑」后弹窗结构更复杂（关闭 / 换成裁剪框 / 保留旧商品图）→ 页面级也找不到上传按钮 → 抛错，但新的 `*-after-reset-edit.png` 会显示真实 DOM，发给我下一轮精准修。

### 下一步（给用户/下一位）

1. 在真实机器对 VERIFY-001 重新点「开始生成」（批次 `batch-2b42bb68` 现 `failed_pre_submit` 可重试；或新建同名 SKU 批次）。仍只用 GUI。
2. 跑后检查：
   - 成功走到 modal-ready → 看 `*-VERIFY-001-modal-ready.png` 右侧是不是吉伊卡哇。
   - 仍失败 → 看 `*-VERIFY-001-after-reset-edit.png`（新诊断截图），它显示「重新编辑」后弹窗的真实状态，发给我。
3. 可选改进（本次未做）：把 GUI logger 从空实现改成真日志（`src/server/start.js:35`），让未来有轨迹日志。当前先靠截图诊断。

### 关键批次状态

```text
batch-2b42bb68-7ef7-4a4d-b731-e1409af40c77 (VERIFY-001 验证批次)
  status: failed
  VERIFY-001: failed_pre_submit
  error: locator.waitFor Timeout 30000ms waiting for .ant-modal filter '手持商品图'
  error_phase: asset_generation
  image_path: 正确（吉伊卡哇，md5 与 tmp/verify-fix/VERIFY-001.jpeg 一致）
```

---

## 2026-07-15 修复记录：商品图必选上传，杜绝静默跳过（首次修复，保留作历史）

### 根因确认（已代码复核 + 截图复核）

通过 `screenshots/2026-07-14T18-21-17-639Z-CHI-001-modal-ready.png` 视觉复核确认：截图时飞影弹窗右侧商品图位是青菜/白菜（bok choy），不是吉伊卡哇。当时本地上传图 `060e3933-...jpeg` 确实是吉伊卡哇。结论与下文「紧急事故」章节一致：飞影弹窗复用了上一次残留商品图，新商品图上传被静默跳过。

根因落在 `src/hifly-page.js` `uploadModalFile(label, filePath)`：当目标上传按钮不可见、但 `isHandsOnModalReadyForGenerate()` 返回 true 时，函数直接 return，不点上传、不抛错。商品图走这条路径就会被静默跳过，残留的旧商品图继续参与生成。

### 实际改动

文件：`src/hifly-page.js`

1. `uploadModalFile(label, filePath, options = {})` 新增 `options.required`：
   - `required: true` 时，按钮不可见直接抛 `Required upload "<label>" is not visible (modal ready=...). Refusing to skip: the modal may still hold a stale product image.`，无论弹窗是否已可生成。
   - `required` 未设或为 false 时（默认，人物图语义），保留「弹窗已可生成就跳过」行为。
2. `createHandsOnImage(product)` 调用商品图上传时显式传 `{ required: true }`；人物图调用保持原样。
3. `resetGeneratedHandsOnImage()` 去掉两处 `isHandsOnModalReadyForGenerate()` 静默 return：
   - 第一次 `waitFor(visible)` 失败 → 走 `clickModalEditFallback` 坐标点击。
   - 第二次 `waitFor(visible)` 再失败 → 抛 `resetGeneratedHandsOnImage could not reveal the product upload button (modal is likely still showing a stale product).`
   - 不再因为「弹窗已可生成」就放过残留商品图。

文件：`test/batch-runner.test.js`

1. 删除不安全测试 `uploadModalFile accepts an already uploaded modal that is ready to generate`。
2. 新增三个回归测试覆盖新语义：
   - `uploadModalFile skips optional uploads when the modal is already ready to generate`：人物图可选语义保持。
   - `uploadModalFile refuses to skip a required upload when the button stays hidden`：商品图在 stale + ready 状态下必须抛错。
   - `uploadModalFile refuses a required product upload even when the modal is not ready to generate`：商品图在 stale + 未 ready 状态下也必须抛错。
3. 更新 `createHandsOnImage edits a stale generated modal before uploading the current product`：mock 改为捕获 `required` 标记，断言商品图以 `required` 调用。
4. 新增 `createHandsOnImage forces a product upload even when the modal looks ready to generate`：直接验证 `createHandsOnImage` 在没有「已生成」弹窗时也会走必选商品图上传，且失败会冒泡。
5. 新增 `resetGeneratedHandsOnImage refuses to silently return when upload controls never come back`：两次重置都失败时必须抛错。

### 验证命令和结果

```bash
node --test test/batch-runner.test.js                 # 41/41 pass
node --test test/state-machine.test.js test/server-api.test.js  # 22/22 pass
npm run check                                         # Checked 41 JavaScript file(s), 通过
```

`npm test` 全量：141 个测试，140 通过，1 失败。失败的是 `test/gui-smoke.test.js` 的 `single-product GUI path creates a pending batch`，原因是 `getByLabel('SKU')` 在批量录入加入后同时匹配单个录入和批量录入两个 input。经 `git stash` 验证：该失败在我本次改动之前就存在，是 `feat: add bulk product entry to GUI` 的副作用，不在本次商品图 bug 修复范围内。下一位接手者如果要修，应在 `test/gui-smoke.test.js` 改用更具体的 selector，而不是改本次的 `hifly-page.js`。

### 当前批次状态（修复前快照）

```text
batch_id: batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f
batch status: failed
CHI-001 (吉伊卡哇): completed
  remote_evidence.remote_id: 629439
  output_path: batches/batch-bdbf3cec-.../2026-07-14T18-25-24-795Z-629439-未命名.mp4
  ⚠️ 这个 mp4 对应的是旧青菜/白菜素材，不能当成功样片交付。
BEAR-001 (抱抱熊): failed_pre_submit
  error: page.waitForTimeout: Target page, context or browser has been closed
IPAD-001 (iPad): pending
```

GUI 未运行（`lsof -nP -iTCP:4317 -sTCP:LISTEN` 无输出）。

### 下一步（给下一位接手者 / 用户）

1. **修复未真实验证**。本次只跑了无积分本地测试。真实飞影生成需要用户明确允许消耗积分。
2. 真实验证**只跑 1 条**：
   - 推荐方式：新建一个只含 1 条商品（例如 IPAD-001，因为它还 pending）的小批次，避免与历史错误素材混在同一个批次。
   - 或者：先人工把当前批次的 CHI-001（产出错误素材）和 BEAR-001（failed_pre_submit）按业务需要归档/标记，再单独跑 IPAD-001。
   - **不要**直接对当前 failed 批次点「重新生成异常批次」一键跑 3 条，会一次消耗 3 倍积分且可能再次复用错误路径。
3. 真实验证时必须人工检查 `screenshots/*-modal-ready.png`：
   - 弹窗右侧商品图（裁剪预览）必须是当前 SKU 对应的本地上传图。
   - 如果右侧仍是青菜/白菜，说明仍命中残留路径，立即停止，不要点「立即生成」。
4. 如果新代码抛 `Required upload "上传商品" is not visible` 或 `resetGeneratedHandsOnImage could not reveal the product upload button`：
   - 这是新加的保护，意味着飞影弹窗进入了未预期的 stale 状态。
   - 记录截图、批次 ID、SKU，按「异常批次」处理，不要在未理解原因前重试。
5. 旧的 CHI-001 错误远端作品 `629439` 不要作为任何成功证据，对应的本地 mp4 不要交付给客户。

---

## 2026-07-15 真实验证就绪性调查与阻塞（重要，下一位接手者必读）

用户已口头批准真实验证，但 Claude Code 本次调查发现两个硬阻塞，**未在 agent 环境执行真实飞影生成**。修复代码已就绪并通过本地测试，真实验证必须由用户在能正常访问 hifly.cc 的真实 macOS 桌面执行。

### 硬阻塞 1：当前 agent 沙箱网络不可达 hifly.cc

- `node -e "require('dns').resolve4('hifly.cc',(e,a)=>console.log(a))"` → `198.18.1.18`
- 198.18.0.0/15 是 RFC2544 benchmarking/test-net，**不可路由**；这是本地代理 fake-ip DNS 劫持
- 环境无 `HTTP_PROXY`/`HTTPS_PROXY`（只有 `NO_PROXY=127.0.0.1,localhost,::1,open.bigmodel.cn`）
- 后果：Playwright 启动的浏览器导航 `https://hifly.cc/goods` 会连不上真实服务器，真实生成必然失败。即使强行启动也会在连接阶段卡住，浪费积分或直接报错。
- 含义：**任何 agent（本机 Codex/Claude Code 沙箱）都不能直接跑真实飞影链路**，除非先解决代理/网络。真实执行必须在用户的真实桌面环境。

### 硬阻塞 2：IPAD-001 不是干净目标（重复扣分风险 + 已命中 bug）

- `screenshots/2026-07-14T12-55-43-036Z-IPAD-001-modal-open.png` 到 `2026-07-14T12-57-12-601Z-IPAD-001-after-submit.png` 是一套完整截图（modal-open→modal-ready→modal-after-generate→after-upload→before-submit→after-submit），说明 7/14 20:55-20:57（UTC 12:55-12:57）那次 IPAD-001 已走到外层 submit，**可能已消耗视频积分**。
- 但 `batch-bdbf3cec` 里 IPAD-001 仍 `pending`、无 `output_path`、`downloads/` 无 7/14 20:xx 产物 → submit 后被打断、状态没回写（与 BEAR-001 的 `Target page, context or browser has been closed` 同一失败模式）。重跑 IPAD-001 有重复扣分风险。
- **视觉复核 `2026-07-14T12-56-14-354Z-IPAD-001-modal-ready.png`：右侧商品图位是白菜/青菜，不是 iPad**。即 IPAD-001 当时也命中了同一商品图残留 bug，与 CHI-001 同源。佐证修复方向正确，且 bug 不是个例。

### 环境/配置就绪情况（除网络外都 OK）

- Playwright chromium 1.61.1：二进制真实存在、revision 匹配（`chromium.executablePath()` 解析到 `~/Library/Caches/ms-playwright/chromium-1228/...`，`fs.existsSync=true`）。之前 npm test 跳过 2 个浏览器测试是另一个环境，当前机器可用。
- 登录态 `playwright/profile/hifly`：.hifly.cc cookie 全部未过期（最早 2027-07-10），PostHog 显示已登录用户 1000753584。保留意见：服务端 session 是否仍被接受，只能真正打开 hifly.cc 才能确认。
- `config.local.json`：`behavior.resetUploadBeforeEachProduct=true`、`debug.captureSteps=true`（modal-ready 截图会在「商品图上传后、点立即生成前」捕获，正好用于核对右侧商品图）、`batch.maxItems=1`、`browser.headless=false`（headed）。

### 执行模型（研究结论，供用户/下一位参考）

- 现有批次 `batch-bdbf3cec` 已永久锁定：CHI-001 是 completed 终态，`prepareExecution` 要求全部 pending，`retry` 要求全部 failed_*，两者都不满足，无法在原批次执行或重试。
- 系统无单条/SKU 级执行路由。单条验证必须**新建一个只含 1 条的小批次**。
- 触发执行是异步的：`POST /api/executions` 返回 202，真正跑在后台，需轮询 `GET /api/batches/:id` 看状态。

### 下一步：用户在真实机器验证（推荐顺序）

> 已准备好现成验证素材包：`tmp/verify-fix/`（在 .gitignore 的 `tmp/` 下，不污染提交）。
> 含 `verify-products.csv`（单行 SKU=`VERIFY-001`）+ `VERIFY-001.jpeg`（吉伊卡哇图，内容独特一眼可辨非蔬菜）+ `README.md`（使用说明）+ `check-assets.mjs`（离线校验，已 PASS，确认 CSV 格式与 SKU↔图片匹配正确）。
> SKU=`VERIFY-001` 全新、零重复扣分风险。下面的 GUI 步骤可直接用这包素材。

**执行入口：只用 GUI**（CLI 可完全忽略）

- GUI 不读 `products/products.csv`，所以 CLI 那条路里 `SKU001=山野小青菜` 的坑，在 GUI 里不存在。GUI 是运营日常唯一入口。
- 直接用 `tmp/verify-fix/` 现成素材包（见上方引用）：`npm run login` → `npm run gui` → 在网页单条录入 SKU=`VERIFY-001` + 上传 `VERIFY-001.jpeg`，或批量导入 `verify-products.csv` + 图片 → 点「开始生成」。完整图文步骤见 `tmp/verify-fix/README.md`。
- 状态进入 `generating_asset` 后立即检查 `screenshots/*-VERIFY-001-modal-ready.png`：右侧商品图必须是吉伊卡哇（素材包里的图）；若是白菜/青菜，立即停止、不要继续点生成。

### 关键安全提醒

- 验证前必须 `npm run login` 确认登录态；登录态失效会停在 `paused_auth`（不扣分但需人工登录）。
- **用全新 SKU 验证**，不要复用 IPAD-001/CHI-001/BEAR-001。
- 旧的 CHI-001 错误远端作品 `629439` 和对应 mp4（`batches/batch-bdbf3cec-.../2026-07-14T18-25-24-795Z-629439-未命名.mp4`）不可交付客户。
- headed 模式（`headless=false`）运行期间不要手动关闭浏览器窗口（BEAR-001 就是被关掉浏览器导致 `Target page... has been closed`）。
- 若新代码抛 `Required upload "上传商品" is not visible` 或 `resetGeneratedHandsOnImage could not reveal the product upload button`，是新加的保护生效：记录截图/批次/SKU，按异常批次处理，未理解原因前不要重试。

---

## 当前最高优先级

当前项目不要继续做大范围优化，工作重心只有一个：先把本地 GUI 到飞影网页自动化的端到端流程跑通。

接手任何工作前，先阅读项目根目录的 `AGENTS.md`。该文件是跨模型协作规范，规定所有接手者必须把实际改动、当前卡点、下一步计划和验证结果写入持久文档，不能只留在聊天上下文里。

## 2026-07-15 紧急事故：正确批次生成成旧青菜/白菜素材

当前必须先暂停真实飞影生成，不要继续点击 GUI 的「开始生成」。

用户反馈：重新生成的批次明明是 iPad、吉伊卡哇玩偶、熊玩偶，但飞影生成出来仍然是青菜/白菜。已确认用户反馈成立。

已采取措施：

- 已停止本地 GUI/自动化进程，避免继续消耗积分和继续生成错误素材。
- 停止前监听端口为 `127.0.0.1:4317`，进程 PID 为 `19091`。
- `lsof -nP -iTCP:4317 -sTCP:LISTEN` 已无输出，说明该 GUI 服务已停。

关键证据：

- 当前批次确实是用户要跑的三条商品：
  - `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f`
  - `CHI-001`：吉伊卡哇卡通公仔
  - `BEAR-001`：棕色抱抱熊毛绒玩偶
  - `IPAD-001`：便携高清平板电脑
- 批次本地上传图是正确的：
  - `batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/uploads/060e3933-7668-4973-bbb1-47f19ee9688c.jpeg` 是吉伊卡哇公仔。
- 但飞影弹窗截图显示上传商品位仍是旧青菜/白菜：
  - `screenshots/2026-07-14T18-21-17-639Z-CHI-001-modal-ready.png`
  - 截图中左侧人物图正确显示推荐人物，但右侧商品图仍为水培青菜，不是吉伊卡哇。
- 说明不是 GUI 选错批次，也不是本地商品表错，而是飞影页面自动化在弹窗中没有强制替换旧商品图，复用了上一次残留素材。

当前批次状态：

```text
batch_id: batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f
status: active
CHI-001: download_pending
BEAR-001: confirmed
IPAD-001: confirmed
```

已产生一个错误下载文件：

```text
batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/2026-07-14T18-25-24-795Z-629439-未命名.mp4
```

该文件很可能对应错误的旧青菜/白菜素材，不要当作有效样片交付。

最可能根因：

- `src/hifly-page.js` 的 `uploadModalFile(label, filePath)` 当前逻辑里，如果目标上传按钮不可见，但 `isHandsOnModalReadyForGenerate()` 返回 true，就直接 `return`。
- 这在“弹窗里残留旧商品图且立即生成按钮可用”的情况下，会跳过当前商品图上传。
- 对商品图来说，这个行为是错误的。商品图必须每条强制替换，不能因为弹窗已经可生成就认为上传成功。
- 相关代码位置：
  - `src/hifly-page.js` `createHandsOnImage(product)`
  - `src/hifly-page.js` `uploadModalFile(label, filePath)`
  - `src/hifly-page.js` `resetGeneratedHandsOnImage()`
  - `src/hifly-page.js` `isHandsOnModalReadyForGenerate()`

建议 Claude Code / 下一位接手者优先修复：

1. 停止把「弹窗已可立即生成」视为商品图已上传成功。
2. 将 `uploadModalFile` 拆成两类语义：
   - 人物图可选：没有人物上传控件且页面可生成时，可以继续。
   - 商品图必选：必须强制上传当前 `product.image_path`，如果上传商品按钮不可见，应先清空/重置商品槽，不能直接跳过。
3. 在 `createHandsOnImage(product)` 中，上传商品图后必须验证右侧商品预览已发生变化，至少要记录截图并确认不是旧图；更理想是捕获上传前后商品图 `src/currentSrc` 或 DOM evidence。
4. 修改或删除现有测试：
   - `test/batch-runner.test.js` 中 `uploadModalFile accepts an already uploaded modal that is ready to generate` 对商品图已经不安全。
   - 应改成：商品图上传按钮不可见且弹窗可生成时，不能静默成功，必须抛错或执行清空后重传。
5. 增加回归测试：
   - stale modal has old product + generate button visible -> `createHandsOnImage` still attempts current product upload.
   - product upload cannot be skipped by `isHandsOnModalReadyForGenerate()`.
   - person upload can remain optional when missing.
6. 修复前不要重启 GUI 执行真实飞影任务。
7. 修复后先用 1 条商品做真实验证，并人工看 `*-modal-ready.png`：右侧必须是当前商品图，再允许点击弹窗「立即生成」。

快速检查命令：

```bash
node -e "const fs=require('fs');const p='batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/batch.json';const b=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({status:b.status,items:b.items.map(i=>({sku:i.sku,name:i.product_name,status:i.status,error:i.error_message,remote:i.remote_evidence,output:i.output_path}))},null,2));"
lsof -nP -iTCP:4317 -sTCP:LISTEN || true
```

恢复策略：

- 不要直接从当前 `active` 状态继续跑，否则可能继续处理 BEAR/IPAD 并继续复用旧商品图。
- 修复上传逻辑后，建议新建一个只含 1 条商品的小测试批次，或手动把当前批次中未执行的 BEAR/IPAD 安全恢复为待执行再测。
- 已生成的 CHI-001 错误远端作品 `629439` 不要作为成功证据。

验收标准：

1. 客户或运营能在本地网页 GUI 上传商品图片、录入或批量导入商品信息。
2. GUI 能创建批次，并按商品表数量执行：一个商品生成一条视频。
3. 自动化浏览器能在飞影 `https://hifly.cc/goods` 完成「上传人物+产品图」「弹窗立即生成」「生成完成确认」「外层立即生成视频」「下载作品」。
4. 出错后 GUI 必须能看到异常状态，并能对失败或需人工核对的批次重新执行，不需要重新逐条录入。
5. 真实飞影积分链路只在用户明确允许后执行。调试确认按钮、下载按钮、状态恢复时，优先复用当前异常批次，不要重复从头跑全流程。

## 项目定位

飞影官方 API 文档没有开放「一键成片 - 手里有货」模式，因此本项目采用本地网页工作台 + Playwright 浏览器自动化。

本地 GUI 只监听 `127.0.0.1`，目标用户是客户自己的运营人员。客户和运营在本项目语境中是一体的，不再区分「客户提交、内部运营执行」两套角色。

## 仓库状态

- 当前目录：`/Users/ketchup/Documents/Product Recommendation clip`
- 当前分支：`feature/local-gui-workbench`
- 远端分支：`origin/feature/local-gui-workbench`
- 已推送的最近提交：
  - `79700ad feat: show GUI execution video count`
  - `ccb3136 feat: add bulk product entry to GUI`
  - `6a9bc07 feat: retry failed pre-submit batches`

当前工作区有未提交改动。接手者必须先查看 `git status --short --branch`，只处理与当前任务相关的文件，不要回滚用户或其他任务造成的改动。

本轮与 GUI 跑通强相关的改动文件：

- `src/hifly-page.js`
- `web/app.js`
- `web/styles.css`
- `web/api.js`
- `src/core/state-machine.js`
- `src/server/routes/batches.js`
- `test/batch-runner.test.js`
- `test/state-machine.test.js`
- `test/server-api.test.js`

已知有其他未提交或未跟踪文件来自前面任务，不要随意删除或回滚。

## 当前 GUI 与服务状态

当前 GUI 目标地址：

```text
http://127.0.0.1:4317/
```

启动命令：

```bash
npm run gui
```

如果端口被占用，服务会自动切换到下一个端口。接手后以终端输出为准。

首次或登录态失效时：

```bash
npm run login
```

登录后需要确认能进入：

```text
https://hifly.cc/goods
```

## 当前关键批次

用户通过 GUI 提交过一个三条商品的小批量：

```text
batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f
```

三条商品：

- `CHI-001`
- `BEAR-001`
- `IPAD-001`

最近检查状态：

```text
batch status: pending
item status: pending
retry_count: 2
execution_key: null
error_message: null
```

含义：该批次此前曾在飞影提交视频附近没有识别到唯一的新作品证据，所以保守标记为「需人工核对」。2026-07-15 已经通过 GUI 的「重新生成异常批次」恢复为待执行，错误、checkpoint 和 execution_key 均已清空。

检查命令：

```bash
node -e "const fs=require('fs');const p='batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/batch.json';const b=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({status:b.status,execution_error:b.execution_error,items:b.items.map(i=>({sku:i.sku,status:i.status,error_phase:i.error_phase,error_message:i.error_message,output_path:i.output_path,submit_checkpoint:i.submit_checkpoint&&{phase:i.submit_checkpoint.phase,observed_at:i.submit_checkpoint.observed_at}}))},null,2));"
```

## 用户明确指出的产品问题

用户当前最不满意的是：GUI 出错后看不到清晰状态，也不能直接重新点击生成，需要重新录入会很麻烦。

已经实现或正在实现的方向：

1. GUI 轮询正在执行的批次，避免“提交后无反应”。
2. 批次详情显示执行异常、商品级错误、checkpoint 阶段和输出路径。
3. `interrupted_unknown` 批次可以在用户明确确认风险后强制重置为待执行。
4. GUI 对该状态显示「重新生成异常批次」，并提醒可能重复消耗积分。
5. GUI 首次加载后会优先选中最需要处理的批次，并在存在 `interrupted_unknown`、`active`、`paused_auth` 或 `failed` 批次时自动进入「待执行任务」页。该自动切换只发生在初始化阶段，轮询不会抢走用户当前所在页面。

2026-07-15 已验证：恢复前，浏览器刷新 GUI 后会自动进入「待执行任务」，并能看到 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` 的「重新生成异常批次」按钮；随后该按钮已被点击并确认，批次恢复为待执行。恢复后选中该批次时，「开始生成」按钮可用，但尚未点击，没有触发真实飞影积分链路。

接手者下一步要重点验证：当前批次已恢复为待执行，GUI 中选中该批次时「开始生成」按钮可用；只有用户明确允许后，才点击「开始生成」进入真实飞影执行。

本机 Claude Code 只读审阅结论：

- 同意默认选中和首屏切到「待执行任务」是当前 GUI 可用性的必要修复。
- 指出默认选中不能依赖批次列表字典序，应按状态优先级选择批次。
- 建议选中优先级与状态机聚合语义一致：`interrupted_unknown` > `active` > `paused_auth` > `failed` > `needs_input` > `pending` > `completed` > `empty`。
- 已知缺口：`canRetryBatch` 当前要求批次内所有 item 都是可重试异常状态。若后续出现部分完成、部分异常的批次，重试按钮可能仍不显示，需要另开小修。
- 已知缺口：静默轮询连续失败 3 次后停止，目前不会给用户明显提示，后续可补充状态提示。

## 飞影页面已知卡点

真实飞影页面的关键经验：

1. 弹窗内生成手持图完成后，会出现「确认」按钮。必须点掉，否则下次再点上传素材仍停留在旧弹窗。
2. 用户多次指出：生成完成弹窗已经显示，不需要从头重跑；调试时应只针对确认按钮或后续下载按钮做验证。
3. 下载阶段曾点错到删除按钮，导致出现「删除作品」确认弹窗。下载按钮和删除按钮相邻，必须使用更稳的定位策略，不能靠粗略坐标。
4. 如果 Playwright 的 DOM 定位不稳定，可以结合可访问性树、可见文本、元素截图、源码/接口观察，但当前第一目标仍是跑通自动化，不先改成未授权的内部 API 调用。

## 推荐下一步

接手后按这个顺序做，不要跳步：

1. 启动或确认 GUI：

```bash
npm run gui
```

2. 打开 `http://127.0.0.1:4317/`，刷新页面，选择批次 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f`。
3. 验证批次是否显示：

```text
状态：待执行
开始生成
```

4. 如果刷新后 GUI 自动选中了其他 `interrupted_unknown` 批次，手动点击 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` 所在行的「查看」。
5. 在用户明确允许前，不点击「开始生成」消耗飞影积分。
6. 真要跑真实链路时，只先跑 1 条；成功后再跑 3 条。
7. 重点观察：
   - 生成完成弹窗的「确认」是否由脚本点掉。
   - 最新作品区是否出现新作品。
   - 脚本是否点中下载而不是删除。
   - 下载文件是否落到批次产物目录或 `downloads/`。

## 验证命令

无积分本地验证：

```bash
npm test
npm run check
```

最近一次验证结果：

- `node --test test/batch-runner.test.js` 通过。
- `node --test test/state-machine.test.js test/server-api.test.js` 通过。
- `node scripts/check-js.mjs` 通过。
- `npm test` 通过：137 个测试，135 通过，2 个因本环境 Playwright 浏览器不可用而跳过。

如果改 GUI 或状态机，至少再跑：

```bash
node --test test/state-machine.test.js test/server-api.test.js test/batch-runner.test.js
npm run check
```

## 真实飞影积分调试规则

为了防止额度耗完：

1. 默认不做真实生成。
2. 需要真实生成时，先向用户说明会消耗积分，并拿到明确允许。
3. 优先利用当前 `interrupted_unknown` 批次定位确认/下载问题。
4. 不要为了验证一个按钮，从素材上传开始重复跑整条链路。
5. 如果必须重新执行，先限制 1 条商品。
6. 每次真实执行后记录批次 ID、商品 SKU、飞影作品时间、下载路径、失败阶段。

## 代码地图

GUI 前端：

- `web/app.js`：批次列表、详情、轮询、重试按钮、批量录入。
- `web/api.js`：前端 API 封装。
- `web/styles.css`：GUI 样式。

服务端：

- `src/server/start.js`：启动本地 GUI。
- `src/server/routes/batches.js`：批次 API、重试 API、公开字段过滤。
- `src/core/state-machine.js`：任务状态机。
- `src/core/batch-store.js`：批次读写。

飞影自动化：

- `src/hifly-page.js`：飞影页面点击、上传、确认、提交、下载定位。
- `src/run-batch.js`：CLI 执行入口。
- `src/core/batch-runner.js`：批次执行编排。

素材和产物：

- `batches/`：GUI 批次状态和上传副本。
- `downloads/`：下载视频。
- `logs/`：运行日志。
- `assets/person_pool/`：人物/背景图素材池。

## 状态语义速记

- `pending`：待执行。
- `confirmed`：用户已确认可执行，通常准备进入自动化。
- `generating_asset`：飞影弹窗内生成手持商品图。
- `asset_confirmed`：手持图已确认。
- `submitted`：已提交飞影视频生成。
- `download_pending`：等待下载。
- `completed`：完成。
- `failed_pre_submit`：提交前失败，通常可安全重试。
- `failed_remote`：远端失败，通常可重试但要检查页面提示。
- `interrupted_unknown`：需人工核对。可能已经消耗积分或提交过飞影任务，重试必须显式确认风险。

## 跨账号或跨工具接力说明

如果 Codex 额度不足，需要换另一个 Codex 账号或转到 Claude Code，接手者先做这些事：

1. 打开本文件。
2. 运行 `git status --short --branch`，不要回滚未理解的改动。
3. 运行 `npm install`，如果依赖已存在可跳过。
4. 运行 `npm run gui`，打开终端输出的本地地址。
5. 检查批次 `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f`。
6. 先验证 GUI 是否能恢复异常批次，再决定是否真实执行飞影。
7. 每次真实执行前必须确认用户允许消耗积分。

## 不要做的事

- 不要为了确认一个按钮修复，从头重复创建新批次并消耗积分。
- 不要自动删除飞影作品。
- 不要把 `config.local.json`、登录态、`batches/`、`downloads/`、`logs/`、`screenshots/`、`outputs/` 提交到 Git。
- 不要切换到内部未公开 API 作为主链路，除非用户明确批准并接受账号风控风险。
- 不要重构大范围架构。当前目标是 GUI 可用、异常可恢复、端到端跑通。
