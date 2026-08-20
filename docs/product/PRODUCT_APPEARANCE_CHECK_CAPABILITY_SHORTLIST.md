# 商品外观检查能力候选清单

> 状态：Fidelity-C1 proposal；随本文件所在 PR 合并进入 `main` 后，才表示 shortlist 研究完成
> 依据：D-036 与 `PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md`
> 官方资料核对日期：2026-08-20
> 证据边界：只读公开资料；未登录控制台、未调用 API、未上传图片、未运行 benchmark、未产生费用

## 1. 结论先行

本轮没有选择最终模型、规则、policy version 或阈值，也没有证明任何候选能够可靠判断商品身份一致性。
官方资料目前只足以形成一个可进入独立受控 benchmark 的候选：

1. **本地 PaddleOCR 3.7.0 / PP-OCRv6 + OpenCV 4.13.0 基线**：先建立可复现的 OCR、颜色、轮廓、
   比例和局部特征证据；数据无需离开受控环境，但遮挡、视角变化和语义部件关系能力必须实测。
OpenAI GPT-5.4 固定 snapshot 保留为 **reserve / blocked**：官方 Images and Vision 输入要求明确包含
“No watermarks or logos”，而 D-036 必须检查真实商品包装上的 Logo。除非取得官方书面澄清，或找到官方支持且明确允许
Logo 商品图的输入路线，否则不得把真实商品图上传到该路线，也不得将它作为可执行 benchmark 候选。固定 snapshot、
Structured Outputs、价格和数据治理资料仍是有效能力事实，但不能越过输入合规门禁。

Google Vertex AI Gemini 同样仅作为 reserve。官方 `GenerateContentResponse` 能返回实际 `modelVersion`，但旧 Vertex
model lifecycle URL 在本次核对时已重定向到 Gemini Enterprise Agent Platform；当前可锁定模型与迁移语义必须重新验证，
不得据此提升为可执行候选。混合方案只是 **deferred composition**：在一个合规且被接受的多模态组件进入 benchmark 前，
它不是独立可执行能力。

本结论只回答“哪些能力值得进入 benchmark”，不回答“哪个能力可以上线”。`BLOCKED_CHECK_CAPABILITY_UNSELECTED`
保持不变。

## 2. Hifly 的检查问题

检查必须分别为 D-036 七个身份维度形成可审计 Evidence：

1. 轮廓与几何结构；
2. 部件数量与连接关系；
3. 主体与关键部件颜色；
4. 长宽、部件与包装的相对比例；
5. 包装形态和开启结构；
6. Logo 的存在、位置与基本形态；
7. 标签文字的存在、位置与可辨识内容。

每维只能得到 `supported | unsupported | unknown`。任一 `unsupported` 聚合为 `blocked`；否则任一 `unknown`
聚合为 `needs_review`；全部 `supported` 才可能得到 `passed`。这仍只是自动检查结论，不能代替人工候选批准，
也不能代替最终 Works 内容验收。

允许变化只有姿势、视角、画面相对大小、光照和合理遮挡。`presentation_size_code` 与外观保真独立；商品呈现
大小通过不能补偿瓶盖、包装、Logo 或标签变化。

## 3. 官方资料证据矩阵

### 3.1 受控本地流水线

| 维度 | 官方资料能证明什么 | 仍为 UNKNOWN 的 Hifly 事实 |
|---|---|---|
| 版本 | PaddleOCR 仓库发布 3.7.0；OpenCV 仓库发布 4.13.0，可在依赖与镜像中锁定 | 精确模型权重、运行镜像、CPU/内存与升级周期尚未决定 |
| OCR/中文 | PaddleOCR 官方把 PP-OCRv6描述为覆盖中英等 50 种语言；OCR pipeline 可本地接收图片并输出文字与框 | 中文包装小字、弧面、反光、遮挡和生成失真的召回/误识率未测 |
| 结构化输出 | OCR 结果和 OpenCV 数值由本系统 Adapter 转为 D-036 schema，不依赖自然语言解析 | 七维映射规则与逐维阈值未设计、未批准 |
| 图像能力 | OpenCV 官方提供 histogram comparison、template matching、feature/homography、shape descriptors | 这些算子不能单独证明“同一商品”；视角与遮挡容忍度未测 |
| 数据治理 | 完全本地运行时，图片无需发往外部模型服务 | 运行节点日志、临时文件、模型供应链和删除 SOP 尚未验收 |
| 费用 | 软件许可为 Apache-2.0；没有按次 Provider 调用费 | 算力、工程、标注、运维成本和每样本延迟未测 |
| 失败语义 | 本系统可观察进程退出、解析失败、空 OCR、特征不足 | 每类失败映射 `failed` 还是逐维 `unknown` 仍需 policy 决定 |
| 生命周期 | 可固定软件与权重版本，升级由本项目控制 | 上游 CVE、模型权重发布与兼容复验成本未知 |

### 3.2 OpenAI 固定 snapshot 多模态 Adapter（reserve / blocked）

| 维度 | 官方资料能证明什么 | 仍为 UNKNOWN 的 Hifly 事实 |
|---|---|---|
| 版本 | GPT-5.4 页面列出 snapshot `gpt-5.4-2026-03-05`，可避免只使用浮动 alias | snapshot 可用生命周期与迁移窗口仍须每次 benchmark 前复核 |
| 图像/OCR | Vision guide 支持 PNG/JPEG/WEBP/非动画 GIF 与多图输入；GPT-5.4 支持 image input | 同一 guide 还明确要求输入图片不得含 watermark 或 logo；本项目真实包装 Logo 与该要求冲突，因此该路线不得进入当前 benchmark，除非取得官方书面澄清或另一条官方支持的合规路线 |
| 结构化输出 | Structured Outputs 支持 JSON Schema adherence、明确 refusal 和 incomplete 边界 | 支持的是 JSON Schema 子集；七维 schema、拒绝和截断映射尚未实测 |
| 输入限制 | Vision guide 列出单请求总 payload 和图片数量上限，并提供 detail 档位 | 商品图片最佳分辨率、detail、token 消耗与裁切策略未测 |
| 数据治理 | 官方说明 API 数据默认不用于训练；默认 abuse logs 最多 30 天；ZDR/MAM 与区域处理受资格和配置约束 | 本项目账号是否获批 ZDR、所需区域是否可用、删除/审计配置均未核验 |
| 费用 | GPT-5.4 页面列出每百万 input/output token 单价；区域处理可能有额外费用 | 图像 token、输出 token、重试、拒绝和实际每样本美元成本未测 |
| 配额/失败 | 官方列出 tier rate limits，以及 429/500/503/API connection/refusal/incomplete 等可观察边界 | 本项目 tier、并发、P50/P95、超时和限流恢复未测；失败不得自动通过 |
| 生命周期 | snapshot 比 alias 更适合审计；输出可记录 model identifier | 供应商退役、schema 行为变化与复验频率仍是版本风险 |

### 3.3 Google Vertex AI Gemini reserve

| 维度 | 官方资料能证明什么 | 本轮处理 |
|---|---|---|
| 图像与 JSON | 官方 quickstart 展示 image input；GenerationConfig 支持 `responseSchema`/JSON | 能力存在，不等于七维准确率 |
| 版本 | `GenerateContentResponse` 官方字段说明实际响应包含 `modelVersion` | 旧 Vertex model lifecycle URL 在 2026-08-20 核对时重定向至 Gemini Enterprise Agent Platform；当前精确锁定与迁移语义必须重新验证，不能凭旧页面表述进入 benchmark |
| 数据 | 官方承诺未经许可不训练；ZDR 文档列出 abuse logging、in-memory cache 与功能例外 | 账号资格、区域、缓存关闭和删除边界未核验 |
| 费用 | 官方 pricing 按 model/token 或 modality 列费率，并说明非 200 请求的计费边界 | 具体 benchmark 模型和图像 token 尚未选，不能算实际单价 |
| 失败/配额 | 官方错误页给出 400/401/403/404/429/5xx；按需模式存在 Dynamic Shared Quota | 可观察失败明确，但延迟、容量和重试策略未测；Hifly 默认仍 fail closed |
| 生命周期风险 | 官方 release notes 与 lifecycle 提供变化记录 | 当前产品命名与文档迁移变化本身要求更严格的版本复验 |

### 3.4 混合方案（deferred composition）

混合方案不是独立可执行候选，而是待一个合规、已接受的多模态组件进入 benchmark 后才可评估的责任编排：

- 本地组件只输出可复核的 OCR box/text、颜色分布、轮廓、比例和局部匹配事实；
- 多模态 Adapter 只处理规则覆盖不足的语义部件、包装结构或遮挡歧义，并返回固定七维 schema；
- 每项结果记录来源组件、精确版本、输入 checksum、evidence reference 与失败原因；
- 规则与模型冲突时不得求平均。任一可靠 `unsupported` 仍阻断；无法裁决则 `unknown`；
- 任何外部超时、refusal、schema invalid、版本漂移或本地证据不足都不能得到 `passed`。

## 4. 七维 Evidence 形成能力

此表只评估“能否形成可复核 Evidence”，不是准确率结论。

| D-036 维度 | 本地 OCR/CV（当前候选） | 固定 snapshot 多模态（reserve） | 混合方案（deferred） | benchmark 必须测量 |
|---|---|---|---|---|
| 轮廓/几何 | 轮廓、关键点、homography 可提供数值证据 | 可给结构化语义判断 | 规则证据优先，模型解释歧义 | 视角、遮挡下误放行/误阻断/unknown |
| 部件数量/连接 | 局部特征可辅助，语义连接较弱 | 可描述部件关系 | 本地定位 + 模型关系判断 | 泵头/瓶盖/把手等变形样本 |
| 颜色 | histogram/区域统计可解释 | 可返回颜色维度 | 本地颜色证据优先 | 光照、白平衡、反光容忍度 |
| 比例 | 轮廓框与关键区域比值可解释 | 可判断相对比例 | 规则测量 + 模型遮挡判断 | 透视和姿势变化下的边界 |
| 包装/开启结构 | 模板/特征有限 | 可做结构化语义判断 | 模型判断必须引用本地可见区域 | 盒/瓶/泵/盖结构变化 |
| Logo | 局部匹配与 OCR 可辅助 | 可判断存在与位置 | 本地匹配优先，模型处理变形 | 小尺寸、旋转、遮挡与生成文字 |
| 标签文字 | OCR box/text 可复核 | 可返回识别与可见性 | OCR 原文为主，模型只做语义辅助 | 中文小字、弧面、错字、不可读样本 |

所有单元格的实际逐维覆盖率、严重误放行率、合法变化误阻断率、unknown 率、运行失败率和延迟均为
**UNVERIFIED**。

## 5. Shortlist 与推荐顺序

### 5.1 候选 1：本地基线

**Adopt for benchmark baseline**。理由是版本、输入和中间证据最容易固定，且没有图片外发；它适合先证明七维中哪些可由
确定性证据覆盖。它不能因“本地”而自动通过：若只产生相似度总分、不能区分遮挡与变形，仍不满足 D-036。

### 5.2 Reserve：OpenAI 固定 snapshot Adapter

**Blocked pending official clarification**。固定 snapshot、固定 schema、`store=false`、拒绝/截断/schema invalid 等能力事实
仍成立，但官方输入要求与 Logo 商品图直接冲突。只有官方书面澄清或另一条官方支持且明确允许 Logo 商品图的路线，才能
重新申请 benchmark gate；不得通过真实上传或 API probe 自行试探。

### 5.3 Deferred：混合方案

**Deferred composition**。只有一个合规、已接纳的多模态组件先通过独立 benchmark gate，并与本地基线分别完成逐维测量后，
才能判断混合是否降低严重误放行，而不是只增加成本与复杂度。当前不得为混合方案运行独立 benchmark。

### 5.4 暂不进入执行的选项

- **Google Vertex AI Gemini**：保留为 reserve；响应 `modelVersion` 字段是有效官方事实，但旧 lifecycle URL 已重定向，
  当前模型锁定、迁移、区域和 ZDR 合同都须重新验证。满足这些条件后仍需独立 gate，不能自动进入 benchmark。
- **纯像素差/感知哈希/单一相似度总分**：明确拒绝。它们无法区分允许的视角、姿势、光照与不允许的包装结构变化。
- **纯 OCR**：明确拒绝为完整检查器；它只能为 Logo/标签与部分可见区域提供 Evidence。
- **浮动模型 alias 或自然语言输出**：明确拒绝；无法形成可复验 policy/model version 与固定 Result schema。

## 6. 最小受控 benchmark 设计

### 6.1 数据与盲测

- 使用 Fidelity-B 受控存储中的 exact source/candidate AssetVersion 和 SHA-256；不使用 Provider 临时 URL；
- 按 D-036 七维建立允许变化、单维身份变化、歧义和组合变化四类样本；
- 每个样本由独立人工标注 `supported/unsupported/unknown`、理由和 evidence reference；
- 单一防晒霜可保留为回归样本，但不得成为唯一数据或 SKU 专用规则；
- 所有候选使用同一冻结数据集、同一抽样和同一聚合规则；模型输出对标注者保持盲测。

### 6.2 必报指标

- 严重误放行：人工 `unsupported` 被能力判为 `supported`；
- 合法变化误阻断：人工 `supported` 被能力判为 `unsupported`；
- unknown 率及原因；
- 七维逐项覆盖与混淆，不只给总准确率；
- parse/schema/refusal/timeout/rate-limit/model unavailable 等运行失败率；
- P50/P95 延迟、峰值内存/CPU 或外部 token；
- 每样本成本与一次完整回归成本；
- 固定版本升级后的同集回归差异。

阈值必须来自该数据和错误代价，再由 Owner 在独立 acceptance gate 决定。本文件不设置样本数、百分比或通过线。

### 6.3 预算计算表

| 方案 | 预算公式 | 本轮数值状态 |
|---|---|---|
| 本地 | `样本数 × 每样本运行时 × 实例小时单价 + 工程/标注工时` | 实例、运行时和工时均 UNVERIFIED |
| OpenAI reserve | `总 input tokens × input 单价 + 总 output tokens × output 单价 + 区域附加费 + 失败/复验预算` | 仅保留未来预算方法；Logo 输入门禁未解除，不得运行 |
| Google reserve | `总 image/input units × 官方单价 + output tokens × 单价 + 复验预算` | 具体 model、锁定合同与计费单位未选，不得运行 |
| 混合 deferred | `本地成本 + 进入模型的 unknown 子集成本 + 编排/复验工时` | 尚无合规多模态组件，不是当前 benchmark 项 |

真实 benchmark、外部 API 或费用动作必须获得 Owner 当次明确授权；不得复用候选生成或视频积分授权。

## 7. Stop conditions

以下任一项成立时，保持 `BLOCKED_CHECK_CAPABILITY_UNSELECTED`：

- 不能固定 model/rule/policy version 或无法记录实际运行版本；
- 供应商不允许本项目包装/Logo 输入，或数据区域、保留、训练与删除边界不清；
- 输出不能严格映射七维 schema，或 refusal/incomplete/parse failure 被当成 passed；
- 没有逐样本人工真值与严重误放行样本；
- 只报告总分，不报告逐维 unsupported/unknown；
- 真实费用、延迟、配额或失败语义未经测量；
- 需要真实 API/图片上传但没有独立授权；
- benchmark 需要改 Production、启动 Worker、生成候选/视频或修改生产数据。

## 8. 未决事实

- 哪个候选的严重误放行、误阻断与 unknown 最低：UNVERIFIED；
- 七维中哪些可由纯本地证据可靠覆盖：UNVERIFIED；
- 中文包装、Logo、标签在多视角/遮挡下的实际识别效果：UNVERIFIED；
- OpenAI 商品 Logo 输入当前受官方要求阻断；官方书面澄清、合规路线与本项目账号 ZDR/区域资格：UNKNOWN；
- Google 可用于审计的精确模型锁定与迁移语义、区域与 ZDR 配置：UNKNOWN；
- 各候选 P50/P95、并发、失败率和每样本成本：UNVERIFIED；
- 最终 capability、policy/model version、逐维阈值和是否采用混合方案：Owner 未决定。

## 9. 官方来源登记

以下链接均于 2026-08-20 只读核对；供应商文档会变化，真实 benchmark 前必须重新核对版本、价格和数据政策。

### 本地流水线

- [PaddleOCR official repository and releases](https://github.com/PaddlePaddle/PaddleOCR)
- [PaddleOCR package metadata](https://github.com/PaddlePaddle/PaddleOCR/blob/main/pyproject.toml)
- [PaddleOCR 3.x OCR pipeline](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/OCR.html)
- [OpenCV official repository and releases](https://github.com/opencv/opencv)
- [OpenCV histogram comparison](https://docs.opencv.org/4.13.0/d8/dc8/tutorial_histogram_comparison.html)
- [OpenCV template matching](https://docs.opencv.org/4.x/de/da9/tutorial_template_matching.html)
- [OpenCV feature matching and homography](https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html)
- [OpenCV structural analysis and shape descriptors](https://docs.opencv.org/4.13.0/d3/dc0/group__imgproc__shape.html)

### OpenAI

- [GPT-5.4 model and snapshot](https://developers.openai.com/api/docs/models/gpt-5.4)
- [Images and vision input](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [API pricing](https://developers.openai.com/api/docs/pricing)
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Error codes](https://developers.openai.com/api/docs/guides/error-codes)

### Google Cloud 对照

- [Gemini image understanding quickstart](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart)
- [Controlled JSON output with response schema](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/generativeaionvertexai-gemini-controlled-generation-response-schema-2)
- [GenerateContentResponse modelVersion field](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse)
- [Model versions and lifecycle](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
- [Vertex AI generative pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Zero data retention controls](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)
- [Generative AI API errors](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/api-errors)
- [Throughput quota](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/resources/throughput-quota)

## 10. 本轮边界

本轮仅使用公开官方资料和仓库已接受合同，没有登录任何供应商控制台，没有调用模型或 Provider API，没有上传
source/candidate bytes，没有运行 benchmark，没有访问 Hifly，没有启动 Worker/Local Agent，没有创建候选、检查、工单或视频，
没有修改生产数据、SSH、部署或产生费用。合并本文件只表示 shortlist 研究进入 `main`；不表示模型已选、阈值已接受、
Fidelity-C 已实现或外观保真已通过。
