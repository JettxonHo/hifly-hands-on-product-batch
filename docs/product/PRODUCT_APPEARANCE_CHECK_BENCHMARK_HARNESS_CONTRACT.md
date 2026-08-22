# 商品外观检查 Benchmark 环境与 Harness 合同

> 关联决策：D-035、D-036
> 关联 Issue：#226、#228、#230
> 生命周期：Issue #226 / PR #227 已进入 `main@a65a74ef0f94c131df0712e9943b68a0c835220e`，合同为 designed/locked；Issue #228 / PR #229 已进入 `main@4e352334374fee6a077fb95a599944239b12f5c1`，只实现 synthetic contract；Issue #230 / 对应 PR 是 C5a Evidence acceptance gate
> 当前能力状态：`BLOCKED_CHECK_CAPABILITY_UNSELECTED`
> 当前环境状态：`BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`
> 非目标：environment implementation 不等于运行 accepted benchmark、选择能力/阈值或实现 Fidelity-C 产品状态

## 1. 结论

Fidelity-C4 已接受仓库外受控 exact-byte 数据和独立七维人工真值；Fidelity-C5 合同已进入 `main`。合同锁定
可由官方来源和当前受控 Evidence 证明的部分：输入身份、候选软件版本、可取得的发行制品 SHA-256、基准运行架构、
离线缓存边界、原始输出和 fail-closed 结果合同。

Issue #228 的获授权 artifact audit 已取得两份 PP-OCRv6 medium 权重的 exact bytes/SHA-256 和安全 archive containment，
并再次核对六个顶层 wheel。Issue #230 进一步以 PaddlePaddle 官方模型仓库的 Apache-2.0 模型卡和 LFS OID，把 tar 内
`inference.pdiparams` 精确绑定到同一官方模型参数 bytes；但 BOS tar 本身没有 LICENSE/NOTICE，官方也没有发布该 exact
archive 的 SHA-256、内容清单或 archive-specific 再分发声明。因此模型参数的第一方许可 Evidence 已建立，exact BOS tar
的复制/再分发边界仍为 `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`。

两架构 no-install resolver report 同时证明：PaddleOCR 3.7.0 / PaddleX 3.7.0 的 `ocr-core` 唯一官方 metadata lane 精确要求
`opencv-contrib-python==4.10.0.84`；`opencv-python-headless==4.13.0.92` 是不同 distribution，不能用 `--no-deps`、metadata
override 或“模块等价”替换。该 contrib wheel 同时打包 FFmpeg，Linux 与 macOS 非 headless wheels 均打包 Qt5；官方资料没有证明
4.13 的图像内存安全修复已回移至 4.10。故 C5a 未形成 accepted lane，环境继续 blocked，完整 cache 与离线
`--require-hashes` 安装也未验证。不得安装、运行模型或 benchmark，也不得用 resolver report 冒充 accepted environment。

## 2. 只读输入绑定

Harness 只能读取 storage alias `HIFLY_APPEARANCE_BENCHMARK_V1`，不得接收本机绝对路径作为持久输入，也不得原地修改
受控包。运行前必须同时核对：

| Artifact | 相对路径 | Bytes | SHA-256 / 固定真值 |
|---|---|---:|---|
| dataset manifest | `manifests/dataset-manifest.v1.json` | 6083 | `306db2ba5a0a5c467318ca449e35149962d936ef7bd8488961e3691a7f318df2` |
| annotation | `annotations/ground-truth.v1.ANT-01.json` | 9355 | `bb7672120ada5a8204527950ad9bd3e9098461826959af87e193a5fe8635f4c5` |
| review | `reviews/ground-truth-review.v1.RV-01.json` | 13231 | `d3a315519a921f266ef84dcba85547c97deb18be883912aeebe8203affe1ea4d` |

Manifest 的固定身份还包括：`dataset_id=hifly-appearance-controlled`、`dataset_version=v1-pre-annotation`、
`status=human_ground_truth_accepted_benchmark_not_run`、4 个 exact source/candidate 配对、4 类样本和 4 个商品族。
版本名中的 `pre-annotation` 是 artifact 创建时名称，不得据此覆盖 manifest hash、status 和 Fidelity-C4 acceptance 真值。

输入校验必须先于任何推理：普通文件且非 symlink、相对路径受控、bytes/media/dimensions/SHA-256 与 manifest 一致、
annotation/review 精确绑定且 review accepted。任一漂移立即停止整次 run，不生成部分通过结论。

仓库 synthetic fixture 必须与 C4 公共 schema 同构：图片引用使用 `relative_path`；annotation 使用
`pack_type=appearance_ground_truth`、`status=completed`、`annotator_id` 与盲评标记，每个 sample 必须有
`annotation_version=1`、非空 `annotated_at`；review 使用 `pack_type=appearance_ground_truth_review`、`status=completed`、
`review_status=accepted`、`annotation_pack_sha256`、`annotator_id`、不同的 `reviewer_id` 与非空 `reviewed_at`，并包含与
annotation 精确同 sample、同 7 axes 的 `sample_reviews`。每项必须核对 `annotator_status`、合法 `reviewer_status`、二者对应的
`status_match`，以及非空 `reason_code`、`reason`、`evidence_ref`、`visibility_context`：一致时只接受 `accepted`；不一致时只接受
`accept_annotation` 且 `decision_note` 至少 4 字符，普通 `reason` 不得替代决定说明。任何 `changes_requested`、空决定、缺项、
重复、错 sample 或错 axis 均 fail closed，不能被顶层 `review_status=accepted` 掩盖。fixture 只使用合成 bytes，不读取上述
accepted 四对数据。测试专用字段名不得成为另一套产品合同。

## 3. 候选环境锁

### 3.1 兼容矩阵

以下是 Fidelity-C5 能由官方来源证明的候选锁，不表示已经安装或运行：

| 层 | 候选锁 | 可证明的发行 Evidence | 本合同边界 |
|---|---|---|---|
| Python | 3.11.16 | Python 官方 release；canonical OCI 使用 `python:3.11.16-slim-bookworm` | 只允许 CPython 3.11；mutable tag 不能单独作为运行身份 |
| Canonical OS/arch | Linux/amd64 | OCI index `sha256:2e32f7d302adc1c37428355c1e646897c0c53f4fd60b6a551245fb90ee129f91`；amd64 manifest `sha256:bb3a5d38989ec658710f06b08bc23cb78d079eb852405e42b124fdf430281454` | 正式资源/延迟数据只在该 architecture-specific digest 上比较 |
| Local smoke | macOS/arm64 | Python 3.11 与对应 arm64 wheels；OCI arm64 manifest `sha256:100d50c3729317111e10b6c29c3e84cd4ddfa724f6d7e44148c81604ae65960b` 仅供容器兼容复核 | 只证明开发机 smoke；不得与 Linux/amd64 性能混报 |
| PaddleOCR | 3.7.0 / tag commit `b03f46425e8ff4442b268ce449e3eef758146cd4` | wheel 146750 bytes，SHA-256 `c0f0a81ad4112727f30c6fcf986ac0ef6a120d31ee0991a01fae0357ee32d338` | 官方兼容表只给 PaddlePaddle `>=3.0.0`，不证明本合同 exact stack 已运行 |
| PaddleX | 3.7.0 | wheel 2220975 bytes，SHA-256 `70c5762d6bae7efe3a7db0e3264eb88e9ce1c3bf88d8e30cd32759924357acdc` | PaddleOCR 3.7.x 要求 PaddleX `>=3.7,<3.8` |
| PaddlePaddle | 3.1.1 | Linux cp311 wheel 187453011 bytes，SHA-256 `36c6a768d31486c100e1be14404f8fc57565283f0df90b7142d2560100fe86ef`；macOS arm64 cp311 wheel 97973526 bytes，SHA-256 `0f58c9dbd3a8e3a50495715925706311e587b018ad3061e49608a017e82b0dce` | 满足官方 `>=3.0.0` 范围且有两平台 exact wheel；CPU exact-stack 兼容仍须 implementation gate 验证 |
| OpenCV Python | 官方 metadata 候选仅 `opencv-contrib-python==4.10.0.84`；尚未 accepted | Linux x86_64 wheel 68681489 bytes，SHA-256 `a261223db41f6e512d76deaf21c8fcfb4fbbcbc2de62ca7f74a05f2c9ee489ef`；macOS arm64 wheel 63667391 bytes，SHA-256 `ee4b0919026d8c533aeb69b16c6ec4a891a2f6844efaa14121bf68838753209c` | PaddleX `ocr-core` 精确要求该 distribution；仍须解决随附 FFmpeg/Qt 许可、安全和 image-only 执行边界，不能视为 accepted environment |

精确 wheel 文件名分别为：`paddleocr-3.7.0-py3-none-any.whl`、`paddlex-3.7.0-py3-none-any.whl`、
`paddlepaddle-3.1.1-cp311-cp311-manylinux1_x86_64.whl`、`paddlepaddle-3.1.1-cp311-cp311-macosx_11_0_arm64.whl`、
`opencv_contrib_python-4.10.0.84-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl` 与
`opencv_contrib_python-4.10.0.84-cp37-abi3-macosx_11_0_arm64.whl`。

PaddlePaddle 官方 macOS 安装边界当前是 ARM64、CPU-only，不支持 macOS x86_64；本合同也没有证明 Linux/arm64 exact stack。
因此 Intel Mac、Linux/arm64、GPU 或其他 Python ABI 都不是可替换 lane，出现时必须停止并另过环境选择 gate。

Issue #230 使用 Python 3.11 的官方 PyPI metadata 做了两份无安装解析：Linux/amd64 解析为 65 个 artifact，report SHA-256
`13261371db551c8ee5603a66fe011adee52cb1b191bb0bf2b09966ce3a349327`；macOS/arm64 解析为 63 个 artifact，report SHA-256
`4ff7e2df45801c12e5e725159d365fd8ba347a28acae000bdf29c3c26045418c`。两份均只含一个 `cv2` distribution，即
`opencv-contrib-python==4.10.0.84`。这些仓库外 report 只证明 metadata graph 可解，不是完整许可清单、可离线安装 cache 或
accepted lock。正式 implementation gate 仍必须生成完整、architecture-specific requirements lock，并以
`pip --require-hashes` 覆盖全部传递依赖。

OpenCV 允许的静态图像操作仅限 versioned policy 明列的解码、方向/尺寸读取、色彩空间转换、resize/crop/padding/normalize、
轮廓/几何、颜色统计、局部结构与 OCR 预处理。每项必须固定参数、顺序和错误语义，并把中间测量写入 raw Evidence；未列操作
默认禁止。不得打开摄像头、视频文件、codec 或 FFmpeg，也不得把静态图像边界扩成视频能力。

### 3.2 PP-OCRv6 权重

候选模型固定为官方 PP-OCRv6 medium detection/recognition。Issue #228 从 v3.7.0 model list 的下载入口取得：

| 模型 | Artifact | Bytes | SHA-256 | Archive |
|---|---|---:|---|---|
| `PP-OCRv6_medium_det` | `PP-OCRv6_medium_det_infer.tar` | 62279680 | `144d0621e059566e5086e228829171591c144c2deb07b2dad4962214fbabfcf7` | 仅模型目录与 `inference.pdiparams` / `inference.yml` / `inference.json`；无路径穿越、symlink 或非普通文件 |
| `PP-OCRv6_medium_rec` | `PP-OCRv6_medium_rec_infer.tar` | 76851200 | `4eecc1c6a4623765042e6fc15446da0da110b7d875b6b72b2d351d2b2dbd4da6` | 同上 |

权重身份和 containment 已从 `DESIGN_BLOCKER_MODEL_ARTIFACT_UNHASHED` 前进。Issue #230 的只读复核进一步得到：det tar 内
`inference.pdiparams` SHA-256 为 `85218d2e3d98f5a21c58b4220627be923a97aee5db3cc71f39536ab31ac53960`，与 PaddlePaddle
官方 `PP-OCRv6_medium_det` 模型仓库固定 commit `8e0f56fb2ef86b461d99cfc7ac5c137738985f61` 的 LFS OID 相同；rec
参数 SHA-256 为 `1b01c79a914587933f615569e75de54f2e638ebb5d3f3b3c1b38c24ede8c7319`，与固定 commit
`e5a92bcbc5cc1b494628e458d267778f0704fd7c` 的 LFS OID 相同。两个官方模型卡均声明 `license: apache-2.0`。

该证据只把 exact 模型参数 bytes 绑定到第一方许可，不把 PaddleOCR 源码许可外推给 tar，也不自动解决归档再分发。两个
BOS tar 均无 LICENSE/NOTICE；官方未发布 tar 的 SHA-256、内容清单或 archive-specific 复制/再分发说明，模型仓库的
`LICENSE` 链接也不可用。因此本轮将旧的笼统 `PP_OCRV6_WEIGHT_LICENSE_UNVERIFIED` 收敛为更精确的
`PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`，不得把 exact tar 打包、镜像或随产品再分发。

### 3.3 离线缓存与网络

后续获授权的环境准备必须分两步：

1. 有网络的 fetch phase 仅下载 allowlist 中的 wheels/weights，逐个核对来源、bytes 和 SHA-256，写仓库外只读 cache manifest；
2. install/run phase 使用 `--no-index --find-links ... --require-hashes` 与容器 `--network none`，只消费已核验 cache。

Git 不提交 wheel、权重、缓存、dataset bytes、annotation/review JSON 或本机绝对路径。cache 缺失、额外文件、hash drift、
包解析需要联网或容器 digest 不匹配时必须停止。

## 4. Harness 合同

### 4.1 两阶段隔离

- **Inference phase**：只能读取 manifest 指定的 source/candidate bytes，不得读取 annotation/review；输出不可变 raw Evidence。
  raw Evidence 必须绑定 storage alias、manifest 相对引用/bytes/SHA-256、dataset ID/version/status，以及每个 sample 的
  source/candidate `relative_path`、bytes/media/dimensions/SHA-256。
- **Scoring phase**：在 inference 完成并封存后才读取 accepted annotation/review，以 exact run manifest 计算逐样本/逐维统计。
  annotation/review 的 dataset ID/version 必须与 raw Evidence 一致；sample ID 相同但数据集不同也必须 fail closed。
- 两个阶段的输出都必须写到受控 dataset root 之外的已存在父目录。校验必须比较 storage root 与输出父目录的真实路径，拒绝
  直接写回以及父级 symlink/junction 指回受控包；输出继续使用不可覆盖创建，不能原地修改任何 dataset 或 truth artifact。
- 固定 4 个样本全部是 evaluation set，不设训练集，也不得在看到人工真值或结果后调阈值再重跑并覆盖原结果。
- 任何新规则、预处理、模型或阈值都必须形成新的 `policy_version` 和新 run，历史 run 不可改写。

### 4.2 原始输出与七维映射

每个 sample 必须保留 source/candidate 的原始 OCR token、box、confidence、几何/颜色/结构测量、中间失败和耗时；不得只保留
一个相似度总分。七维仍为：轮廓/几何、部件、颜色、比例、包装、Logo、标签文字。

Accepted annotation pack 的 axis 与 D-036 runtime dimension 不是一一对应。Harness 必须原样冻结 C3 映射：

| Annotation axis | 人工语义 | D-036 runtime dimension / 规则 |
|---|---|---|
| `form_silhouette` | 瓶型/轮廓 | 轮廓与几何结构 |
| `cap_pump_key_parts` | 盖体/泵头 | 部件数量与连接关系；包装形态和开启结构 |
| `label_logo_text` | 标签、Logo 与文字 | Logo；标签文字 |
| `color_material` | 颜色与材质 | 主体与关键部件颜色；材质只作解释 Evidence，不新增 runtime dimension |
| `local_structure_decoration` | 局部结构与装饰 | 仅映射到 Evidence 实际支持的轮廓/几何、部件或包装维度 |
| `internal_proportion_size_impression` | 比例与尺寸感 | 长宽、部件与包装的相对比例；画面相对大小仍是允许变化 |
| `obvious_artifacts` | 明显伪影 | 跨维风险 axis；只映射到 Evidence 可归属的现有维度，无法归属时为 `unknown` |

评分映射固定为 `mapping_policy_version=d036-c3-v1`，并以 exact content SHA-256
`1e5fc0362d70d9d3b9bd63ed858889de7a7cd3b5a922e013ae354d1224bf9470` 锁定上表内容；有效维度内的任意重映射、重复目标、
空目标漂移或第八维都必须停止。评分输出必须同时保留 `annotation_axis`、`runtime_dimension`、`mapping_policy_version`、
mapping content hash、原始人工 status/reason code/reason/evidence/visibility context、派生 runtime truth、模型 raw Evidence 引用和
comparison outcome。`obvious_artifacts` 不得成为第八个 runtime dimension。

Inference raw output 仍按 sample、受控 operation 与候选 runtime dimension 编址，不得读取 annotation。Scoring phase 才按固定
映射生成两组独立统计：`by_annotation_axis` 保留原 7 axes，`by_runtime_dimension` 保留 D-036 的 7 个运行维度；每个统计单元
都必须能回链到同一 atomic mapping record 与 raw Evidence。不得用一个总分、合并后的“七维”名称或丢失 axis 的 runtime
汇总替代这两组结果。

一对多映射不得把一个人工结论静默复制为多个独立真值。例如 `cap_pump_key_parts` 或 `label_logo_text` 只有在 annotation 的
reason/evidence 分别足以支持目标维度时，才能为每个目标建立独立映射记录；证据不足的目标必须是 `unknown`。跨维 axis 也
必须逐目标保存映射依据。实现者不得按字段名、数组顺序或自身判断另造映射。

`supported | unsupported | unknown` 只能由获 Owner 接受的 versioned policy/rule 产生。当前没有 accepted 阈值，故任何
真实 run 在 policy acceptance 前最多产出 raw Evidence；若接口需要 provisional verdict，各维必须为 `unknown`，聚合只能是
`needs_review`，不得得到 `passed`。聚合固定为：任一 `unsupported` -> `blocked`；否则任一 `unknown` -> `needs_review`；
全部 `supported` -> `passed`。

缺依赖、权重不可读、格式不支持、超时、OOM、OCR/CV 异常、输出 schema 不合格或部分维度没有 Evidence，均 fail closed：
run 记为 failed 或对应维度 `unknown`，绝不能折算为 `supported`。

### 4.3 Negative controls

每次 acceptance run 至少验证：dataset/hash 篡改、annotation 在 inference phase 可见、模型权重 hash 漂移、缺依赖、超时、
不支持媒体、结果 schema 漂移、partial output、重复 run ID、未登记图像操作、一对多结论复制和伪造第八个 runtime dimension。
还必须覆盖逐样本/逐轴 review 缺项、重复、错绑定、未解决决定，以及 inference/scoring 直接或经 symlink 写回受控包。
negative control 必须证明停止或 unknown，不得触发网络下载或覆写受控输入。

### 4.4 结果 manifest

每次 run 的不可变 manifest 至少记录：

- run ID、UTC 时间、仓库 commit、harness/policy/rule version；
- dataset、annotation、review 的相对 artifact、bytes、SHA-256；
- OCI index/architecture manifest digest、Python/OS/CPU architecture、CPU/内存/线程配置；
- 完整 dependency lock hash、每个 wheel/weight 的来源、bytes、SHA-256 和许可证记录引用；
- source/candidate exact SHA-256、逐样本/逐维 raw output 与错误；
- inference/scoring 命令、网络关闭证据、P50/P95、峰值 CPU/内存与本地成本计算；
- 严重误放行、合法变化误阻断、unknown、运行失败和逐维覆盖的原始计数；
- Reviewer 身份只用受控角色引用、复核决定、Evidence hash 与时间。

macOS/arm64 smoke 与 canonical Linux/amd64 run 必须分开命名和统计。CI 绿只证明仓库合同/代码可执行；受控 benchmark Evidence
必须来自 exact canonical lane，不能用 `ubuntu-latest` 或开发机性能替代。

## 5. 费用、隐私、许可证与安全

- 当前 baseline 只使用本地 CPU，不授权外部 API、图片上传或付费动作；本地成本按 wall time、CPU/内存和设备小时公式记录，
  不在本合同发明金额。
- dataset/人工真值继续遵守 Owner 已接受的用途、12 个月保留、复审和删除边界；harness 只读，不创建未治理副本。
- PaddleOCR、PaddleX、PaddlePaddle 代码仓库使用 Apache-2.0；PP-OCRv6 两个官方模型卡也声明 Apache-2.0，且 exact
  参数 bytes 已由 LFS OID 绑定。BOS tar 的 archive-specific 再分发边界仍未证明，不能只凭模型卡把 tar 打包或镜像。
  OpenCV core 使用 Apache-2.0，opencv-python packaging 使用 MIT；contrib wheel 还携带 FFmpeg LGPLv2.1，Linux 与 macOS
  non-headless wheels 均携带 Qt5 LGPLv3。implementation gate 必须逐 artifact 归档 LICENSE/NOTICE/第三方许可并形成可复核
  obligations plan；PyPI 顶层 license 字段不能替代 wheel 内第三方许可。CPython 使用 PSF License。
- 所有第三方 wheel/weight 都是不可信输入：hash、magic/archive containment、路径和反序列化边界必须在实现 gate 单独审阅。
- OpenCV 4.10 contrib wheel 的构建信息和随附组件必须进入安全复核；本 baseline 即使禁用 video/GUI/codec/FFmpeg 路径，
  也不能据此宣称打包组件不存在或依赖零风险。官方没有发布“无漏洞”证明；4.13 变更记录中的图像安全修复也没有官方
  Evidence 证明已回移到 4.10，因此只能记录为未决安全复核，不能反向断言具体 CVE。

## 6. 官方来源

以下均于 2026-08-22 核对：

- [PaddleOCR v3.7.0 release](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0)
- [PaddleOCR v3.7.0 package metadata](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/pyproject.toml)
- [PaddleOCR / PaddleX compatibility at v3.7.0](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/paddleocr_and_paddlex.md)
- [PP-OCRv6 model list](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/model_list.md)
- [PP-OCRv6 description](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.en.md)
- [PaddleX v3.7 official model mapping](https://github.com/PaddlePaddle/PaddleX/blob/v3.7.0/paddlex/inference/utils/official_models.py)
- [PP-OCRv6 medium detection model card at fixed commit](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det/blob/8e0f56fb2ef86b461d99cfc7ac5c137738985f61/README.md)
- [PP-OCRv6 medium detection fixed tree metadata](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_det/tree/8e0f56fb2ef86b461d99cfc7ac5c137738985f61?recursive=true&expand=true)
- [PP-OCRv6 medium recognition model card at fixed commit](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec/blob/e5a92bcbc5cc1b494628e458d267778f0704fd7c/README.md)
- [PP-OCRv6 medium recognition fixed tree metadata](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_rec/tree/e5a92bcbc5cc1b494628e458d267778f0704fd7c?recursive=true&expand=true)
- [PaddleOCR 3.7.0 PyPI artifacts](https://pypi.org/project/paddleocr/3.7.0/)
- [PaddleX 3.7.0 PyPI artifacts](https://pypi.org/project/paddlex/3.7.0/)
- [PaddlePaddle 3.1.1 PyPI artifacts](https://pypi.org/project/paddlepaddle/3.1.1/)
- [PaddleOCR Apache-2.0 license](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/LICENSE)
- [PaddleX Apache-2.0 license at v3.7.0](https://github.com/PaddlePaddle/PaddleX/blob/v3.7.0/LICENSE)
- [PaddlePaddle Apache-2.0 license](https://github.com/PaddlePaddle/Paddle/blob/v3.1.1/LICENSE)
- [PaddlePaddle macOS installation boundary](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/macos-pip_en.html)
- [opencv-contrib-python 4.10.0.84 artifacts and packaging notes](https://pypi.org/project/opencv-contrib-python/4.10.0.84/)
- [opencv-python license at release 84](https://github.com/opencv/opencv-python/blob/84/LICENSE.txt)
- [opencv-python third-party licenses at release 84](https://github.com/opencv/opencv-python/blob/84/LICENSE-3RD-PARTY.txt)
- [OpenCV 4.13 change log](https://github.com/opencv/opencv/wiki/OpenCV-Change-Logs#version4130)
- [OpenCV 4.10 security policy](https://github.com/opencv/opencv/blob/4.10.0/SECURITY.md)
- [Python 3.11.16 release](https://www.python.org/downloads/release/python-31116/)
- [CPython 3.11.16 license](https://github.com/python/cpython/blob/v3.11.16/LICENSE)
- [Docker Official Image: Python](https://hub.docker.com/_/python)
- [Docker Official Image tag metadata](https://hub.docker.com/v2/repositories/library/python/tags/3.11.16-slim-bookworm)

PyPI/file hashes、Hugging Face fixed tree/LFS OID 和 OCI manifests 是官方分发元数据；Issue #228 已在仓库外取证目录下载并
复核六个顶层 wheel 与两份权重，Issue #230 只读复核模型参数身份和两架构 resolver graph，Git 不接收这些二进制或 report。
用于 fixed model identity/license 的模型卡与 tree Evidence 固定到 commit；Docker tag metadata 是 2026-08-22 的取证入口且
仍可漂移，实际运行身份只能使用上表已记录的 architecture-specific digest。源码 tag、wheel、模型参数和 BOS tar 是不同
制品，任一 tag commit 或参数 LFS OID 都不能替代 tar SHA-256，也不能自动解决 tar 再分发边界。

## 7. Acceptance 与停止条件

Fidelity-C5 合并只表示本合同 designed/locked，不表示 environment ready。environment implementation acceptance 前必须全部满足：

1. PP-OCRv6 exact model parameters 已绑定第一方许可，且 BOS tar 的复制/再分发边界由 archive-specific 官方 Evidence 解除；
2. 两种 architecture 的完整 transitive lock 均通过 `--require-hashes`，canonical Linux/amd64 lane 可离线构建；
3. 官方 metadata 要求的 OpenCV distribution、版本与两架构 wheel 已获明确安全/许可证接受，随附 FFmpeg/Qt obligations
   有逐 artifact 计划，image-only 限制可测试且不靠 `--no-deps` 或 metadata override；
4. external cache manifest、dataset identity、blind inference/scoring 和 negative controls 有 TDD 合同；
5. Owner 尚未接受阈值时，harness 不得产生 `passed`。

Issue #228 已实现 synthetic-only 的 alias/input validator、blind raw Evidence、双层 axis/dimension scoring 与 negative controls。
测试 lock 必须显式声明 `synthetic_contract_only`，validator 只能返回 `synthetic_contract_validated`；任意只有格式正确的外部
lock、假 dependency hash 或 OCI digest 都不能得到 `environment_validated`。真实 environment 状态必须等待完整 lock/cache/runtime
Evidence 和本节阻断解除后另行开放。上述代码只有随对应 PR 合并进入 `main` 后才计为 repository implemented；它们不解除
上述 artifact gate。C5a 已证明 exact 模型参数许可与唯一官方 dependency graph，但 BOS archive 再分发和 OpenCV contrib
4.10 随附组件的许可/安全接受仍未满足，故环境配置明确保持 blocked，不提交 accepted requirements lock、不安装或运行模型。解除阻断、形成
完整 cache 与离线安装 Evidence 后还需独立 Review，之后才可另行授权本地 accepted benchmark。`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 持续到 benchmark Evidence、
Reviewer 复核和 Owner capability/policy/阈值 acceptance 全部完成。

## 8. 本轮边界

Issue #228 的仓库外 audit 下载了六个官方 wheel 和两份权重，仅用于 exact identity、archive、license 与依赖解析；Issue #230
仅使用现有只读取证 artifact、官方公开 metadata 和无安装 resolver report，没有新增下载、安装 PaddleOCR/OpenCV/PaddlePaddle，
也没有运行模型或 accepted benchmark。仓库实现只运行 synthetic fixture smoke，不能
读取 accepted annotation/review，也不能输出 `passed`。没有调用外部模型/API、访问 Hifly/Provider、启动 Worker/Local Agent、
SSH/部署、修改生产数据、创建候选/工单/视频或消耗积分。Git 未接收 dataset bytes、图片、annotation/review JSON、权重、
wheel、缓存、候选 lock、本机绝对路径或真人身份。
