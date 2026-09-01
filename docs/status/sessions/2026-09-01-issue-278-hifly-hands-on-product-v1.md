# Issue #278 `HIFLY_HANDS_ON_PRODUCT_V1` implementation session

## 2026-09-02 Production Contract Engineering Revision (provider-free)

本次 bounded revision 以最近真实 Evidence Run 的 `1600x2848` Stage 1
结果为唯一事实基线；没有调用 Provider/Hifly、没有新的登录、上传、生成、
确认、ProductionOrder、Attempt、部署或积分消耗。工作树基线为
`f2116bd424581b1af0f4a84c6516fad78f0c24d8`，仍在
`codex/hifly-hands-on-product-v1-contract`。

### RED → GREEN

- 新增 evidence helper 的首个 RED：`node --test
  test/hifly-production-evidence-contract.test.js` 在旧实现返回
  `ERR_MODULE_NOT_FOUND`；GREEN 记录字段级 evidence，并用精确
  `width * 16 === height * 9` 判定 `1600x2848 → FAIL_EXACT_MATCH`。
- Cloud bypass characterization RED：旧 adapter 接受
  `contractFieldVerifier: async () => true`，执行继续到
  `CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN`；GREEN 改为拒绝 bare boolean，返回
  `CONTRACT_STRUCTURED_EVIDENCE_REQUIRED` 与脱敏字段证据，并保持
  `createAsset`/`submitVideo` 为零。
- Local bypass characterization RED：带 V1 contract 的 real runner 接受
  bare boolean 并返回 `completed`；GREEN 在
  `createAsset`/`submitVideo` 前复用同一 structured verifier 语义并返回
  `requires_action`。
- Hifly page RED：带 V1 target 的 `1600x2848` generated dimensions 仍会
  进入 UI Confirm；GREEN 在 Confirm 前绑定单一 ready generated-result，记录
  `handheld_aspect_ratio` evidence。默认 `record_only` 允许继续；显式不可变
  `require_exact` 才返回 `HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_MISMATCH`/
  `requires_action`，不 Confirm、不进入 Stage 2。该历史 run 当时的 exact
  policy 仍保留在历史证据中。
- Follow-up RED：缺少 bounded evidence / Local report `failure_stage`，以及
  unsafe thrown evidence 可绕过重建；GREEN 使用 controlled fields/source/stage/
  paid-boundary、bounded values、safe reconstruction，并通过现有
  `supporting_outputs` JSON 保留 Local report evidence。Rich ratio results are
  projected to canonical field-level records before persistence; scalar or
  mutable enforcement policies are rejected.
- Follow-up RED：PARTIAL voice evidence 接受了 contradictory source、测试 fixture
  被列入 pre-paid production source、完成路径未携带 Stage 1 evidence、证据集合无
  persistence cap/duplicate rejection。GREEN 收紧 native voice source，加入
  `voice_identity_policy=ui_visible_state_allowed`，把成功 evidence 传入 Cloud/Local
  completed reports，并在持久化边界做 `<=16`/duplicate/opaque-ID 约束。

### 实际改动

- 新增 `src/execution-contracts/hifly-hands-on-product-evidence.js`：字段级
  Evidence Record、target/handheld/final 分离、精确比例核验、不可变执行策略、
  结构化 verifier 检查、默认/历史 Evidence status 与消费者可见商品保真判定。
- 更新 Cloud Playwright 与 Local Agent real V1 路径，均拒绝 bare/非结构化
  verifier success，并将 `requires_action` 保留为结构化 evidence。
- 更新 Hifly 页面 generated-artifact natural dimensions 读取和
  post-handheld/pre-video Confirm seam；只读取单一 ready-result，去除
  `imageSources`/raw modal image source 日志；更新 batch runner 对受控
  `requires_action` evidence 的不可恢复终态保存。
- 更新本地 Agent 受控 reason、report evidence/failure-stage 传递及 focused
  tests/docs；未改变 Provider config、Secret、生产数据库、部署或业务对象。

### 验证

- `node --test test/cloud-executor-playwright.test.js
  test/local-agent-cli.test.js test/hifly-production-evidence-contract.test.js`
  → **当前 42/42 pass**（包含 thrown-evidence、target/policy、voice-shape 与
  evidence projection 修正）。
- `node --test test/batch-runner.test.js` → **当前 95/95 pass**。
- `node --test test/local-agent-execution-system.test.js` → **3/3 pass**。
- Relevant aggregate (`hifly-hands-on-product-contract`, evidence helper,
  avatar material, production start, package/compiler, handoff, snapshot,
  Cloud, Local and batch suites) → **235/235 pass**。
- `npm run check` → **252 JavaScript files checked**；`git diff --check` → pass。

Pre-paid production evidence sources exclude `test_fixture`; tests use
`production_contract` for target and `hifly_ui_display` for UI-visible voice.
The formal ProductionOrder snapshot remains `record_only`; `require_exact` is
only a deferred explicit execution-authorization seam. The generated-result
semantic selector is synthetic/unverified and remains
`LIVE_DOM_EVIDENCE_REQUIRED` until a live DOM recording establishes it.

当前工程候选仍不能宣称真实生产完成；native voice exact identity、final
video ratio、Stage 1→Stage 2 dimension behavior、最终音频与 Lip-sync 仍是
独立 evidence gaps。下一步必须经过 Independent Review 与 Owner Gate，且
真实 Final Video 仍需新的授权。

> 日期：2026-09-01（Asia/Shanghai）
> 角色：IMPLEMENTER / luna-worker；运行时模型元数据未暴露（`UNVERIFIED_RUNTIME_MODEL`）
> 分支：`codex/hifly-hands-on-product-v1-contract`
> 精确基准：`3fbca9647b0d8fab89423ec0e55fd5ee7b71821c`
> 边界：provider-free / Hifly-free；不提交、不推送、不合并、不部署

## 目标与决策

本轮只实现窄化的 `HIFLY_HANDS_ON_PRODUCT_V1` 合同。合同由结构化事实构建，不解析 `output_instructions`，不建设通用视频 DSL。生产配置显式注入 `productionContractId`；默认 demo/test 没有 marker 时保留 legacy contractless 行为。精确 lineage 由当前 approved/frozen upstream 提供，`requireHiflyHandsOnProductV1(contract, expectedBindings?)` 负责 caller-supplied lineage 复核；实现模块不硬编码某一组 Owner UUID。

## TDD 记录

### RED 1 — contract module

- 新增 `test/hifly-hands-on-product-contract.test.js` 后：
  `node --test test/hifly-hands-on-product-contract.test.js`
- 结果：**RED**，目标 `src/execution-contracts/hifly-hands-on-product-v1.js` 不存在，Node 返回 `ERR_MODULE_NOT_FOUND`。

### GREEN 1 — contract

- 新增 builder/validator/canonical SHA-256 seam。固定 production invariants 为 `hands_on_product`、`9:16`、`hifly_native`、`single_scene`、`fixed_simple`、`smart_fit`、B-roll/additional characters/external TTS/standalone lipsync/copy AI 全部关闭。
- 结构化 frozen Copy body 计算 `body_hash`；contract 与嵌套对象 deep-freeze；expected lineage mismatch 和 mode/ratio/voice/copy/plan 状态 fail-closed。
- 结果：`node --test test/hifly-hands-on-product-contract.test.js` **16/16 pass**。

### GREEN 2 — avatar material and snapshot

- `avatar-selection-service.js` 增加一个 server-private `getHandsOnProductMaterialSnapshot`，解析 current selection → AvatarVersion → registered MaterialVersion，校验同组织、`avatar_image`、active/available、verified media/size/SHA，仅返回受控元数据，不进入 public projection。
- 生产 input snapshot port 只接收构造时注入的显式 `productionContractId` marker；marker 精确为 V1 才 derive `hifly_hands_on_product_v1`，并使用当前计划、review、商品引用、冻结文案和人物素材事实；未知 marker fail-closed。多商品图片没有显式 primary 时不猜首张。
- production config/app wiring 已注入 `HIFLY_HANDS_ON_PRODUCT_V1`。
- 结果：`node --test test/avatar-materials-service.test.js test/hifly-hands-on-product-contract.test.js test/production-start.test.js` **29/29 pass**。

### GREEN 3 — handoff/compiler/execution

- Handoff manifest 在 V1 下验证精确 plan/review/product/copy/avatar lineage，校验商品 primary reference、copy body hash、Smart Fit，并将 contract 原样纳入 manifest/hash；legacy manifest 不新增字段。
- Local compiler 在 V1 下校验 manifest fields、嵌入商品实际字节与映射人物实际字节的 size/SHA，输出 contract 与 exact lineage task fields；不写凭据/路径到 manifest。
- Execution snapshot 仅在 task 有 V1 contract 时加入 canonical contract，避免 legacy digest 漂移。
- 结果：Local compiler **8/8**、manual handoff service **9/9**、real-chain **1/1**、execution snapshot **5/5** pass。

### GREEN 4 — Cloud pre-point gate

- Cloud Playwright 在 browser/delegate construction 前验证 contract/mode；默认没有 proven verifier 时对 ratio/voice 返回稳定 `CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE`（历史实现曾记录为 `aspect_ratio,voice_source`，当前字段为 `target_aspect_ratio,voice_source`），browser-zero。注入 verifier 时只构造一个 page/hiflyPage，并将同一对象传入 verifier；验证发生在 `runBatch`/`createAsset`/`submitVideo` 前，失败即关闭 context 并返回 Owner-gated stop；wrapper 再次复核 contract。
- 结果：Cloud Playwright **7/7** pass，包含 package archive/compiler chain、taskFactory drift、same-page verifier、failed-verifier close 与 ambiguous post-submit 既有回归。

### Rework — readiness, page ordering, integrity, and archive closure

- **RED**：Cloud `preflight()` 无 verifier 时会启动浏览器；runtime readiness 丢失稳定 contract reason。**GREEN**：无 verifier 的 adapter preflight/browser/readiness 为 `CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE` + `requires_action`，runtime 在 list/claim 前停止；注入 verifier 才保留 login-purpose preflight。
- **RED**：`fillProduct` 先执行 inner 150-point `createHandsOnImage`，script/AI toggle 失败仍可能触达 paid action。**GREEN**：固定商品字段与 `applyScriptMode`（set/readback）先于 inner generation；失败时 inner/clickModalGenerate 为 0，继续复用既有 selectors。
- **RED**：V1 compiler 在多图片时取首个 asset，execution snapshot 未比对实际 bytes，archive/attempt attribution integrity 缺失。**GREEN**：V1 只按 contract primary AssetVersion，legacy 保留首项；snapshot 比对 product/avatar SHA；既有 manifest/package hash 重算与 attempt/package/order/version 绑定在 Local/Cloud compile 前执行，self-consistent 但归属错误的包仍拒绝。
- **RED**：archive `require` 返回可变原对象，Handoff 未校验 order top-level plan identity。**GREEN**：validator 返回 deep-frozen structured clone，Handoff 写入 validated clone，并在 hash 前拒绝 `order.video_plan_version_id !== snapshot plan.id`。

## Independent review correction loop

首轮独立 Review 标记 5 个 merge-blocking P0，随后逐项补充了真实回归测试：

- **RED A（taskFactory bypass）**：taskFactory 返回 `resolved_script_mode=custom` 时旧 adapter 继续进入执行并报告 generic `failed`，未在浏览器前拒绝。新增测试先失败；GREEN 增加 canonical task lineage、frozen-copy mode、script SHA、presentation/ratio/voice/mode 交叉核对，现以 `HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH`/`pre_point_gate` 停止且 browser/delegate calls 为 0。
- **RED B（validator shape）**：删除 contract plan lineage 字段后旧 validator 因 `expectedPairs(...).filter(nonempty)` 仍接受。新增字段表测试先失败；GREEN 明确要求每个 plan/product/copy/avatar 字段与每个 fixed production flag，且覆盖 unsupported version。
- **RED C（avatar race/binding）**：material seam 返回 stale selection/avatar version 时旧 snapshot 只采用 material checksum，未核对 selection/version。新增测试先失败；GREEN 要求 server-private seam 接收 expected IDs，并由 seam 与 snapshot 双重核对。
- **RED D（primary product）**：ProductRevision 有多个图片且无显式 primary 时旧 snapshot 静默选首张。新增测试先失败；GREEN 仅在恰好一个 asset 时允许 fallback，否则返回 `HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_ASSET_REQUIRED`。
- **GREEN E（runtime semantics）**：ratio/voice verifier 缺失、失败或返回未验证结果统一返回 `{status:"requires_action", outcome:"requires_action", failureStage:"pre_point_gate", code:"CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE", fields:["target_aspect_ratio","voice_source"]}`，Cloud service 可保持 Owner-gated，而不是 generic failed；fake verifier 只用于本地测试。

Review 同时收窄接口为单一 canonical `hifly_hands_on_product_v1` 字段与 constructor-injected `productionContractId`；移除 `production_contract`/camel-case aliases 与未使用的 `isHifly...` export。实现模块不硬编码 Owner UUID；exact lineage 来自当前上游与 caller expected bindings。

第二轮 Review 追加 3 项边界并完成 RED → GREEN：

- **RED E（Plan presentation size）**：Plan 为 `small` 时旧 snapshot 仍构建 smart_fit 合同，并将阻断推迟到 handoff；GREEN 在 Order snapshot 前要求 exact `smart_fit`，返回 `HIFLY_HANDS_ON_PRODUCT_V1_PRESENTATION_SIZE_INVALID`。
- **RED F（verifier context）**：成功 fake verifier 原先在 browser 前执行，收不到 `page`/`hiflyPage`；GREEN 只有注入 `contractFieldVerifier` 才构造单一 browser/delegate，把同一 page/hiflyPage 与 fields/phase 传入 verifier，并在 `runBatch` 前执行。无 verifier 继续 browser-zero。
- **RED G（contract shape）**：未知 top-level/nested key 原先被忽略；GREEN 仅允许精确 contract shape，未知 key、缺字段与固定 invariant drift 均 fail-closed。失败 verifier 会关闭 context、返回 Owner-gated `requires_action`，并不调用 `createAsset`/`submitVideo`。

第三轮独立 Review 追加边界并完成 RED → GREEN：

- **RED H（package hash order）**：双素材包在 asset 顺序为 `b → a` 时，旧 verifier 对 asset names 排序而与 producer insertion order 不同，合法包无法等价校验；GREEN 抽出既有 fingerprint 算法为 `computeManualHandoffPackageHash`，producer/verifier 共用有序 entries，合法双素材通过，重排或 bytes 篡改 fail-closed。
- **RED I（archive member/write boundary）**：旧 Cloud/Local path 先把 ZIP 写入 workspace 再做完整性校验，`unexpected.bin` 可先落盘；GREEN verifier 从 archive bytes 派生 manifest，拒绝 manifest/README/预期 `assets/<id>` 之外成员（保留必要 directory entry），Cloud/Local 在 extraction 前完成 attribution/hash/member 校验。Cloud 回归确认拒绝后 extraction root 不存在且 browser/delegate 为 0。
- **RED J（contract immutability）**：compiler 丢弃 `requireHiflyHandsOnProductV1` 返回值，来自 archive 的 mutable contract 会进入 task；execution snapshot 另行 structuredClone 也会丢失 deep-freeze；GREEN 两处均保留 validator 的 deep-frozen clone，task/snapshot 及嵌套 lineage 保持 frozen。
- **GREEN K（attribution/size）**：expected package/attempt/order 的每个非 null `package_id/order_id/package_version/manifest_hash/package_hash` 均逐项与 manifest 及彼此交叉核对，hashless legacy 也先过 identity gate；execution snapshot 同时核对 product/avatar byte length 与 SHA，正确 bytes+hash 但声明 size 漂移会停止。
- **RED L（historical hybrid hash）**：旧 producer 对 provisional asset names 使用 sorted 顺序、对最终 asset digests 保留写入顺序；当前统一 insertion 的 helper 会拒绝非字典序 z→a 历史包。**GREEN** 仅恢复既有 hybrid 语义（provisional names sort、final digests archive order），当前 producer、历史 fixture 均通过，最终 digest 重排仍拒绝。

## 验证

```text
node --test test/hifly-hands-on-product-contract.test.js
node --test test/avatar-materials-service.test.js
node --test test/production-start.test.js
node --test test/local-agent-package-compiler.test.js
node --test test/manual-handoff-package-service.test.js test/manual-handoff-package-real-chain.test.js
node --test test/execution-snapshot.test.js
node --test test/cloud-executor-playwright.test.js
node --test test/cloud-executor-login.test.js test/cloud-executor.test.js
node --test test/batch-runner.test.js
node --test test/local-agent-cli.test.js
npm run check
git diff --check
```

Before the third review, the relevant regression baseline was **259 tests / 258 pass / 1 expected PostgreSQL skip**. After the third review's two new archive-boundary cases, the intermediate relevant command passed **261 tests / 260 pass / 1 expected PostgreSQL skip**; after the historical hybrid hash compatibility case, the final relevant command passed **262 tests / 261 pass / 1 expected PostgreSQL skip / 0 fail**. The direct latest per-file checks were Local compiler **7/7** and batch/Hifly page **90/90**; these per-file counts overlap and must not be summed into the aggregate. Other focused checks: contract **19/19**, avatar material **8/8**, execution snapshot **5/5**, Local runner **16/16**, manual handoff service **13/13**, real-chain **1/1**, Cloud Playwright **10/10**, Cloud runtime **24/24**, Cloud login **10/10**, production-start **15/15**. Governance regressions ran separately at **30 tests / 30 pass / 0 skip** and are not folded into the overlapping code aggregate. `npm run check` checked 251 JavaScript files; `git diff --check` passed. `npm ci --ignore-scripts` was run once because dependencies were absent before testing.

PRE-REWORK baseline only (not current validation; no full suite rerun after rework): `npm test` previously recorded **1310 pass / 16 expected environment skips / 1 fail** out of 1327. The single failure was the pre-existing, unmodified `test/operator-single-workspace-works-browser.test.js` browser timing assertion (line 599, `false !== true`); it is outside this Issue's allowlist and was not altered or retried as a false product signal.

## Evidence coverage and next gate

Existing evidence is sufficient for Hands-on-Product entry/mode, avatar/product upload, frozen Chinese copy input, AI-copy-off, generate boundary and download/output. Smart Fit is already `CONTRACT_MACHINE_ENFORCED` by native select plus double read-back. Ratio and Hifly-native voice lack reliable current Playwright set/read-back; the required future minimum is one bounded recording through state/request/response/read-back, stopping immediately before point-consuming Generate whenever possible. No recording is run in this session.

`CONTRACT_IMPLEMENTATION = GAP`: the provider-free structural/identity code-test candidate is GREEN, but the production gate remains BLOCKED for ratio/voice until a proven verifier exists. Independent Review, exact-head CI, merge and deployment remain pending.

P1 truth: `smart_fit` is CLOSED / machine-enforced; current script/toggle set/read-back before inner Generate makes `copy_ai_generation=false` CONTRACT_MACHINE_ENFORCED; `single_scene`, `fixed_simple`, `b_roll=false` and `additional_characters=false` are RECORDED_ONLY / POST_OUTPUT_QC_REQUIRED; `external_tts=false` and `standalone_lipsync=false` are RECORDED_ONLY current-path constraints.

## External effects truth

```text
Provider Calls Delta: 0
Provider HTTP Delta: 0
Provider Tokens Delta: 0
Provider Cost Delta: 0
Hifly Requests Delta: 0
Hifly Points Delta: 0
ProductionOrder Delta: 0
Handoff Delta: 0
Attempt Delta: 0
Cloud Claim Delta: 0
Real production executed: NO
Generate clicked: NO
```

All tests use memory repositories, temporary files and injected fakes. No provider, Hifly, browser production, login, deployment or business-domain write was performed.
