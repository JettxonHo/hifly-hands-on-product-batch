# ProductionOrder 人工交接包与人工执行结果合同

> 状态：Accepted at product specification level
> Owner：owner（JettxonHo）
> 最后更新：2026-08-05
> 关联 Decision：[D-029](DECISION_LOG.md)
> 解决范围：ManualHandoffPackage 容器/字段/版本/生命周期、manual ExecutionAttempt 开始条件、ManualExecutionReport、候选产物核验与 Work 创建门禁、证据/幂等/安全边界
> 非目标：不实现 ZIP 生成、manifest JSON Schema、对象存储上传、人工执行页面、Work 自动登记、Local Agent；不接入 Hifly；不关闭 Q-018；不声称 HIFLY-001 已执行

本文件是 D-029 的详细 Specification。它是**产品与领域合同**，不代表任何代码、Schema、Migration、API、对象存储逻辑、前端页面或 Local Agent 已经实现。本文不固定完整 JSON Schema、API 路径、数据库表/字段、ZIP 压缩实现、哈希算法、数字签名算法、对象存储具体服务、文件大小限制、精确视频格式列表、Hifly 页面任务字段、ProviderTaskReference 真实格式、高保真页面、Local Agent 协议、Playwright/影刀职责或 Hifly 凭据管理实现。

---

## 1. 目的与适用范围

定义 ManualHandoffPackage 的产品定位、容器、权威清单与人工说明之间的关系、合同版本与业务包版本、固定字段与素材引用方式、生命周期与重新生成规则、manual ExecutionAttempt 开始条件、ManualExecutionReport、候选产物回传/核验/Work 创建门禁、证据/幂等/安全边界，为 Vertical Slice A Issue 拆分提供稳定合同。

## 2. 与 ProductionOrder / ExecutionAttempt / Work 的关系

```text
approved VideoPlan
→ CreateProductionOrder
→ ProductionOrder
→ GenerateManualHandoffPackage
→ ManualHandoffPackage ready
→ 人工执行者领取任务
→ 创建 executor_type=manual 的 ExecutionAttempt
→ 人工执行
→ 上传候选产物
→ 提交不可变 ManualExecutionReport
→ 服务端产物核验
→ 创建 Work
→ ProductionOrder succeeded
```

必须明确：

- **ManualHandoffPackage 不绕过 ProductionOrder**；
- 生成交接包 ≠ 开始执行；
- 下载交接包 ≠ 开始执行；
- ExecutionAttempt succeeded ≠ ProductionOrder succeeded；
- 只有产物核验通过且 Work 创建成功，ProductionOrder 才能 succeeded。

## 3. 容器结构（MHC-001）

```text
ManualHandoffPackage ZIP
├── manifest.json       （机器可读的权威执行合同）
├── README.md           （从 manifest 派生的人工作业说明）
└── assets/             （可选的受控、非敏感素材）
```

- `manifest.json`：机器可读的权威执行合同；后端回传校验和人工结果登记以它为准。
- `README.md`：从 manifest 派生的人工作业说明；**不得拥有 manifest 中不存在的独立业务事实**；不是第二个权威来源。
- `assets/`：只允许包含确实需要且允许内嵌的非敏感素材；不要求所有素材都内嵌。

**如 README 与 manifest 冲突**：以 manifest 为准；将交接包视为生成异常；不允许人工自行判断并继续生产。

D-029 不固定 ZIP 压缩算法、目录权限位或具体代码库。

## 4. 版本与不可变性（MHC-002）

区分两层版本：

1. **合同 Schema 版本**：`contract_type = manual_handoff`、`contract_version = 1.0`；
2. **业务交接包版本**：`package_id`、`package_version`。

每个 package version 不可变。每个 manual ExecutionAttempt 必须绑定 `package_id`、`package_version`、`manifest_hash`。

**可以创建新 package version 的情况**：修正 README 或人工说明；修正输出文件命名规则；合同 Schema 兼容升级；原包存在生成错误。

**以下变化不能只创建新交接包**（必须创建新上游版本 + 重新审核 + 新 ProductionOrder + 新 ManualHandoffPackage）：文案变化；人物变化；ProductRevision 变化；VideoPlan 配置变化；主要输入素材发生业务变化；production purpose 变化。**不得使用新交接包为旧工单偷换输入。**

## 5. manifest 固定字段组

字段名称属于产品级合同。D-029 不定义完整 JSON Schema、精确字符串长度、数据库字段、API 请求结构、哈希/签名实现。

1. **合同身份**：`contract_type`、`contract_version`、`package_id`、`package_version`、`package_status`、`created_at`、`created_by`、`supersedes_package_id`（可选）
2. **业务追踪**：`organization_id`、`project_id`、`product_id`、`production_order_id`、`execution_purpose`、`video_plan_version_id`、`copy_version_id`、`avatar_asset_version_id`
3. **输入快照**：`product_revision`、`copy_snapshot`、`avatar_snapshot`、`video_plan_snapshot`、`configuration_snapshot`
   - 文案快照至少：`copy_version_id`、`copy_body`、`copy_hash`、`approved_review_id`、`approved_at`
   - 人物快照至少：`avatar_asset_id`、`avatar_asset_version_id`、`display_name`、`source_type`、`authorization_summary`、`verified_capability_snapshot`
4. **执行说明**：`execution_steps`、`business_constraints`、`expected_behavior`、`known_limitations`、`human_confirmation_points`
5. **输出要求**：`primary_output`、`supporting_outputs`、`file_naming_rule`、`accepted_media_types`、`expected_quantity`、`minimum_validation_requirements`
6. **完整性与访问**：`manifest_hash`、`package_hash`、`generated_by_system`、`access_scope`、`retention_notice`

### 概念性 manifest 示例

> 仅产品级示例，**不是已实现的 JSON Schema**，不含真实 ID/URL/Secret/账号。

```json
{
  "contract_type": "manual_handoff",
  "contract_version": "1.0",
  "package_id": "pkg_example_placeholder",
  "package_version": 1,
  "package_status": "ready",
  "organization_id": "org_placeholder",
  "production_order_id": "po_placeholder",
  "execution_purpose": "first_production",
  "video_plan_version_id": "vpv_placeholder",
  "copy_snapshot": { "copy_version_id": "cv_placeholder", "copy_hash": "hash_placeholder", "approved_review_id": "rv_placeholder" },
  "primary_output": { "role": "primary_video", "accepted_media_types": ["video/*"], "expected_quantity": 1 },
  "manifest_hash": "hash_placeholder"
}
```

## 6. execution_purpose

创建 ProductionOrder 的明确业务目的，至少覆盖：`first_production` / `rework` / `supplemental_version` / `reproduction`（具体枚举可在技术规格收敛）。同一 VideoPlan 可因不同明确目的创建多个 ProductionOrder；**重复点击不能自动产生新 purpose 或新工单**；purpose 是工单创建时的固定快照（与 D-028 DM-004 一致）。

## 7. 素材引用模式（MHC-003）

每条素材引用至少包含：`asset_id`、`asset_version_id`、`role`、`display_name`、`media_type`、`size`、`checksum`、`retrieval_mode`、`access_scope`。

| retrieval_mode | 含义 | 约束 |
|---|---|---|
| `embedded` | 文件实际位于 ZIP 的 assets/ | 仅限当前任务需要、当前执行者有权、非敏感、允许内嵌和本地保留 |
| `short_lived_fetch` | 交接包保存资产引用，执行者通过系统获得短时下载授权 | **manifest 不保存永久 URL**；短时授权过期可重新签发；重新签发不改变生产输入，也不创建新 package version |
| `provider_existing` | 素材已存在于 Hifly 或目标执行环境 | 只保存脱敏业务引用、必要人工确认说明、已验证能力/Evidence 摘要；**不得保存 Provider 凭据** |

## 8. 禁止进入交接包的内容

禁止：Hifly 用户名和密码；Token；Cookie；LocalStorage；浏览器 Profile；验证码；Local Agent 设备凭据；数据库 Secret；对象存储永久密钥；永久或长期签名 URL；人物原始隐私素材；完整人物授权证明原件；其他 Organization 的素材；未脱敏日志；未脱敏 Provider 页面数据；完整本地敏感路径。**Q-018 的凭据边界保持不变。**

## 9. 生命周期

| 状态 | 含义 |
|---|---|
| `generating` | 正在生成 manifest、README、ZIP 和受控素材引用 |
| `ready` | 包生成完成；manifest 与 package hash 校验通过；可交给人工执行者 |
| `generation_failed` | 未形成有效合同；不允许开始人工执行 |
| `superseded` | 已由新 package version 取代；历史 attempt 仍保留原版本引用 |
| `expired` | 下载或访问授权窗口已过期；历史记录保留；**不代表已下载到本地的副本已被远程清除** |
| `revoked` | 禁止使用该包开始新 manual ExecutionAttempt（工单取消/安全事件/明确管理操作触发） |

## 10. 生成与重新生成

**第一次生成必须验证**：ProductionOrder 存在；工单输入快照完整；ProductionOrder 属于当前 Organization；VideoPlan/CopyVersion/Avatar 版本引用完整；当前用户有生成权限；相同幂等请求未生成其他等价包；所有素材引用属于当前 Organization；包内容不包含禁止项。

**只重新生成下载副本，不创建新业务版本**：下载中断；短时下载授权过期；同一用户重复下载；ZIP 临时构建副本过期但 manifest 内容未变化。

**创建新 package_version**：人工说明修正；输出命名规则修正；Schema 兼容升级；旧包存在生成错误。

**必须创建新 ProductionOrder**：生产输入变化；生产目的变化；approved VideoPlan 变化；文案/人物/主要生产素材变化。

## 11. manual ExecutionAttempt（MHC-004）

`GenerateManualHandoffPackage ≠ StartManualExecution`；`DownloadManualHandoffPackage ≠ StartManualExecution`。

正确流程：人工执行者领取任务 → 服务端重新验证工单和包状态 → 创建新 ExecutionAttempt（`executor_type = manual`，绑定 `package_id`/`package_version`）→ 执行者确认开始后 attempt 进入 `running`。

manual ExecutionAttempt 至少记录：`execution_attempt_id`、`production_order_id`、`package_id`、`package_version`、`manifest_hash`、`executor_type = manual`、`operator_id`、`claimed_at`、`started_at`、`completed_at`。

**人工 attempt 不得伪造**：Local Agent、Agent 心跳、Adapter、Playwright、影刀、自动执行步骤、Provider 自动回调（与 D-028 DM-003 一致）。同一 ProductionOrder 同一时刻原则上最多一个有效运行 attempt。

## 12. ManualExecutionReport（MHC-005）

ManualExecutionReport 是绑定一个 ExecutionAttempt 的**不可变**人工结果记录；不覆盖 ExecutionAttempt；不直接设置 ProductionOrder 最终状态；可通过新版本或 superseding report 修正，但旧报告保留。

字段组：

1. **身份**：`report_id`、`report_version`、`production_order_id`、`execution_attempt_id`、`package_id`、`package_version`、`submitted_by`、`submitted_at`、`supersedes_report_id`（可选）
2. **执行结果**：`outcome`（`completed` / `requires_action` / `failed` / `cancelled`）、`started_at`、`completed_at`、`provider_task_reference`（可选）、`operator_note`
   - **禁止人工提交**：`production_order_succeeded`、`work_created`、`provider_verified`
3. **执行偏差** `deviations`：至少用于记录 Provider 自动修改文案、实际未使用某辅助素材、输出命名与预期不同、人工替代非核心步骤、页面入口/流程与说明不同、其他可审计偏差。**核心输入发生偏差时**：不得自动创建 Work；进入人工判断/失败/返回上游；不允许执行者自行认定等价。
4. **输出引用**：`primary_output`、`supporting_outputs`；每个输出引用至少含 `upload_reference`、`original_filename`、`media_type`、`size`、`checksum`、`role`。**本地绝对路径不得成为云端权威引用。**
5. **证据和异常**：`evidence_references`、`error_category`、`failure_stage`、`requires_action_reason`、`retryability`、`upstream_return_target`（可选）

## 13. 结果状态转换

`outcome = completed`：ManualExecutionReport completed → ExecutionAttempt 可进入 succeeded → 创建产物核验 AsyncJob → 核验候选产物 → 创建 Work → ProductionOrder succeeded。**ExecutionAttempt succeeded ≠ ProductionOrder succeeded。**

`outcome = requires_action`：ExecutionAttempt → requires_action；ProductionOrder → requires_action；记录原因、责任角色和恢复要求；不能通过「标记已处理」直接成功；必须执行真实恢复检查（`requires_action ≠ failed`）。

`outcome = failed`：ExecutionAttempt → failed；ProductionOrder 是否 failed 由错误类别决定。可重试技术问题→保留工单+新 ExecutionAttempt；输入或业务问题→ProductionOrder 可 failed + 返回上游新版本/新工单；未知问题→人工判断，不自动重试或自动失败。

`outcome = cancelled`：不能由人工执行者单方面改写 ProductionOrder；必须配合 `cancel_requested` 和明确停止确认。

## 14. 候选产物核验（MHC-006 / MHC-007）

**Phase 1 固定**：一个 ProductionOrder → 最多一个主要视频 Work；可存在多个 supporting outputs（截图、执行说明、辅助文件、失败证据、Provider 导出附属文件），supporting output 不自动成为正式 Work。未来若支持一工单多正式视频 Work，需要新产品决策。

**人工上传的文件首先是候选产物，不是正式 Work**（`candidate output ≠ Work`；`upload completed ≠ artifact verification passed`）。核验必须包括：对象存在；Organization 归属正确；ProductionOrder 匹配；ExecutionAttempt 匹配；ManualExecutionReport 匹配；package ID 和版本匹配；manifest hash 匹配；文件类型符合；文件大小符合；checksum 匹配；主要产物数量符合；候选产物未被重复登记；Work 创建成功。

只有全部通过后：创建 Work → 推进 ProductionOrder 为 succeeded → 写入 AuditEvent。

**禁止**：先标记工单 succeeded 再创建 Work；把上传成功当作核验成功；人工表单直接创建最终 Work；同一候选产物重复创建 Work。

## 15. Work 来源关系

人工生产的 Work 必须固定引用：ProductionOrder、manual ExecutionAttempt、ManualExecutionReport、ManualHandoffPackage ID 和版本、manifest hash、VideoPlanVersion、CopyVersion、AvatarAssetVersion、主要文件 AssetVersion、primary output checksum、创建时间。**Work 不因后续项目/文案/人物/方案变化而被改写**（`Work ≠ DeliveryRecord`）。

## 16. 证据要求（MHC-008）

成功回传至少记录：操作者、实际开始时间、实际完成时间、package ID 和版本、manifest hash、输出文件引用、输出 checksum、是否存在执行偏差、当前结果归属的 ProductionOrder 和 ExecutionAttempt。

`ProviderTaskReference`：HIFLY-001 尚未完成前**不设为绝对必填**；若实际流程能稳定取得，应记录脱敏引用；不得用未经验证的页面文本位置代替稳定任务引用。

失败或 requires_action 至少记录：失败或停止阶段、错误分类、用户可理解原因、是否可重试、是否需要返回上游、责任角色、安全可取得时提供脱敏截图或元素级证据。

**禁止作为证据上传**：Cookie、Token、密码、验证码、浏览器 Profile、其他客户内容、未脱敏整页截图、完整签名 URL、Hifly 敏感账号信息、未脱敏 HTML、本地敏感路径。无法安全截图时使用结构化错误说明，不强制上传整页证据。

## 17. 幂等（MHC-009）

- **交接包生成**：`production_order_id + package_version + contract_version + generation_request_id`；重复请求返回同一包或同一生成任务，不创建多个等价 package version。
- **manual ExecutionAttempt**：同一工单同一时刻最多一个有效运行 attempt；重复点击开始不创建多个 attempt。
- **ManualExecutionReport**：`report_id + payload_hash` 相同的重复提交返回原结果；`report_id` 相同但 payload 不同→拒绝并记录冲突；修正报告创建新 `report_version` 或新 report（用 `supersedes_report_id`），**不覆盖旧报告**。
- **Work 创建**：`production_order_id + execution_attempt_id + primary_output_checksum` 不得重复创建 Work。
- **DeliveryRecord**：重复网络请求不自动创建多个交付事件；真实多次交付必须使用新明确业务命令。

## 18. 安全边界（MHC-010）

下载交接包前必须检查：当前 Organization、当前成员权限、ProductionOrder 归属、package 状态、package version、当前访问范围。下载应使用：短时授权、可审计下载事件、不公开的访问地址、不写入普通日志的签名 URL。

交接包下载到本地后：云端不能保证远程删除（`package expired ≠ local copy remotely deleted`）；页面必须提示执行者遵守企业清理和保留政策；包内只放入完成任务所必需的数据。

人工回传时服务端必须重新检查：Organization、ProductionOrder、ExecutionAttempt、package ID、package version、manifest hash、report ID、output checksum、操作者权限。**不能只相信前端隐藏字段。**

## 19. 上游变化与历史保留

ProductionOrder 创建后：输入快照保持不变；交接包不读取项目最新值；不静默替换文案/人物/素材；不修改已开始的 manual ExecutionAttempt；已有包和报告保留历史。

需要新内容时：上游修改 → 新版本 → 新审核 → 新 ProductionOrder → 新 ManualHandoffPackage → 新 ExecutionAttempt。原工单需明确：继续执行/取消/失败/进入人工处理。**不得通过隐藏、删除或静默失效让历史工单消失**（`revoked package ≠ local copy remotely deleted`）。

## 20. 异常处理

- **交接包生成失败**：ProductionOrder 不进入 running；可修复素材访问；可相同幂等请求重试；显示脱敏错误；必要时返回 VideoPlan。
- **包访问授权过期**：可重新签发短时授权；内容未变化时不创建新 package version。
- **包被 revoked**：不允许开始新 manual ExecutionAttempt；已运行 attempt 需明确继续/停止/人工判断；不静默终止。
- **候选产物上传失败**：保留人工执行记录；不允许提交最终 completed；可继续上传；用幂等避免重复对象和 Work。
- **产物核验失败**：不创建 Work；ProductionOrder 不进入 succeeded；显示明确失败原因和处理入口。

## 21. Phase 1 用户流程

```text
approved VideoPlan
→ ProductionOrder
→ Generate Package（ready）
→ Download（不等于开始执行）
→ Claim Manual Task（服务端重新验证）
→ manual ExecutionAttempt（running）
→ Upload Candidate Output
→ Submit ManualExecutionReport（completed）
→ 候选产物核验（不通过不创建 Work）
→ Create Work
→ WorkInspection
→ DeliveryRecord
```

## 22. MHC-001 ～ MHC-010

| 编号 | 已确认决策 |
|---|---|
| **MHC-001** | 交接包使用 ZIP，包含权威 manifest.json、派生 README.md 和可选受控 assets/ |
| **MHC-002** | 交接包版本不可变；manual ExecutionAttempt 绑定精确包版本；生产输入变化必须创建新 ProductionOrder |
| **MHC-003** | 素材支持 embedded、short_lived_fetch、provider_existing；敏感人物源素材和凭据不得内嵌 |
| **MHC-004** | 生成或下载交接包不创建 ExecutionAttempt；执行者领取并确认开始时创建 executor_type=manual 的 attempt |
| **MHC-005** | 人工结果使用不可变 ManualExecutionReport；报告只能提交执行结果和候选产物，不能直接提交 ProductionOrder succeeded |
| **MHC-006** | Phase 1 每个 ProductionOrder 最多一个主要视频 Work；辅助附件不自动创建 Work |
| **MHC-007** | 只有候选产物核验通过并成功创建 Work，ProductionOrder 才能 succeeded |
| **MHC-008** | 成功必须记录操作者、时间、包版本、manifest hash、输出 checksum 和偏差；失败或人工处理必须记录阶段、分类、原因和恢复性 |
| **MHC-009** | 包生成、manual attempt、人工报告、产物登记和 Work 创建均需幂等保护；旧包和旧报告不原地覆盖 |
| **MHC-010** | 交接包、报告和证据不得包含 Secret、Cookie、密码、Profile、永久 URL 或跨组织数据；下载和回传必须重新进行组织、权限、版本与完整性校验 |

## 23. 非目标

D-029 不固定：完整 JSON Schema、API 路径、数据库表/字段、ZIP 压缩实现、哈希算法、数字签名算法、对象存储具体服务、文件大小限制、精确视频格式列表、Hifly 页面任务字段、ProviderTaskReference 真实格式、高保真页面、Local Agent 协议、Playwright/影刀职责、自动执行、客户交付门户、多主要视频输出、Hifly 凭据管理实现。

## 24. 后续技术规格

- manifest 完整 JSON Schema 与校验实现；
- 短时下载/上传授权签发与重签机制；
- 候选产物核验 AsyncJob 实现；
- ManualExecutionReport API 契约；
- 与对象存储（COS，D-026）的集成边界。
