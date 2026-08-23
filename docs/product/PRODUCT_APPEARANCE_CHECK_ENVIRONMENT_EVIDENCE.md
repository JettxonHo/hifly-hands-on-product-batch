# 商品外观检查环境官方 Evidence 复核

> Evidence 日期：2026-08-23（Asia/Shanghai）
> 工作类型：strict docs-only / public first-party evidence research
> 关联合同：[`PRODUCT_APPEARANCE_CHECK_BENCHMARK_HARNESS_CONTRACT.md`](PRODUCT_APPEARANCE_CHECK_BENCHMARK_HARNESS_CONTRACT.md)
> 当前环境结论：`BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`
> 当前能力结论：`BLOCKED_CHECK_CAPABILITY_UNSELECTED`
> 本文不构成法律意见，也不构成 environment、benchmark、capability 或发布 acceptance。

## 1. Executive conclusion

本轮没有形成 accepted environment lane，也不得生成 D-037。

1. **PP-OCRv6 BOS archives：部分核对，仍 blocked。** PaddleOCR v3.7.0 的第一方 model list 确实把
   `PP-OCRv6_medium_det` / `PP-OCRv6_medium_rec` 指向合同中的两个 exact BOS URL。2026-08-23 对 URL 只发起
   `HEAD`，服务器 `Content-Length` 分别为 `62279680` 与 `76851200`，与合同 bytes 相同；服务器没有发布 SHA-256，
   ETag 与 CRC 字段不能替代 SHA-256。合同中的 archive SHA-256 仍是既有仓库外取证值，不是官方发布值，本轮也没有下载
   archive 重新计算。
2. **模型参数身份与许可：可绑定到 exact parameter bytes。** PaddlePaddle 官方 Hugging Face 模型仓库的固定 commit
   对 `inference.pdiparams` 发布了 LFS SHA-256；det/rec 分别与合同记录的 tar 内参数 SHA-256 相同。两个固定模型卡均声明
   `license: apache-2.0`。这是 exact 参数 bytes 的第一方许可 Evidence。
3. **BOS archive 的复制/再分发边界：`UNKNOWN`。** 固定模型仓库 tree 没有独立 `LICENSE` / `NOTICE`，官方 BOS 响应没有
   archive SHA-256、内容清单或许可字段；已核对的第一方文档没有把 Apache-2.0 明确绑定到两个 exact tar object，也没有
   archive-specific 复制/镜像/再分发说明。不得把模型卡许可自动外推为整个 BOS tar 的再分发授权。
4. **OpenCV contrib wheels：identity 已核对，许可与安全 acceptance 未完成。** PyPI 官方 metadata 的两个 exact wheel
   bytes/SHA-256 与合同一致。release `84` 的第一方仓库说明 wrapper scripts 为 MIT、OpenCV binary 为 Apache-2.0，固定
   `LICENSE-3RD-PARTY.txt` 说明所有 wheels 带 FFmpeg，非 headless Linux/macOS packages 带 Qt5，并列出更多平台相关组件。
   这些义务不会因 runtime 只允许静态图片而消失。
5. **OpenCV 4.10 安全结论：不接受。** release `84` 固定到 OpenCV 4.10.0 source commit。CVE-2025-53644 的官方
   版本范围包含 OpenCV 4.10.0 和 4.11.0，GitHub Security Lab 将其绑定到 JPEG 2000 `imdecode` 的堆写，修复于 4.12
   发布；4.13 固定 changelog 又记录了更多 PNG/BMP 溢出和崩溃修复。未找到这些修复回移到 exact 4.10 wheel 的官方
   Evidence，因此不能把该 wheel 记为 accepted static decoder。
6. **完整依赖许可锁：未形成。** 两份 resolver report 可规范化为 Linux 64 条、macOS 62 条 `name==version` 记录，
   但没有锁定各 target 实际选择的 wheel/source、hash、wheel 内第三方许可和 native graph。官方 PyPI release metadata
   只能作为候选清单，不能代替完整离线 lock、SBOM 或 Owner/legal acceptance。

## 2. 方法、术语与边界

本轮只读取 Git 仓库文档、官方网页、文本/JSON metadata，以及对两个 BOS URL 的 HTTP `HEAD` 响应：

- 没有对模型或 wheel URL 发起 artifact body 下载；
- 没有安装 PaddleOCR、PaddleX、PaddlePaddle、OpenCV 或其他依赖；
- 没有读取 accepted dataset、annotation 或 review；
- 没有运行 benchmark、模型、harness、Provider、Hifly、Worker 或生产流程；
- 没有创建 cache、requirements lock、accepted lane、decision 或 D-037。

本文严格使用三种证据等级：

- **FACT**：官方/一手公开来源直接陈述或发布的事实，或仓库合同中待核对的精确值；
- **INFERENCE**：由多个 FACT 推导出的结论，明确写出推导边界；
- **UNKNOWN**：公开证据不足，不能用经验、相似 artifact、源码许可证或 runtime 禁令补齐。

所有会漂移的 HTTP metadata、发布状态、tree 内容和安全状态均按 **2026-08-23** 观察，并在对应条目给出直接 URL。

## 3. PP-OCRv6 exact archives

### 3.1 合同 bytes/SHA 与官方 BOS object

| Artifact | 合同值 | 2026-08-23 官方公开核对 | 证据等级 |
|---|---|---|---|
| `PP-OCRv6_medium_det_infer.tar` | `62279680` bytes；SHA-256 `144d0621e059566e5086e228829171591c144c2deb07b2dad4962214fbabfcf7` | PaddleOCR v3.7.0 model list 指向 [exact BOS URL](https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_medium_det_infer.tar)；`HEAD` 返回 `200`、`Content-Length: 62279680`、`Last-Modified: Tue, 09 Jun 2026 02:35:55 GMT`。响应没有 SHA-256。 | URL/bytes/headers：**FACT**；合同 SHA：**FACT（repository contract）**；当前 BOS object 的 SHA-256 等于合同 SHA：**UNKNOWN** |
| `PP-OCRv6_medium_rec_infer.tar` | `76851200` bytes；SHA-256 `4eecc1c6a4623765042e6fc15446da0da110b7d875b6b72b2d351d2b2dbd4da6` | PaddleOCR v3.7.0 model list 指向 [exact BOS URL](https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_medium_rec_infer.tar)；`HEAD` 返回 `200`、`Content-Length: 76851200`、`Last-Modified: Tue, 09 Jun 2026 02:35:55 GMT`。响应没有 SHA-256。 | URL/bytes/headers：**FACT**；合同 SHA：**FACT（repository contract）**；当前 BOS object 的 SHA-256 等于合同 SHA：**UNKNOWN** |

第一方固定版本入口：2026-08-23 核对的
[PaddleOCR v3.7.0 model list](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/model_list.md)
在文本检测与文本识别表中分别列出上述模型名和 exact BOS URL。

**事实边界：** 相同 `Content-Length` 不能证明内容相同；BOS 的 ETag、`x-bce-content-crc32`、
`x-bce-content-crc32c` 和 `x-bce-content-crc64ecma` 也不是合同要求的 SHA-256。由于本轮禁止下载，不能用当前响应重新计算
archive SHA-256。因此本轮不能把“合同 SHA 已由官方重新核对”写为 FACT。

### 3.2 PaddlePaddle fixed model repository / LFS identity

| Model | 2026-08-23 固定第一方 Evidence | 证据等级 |
|---|---|---|
| `PP-OCRv6_medium_det` | 固定 commit `8e0f56fb2ef86b461d99cfc7ac5c137738985f61`；[model API](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_det/revision/8e0f56fb2ef86b461d99cfc7ac5c137738985f61) 的 `cardData.license=apache-2.0`；[tree API](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_det/tree/8e0f56fb2ef86b461d99cfc7ac5c137738985f61?recursive=true&expand=true) 给出 `inference.pdiparams` size `61960476`、LFS OID/SHA-256 `85218d2e3d98f5a21c58b4220627be923a97aee5db3cc71f39536ab31ac53960`。 | commit、license metadata、size、LFS OID：**FACT** |
| `PP-OCRv6_medium_rec` | 固定 commit `e5a92bcbc5cc1b494628e458d267778f0704fd7c`；[model API](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_rec/revision/e5a92bcbc5cc1b494628e458d267778f0704fd7c) 的 `cardData.license=apache-2.0`；[tree API](https://huggingface.co/api/models/PaddlePaddle/PP-OCRv6_medium_rec/tree/e5a92bcbc5cc1b494628e458d267778f0704fd7c?recursive=true&expand=true) 给出 `inference.pdiparams` size `76465087`、LFS OID/SHA-256 `1b01c79a914587933f615569e75de54f2e638ebb5d3f3b3c1b38c24ede8c7319`。 | commit、license metadata、size、LFS OID：**FACT** |

两个 fixed tree 在 2026-08-23 均只列 `.gitattributes`、`README.md`、`inference.json`、
`inference.pdiparams`、`inference.yml`，没有独立 `LICENSE` 或 `NOTICE`。模型卡 metadata 的 Apache-2.0 声明仍是有效第一方
许可 Evidence；tree 中没有独立许可文件则是需要保留的 provenance/notice 风险，不应被隐藏。

合同记录的 tar 内参数 SHA-256 与上述 LFS OID 一致。由此可作以下有界推断：

- **INFERENCE：** 如果 Issue #230 既有 tar extraction/hash 记录可信，则当时 tar 内的 exact `inference.pdiparams`
  与 fixed PaddlePaddle model repository 的参数 bytes 相同，参数 bytes 受模型卡声明的 Apache-2.0 约束。
- **UNKNOWN：** 2026-08-23 当前 BOS object 是否仍具有合同 archive SHA-256；本轮没有下载 archive，官方也未发布 SHA-256。
- **UNKNOWN：** Apache-2.0 是否由 PaddlePaddle 明确应用于整个 BOS tar，包括 archive packaging、`inference.yml`、
  `inference.json` 和任何 archive-level notice。fixed model card/LFS identity 不能单独回答该问题。

### 3.3 复制与再分发边界

[Apache License 2.0 正文](https://www.apache.org/licenses/LICENSE-2.0)允许在满足条件时复制和分发受该许可证覆盖的作品，
包括向接收者提供许可证副本、标示修改、保留相关 notices，以及在作品包含 NOTICE 时传递相应 attribution。

这里必须区分两件事：

1. **FACT：** fixed model card 对 exact parameter identity 声明 Apache-2.0。
2. **UNKNOWN：** exact BOS archive 是否是同一被许可作品，以及 archive-specific LICENSE/NOTICE、官方 SHA-256/内容清单和
   镜像/随产品再分发边界是什么。

因此当前状态保持 `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`。在上游补齐 archive-specific Evidence 前，不得把
两个 tar 提交 Git、打进容器/image、镜像到自有 object storage、放入离线 cache 分发，或随产品交付。仅把 BOS URL 写进文档
不等于复制 artifact；后续是否允许运行时直接 fetch 仍需 Owner 明确选择部署/许可边界，并另过网络、完整性和可复现性 gate。

## 4. `opencv-contrib-python==4.10.0.84`

### 4.1 两架构 exact wheel identity

以下时效事实均于 2026-08-23 从
[PyPI release JSON](https://pypi.org/pypi/opencv-contrib-python/4.10.0.84/json)核对；两个文件均为 `yanked=false`。

| Target | Exact wheel | Bytes | SHA-256 | 直接 artifact URL（本轮未下载） |
|---|---|---:|---|---|
| Linux x86_64 / manylinux2014 | `opencv_contrib_python-4.10.0.84-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl` | `68681489` | `a261223db41f6e512d76deaf21c8fcfb4fbbcbc2de62ca7f74a05f2c9ee489ef` | [files.pythonhosted.org exact file](https://files.pythonhosted.org/packages/b0/e0/8f5d065ebb2e5941d289c5f653f944318f9e418bc5167bc6a346ab5e0f6a/opencv_contrib_python-4.10.0.84-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl) |
| macOS arm64 | `opencv_contrib_python-4.10.0.84-cp37-abi3-macosx_11_0_arm64.whl` | `63667391` | `ee4b0919026d8c533aeb69b16c6ec4a891a2f6844efaa14121bf68838753209c` | [files.pythonhosted.org exact file](https://files.pythonhosted.org/packages/92/64/c1194510eaed272d86b53a08c790ca6ed1c450f06d401c49c8145fc46d40/opencv_contrib_python-4.10.0.84-cp37-abi3-macosx_11_0_arm64.whl) |

PyPI metadata 对 project 顶层填写 `License: Apache 2.0`，但 publisher 的 fixed release 文档给出更细的分层：

- [release 84 README](https://github.com/opencv/opencv-python/blob/84/README.md)声明 wrapper/package scripts 为 MIT、OpenCV 本体为
  Apache-2.0，并要求查阅第三方许可证；
- [release 84 MIT license](https://github.com/opencv/opencv-python/blob/84/LICENSE.txt)适用于 packaging repository scripts；
- [OpenCV 4.10.0 license](https://github.com/opencv/opencv/blob/4.10.0/LICENSE)是 OpenCV binary 的 Apache-2.0 来源；
- [release 84 setup.py](https://github.com/opencv/opencv-python/blob/84/setup.py)把 `LICENSE.txt` 与
  `LICENSE-3RD-PARTY.txt` 配置进 `cv2` package data；
- [release 84 third-party license inventory](https://github.com/opencv/opencv-python/blob/84/LICENSE-3RD-PARTY.txt)
  才是平台组件和许可文本的第一方 packaging Evidence。

### 4.2 Source identity

2026-08-23 核对的 [opencv-python annotated tag `84`](https://github.com/opencv/opencv-python/releases/tag/84)
指向 packaging commit `cce7c994d46406205eb39300bb7ca9c48d80185a`，release message 为 OpenCV 4.10.0 / NumPy 2.0 support；
该 tree 固定：

- OpenCV submodule commit `71d3237a093b60a27601c20e9ee6c3e52154e8b1`，即
  [OpenCV 4.10.0 release commit](https://github.com/opencv/opencv/commit/71d3237a093b60a27601c20e9ee6c3e52154e8b1)；
- opencv_contrib submodule commit `1ed3dd2c53888e3289afdb22ec4e9ebbff3dba87`。

这是 **FACT**：release `84` 的构建源码身份固定在 OpenCV/OpenCV-contrib 4.10.0 代际。它不证明两个 wheel 的每个 native
binary 与 build flag，也不替代 wheel 内文件级 SBOM。

### 4.3 官方许可与第三方义务

release `84` 的 fixed `LICENSE-3RD-PARTY.txt` 对两个 non-headless contrib wheel 给出以下至少义务面：

| 范围 | Linux x86_64 wheel | macOS arm64 wheel | 证据/边界 |
|---|---|---|---|
| Wrapper / OpenCV | packaging scripts MIT；OpenCV binary Apache-2.0 | 同左 | **FACT**；分发时保留适用 license/copyright/notice |
| FFmpeg | 所有 opencv-python packages 均带 FFmpeg，publisher README 标为 LGPLv2.1 | 同左；fixed inventory 另列一组 macOS FFmpeg 相关 libraries | **FACT**；禁用 video/codec runtime 不取消 binary distribution 义务 |
| Qt5 | fixed inventory 说明 non-headless Linux packages 带 Qt5，LGPLv3 | fixed inventory 同时明确 non-headless macOS packages 带 Qt5，LGPLv3 | **FACT**；README 摘要只点名 Linux，fixed inventory 的平台声明更完整 |
| 其他平台组件 | 至少包括 Linux 相关的 libvpx、bzip2、libcrypto/libssl、freetype、libpng、libz、libwebp、xcb family，以及 inventory 中标为 all-packages/build-option 的组件 | 另列 libgmp、libidn2、libunistring、fontconfig、dav1d、ffi、ogg/openjp2/opus/rav1e/snappy/speex/srt/theora/vorbis 等，以及共同组件 | **FACT（publisher inventory）**；该清单宽于一个 wheel 的已启用 binary graph，exact inclusion/build flags 仍需 wheel/SBOM 复核 |
| License files in exact wheel | `setup.py` 声明应包含两个 license 文件 | 同左 | build intent：**FACT**；本轮未下载 wheel，exact wheel 内是否存在且内容是否逐字一致：**UNKNOWN** |

若项目复制或再分发 wheel/container，最低 obligations plan 不能只保存 PyPI 顶层 `License: Apache 2.0`。至少需要：

1. 随交付保留并可访问 MIT、Apache-2.0 和完整第三方 notices；
2. 对 FFmpeg/Qt 及其他 LGPL 组件确定适用版本、链接方式、对应源码取得方式、修改情况、relink/installation information 与
   notice 传递方式，并由 Owner 指定的法律/开源合规角色接受；
3. 对 BSD/MIT/Apache/其他组件逐项保留版权、许可、免责声明及适用 attribution，不用聚合标签替代；
4. 记录 exact wheel SHA、wheel 内 binary/dependency inventory、source revision 和 source-offer/下载入口的不可变绑定；
5. 区分“内部安装使用”“把 wheel 放入离线 cache”“把 wheel 放入镜像并交付”三种行为。它们的复制/分发事实不同，不能由
   image-only runtime policy 统一抹平。

这是工程合规最小清单，不是对 LGPL/Apache 条款的最终法律解释。

### 4.4 OpenCV 4.10 security Evidence

2026-08-23 可取得的第一方证据如下：

| Evidence | FACT | 对本 lane 的含义 |
|---|---|---|
| [OpenCV 4.10.0 release](https://github.com/opencv/opencv/releases/tag/4.10.0) | 4.10.0 于 2024-06-03 发布，source commit 固定为 `71d3237...`。 | 证明版本身份，不是安全认证。 |
| [OpenCV 4.10 SECURITY.md](https://github.com/opencv/opencv/blob/4.10.0/SECURITY.md) | 只给 `security@opencv.org` 报告流程和 PGP key；没有 supported-version matrix、EOL、已修复 advisory 列表或“4.10 无漏洞”声明。 | 不足以作为 4.10 acceptance。 |
| [NVD CVE-2025-53644 JSON](https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2025-53644) / [GHSL-2025-057](https://securitylab.github.com/advisories/GHSL-2025-057_OpenCV/) | 官方版本范围为 4.10.0（含）至 4.12.0（不含）；恶意构造的 JPEG 2000 输入可经 `imdecode` 触发堆写；上游修复由 [commit `a39db413`](https://github.com/opencv/opencv/commit/a39db41390de546d18962ee1278bd6dbb715f466) 进入 4.12。 | exact 4.10 source 属于已知受影响范围；本轮没有可证明的 backport。 |
| [OpenCV 4.13 changelog（固定 revision）](https://github.com/opencv/opencv/wiki/OpenCV-Change-Logs/e69f11cb5f61be10fbe549381161c3bf0b69fafb#version4130) | 4.13 记录 BMP overflow/out-of-bounds、PNG fuzzer crash/overflow、AVIF safety checks，以及 stackBlur heap overflow、bilateralFilter out-of-bounds read 等修复。 | 这些修复与静态图片 decode/process threat surface 重叠，不能假设 4.10 已安全等价。 |
| [BMP overflow PR #28040](https://github.com/opencv/opencv/pull/28040)、[PNG fuzzer PR #27529](https://github.com/opencv/opencv/pull/27529)、[PNG overflow PR #28249](https://github.com/opencv/opencv/pull/28249) | 三个第一方 PR 分别绑定 4.13 milestone，且创建时间晚于 4.10 release。 | **FACT：** 修复存在于后续开发线；**UNKNOWN：** exact wheel 的具体可利用性、严重度、输入前提和所有回移状态。 |

未找到 OpenCV/opencv-python 官方公开来源声明这些后续修复全部 backport 到 4.10.0 / wheel `4.10.0.84`。也未找到该 exact
wheel 的 publisher security attestation、SBOM、VEX 或“image-only 使用无风险”证明。

因此只能作以下结论：

- **FACT：** exact wheels 使用 OpenCV 4.10.0 source identity；CVE-2025-53644 将 4.10.0 列为受影响版本，官方后续版本还存在与静态图像相关的健壮性/内存安全修复。
- **INFERENCE：** 对不可信商品图执行 decode/process 时，4.10 lane 需要独立威胁模型、format allowlist、资源上限、sandbox 和
  upstream/backport 评估；仅禁止 video/GUI/FFmpeg 调用不覆盖 imgcodecs/imgproc 风险。
- **UNKNOWN：** 本项目 exact PNG/JPEG 输入对后续 PNG/BMP 修复是否可达、wheel build 实际启用哪些 codec、传递 native
  library 版本及其 advisory 状态，以及 runtime controls 能否把 exact 4.10 风险降到 Owner 可接受范围。
- **禁止结论：** 不得把格式 allowlist、image-only policy 或 sandbox 写成对已知受影响版本的自动豁免，也不得把后续
  每一项修复都自动标记为本项目已确认可利用。

### 4.5 两架构 resolver 与许可 graph

Issue #230 的仓库外 no-install reports 保持以下不可变身份：

- Linux/amd64 report SHA-256 `13261371db551c8ee5603a66fe011adee52cb1b191bb0bf2b09966ce3a349327`；
- macOS/arm64 report SHA-256 `4ff7e2df45801c12e5e725159d365fd8ba347a28acae000bdf29c3c26045418c`。

Issue #232 按 report 中规范化的 `name==version` 记录重算为 Linux 64 条、macOS 62 条，共 64 个 distribution 名；62 个
两架构共有，Linux 另有 `pytz` / `tzdata`，`numpy`、`pandas`、`pillow` 的版本跨架构不同。旧文档的 65/63
artifact 计数不是这一 package-record 口径，也不能作为 exact selected artifact lock。

对 67 个 exact version row 的官方 PyPI release JSON 做了只读 metadata 快照，仓库外 snapshot 为 `817217` bytes、
SHA-256 `1c9edf3003a4dfbf8ffd544860bd76e468e6c5ee5af7fda11b08659004c97c58`；它枚举的是每个 release 的全部候选文件，
不是 resolver 对两个 target 实际选择的文件。顶层 metadata 至少暴露这些需要继续处理的边界：

- `crc32c` 声明 LGPLv2+，`python-bidi` 声明 LGPL；
- `pypdfium2` 明确要求二进制分发同时履行 PDFium 及其依赖的许可义务；
- `fsspec` 的该 PyPI 顶层 license 为空，而固定源码声明 BSD-3-Clause；
- `opencv-contrib-python` 的顶层 Apache-2.0 不能覆盖 wheel 内 FFmpeg、Qt5 与其他第三方组件。

因此当前只有 **metadata graph 可解** 的 Evidence，没有两架构 exact selected wheel/source URL、bytes/SHA、inside-wheel
LICENSE/NOTICE、native dependency/SBOM 与 source-offer 绑定，也没有可供 `--require-hashes` 离线安装的完整 graph。
这保持 `TRANSITIVE_ARTIFACT_CACHE_AND_OFFLINE_REQUIRE_HASHES_INSTALL_UNVERIFIED`。

### 4.6 待接受的 image-only 可测试边界

下列内容只是后续安全决策的最小输入，不是本轮已实现或已接受的 control：

1. 输入只能来自 manifest 精确绑定的普通文件；拒绝 symlink、路径逃逸、hash/media/dimensions/magic 不一致。
2. 允许格式必须由 Owner 安全 acceptance 明列；若只允许 PNG/JPEG，则 JP2/BMP/TIFF/WebP/GIF/EXR/HDR/PDF 与所有视频均拒绝，
   不能在错误时回退到其他 codec。
3. 在 decode 前执行 bytes、dimensions、pixels 限额；运行时另有 CPU/time/memory 限额，并以 bounded bytes 调用静态
   `imdecode` / versioned preprocessing，不接受 URL、任意路径、camera、video capture、GUI 或 codec 命令。
4. canonical lane 必须 network-none、非特权、只读文件系统且输出隔离；negative controls 覆盖畸形头、解压炸弹、截断、
   超限、错误 magic、禁止格式、资源耗尽与 decoder 异常，任何未知均 fail closed。

即使这些 control 将来通过 TDD，也不会删除 wheel 中 FFmpeg/Qt 的分发义务，更不能自动消除 exact 4.10 的已知受影响版本事实。

## 5. Decision matrix

| 问题 | FACT | INFERENCE | UNKNOWN / 决定 |
|---|---|---|---|
| BOS archive identity | 官方 model list 给出 exact URL；2026-08-23 `HEAD` bytes 与合同相同 | URL/length 支持对象候选未明显换名/换尺寸 | 官方未发布 archive SHA-256；当前 bytes 是否仍等于合同 SHA：UNKNOWN |
| Model parameter identity | fixed LFS OID 与合同记录的 tar 内 parameter hash 相同；model cards Apache-2.0 | 既有 extraction 可信时，exact parameter bytes 已绑定第一方许可 | 当前 tar 内容未重算；archive metadata/packaging 许可仍 UNKNOWN |
| BOS redistribution | 没有找到 archive-specific LICENSE/NOTICE/hash/manifest/redistribution statement | 不应将 model-card license 外推到 tar | 保持 `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED` |
| Wheel identity | PyPI exact filenames/bytes/SHA 与合同一致 | 可作为后续 artifact allowlist 候选 | 没有安装、wheel-body inspection 或 runtime proof |
| Wheel licensing | fixed publisher repo 给出 MIT/Apache 与完整第三方 inventory；FFmpeg/Qt 明确存在于对应 package 类别 | 再分发必须形成逐 artifact obligations plan | exact wheel binary/SBOM/source-offer fulfillment 尚未复核/接受 |
| OpenCV 4.10 security | source identity 固定；CVE-2025-53644 明确包含 4.10.0；后续官方图像修复存在 | 静态 image-only 限制不能单独解除风险 | backports、codec graph、Owner risk acceptance 未完成，保持不接受 |
| Transitive graph | no-install reports 可复核为 64/62 条 package records；官方 release metadata 可枚举 | metadata graph 可解不等于 exact selected artifact/license lock | exact target file/hash、wheel 内许可、native graph 与 obligations plan 未完成 |
| Environment | 合同和 artifact metadata 可继续用于 blocked evidence | 不能据此进入 materialization | 不创建 accepted lane，不开始 C5b，不运行 benchmark，不生成 D-037 |

## 6. Stop condition 与最小 Owner/上游输入

在下列输入全部到位并经独立 Review 前，必须停止于 docs-only Evidence，不得下载/安装 artifact、建立完整 cache、运行 model 或
accepted benchmark，也不得把环境状态改为 ready：

### 6.1 PP-OCRv6 最小输入

至少满足一个经 Owner 选择并接受的路线：

1. **上游 archive 路线：** PaddlePaddle/Baidu 对两个 exact BOS object 提供 archive-specific、可归档的许可声明，明确
   LICENSE/NOTICE、复制/缓存/镜像/再分发边界，并发布官方 SHA-256 与内容清单；或
2. **Owner 改变 artifact 路线：** 明确决定不使用/不再分发 BOS tar，改为 fixed official model repository 的 exact files，
   由上游或 Owner 指定合规角色确认模型卡许可适用范围，并重新定义 artifact manifest、下载来源、SHA-256、NOTICE 与可复现
   package 边界。该路线是新的合同输入，不因本文自动成立。

如果 Owner 只允许运行时直连 BOS、不做自有 cache/镜像，还必须给出这一网络/可复现性取舍的明确授权和失败关闭要求；它不能
解除官方 SHA-256 缺失，也不能满足当前 offline environment 合同。

### 6.2 OpenCV contrib 最小输入

1. Owner 明确部署/分发形态：仅内部运行、离线 cache、内部容器、还是向第三方交付；指定法律/开源合规责任人接受 FFmpeg、Qt5
   和其他固定 inventory 的义务方案。
2. 上游或获授权的后续 artifact audit 提供两个 exact wheel 的文件清单、native dependency graph、build flags、内置组件版本、
   SBOM/VEX 或等价 Evidence，并验证 wheel 内 LICENSE/NOTICE；仍不得以 PyPI 顶层 license 替代。
3. OpenCV/opencv-python/PaddleX 上游提供受支持的 patched version/backport statement，或 Owner 基于独立安全评估明确接受
   exact 4.10 risk；若改版本/distribution，必须先由 PaddleX 官方 metadata 或新的合同证明兼容，不能使用 `--no-deps`、
   metadata override 或 distribution 等价假设。
4. Owner 提供最小静态输入政策：允许的 magic/codec、最大 bytes/dimensions/pixels、解码资源上限、不可信输入边界、sandbox 与
   fail-closed 行为。无需提供或读取 accepted dataset bytes。
5. 完整 transitive artifact/source/hash/license plan 无未决项后，才可另行授权 C5b materialization；C5b 仍只允许 synthetic
   smoke。真实 accepted benchmark 必须在 C5b、独立 Review 和新的 Owner 明确授权之后。

## 7. Final status

- `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`
- `OPENCV_CONTRIB_4_10_LICENSE_OBLIGATIONS_UNACCEPTED`
- `OPENCV_CONTRIB_4_10_IMAGE_SECURITY_UNACCEPTED`
- `TRANSITIVE_ARTIFACT_CACHE_AND_OFFLINE_REQUIRE_HASHES_INSTALL_UNVERIFIED`
- `BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`
- `BLOCKED_CHECK_CAPABILITY_UNSELECTED`

**Stop.** 本文只建立 successor Evidence，不建立 accepted lane，不授权 C5b，不生成 D-037。
