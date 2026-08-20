# 商品外观自动检查能力验收门禁

> 关联决策：D-035、D-036
> 关联 Issue：#216
> 状态：Owner 已授权建立门禁；随对应 PR 进入 `main` 后仅计为 gate designed
> 当前结论：`BLOCKED_CHECK_CAPABILITY_UNSELECTED`
> 非目标：本文件不选择模型、不设想阈值、不实现 Check/Review，不证明真实检查能力可用

## 1. 为什么 Fidelity-C 现在停止实现

Fidelity-B 已在仓库提供精确 source/candidate bytes、checksum、受控 AssetVersion、Candidate/State/Observation 和默认关闭的
capture seam。这些是真实检查的输入基础，但不是检查能力本身。

只读审计 `main@c4abb79271c5ede127b8e3d51b3d10632a5d7336` 得到以下事实：

| 检查项 | 当前仓库真值 |
|---|---|
| AppearanceCheckRun / Result | D-036 只有设计合同；`src/` 无实现 |
| 自动检查 Adapter | 无；Fidelity-B Adapter 只负责候选捕获，不判断外观 |
| 模型与 policy version | 未选择、未接受 |
| 逐维规则或阈值 | 未定义、未校准 |
| 误放行、误阻断与 unknown 证据 | 无基准集、无测量结果 |
| 费用、延迟、数据外发与保留 | 未确认 |
| 当前图像依赖 | `sharp` 只提供图像处理，不能据此宣称商品身份判断能力 |

D-036 已明确：能力 gate 未通过前不得实现假检查器。fake Adapter、固定 `passed`、单张截图主观判断、纯像素差或一个不可解释
总分都不能填补这些证据缺口。因此 Issue #216 只定义后续选型和验收输入；Fidelity-C 代码保持未开始。

## 2. 要解决的产品问题

自动检查不是判断“画面是否好看”，而是为运营人员回答：候选图中的商品是否仍是同一商品，哪些维度有证据支持、哪些已变形、
哪些因视角或遮挡无法判断。

固定身份维度为：

1. 轮廓与几何结构；
2. 部件数量与连接关系；
3. 主体与关键部件颜色；
4. 长宽、部件与包装的相对比例；
5. 包装形态和开启结构；
6. Logo 的存在、位置与基本形态；
7. 标签文字的存在、位置与可辨识内容。

允许变化仍仅限姿势、视角、画面相对大小、光照与合理遮挡。`presentation_size_code` 不参与身份一致性结论；尺寸档位通过
不能补偿瓶盖、包装、Logo 或标签变化。

## 3. 待比较的能力类别

本门禁不提前选赢家。后续 evidence 任务只比较与本项目约束相符的候选：

| 能力类别 | 需要证明 | 直接否决条件 |
|---|---|---|
| 受控本地视觉/OCR流水线 | 对视角、缩放、光照与遮挡有可解释处理；逐维证据可复现 | 只能做像素相等或单一相似度总分 |
| 受控多模态模型 Adapter | 能返回固定 schema、版本可锁定、输入不被训练、费用与保留可接受 | 只返回自然语言结论、模型不可锁定或数据用途不清 |
| 确定性规则与模型组合 | 规则负责 bytes/几何/OCR 事实，模型只处理受控歧义；责任边界可追踪 | 任一组件失败时默认放行，或无法定位结论来源 |

Hifly 候选生成页面不是自动检查供应商。不得因为候选来自 Hifly，就把 Provider 的生成成功、`gen_id` 或可下载状态解释为外观
检查通过。

## 4. Evidence 包

任何候选能力进入实现设计前，必须提交一份可独立复核的 Evidence 包。

### 4.1 精确输入

- 使用 Fidelity-B 受控存储中的 exact source/candidate AssetVersion；
- 记录 organization、candidate、candidate state revision、source/candidate checksum；
- 对参与比对的预处理步骤记录稳定版本与参数；
- 不以文件名、数组顺序、临时 Provider URL 或浏览器 Profile 路径识别输入。

### 4.2 代表性基准集

基准集按风险而不是按 SKU 硬编码组织：

- **允许变化**：同一商品在不同姿势、视角、大小、光照和合理遮挡下应保持可支持或明确 unknown；
- **身份变化**：分别覆盖几何、部件、颜色、比例、包装、Logo、标签文字的真实或受控变更；
- **歧义样本**：严重遮挡、低清、反光、背面不可见和文字不可读，应促使 unknown，而不是猜测通过；
- **组合变化**：至少包含多个维度同时变化，验证聚合规则不会被单个高分掩盖。

每个样本必须有独立人工标注、标注理由和可复核证据引用。单一防晒霜样本可作为回归案例，但不能成为产品专用逻辑或唯一验收集。

### 4.3 固定输出

能力输出必须映射到 D-036 的七个 dimension。每项只允许：

- `supported`：现有可观察证据支持身份一致；
- `unsupported`：可观察证据表明身份发生不允许的变化；
- `unknown`：输入不足、合理遮挡、能力不支持或运行证据不足。

聚合保持不变：任一 unsupported 为 blocked；否则任一 unknown 为 needs_review；全部 supported 才为 passed。原始模型提示、完整第三方
响应、临时 URL 和不可解释总分不进入公共结果。

### 4.4 测量与业务代价

Evidence 必须分开报告：

- `unsupported` 被错误判为 supported 的严重误放行；
- 合法 allowed variation 被错误阻断；
- unknown 的比例与主要原因；
- 七个维度各自覆盖，而不是只给汇总准确率；
- 单次延迟、失败率、并发边界与费用；
- 模型/规则版本变化后的复验结果。

本文件不凭空给出百分比阈值。候选能力报告必须根据基准规模、错误代价和实际分布提出明确阈值，再由 Owner 在独立 acceptance
gate 中批准。阈值未批准时，能力状态保持 blocked。

### 4.5 隐私与运行边界

- 明确 source/candidate bytes 是否离开本系统、传输区域、保留时间、训练用途和删除方式；
- 不向公共 API、日志或审计暴露 Provider URL、Token、Cookie、Profile 路径、对象键或原始模型正文；
- 外部检查如可能收费，真实 benchmark 前需要独立费用授权；不得复用候选生成或视频积分授权；
- 网络失败、模型不可用、schema 漂移或输出无法验证时只得到 failed/unknown，不能得到 passed。

## 5. Acceptance gate

只有以下事实同时成立，主控才可提出 Fidelity-C 实现 Issue：

1. Owner 接受一个明确的 capability、policy version、model/rule version 与逐维阈值；
2. Evidence 包可复现，并保留逐样本人工真值与逐维输出；
3. 严重误放行、误阻断、unknown、延迟、费用和数据治理均有实际测量，而不是供应商宣传；
4. 输出能无损映射到 D-036 的 Run/Result 合同，failed/pending 不产生 Result；
5. 受控 bytes 和 checksum 绑定成立，第三方响应按不可信输入验证；
6. capability 默认关闭，失败关闭，并且不触发候选重生、Production、Worker 或视频提交；
7. 独立 Reviewer 复核 Evidence 与阈值，Owner 明确接受。

下列任一情况直接保持 `BLOCKED_CHECK_CAPABILITY_UNSELECTED`：固定假结果、只有自然语言判断、只提供总分、未覆盖 Logo/标签、
未来模型版本不可锁定、无法说明数据用途、费用未知、没有误放行样本或需要真实生产数据才能完成首次校准。

## 6. Fixture 与真实能力证据的边界

确定性 fixture 只用于证明 API 状态机、组织隔离、幂等、冲突、审计和 UI 恢复。fixture 可以返回 supported/unsupported/unknown，
但这些返回值只验证软件合同，不能证明模型、阈值或产品效果。

在 capability acceptance 前，不创建 AppearanceCheckRun/Result、AppearanceReview、检查 Worker 或 candidate workspace 的生产实现，
避免让 fake 绿测先形成不可撤销的公共合同。

## 7. 后续严格顺序

```text
Issue #216 gate 进入 main
→ Issue #218 capability shortlist 与官方费用/隐私/版本证据进入 main
→ 经单独授权的受控 benchmark（如涉及外部 API 或费用）
→ Owner 接受 capability + policy/model version + 阈值
→ 新 Fidelity-C 实现 Issue：Run/Result → Review → workspace
→ 独立 Review/merge
→ Fidelity-D Product/API/Provider gate
```

原 Fidelity-C 的公共状态、API 与人工审核合同继续由 D-036 持有；本文件只补上进入代码实现前缺失的能力证据门禁。没有通过
本门禁时，不得开始 Fidelity-D/E，也不得把人工 Works 检查倒推成自动检查已可用。

Issue #218 的研究结果由
[`PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md`](PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md) 持有。该文件只把官方能力
压缩为当前唯一可执行候选：本地 PaddleOCR/OpenCV 基线。OpenAI 固定 snapshot 因官方 Logo 输入要求保持 reserve/blocked，
Google Vertex AI 因版本锁定与迁移语义待复核保持 reserve，混合方案在合规多模态组件获接受前保持 deferred。它没有运行模型、
测量准确率、设置阈值或替 Owner 选择最终 capability。其 PR 合并只表示 shortlist 研究完成；下一门至多是仍需独立授权的本地
受控 benchmark，任何外部图片/API/费用动作继续单独过 gate。

## 8. 本轮边界

本门禁建立过程没有访问 Hifly 或任何真实视觉 Provider，没有上传 source/candidate bytes，没有启动 Worker/Local Agent，没有创建
候选、检查、工单或视频，没有修改生产数据、部署或消耗积分。合并只表示“如何验收检查能力”已设计，不表示某个模型已选定、
Fidelity-C 已实现或外观保真已经通过。
