# RBV-001 Real Batch Production Validation Pilot Contract

> 状态：`CALIBRATION_READINESS_FREEZE_BLOCKED_PRE_REAL_RUN`
> Goal：[RBV-GOAL-001](../../GOAL.md)
> Goal ID：`RBV-GOAL-001`
> 产品决策：[D-037](DECISION_LOG.md#d-037-real-batch-production-validation)
> 适用阶段：`Readiness Freeze`（Issue #261 / `RBV-CAL-001`）
> Stage 1「合同与人工门禁」：已完成历史（Issue #259 / PR #260）
> 当前 Readiness Record：[RBV_CALIBRATION_READINESS_FREEZE.md](../status/RBV_CALIBRATION_READINESS_FREEZE.md)

本文件是 Real Batch Production Validation（RBV-001）的执行合同，不是运行报告，也不是完成声明。它只定义后续真实验证必须满足的条件；当前已登记脱敏 Readiness Freeze roster 与元数据，但五个 SKU 均为 `BLOCKED`；没有授权真实运行，也没有产生新的 Provider、成本、发布或反馈证据。唯一当前 verdict 为 `BLOCKED_PRE_REAL_RUN`。

## 1. 权威链与术语

唯一事实链为：

```text
GOAL.md (RBV-GOAL-001, Readiness Freeze)
  → D-037 (docs/product/DECISION_LOG.md)
  → 本 Pilot Contract
  → docs/status/RBV_CALIBRATION_READINESS_FREEZE.md (RBV-CAL-001)
  → docs/status/CURRENT.md / docs/ROADMAP.md / docs/PROJECT_HANDOFF.md
```

`Calibration` 是小样本的真实或获许可脱敏商品验证；`Repeatable` 是修复真实阻塞后再进行的有界重复批次；`real business evidence`（真实业务证据）仅指真实商品、真实 Provider 结果和可追溯运营使用，不包括 fake、fixture、mock、controlled provider、本地 demo 或离线测试。上述替身和离线结果只能作为工程证据，不能替代真实业务证据。`Owner Gate` 是人工确认点，不由实现者、测试或文档自动通过。

## 2. 可机器核对的合同参数

| contract_key | locked_value |
|---|---|
| goal_id | RBV-GOAL-001 |
| active_stage | Readiness Freeze |
| calibration_roster_count | 3–5 |
| calibration_categories_min | 2 |
| calibration_manual_correction_min | 1 |
| success_rate_target | none（不预设成功率） |
| repeatable_batch_min | 10 |
| non_author_operator_required | true |
| real_video_delivery_or_use_required | true |
| consecutive_jobs_without_production_code_changes | 5 |
| owner_authorization_per_real_run | true |
| production_provider_access | fail_closed |
| contract_status | readiness_freeze_active_blocked |

这些数字是合同阈值，不是已经完成的样本数量、成功率或成本统计。任何低于阈值的样本都只能报告为未满足门禁，不能通过重写文档、缩小样本或替换为测试替身来宣称通过。

## 3. Calibration Gate（仅在 Owner Gate 后激活）

Calibration 必须由 Owner 在新一轮明确确认后提供并核对：

1. `3–5` 个真实商品，或有明确使用权的脱敏商品；至少覆盖 `2` 个品类。
2. 至少 `1` 个商品预期需要人工修正或人工核对。该条件用于验证失败处理和人工判断，不得预设或反向编造成功率。
3. 每个 SKU、商品图使用权、上游版本、运行时间、结果状态和证据脱敏规则逐项登记。未获许可的真实客户素材不得导入。
4. 真实登录、Provider、Secret、积分/付费和证据写入边界逐次由 Owner 授权；默认全部禁止。

Calibration 的结果只用于确认阻塞、人工修正和真实业务证据，不自动打开 Repeatable。首个真实阻塞、授权不完整、成本不明或证据无法脱敏时立即停在 Owner Gate。

## 4. Repeatable Gate

只有在 Calibration 发现的真实阻塞已由独立变更修复并获得复核后，才可进入 Repeatable。Repeatable 至少包含 `10` 个商品；成本、积分或运营负担不合理时必须停在 Owner Gate，不能自行缩样、改变阈值或宣称通过。Repeatable 的商品集合、授权、批次边界、失败停机和每条证据必须在运行前冻结；不提供自动重试、并行扩容或隐式补跑。

If cost is unreasonable, stop at Owner Gate; do not shrink the sample or reuse authorization.

连续完成 `5` 个工单期间不得修改生产代码。若生产代码、配置、Provider 行为或授权发生变化，连续计数归零并回到人工门禁；文档或测试本身不能替代这项运行约束。

## 5. 业务证据 Gate

- 至少一名**非作者运营人员**必须实际发起第二批，并在证据中记录其角色和操作时间；作者本人代跑不能满足该条件。
- 至少一个真实视频必须实际交付、展示或用于运营，且能追溯到对应 SKU、工单、产物和授权。仅生成、下载到本地、截图或 fake/fixture 预览不满足该条件。
- 真实视频的交付/展示/运营使用不等同于内容质量通过；若人工检查要求返工，必须保留返工事实，不得把技术成功改写成业务成功。
- MBL、RBV 或“生产就绪”都不能因为文档、测试、代码、fake、fixture、mock、controlled provider、本地 demo 或单次真实生成完成而自动宣布完成。
- 不得因文档、测试或代码宣布 MBL/RBV 完成；任何完成声明都必须等待合同规定的真实业务证据和 Owner Gate。

## 6. Fail-closed 与禁止范围

在 Owner 为具体动作、具体批次和具体预算明确授权前，以下全部保持 fail-closed：

- Provider 或飞影访问、真实登录、SSH/noVNC、验证码和浏览器 Profile；
- Secret、Cookie、Token、客户素材、未脱敏页面/日志、永久 URL 或服务器路径；
- 积分/付费、上传、生成、提交、轮询、下载、交付、公开发布和生产部署；
- 不得执行破坏性操作、删除/覆盖真实数据、并行生产、自动重试、自动缩样或跨批次复用授权。

每一次真实动作都需要当次 Owner 授权并记录安全摘要；一次授权不延续到下一批次、下一 SKU 或下一阶段。任何授权缺失、成本上限不明、登录态不明、证据脱敏失败或首失败，都必须停止，不得替换 Provider、重试或扩大范围。

## 7. Stage 1 Acceptance 与停止条件（历史已完成）

Stage 1 只交付治理合同，现已完成并保留为历史；本节规则继续约束当前 Readiness Freeze：

1. 旧 P0 `GOAL.md` 原事实保存在只读归档，并保留 `GOAL_COMPLETE`；新的 `GOAL.md` 是唯一现行 Goal，不静默改写旧历史。
2. `GOAL.md → D-037 → 本 Pilot Contract → CURRENT / ROADMAP / HANDOFF` 的 Goal ID、合同链接和停止条件一致。
3. 自动治理测试锁定本文件的 Goal ID、Calibration/Repeatable 阈值、非作者运营、真实交付/使用、连续 5 单不改生产代码和人工门禁。
4. Draft PR 必须先经独立 Reviewer 审查并给出 `APPROVED`；实现 Agent 不得批准或合并自己的成果。
5. Stage 1 完成后 Draft PR 停止，等待 Owner Gate；不合并、不激活 Calibration、不访问 Provider、不消耗积分。当前 Readiness Freeze 仍按同一停止边界执行。

Stage 1 的 `APPROVED` 是独立 Review 对治理变更的结论，不是 MBL、RBV、真实业务或生产就绪的结论。

## 8. Owner Gate 输入清单（下一 Owner）

下一 Owner 必须在激活 Calibration 前逐项确认并留痕：

- Calibration `3–5` 商品 roster、至少两类品类和至少一个人工修正目标；
- 每个商品及人物/素材的使用权、脱敏方式、保留/删除边界；
- 非作者运营人员及其最小操作权限；
- 可接受积分/付费上限、失败停机规则和是否允许继续；
- 允许的真实登录窗口、Provider 范围、证据采集与脱敏规则；
- 运行期间生产代码冻结和变更后的计数归零规则。

在上述输入全部齐备并经 Owner 明确授权前，真实运行授权仍保持 `pending_owner_gate`；本轮 Readiness Freeze 只登记脱敏 roster 元数据，不得开始 Calibration 或 Repeatable。

## 9. Current Production Truth（历史基线，不是 RBV Calibration）

当前生产事实只用于说明起点，不是本 Pilot 的 Calibration 结果。历史单条真实链仅算工程/运营基线：当前 Work inspection 为 `rework_required`，delivery 记录为 `0`，既有 `v2 small approved` 方案仍是历史状态；没有第二个 order、attempt 或 delivery。上述事实绝不算本 RBV Calibration，也不能替代 Owner Gate 后的新授权证据。

| truth_key | locked_value |
|---|---|
| current_production_truth | historical_single_real_chain_baseline_only |
| historical_real_chain_role | baseline_only_not_rbv_calibration |
| current_work_inspection | rework_required |
| current_delivery_records | 0 |
| delivery | 0 |
| current_video_plan | v2 small approved |
| second_order | none |
| second_attempt | none |
| second_delivery | none |
| rbv_calibration_status | not_started_pending_owner_gate |

不得把历史单条真实链、`rework_required`、delivery=0、`v2 small approved` 或任何既有下载/截图写成 RBV Calibration；也不得因当前没有第二 order/attempt/delivery 而推断业务门禁已通过。

## 10. Gap Matrix（pending 与已有工程基线分离）

Gap Matrix 只标记缺口和已有工程基线，不填真实 roster、人员、成本或运行结果。`fake`、fixture、mock、controlled provider、本地 demo 和离线测试不能闭合任何 gap。

| gap_id | status | evidence_boundary |
|---|---|---|
| roster_rights | pending | Owner 提供 roster、使用权和脱敏规则后才可核对 |
| non_author_operator | pending | 非作者运营者和第二批操作尚未提供 |
| login_readiness | existing_engineering_baseline | 现有登录/readiness 代码证据，不代表本 Pilot 授权 |
| page_upload_submit_generate_download | existing_engineering_baseline | 页面/上传/提交/生成/下载工程链存在，不代表真实批次闭环 |
| cost | pending | 积分/成本上限与停机规则待 Owner 确认 |
| quality_delivery | pending | 历史 `rework_required`、delivery=0；真实质量/交付证据待补 |
| observability_recovery | existing_engineering_baseline | 既有状态/恢复工程基线，真实批次观测仍待授权 |

只有真实、可追溯、脱敏并经 Owner 授权的证据才能关闭对应 gap；替身证据不得升级 status。

## 11. Per-product / Per-order 数据字段与汇总指标

每个商品和工单都要以不可变字段关联 SKU、授权、状态、时间和证据引用；本阶段只锁定 schema，不填写任何实际值。字段值只能来自真实、获授权的采集；尚未采集或无法核对时统一记为 `unknown` 或 `pending`，不得估算、补写或用替身值闭合。

### 11.1 Per-product / per-order fields

| field | required_record |
|---|---|
| product_id | per_product |
| sku | per_product |
| category | per_product |
| product_rights_ref | per_product |
| input_image_dimensions | per_product |
| input_composition | per_product |
| product_name_length | per_product |
| selling_point_count | per_product |
| order_id | per_order |
| attempt_id | per_order |
| provider_task_ref | per_order |
| operator_role | per_order |
| login_state | per_order |
| page_contract_match | per_order |
| upload_result | per_order |
| submit_result | per_order |
| generation_result | per_order |
| generation_confirmation_result | per_order |
| download_result | per_order |
| started_at | per_order |
| finished_at | per_order |
| queue_duration | per_order |
| generation_duration | per_order |
| status | per_order |
| qc_result | per_order |
| manual_interventions | per_order |
| retry_count | per_order |
| failure_class | per_order |
| recovery_method | per_order |
| captcha_encountered | per_order |
| page_change_detected | per_order |
| timeout_stage | per_order |
| points_insufficient | per_order |
| platform_points_or_cost | per_order |
| delivery_or_use_result | per_order |
| delivery_or_use_evidence_ref | per_order |
| code_revision | per_order |
| evidence_refs | per_order |

### 11.2 Summary metrics

| metric_key | locked_definition |
|---|---|
| product_total | count of authorized products in the frozen batch |
| order_completion_rate | completed orders / frozen orders |
| video_generation_success_rate | successful video generations / authorized generation attempts |
| qc_pass_rate | QC-passed items / items with a QC result |
| avg_per_product_duration | mean finished_at - started_at per product |
| batch_duration | batch finished_at - batch started_at |
| manual_interventions | count of human corrections/checks |
| retries | count of explicit retry attempts; no implicit retry |
| unit_platform_cost | platform cost per product, with currency and evidence reference |
| failure_class | controlled failure taxonomy value per item/order |
| recovery_method | manual or approved recovery action per failure |
| code_revision | production code revision observed for the item/order |
| code_streak | consecutive jobs under the same frozen production revision |

汇总指标只能在真实批次授权后填入；空值、unknown、成本不可核对或脱敏失败均保持 pending，不得用 fake/fixture/mock 数字补齐。

## 12. Evidence Package 与 Git 禁止项

Evidence Package 是后续真实运行的脱敏交付结构，不是本阶段已经产生的运行包。所有 artifact 先经过 Owner 的证据红线和脱敏审查。

| artifact_key | required_contents |
|---|---|
| sanitized_report | 脱敏报告、范围、门禁结论与停止原因 |
| manifest | 批次、商品、工单、版本和授权引用清单 |
| item_metrics | 逐商品/逐工单字段与指标快照 |
| events | 授权、状态、人工介入、失败和恢复事件序列 |
| hash_index | 脱敏 artifact 的 hash 与校验算法索引 |
| demo_path | 受控演示入口或路径说明（不携带秘密或客户素材） |
| architecture_diagram | 版本化的边界、数据流和人工门禁图 |

Git 禁止项：`Secret`、`Profile`、`Token`、客户素材（customer materials）和 raw downloaded video 均不得进入 Git；同样不得提交 Cookie、未脱敏页面/日志、永久下载 URL、服务器路径或可还原凭据。原始下载视频只允许留在受控、获授权的外部保存边界，不是本仓库 Evidence Package。

## 13. Issue / Stage map（current）

Stage 顺序固定为 `Contract → Readiness Freeze → Calibration Run → one blocker per Issue → Repeatable Readiness → Repeatable Run → Delivery/Report`。Stage 1/Contract 已完成历史；当前仅激活 Readiness Freeze。其余阶段均 deferred，必须在前置 Owner Gate、独立审查和可观测结果满足后逐项开启。

| stage_key | stage | status | observable_outcome |
|---|---|---|---|
| stage_contract | Contract | completed | 合同参数、停止条件和治理测试可机器核对（Stage 1 历史） |
| stage_readiness_freeze | Readiness Freeze | active | RBV-CAL-001 roster、权利、预算、登录窗口和证据红线冻结 |
| stage_calibration_run | Calibration Run | deferred | 每个授权商品有结果、人工修正和失败分类 |
| stage_one_blocker_per_issue | one blocker per Issue | deferred | 每个 Issue 只有一个可观察 blocker outcome |
| stage_repeatable_readiness | Repeatable Readiness | deferred | 至少 10 条批次、成本和代码 revision/streak 可核对 |
| stage_repeatable_run | Repeatable Run | deferred | 串行运行、重试/恢复和逐条证据完整 |
| stage_delivery_report | Delivery/Report | deferred | 真实视频交付/展示/运营使用及脱敏报告可追溯 |

### Stage 1 historical contract snapshot（not current）

上一阶段 Stage 1「合同与人工门禁」已完成并保留为历史，不改变 current map。历史合同状态为 completed；历史 Readiness Freeze、Calibration Run、one blocker per Issue、Repeatable Readiness、Repeatable Run 和 Delivery/Report 均为 deferred。该历史描述不是当前 stage schema，也不构成当前 active 或真实运行证据。

每个 Issue 必须声明一个 observable outcome；不能把多个 blocker 收容在模糊的“整体完成”中。任一阶段失败或授权失效都停止在当前 Gate，不自动跳级、补跑或合并阶段。

## 14. Allowed fixes 与明确非目标

Stage 1 及后续 Pilot 只允许针对真实 blocker 的最小修复，并保留可观察状态和人工恢复边界。

| allowed_fix | boundary |
|---|---|
| real_blocker | 修复经证据确认的真实阻塞，不扩大产品目标 |
| observability | 增加必要的状态、事件、指标或证据可见性 |
| status | 修正真实状态投影、终态或停止原因 |
| safety | 加强授权、脱敏、费用和 fail-closed 门禁 |
| idempotency | 防止重复订单、重复 attempt、重复证据或重复交付 |
| manual_recovery | 提供有界、可审计的人工恢复/重开动作 |
| minimal_ux | 仅补完成上述门禁所需的最小 UX 提示或状态 |

明确非目标（Non-goals）：`Multi-Agent`、`SaaS`、`RBAC`、`browser platform`、`UI redesign`、`parallel`、`unbounded retry`、`captcha bypass`、`model router`、`architecture rewrite`。这些方向不得借 Pilot 名义实现、扩 scope 或替代当前人工门禁。
