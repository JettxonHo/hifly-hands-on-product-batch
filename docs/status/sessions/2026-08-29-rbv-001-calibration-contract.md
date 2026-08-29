# 2026-08-29 RBV-001 Calibration Contract

## 会话范围

- Issue：[#259 RBV-001：固化真实批次 Pilot 合同与 Calibration 人工门禁](https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/259)
- Exact base：`d0d4cc84b99ea2c88962fd7e1f93b8d1d33e8fa4`
- Branch：`codex/rbv-001-calibration-contract`
- Goal：[`RBV-GOAL-001`](../../GOAL.md)
- Decision：[`D-037`](../../product/DECISION_LOG.md#d-037-real-batch-production-validation)
- Pilot Contract：[`REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`](../../product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)
- 当前阶段：Stage 1「合同与人工门禁」；状态 `STAGE_1_CONTRACT_PENDING_OWNER_GATE`

本会话只处理文档合同、人工门禁和治理测试。实现 Agent 不是独立 Reviewer，不能批准自己或合并 Draft PR。

## Old-head RED（先测后改）

在未修改文档的 exact base 上，先运行：

```text
node --test test/real-batch-validation-governance.test.js
```

结果为真实 RED：`6/6` 测试失败。失败均为治理文档缺失（test 1 找不到归档 Goal；test 2–5 找不到 Pilot Contract；test 6 缺少 product README 的 RBV marker），没有通过伪造 fixture 或跳过测试来规避。

## Contract completeness 第二轮 RED → GREEN

- 在补充合同完整性断言后，先对当前候选运行同一 targeted test；真实结果为 `12` tests / `6` pass / `6` fail。新增失败覆盖 Current Production Truth、Gap Matrix、逐商品/逐工单字段与汇总指标、Evidence Package/Git 排除、串行 Issue/Stage map、Allowed fixes/Non-goals；此前 Pilot 尚未固化这些结构。
- 随后只在本 Pilot Contract 内补齐上述六组结构与机器可核对字段，再运行 targeted test，结果为 `12/12 pass`。没有写入实际 roster、人员、成本、运行、发布或反馈值，也没有把历史基线升级为 RBV Calibration。

## Independent Review 修复循环（CHANGES_REQUESTED）

- Reviewer verdict：`CHANGES_REQUESTED`；主控已在 Issue #259 checkpoint（`issuecomment-5459832698`）记录该结论。问题是 CURRENT、ROADMAP 与 agent-collaboration 仍把旧 Cloud Executor/P0.5 文本呈为当前指针。
- 本轮 allowlist 扩展为 11 个文件，新增 `docs/agent-collaboration.md`；其余范围与 Stage 1 合同不变。
- 第三轮先扩治理断言后运行 targeted test，真实结果为 `14` tests / `12` pass / `2` fail（旧 P0/P0.5 当前措辞与旧 CE-08 当前分配）；随后将冲突文本明确降为历史并切换当前分配，结果为 `14/14 pass`。

## Independent Review 第二次修复循环（CHANGES_REQUESTED）

- 第二次独立复审 verdict：`CHANGES_REQUESTED`（无新增 P0）；主控要求继续修复 ROADMAP 旧 §3/§4/§5 的现行标题、D-037 anchor、以及 Pilot schema 的逐项字段覆盖。
- allowlist 仍为 11 个文件，本轮不扩文件、不访问 GitHub；Stage 1 的 Provider/飞影/Secret/积分与真实数据边界不变。
- 第三轮先扩治理断言后运行 targeted test，真实结果为 `15` tests / `12` pass / `3` fail（D-037 exact heading/active anchor、逐项数据字段、ROADMAP 历史降级）；实现后结果为 `15/15 pass`。

## Final Independent Review（APPROVED）

- 未参与实现的独立 Reviewer 对最终 11-file 候选完成 delta + full re-review，verdict 为 `APPROVED`；P0/P1/P2 均为 0。实现 Agent 未批准自己的工作。
- Reviewer 复核确认：CURRENT、ROADMAP 与 agent-collaboration 只保留 RBV-GOAL-001 Stage 1 为现行指针，旧 P0/CE-08/P0.5 内容明确为历史；D-037 heading 与所有 active anchor 一致；Pilot 数据 schema 覆盖本 Goal 要求且只能使用真实授权采集，未采集值保持 `unknown`/`pending`。
- 该批准只覆盖 Issue #259 Stage 1 的治理候选，不代表 Calibration、Repeatable、MBL、RBV、真实交付或生产就绪完成。Draft PR 仍须停止在 Owner Gate。

## Exact-head CI newline 修复循环（Windows RED → normalization）

- Exact-head CI run `run33230035708` 的 Windows job `99041103439` 出现唯一失败：归档 Goal 的 worktree 字节因 CRLF 换行导致实际哈希前缀 `888aa0`，而固定 LF 期望哈希前缀为 `a3d2fc`；Ubuntu 与 `identity-postgres` jobs 为 green。主控已先在 Issue/PR 留下透明 checkpoint。
- 修复仅限治理测试：先将归档文本的 CRLF 归一化为 LF 再计算固定 SHA-256；同时构造 CRLF 投影并断言归一化后的哈希与固定值及 LF 哈希一致，避免 Linux 换行环境假绿。旧标题和 `GOAL_COMPLETE` 断言保持不变。
- 本轮修复后本地 targeted `15/15`、`npm run check`（249 JavaScript files）、`git diff --check`、exact-base archive `cmp` 与 allowlist（11 paths / outside=0）均通过；Exact-head CI 需在该修复上重跑，未提前宣称通过。

## Stage 1 合同事实

- Calibration roster 只允许 3–5 个真实或已授权去标识化商品，至少 2 个品类、至少 1 次人工修正；不预设成功率，也不在本阶段填写商品、素材、权利或结果。
- 真实 blocker 修复后，后续才可验证可复现至少 10 条；连续 5 条作业期间不得修改生产代码。成本不合理即停在 Owner Gate，不得自行缩样。
- 真实业务证据还要求至少一名非作者运营者启动第二批，以及至少一条真实视频已交付、展示或用于运营。fixture/fake/mock/controlled provider/本地 demo 只能作为工程证据。
- 飞影、Provider、Secret、积分、客户素材、公开发布、生产部署、破坏性操作和其他真实动作均 fail-closed，按动作等待 Owner 明确授权；本会话实际消耗积分为 `0`。

## Owner Gate 输入（未满足前不得进入下一阶段）

Owner 必须提供并确认：Calibration roster、每个素材的权利/用途/留存与脱敏规则、非作者运营者、可接受积分/成本上限、允许登录窗口及证据红线。当前这些输入均为 pending；不得先运行 Calibration、创建批次、访问真实 Provider 或把文档/测试/代码标为 MBL/RBV 完成。

## 本轮实际改动（严格 allowlist）

1. `GOAL.md`：设为唯一现行 `RBV-GOAL-001` Goal，仅激活 Stage 1，并指向 D-037/Pilot。
2. `docs/status/archive/GOAL-cloud-executor-p0-complete-2026-08-13.md`（new）：保留旧 P0 Goal 原文和 `GOAL_COMPLETE`，作为历史归档。
3. `docs/product/DECISION_LOG.md`：追加 D-037，锁定 RBV-001 的合同阈值、人工门禁和 fail-closed 边界；heading 与 anchor 固定为 `D-037 Real Batch Production Validation`。
4. `docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`（new）：建立执行合同、阈值、证据分类、Owner Gate、Stage 1 验收和逐项数据 schema。
5. `docs/product/README.md`：登记 D-037 与 Pilot，使用 canonical D-037 anchor，并更新阅读顺序/最新更新时间。
6. `docs/status/CURRENT.md`：将当前事实链切到 RBV-GOAL-001 Stage 1，保留旧时间序列并将旧 P0/P0.5 指针明确标为历史。
7. `docs/ROADMAP.md`：增加 RBV-001 Stage 1 路线门禁，引用同一 Goal→D-037→Pilot 链，并将旧 P0.5 及 §3/§4/§5 明确标为历史。
8. `docs/PROJECT_HANDOFF.md`：增加本会话最新接力章节、边界和下一 Owner Gate。
9. `docs/status/sessions/2026-08-29-rbv-001-calibration-contract.md`（本文件）：记录两轮 RED/GREEN、Review 修复和环境边界。
10. `test/real-batch-validation-governance.test.js`（new）：锁定文档链、阈值、人工门禁、独立审查、禁止项和旧状态指针降级。
11. `docs/agent-collaboration.md`：将当前分配切到 RBV-GOAL-001/Stage 1，并保留 CE-08 为历史/非现行分配。

未修改代码、UI/API/DB/Cloud Executor、部署配置或任何真实批次数据。

## 主控本地 default `npm test`（环境阻塞，2026-08-29）

主控在 isolated worktree 运行 default `npm test` 时未安装 `node_modules`，命令以 exit 1 结束：`756` tests / `674` pass / `82` fail。失败均为 `fastify`、`file-type`、`playwright`、`pg` 等依赖的 `ERR_MODULE_NOT_FOUND` 导入环境错误；本结果不判定产品断言失败，也不宣称全量通过。完整套件最终状态待 exact-head CI，当前不因该本地环境结果提前放行。

## 验证与状态

| 检查 | 状态 |
|------|------|
| Old-head governance RED | 已完成：6/6 fail（文档缺失） |
| Targeted governance test after implementation | 已完成：15/15 pass（`node --test test/real-batch-validation-governance.test.js`；含第二轮完整性、两次 Review 修复与逐项 schema 断言） |
| `npm run check` | 已通过：Checked 249 JavaScript file(s). |
| `git diff --check` | 已通过（无输出） |
| Allowlist mechanical check | 已通过：11 个变更路径，outside=0（含 `docs/agent-collaboration.md`） |
| 飞影/Provider/Secret/积分/真实素材/生产部署 | 未访问；积分消耗 0 |

## 下一 Owner Gate

只有 Owner 补齐并明确批准 Calibration roster、素材权利、非作者运营者、积分/成本上限、登录窗口和证据脱敏规则，且独立 Reviewer 标记 `APPROVED` 后，才可另立后续阶段合同。Draft PR 在此之前停止，不合并、不开始 Calibration；任何失败不得自动重试、换 Provider、缩小样本或扩大 scope。
