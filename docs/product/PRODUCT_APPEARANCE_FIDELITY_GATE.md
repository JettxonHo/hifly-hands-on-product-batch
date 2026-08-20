# 商品外观保真门禁合同

> 生命周期：Owner 已批准产品方向；本合同随对应 PR 合并进入 `main` 后才计为 designed
> 实现状态：Fidelity-0 有界 Provider Evidence 已建立；产品能力仍未实现
> 设计跟踪：Issue #208（已完成）；Fidelity-0 Evidence：Issue #210（已接受）；Fidelity-A：Issue #212

## 1. 目标

在飞影生成手持商品图之后、提交视频之前，建立一个独立、可审计、失败关闭的商品外观保真门禁。

默认要求生成候选保持商品身份一致：

- 轮廓与几何结构；
- 部件数量与组合关系；
- 颜色与比例；
- 包装结构；
- Logo 与标签文字。

允许变化只包括姿势、视角、画面相对大小、光照与合理遮挡。`presentation_size_code` 只控制飞影原生的画面呈现档位，不能作为外观保真证据。

## 2. 术语与独立责任

| 概念 | 责任 | 不等于 |
|---|---|---|
| 商品外观基准 | 精确 ProductRevision 与显式冻结的源商品图片 AssetVersion 所表达的原始身份事实 | 提示词、数组首项或图片像素推断出的实物尺寸 |
| 手持商品候选 | 飞影手持商品图生成阶段产生、尚未提交视频的中间图片 | 最终视频、Work 或已批准结果 |
| 自动外观检查 | 基于真实候选和外观基准输出结构化证据 | 人工批准 |
| 人工候选批准 | 运营人员明确允许该候选进入视频生成 | 自动检查通过、VideoPlan approved |
| Works 内容验收 | 对最终视频做检查、返工与交付判断 | 视频前候选批准 |

三层判断必须分别保留状态、操作者、时间和证据，不能互相代替。

## 3. 当前能力真值

设计基线为 `origin/main@bffb90b1f6f94024a907ad66b2c4cf0170a2e593`；Fidelity-0 探测从
`origin/main@a2a1e96e42655fa7d26f8686b9848d261c2a92af` 执行。

| 层级 | 已证明 | 尚未证明 |
|---|---|---|
| 飞影页面 | 一次获授权候选生成在“确认”和外层视频提交前停下；关闭浏览器上下文后，同一受控 Profile 可即时恢复候选就绪 | 候选引用的长期稳定期、跨设备恢复、正式授权下载合同，以及精确计费口径 |
| 飞影 HTTP | 恢复响应把 `gen_id`、`image_url`、`status=3` 与 `goods_size` 绑定；受控读取取得候选 `image/jpeg` bytes、size 与 checksum | `gen_id` 和候选引用的长期有效期、正式下载 API、跨设备复用与 Provider 评分 |
| Playwright | 本次实际上传预览与受控源文件 bytes/media/checksum 一致；流程在候选确认前安全暂停，且没有外层视频提交 | 领域候选持久化、ProductRevision AssetVersion 绑定、人工批准后生产恢复，以及 Worker 租约内的分阶段执行 |
| 领域/API | 最终 `primary_video` 候选、A12、Work 与 Works 检查已有完整合同 | 视频前 AppearanceCandidate、自动检查、人工决定和恢复命令 |
| 自动比较 | 无 | 受控模型/算法、可解释输出、误判边界、通过阈值与运行成本 |

2026-08-19 的单条获授权真实复验证明：原生 `small` 档和技术闭环均通过，但手持生成结果把源图的平滑斜切蓝盖
持续改成宝石形，最终 Work 被人工登记为 `rework_required`，没有交付、自动重试或第二工单。该证据证明
`presentation_size_code` 与商品身份一致性彼此独立，也证明当前流程不能把技术成功、A12 passed 或 Work available
当成外观保真通过。

因此当前不能用前端标记、提示词、DOM 图片存在或 `gen_id` 存在来宣称“外观保真已通过”。

### 3.1 Fidelity-0 Provider capability 结果

2026-08-19 的一次获授权能力探测建立了以下有界证据：

- 本地受控源图 `SUNSCREEN-20260818-001.png` 为 419685 bytes、PNG 656x952，SHA-256 为
  `e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5`；Provider 商品预览受控读取与其
  media、size、checksum 逐字节一致。本次没有可证明的 AssetVersion，因此该证据只证明 Provider 上传输入，
  不冒充产品领域绑定；
- 恰好执行一次候选生成。候选在“确认”和外层视频提交前就绪；没有点击确认或外层视频生成；
- 恢复响应把 `gen_id=lZRGIwOKPBScFlEz` 与候选引用绑定。受控候选读取为 `image/jpeg`、275745 bytes、SHA-256
  `1778a04198280c4cf2d08f78ba544085da44611d76f69b0653004bffe483244b`；完整 URL 与任何凭据均不入库；
- 关闭浏览器上下文后，以同一受控 Profile 重新进入仍恢复同一候选就绪状态，证明即时上下文重启恢复和视频前安全暂停；
- Provider 按钮显示候选生成需要 150 积分，但页面余额没有刷新，因此只记录“一次可能收费的候选生成动作”，
  不宣称精确扣分。

这个结果满足 Fidelity-0 对**当前 Provider seam 可取证并可在视频前暂停**的能力门禁，可以作为 Fidelity-A 独立设计的
输入；它不证明长期或跨设备生命周期、正式下载 API、外观保真通过、ProductRevision AssetVersion 绑定，亦不实现
Candidate/Check/Decision、人工批准、自动检查或生产恢复。

## 4. 通用产品合同

1. 通用身份规则由系统统一执行，不为安热沙、防晒霜、蓝色瓶盖或单张商品图写专用代码。
2. SKU 特殊说明只能作为 ProductRevision 的可选业务补充，并随版本冻结；它不能覆盖通用身份规则，也不能成为固定禁词列表。
3. 每次生成必须显式冻结一个不可变 `source_asset_version_id`（或经独立设计接受的等价字段），不能从
   ProductRevision 的多个 `asset_version_ids` 中按数组顺序选择，也不能在生成后反推。执行证据必须证明该版本的
   bytes 与 checksum 就是实际上传给 Provider 的源图；自动检查必须消费同一版本、同一 bytes/checksum 与真实候选。
4. 候选在能力证据成立后才可设计为绑定精确 Organization、ProductRevision、`source_asset_version_id`、
   AvatarSelection、VideoPlan、呈现大小、Provider 生成引用和生成上下文的不可变事实。
5. 自动检查只能消费真实候选与精确外观基准。证据缺失、候选不可读、模型不可用或结论不确定均视为未通过门禁。
6. 自动检查通过后仍须独立人工批准；人工批准不能篡改自动证据。
7. 未批准候选不得进入视频提交，不得自动重生、自动重试、重新领取或创建下一工单。
8. 最终视频仍必须经过 A12 与 Works 内容验收；候选批准不能预先通过最终视频。

## 5. Provider evidence-first 门禁

任何领域、API、数据库、UI 或执行器实现之前，必须先完成 **Fidelity-0 Provider capability gate**：

1. 证明可在外层视频提交前取得稳定、可授权读取的候选 bytes 或受控引用；
2. 证明引用生命周期、跨会话或恢复语义，以及候选与 Provider 生成请求的精确关联；
3. 证明生成后可以安全停止或恢复，不长期持有 Worker lease，也不依赖普通自动重试；
4. 证明实际上传的 `source_asset_version_id`、bytes 和 checksum 与比较基准完全一致；
5. 记录候选生成的计费事实。优先使用不产生费用的静态、脱敏抓包或只读证据；如果必须执行真实 capability probe
   或候选生成，必须在当次获得明确的单条积分授权，首失败即停。

Fidelity-0 的有界 Provider Evidence 已随独立审阅后的 PR 进入 `main`，状态为 accepted。Fidelity-A 只负责领域/API
设计；在其 acceptance artifact 进入 `main` 前仍不得实现 Candidate/Check/Review、前端状态或暂停命令。门禁失败只能
阻止继续实现或后续视频提交，不能宣称候选阶段零积分；候选生成本身可能已经收费。

## 6. Fidelity-A 领域边界

Fidelity-A 的 acceptance artifact 为
[PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md](PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md)。该文件随对应 PR 合并进入
`main` 后才计为 `designed`，并采用生产前独立候选门禁：

- `AppearanceCaptureRequest` 持有一次候选生成意图、管理员授权、单次上限与短生命周期异步状态；
- 不可变 `AppearanceCandidate` 只在真实候选 bytes 进入系统管理 AssetVersion 并完成服务端核验后创建；1:1
  `AppearanceCandidateState` 持有可变 current state 和 row version；
- 私有 append-only `ProviderReferenceObservation` 以 exact ID、policy 与有效期证明引用当前可用；过期或无法安全再观察
  一律 unknown 并阻断；
- `AppearanceCheckRun/Result` 分离技术运行与逐维业务结论，精确 result 绑定 candidate state revision、输入 checksum 和
  policy/model version；
- `AppearanceReview` 保存独立人工批准、拒绝、撤销与历史；
- Production snapshot / handoff 只冻结仍为 current、readable、approved 的 exact evidence chain 与 create/claim Observation
  证据，不复制临时 URL 或凭据。

该设计不授权实现这些对象。Fidelity-B～E 仍需严格串行的独立 Issue、TDD、Review 和费用/Provider gate。

## 7. 执行时序与失败关闭

期望时序：

```text
已批准上游输入
→ 冻结 source_asset_version_id 并核对上传 bytes/checksum
→ 生成手持商品候选
→ 保存候选与 Provider 引用
→ 自动外观检查
→ 人工批准精确候选
→ 显式提交视频
→ 最终视频候选
→ A12
→ Work
→ Works 内容验收
```

当前 Cloud Executor attempt 不能在持有 lease 时无限等待人工。Fidelity-A 选择**生产前独立候选门禁**：候选捕获、
自动检查和人工审核在 ProductionOrder 创建前完成，候选捕获任务在保存受控 bytes 后结束，不持有 Production lease。
已批准候选和最小受控 Provider 引用在创建工单时进入冻结输入，并在 claim 前再次验证。

可恢复的分阶段 Production 执行当前被否决：Fidelity-0 没有证明 Provider 引用长期/跨设备恢复，且该方案会扩张
ExecutionAttempt、lease、retry 和费用语义。只有取得正式 Provider API 与跨节点生命周期证据后，才可另过独立决策 gate。

明确拒绝：

- 让 Worker/浏览器长时间占用运行中 attempt 等待人工；
- 自动点击确认后再让人工补签；
- 用提示词或候选截图文件存在作为通过依据；
- 把 `supporting_output` 或最终 Works 检查改名后冒充视频前候选门禁。

无论采用哪种方案，激活前 Worker off、唯一 eligible、当前工单零 attempt、active attempts=0、terminal 后停 Worker、失败停批和不自动创建下一单的合同均保持。

候选生成可能是付费动作。门禁失败关闭只保证不继续外层视频提交、不自动重试和不创建下一工单，不能反向声称
候选生成没有消耗积分。每次真实 capability probe、候选生成或后续真实验收都需要当次明确的单条授权与费用记录。

## 8. 自动检查证据边界

自动检查至少要对通用身份维度分别给出“支持 / 不支持 / 无法判断”及可定位证据；不得把多个维度压成一个无法解释的总分。当前不预设模型、阈值或供应商，因为仓库尚无可验证能力合同。

Fidelity-C 实现前的能力选型、基准集、误放行/误阻断/unknown、费用、隐私和版本 Evidence 门禁见
`PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md`。该门禁未通过时，不得用 fake Adapter 或固定结果提前实现检查与审核。

Logo、标签文字被合理遮挡时可以是“无法判断”，不能推断为通过。若纯生成模式持续不能满足身份一致性，受控抠图合成或 Provider 产品锁定能力必须作为新的独立 Product/Provider/架构 gate 评估，不在 Issue #208 内扩展。

## 9. 严格串行实施切片

| 切片 | 目标 | 停止条件 |
|---|---|---|
| Fidelity-0 | Provider capability：证明候选 bytes/reference、生命周期、计费边界、安全暂停/恢复与精确源图上传对应关系 | 有界 Evidence 已建立；长期/跨设备与领域 AssetVersion 绑定留给后续设计，不自动进入实现 |
| Fidelity-A | 领域/API：采用生产前独立候选门禁，定义 CaptureRequest/Candidate/State/Provider Observation/Check/Review、组织隔离、审计和幂等 | 随独立审阅后的合同 PR 合并才计为 designed；不自动授权实现 |
| Fidelity-B | Provider capture：按 Fidelity-0 已接受 seam 保存精确候选，DOM/API 漂移时失败关闭 | 实现与已接受 Provider 证据不一致时停止 |
| Fidelity-C0 | 检查能力门禁：选择并实证逐维模型/规则、阈值、误判、unknown、费用与数据治理 | 未接受 capability/policy/model version 与阈值时停止，不写假检查器 |
| Fidelity-C | 运营审核：预览证据、批准/拒绝、冲突与历史 | 不得伪造自动通过或最终 Works 通过 |
| Fidelity-D | Production 集成：冻结引用、handoff、显式视频阶段和去重提交 | 无法证明一次批准只产生一次提交时停止 |
| Fidelity-E | 单条受控真实验收 | 必须在当次另获单条积分授权；首失败即停 |

每片独立 Issue、TDD、Draft PR 和独立 Review；前片合并后才开始后片。

## 10. 本合同的验收边界

本次 Fidelity-0 确有一次获授权 Provider 候选生成动作，但没有确认候选、提交外层视频、启动 Worker/Local Agent 或部署。
本合同与 Evidence 合并只表示产品边界已设计且有界 Provider seam 已取证，不表示：

- 外观保真已实现或自动化已可用；
- 飞影候选有长期稳定下载、正式授权 API 或跨设备恢复能力；
- 某个自动视觉模型已选定或通过验收；
- 精确积分余额变化已确认，或候选、视频和生产能力已经实现、部署或验收；
- 蓝色斜切瓶盖、Logo、标签或任一 SKU 已通过真实复验。
