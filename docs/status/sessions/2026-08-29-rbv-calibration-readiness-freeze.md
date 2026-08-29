# 2026-08-29 RBV-002 Calibration Readiness Freeze

## 会话范围与权限

- Issue：[#261 RBV-002：冻结 Calibration Readiness 并输出真实运行前门禁结论](https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/261)
- Exact base/main/head：`135ac176dc48162395707550a991d075287702c2`
- Branch：`codex/rbv-calibration-readiness-freeze`
- Goal：[`RBV-GOAL-001`](../../GOAL.md)
- Decision：[`D-037`](../../product/DECISION_LOG.md#d-037-real-batch-production-validation)
- Pilot Contract：[`REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`](../../product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)
- Readiness Record：[`RBV_CALIBRATION_READINESS_FREEZE.md`](../RBV_CALIBRATION_READINESS_FREEZE.md)
- 逻辑角色：`IMPLEMENTER`
- 自定义 Agent：`luna-worker`（custom agent: luna-worker）
- 配置模型：`gpt-5.6-luna`
- 配置推理强度：`Max`
- 配置文件状态：`CONFIG_VERIFIED`
- 运行时模型元数据：`UNVERIFIED_RUNTIME_MODEL`（当前工具未暴露可核验的 wire/session 模型元数据）

本轮只允许更新 Issue #261 的十文件 allowlist，并创建 Git 外 Evidence 目录骨架。没有 Provider、飞影、Secret、登录、SSH/noVNC、真实上传、生成、下载、交付、部署、生产数据写入或积分动作；积分消耗为 `0`。

## Owner-confirmed readiness inputs

- `RBV-CAL-001` roster 为 `SKU-CAL-001` ～ `SKU-CAL-005`，共 5 项；operator 为 `OP-CAL-001`。
- Batch hard cap `6000` points、per SKU `1200` points、concurrency `1`、`automatic_retry=false`。
- 日期 `2026-08-29`、时区 `Asia/Shanghai`，窗口为 Owner confirmation → `2026-08-29T23:59:59+08:00`。上限是 maximum exposure，不是 spend authorization。
- Repeatable non-author operator 为 `pending`：不阻塞 Calibration readiness，但继续阻塞 Repeatable。
- 外部商品样本仅以 alias `RBV_PRODUCT_INPUT_SAMPLES` 引用；网页图片许可尚未核验。
- 候选人物仅以 `RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png` 引用。只读校验：PNG、`1122x1402`、`1666036` bytes、mode `0600`、SHA-256 `0887c7e4748caf2f9735e7d7d1afd6788d2f3b6e4d3a9a53a9c88f1767093b10`、`outside_git`。Owner nominated，但内部/Provider 上传许可与 live upload 未授权。
- `RBV_PRIVATE_EVIDENCE_ROOT/calibration/RBV-CAL-001/{inputs,provider,runtime,outputs,cost,qc,delivery}` 已在 Git 外创建为 mode `0700` 空目录；未写入真实 evidence。

## TDD checkpoint

1. 先新增 `test/real-batch-calibration-readiness-governance.test.js`，未修改文档的 exact base 运行：`node --test test/real-batch-calibration-readiness-governance.test.js`。
2. Old-head 结果为真实 RED：`12` tests / `0` pass / `12` fail。失败由缺失 readiness record、Readiness Freeze current pointers 和 current Issue/Stage map 触发；没有跳过测试、伪造 fixture 或绕过断言。
3. 随后仅更新 Issue #261 allowlist 内文档与 readiness record，保留 Stage 1 合同为历史，并将唯一 active stage 切换为 Readiness Freeze。
4. 删除旧 Stage 1 compatibility table、修正 CURRENT 权威恢复顺序与新治理断言后，先运行旧治理测试捕获 active 期待 RED，再仅更新既有测试为 Stage 1 historical completed regression。
5. GREEN 目标：targeted governance、既有 Stage 1 governance、`npm run check`、`git diff --check` 和 exact 10-file allowlist/outside=0 均通过；最终 verdict 必须为 `BLOCKED_PRE_REAL_RUN`。

## Reviewer P1 修复 checkpoint

- Reviewer checkpoint：`issuecomment-5461982538`，结论 `CHANGES_REQUESTED`（P0=0，P1=2）：CURRENT 深层权威恢复顺序仍指向 Stage 1；Pilot compatibility table 造成第二个同 schema `stage_contract | active`。
- Owner 将 exact allowlist 从 9 扩为 10，唯一新增为 `test/real-batch-validation-governance.test.js`，用于更新旧 Stage 1 断言；不扩展其他实现范围。
- 先删除 compatibility table、更新 CURRENT 与 new readiness test，再运行旧治理测试得到预期 RED：`16` tests / `14` pass / `2` fail（旧 `active_stage=Stage 1` 与旧 authority/P0 指针期待）。随后精确更新既有测试，保留阈值、Evidence、non-goal、历史 Goal 与 P0 历史断言，GREEN 为 `16/16`。
- Final test-truth cleanup：将 existing Stage 1 governance test 的 AGENTS 与 agent-collaboration 断言改为 Issue #261 当前 Readiness Freeze/current record，并显式断言 Stage 1 completed historical 与 CE-08 historical；不再依赖无作用域的 Stage 1 current wording 或历史词命中。

## Independent Review final

- 独立 Reviewer 最终结论：`APPROVED`；P0/P1/P2 均为 `0`。
- 两项 P1 已修复：CURRENT 权威恢复顺序现指向 Readiness Freeze/current record/current roadmap；Pilot 仅保留 current map 的唯一 `active`，Stage 1 仅以历史 completed prose 保留。
- 当前验证汇总：两套治理测试合计 `28/28` pass，`npm run check` 检查 `249` 个 JavaScript 文件，`git diff --check` pass，allowlist `10` / outside `0`。
- Exact-head required CI：待 commit 后运行；本轮不因本地 GREEN 提前合并或宣称 CI 通过。

## 当前 blocker / Stop Rules

五个 SKU 均为 `BLOCKED`，原因包括网页图片许可未核验、manifest 名称/卖点是 test fixture 而非 source authority；`SKU-CAL-004` source 是 Facial Cleanser Bottle 而非洁面乳；`SKU-CAL-005` source 是 Meadow XL，revision 是预制 fixture，不构成真实人工证据。候选人物内部许可与 Provider upload 未授权。

当前真实运行还阻塞于 `LOGIN_RUNTIME_UNVERIFIED`、`UPSTREAM_PRODUCT_FACTS_UNVERIFIED`、`UPSTREAM_COPY_NOT_VERIFIED`、`AVATAR_SELECTION_NOT_VERIFIED`、`VIDEO_PLAN_NOT_VERIFIED`、`ORDER_READINESS_NOT_VERIFIED`、`PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED`、`PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED` 和 `POINTS_SPEND_UNAUTHORIZED`。不得创建 ProductionOrder/attempt、登录、上传、生成、下载、部署、发布、重试、并行或消耗积分。

唯一当前结论：`BLOCKED_PRE_REAL_RUN`。独立 Reviewer 仍须审查实际 diff 和测试；实现者不得自审/批准，Draft PR 停在 Owner Gate。

## 实际改动（Issue #261 exact allowlist）

1. `AGENTS.md`、`GOAL.md`、`docs/agent-collaboration.md`：将 current pointer 切到 Issue #261 Readiness Freeze，Stage 1 标为已完成历史，并保留 fail-closed/协作规则。
2. `docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`：将 current metadata/stage map 切到 Readiness Freeze，保留 Stage 1 historical snapshot 与原合同阈值。
3. `docs/status/RBV_CALIBRATION_READINESS_FREEZE.md`：新增脱敏、机器可核对的五 SKU readiness record、人物/Provider、预算、证据 alias、Stop Rules 和唯一 verdict。
4. `docs/status/CURRENT.md`、`docs/ROADMAP.md`：写入当前 RBV-002 状态、阻塞原因、证据隔离和下一 Owner Gate；旧 Stage 1 与 P0 文本仅作历史。
5. `docs/status/sessions/2026-08-29-rbv-calibration-readiness-freeze.md`：记录本轮 TDD、配置、事实、验证和零真实动作边界。
6. `test/real-batch-calibration-readiness-governance.test.js`：锁定 active stage、五 SKU 字段、元数据、权利/fixture 分离、人物元数据、预算窗口、证据 alias、fail-closed 和 verdict。
7. `test/real-batch-validation-governance.test.js`：将 Stage 1 stage-map 与 CURRENT authority 断言收敛到 historical completed + current Readiness Freeze，保留既有治理覆盖。

未创建 ADR/Decision，未修改 UI/API/DB/Cloud Executor/Agent/Provider adapter/生产功能代码，未复制外部商品图或人物图进入 Git。

## 验证记录

| command | result |
|---|---|
| `node --test test/real-batch-calibration-readiness-governance.test.js`（old-head） | RED：12/12 fail（已记录） |
| `node --test test/real-batch-calibration-readiness-governance.test.js`（实现后） | GREEN：12/12 pass |
| `node --test test/real-batch-validation-governance.test.js`（docs+new test、旧断言） | RED：14/16 pass、2 fail（已记录） |
| `node --test test/real-batch-validation-governance.test.js`（historical regression 更新后） | GREEN：16/16 pass |
| `npm run check` | GREEN：Checked 249 JavaScript file(s). |
| `git diff --check` | GREEN：无输出、exit 0 |
| exact 10-file allowlist / outside=0 | GREEN：changed=10、allowlist=10、outside=0 |
| private absolute path leak scan | GREEN：无私有绝对路径命中；Git 文档仅 alias + relative ref（已有协作配置 tilde 引用不含候选路径） |

## 下一步

Targeted governance、Stage 1 regression、静态检查与 allowlist 证据均已 GREEN；下一步仅等待独立 Reviewer、Draft PR exact-head CI 与 Owner Gate。无新的 Owner 授权前不进入 Calibration Run，不访问 Provider，不消耗积分。
