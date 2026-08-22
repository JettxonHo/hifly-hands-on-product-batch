# Fidelity-C5a 权重许可与依赖通道 Evidence Gate

> 日期：2026-08-22
> 基线：`origin/main@4e352334374fee6a077fb95a599944239b12f5c1`
> 关联：Issue #230 / 对应 Draft PR
> 生命周期：Owner 已授权 C5a Evidence 方向；对应 PR 是本结论的 acceptance gate，只有合并进入 `main` 后才计为 accepted
> 结论：docs-only blocker；未形成 accepted environment lane

## 1. 目标与范围

本会话只复核 PP-OCRv6 medium det/rec 权重的第一方许可与再分发边界，并使用官方 metadata 对 Linux/amd64、
macOS/arm64 两个无安装依赖图进行比较。Issue #228 / PR #229 已合并，只提供 synthetic contract；本会话没有复用
旧分支，也没有把 synthetic smoke 写成真实环境。

严格文件范围：

- `docs/product/PRODUCT_APPEARANCE_CHECK_BENCHMARK_HARNESS_CONTRACT.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-22-fidelity-c5a-license-dependency-lane.md`

## 2. PP-OCRv6 权重 Evidence

仓库外既有只读取证 artifact 与合同记录一致：

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `PP-OCRv6_medium_det_infer.tar` | 62279680 | `144d0621e059566e5086e228829171591c144c2deb07b2dad4962214fbabfcf7` |
| `PP-OCRv6_medium_rec_infer.tar` | 76851200 | `4eecc1c6a4623765042e6fc15446da0da110b7d875b6b72b2d351d2b2dbd4da6` |

官方 PaddleOCR v3.7 文档给出这两个 BOS 下载入口；PaddleX v3.7 的 official model mapping 同时把相同模型名映射到
PaddlePaddle 官方 Hugging Face 模型仓库。只读展开后的精确参数绑定为：

| Model | tar 内参数 SHA-256 | 官方固定模型仓库 Evidence |
|---|---|---|
| det | `85218d2e3d98f5a21c58b4220627be923a97aee5db3cc71f39536ab31ac53960` | commit `8e0f56fb2ef86b461d99cfc7ac5c137738985f61` 的 `inference.pdiparams` LFS OID 相同 |
| rec | `1b01c79a914587933f615569e75de54f2e638ebb5d3f3b3c1b38c24ede8c7319` | commit `e5a92bcbc5cc1b494628e458d267778f0704fd7c` 的 `inference.pdiparams` LFS OID 相同 |

两个固定模型卡均由 PaddlePaddle 发布并声明 `license: apache-2.0`。这建立了 exact 参数 bytes 的第一方模型许可，
不是把 PaddleOCR 源码许可证外推给权重。

硬阻断仍在 archive 层：BOS tar 没有 LICENSE/NOTICE；官方没有发布 tar 的 SHA-256、内容清单或 archive-specific
复制/再分发说明，模型仓库的 LICENSE 链接不可用。Apache-2.0 正文规定复制/再分发义务，但不能替代 artifact 许可绑定。
因此状态精确收敛为 `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`。本轮不把 tar 打包、镜像或随产品再分发。

## 3. Dependency lane Evidence

使用 Python 3.11 和官方 PyPI metadata 生成两份仓库外 no-install resolver report；没有安装任何包：

| Target | Artifact count | Report SHA-256 | 关键结果 |
|---|---:|---|---|
| Linux/amd64 manylinux2014 | 65 | `13261371db551c8ee5603a66fe011adee52cb1b191bb0bf2b09966ce3a349327` | `opencv-contrib-python==4.10.0.84` |
| macOS/arm64 | 63 | `4ff7e2df45801c12e5e725159d365fd8ba347a28acae000bdf29c3c26045418c` | `opencv-contrib-python==4.10.0.84` |

两份图都锁定 PaddleOCR 3.7.0、PaddleX 3.7.0、PaddlePaddle 3.1.1，且只有一个 `cv2` distribution。PaddleX
`ocr-core` metadata 精确要求 contrib 4.10；`opencv-python-headless==4.13.0.92` 是不同 distribution，不能用
`--no-deps`、metadata override 或 distribution 等价假设保留。

候选 contrib wheel identity：

| Target | Bytes | SHA-256 |
|---|---:|---|
| Linux x86_64 | 68681489 | `a261223db41f6e512d76deaf21c8fcfb4fbbcbc2de62ca7f74a05f2c9ee489ef` |
| macOS arm64 | 63667391 | `ee4b0919026d8c533aeb69b16c6ec4a891a2f6844efaa14121bf68838753209c` |

官方 opencv-python 资料要求同一环境只安装一个 `cv2` wheel。OpenCV core 为 Apache-2.0，packaging scripts 为 MIT；
所有 wheels 打包 FFmpeg LGPLv2.1，Linux 与 macOS non-headless wheels 均另打包 Qt5 LGPLv3。运行合同仍只允许本地静态栅格图像
decode/preprocess/measure，禁止 URL、PDF、目录、video capture、codec、FFmpeg、GUI 和 camera；但操作禁令不能抹去
二进制中实际打包的组件与许可义务。

官方资料没有提供“4.10 无漏洞”证明；OpenCV 4.13 change log 记录了多项图像内存安全修复，也没有 Evidence 证明已回移
至 4.10。本结论不反向宣称具体 CVE，只把安全接受记为未决。两份 resolver report 证明 graph 可解，不证明完整 transitive
artifact license plan、离线 cache、`--require-hashes` 安装或 runtime 兼容。

## 4. 决定与下一门

C5a 未满足全部 stop conditions，故不创建 D-037、不接受 speculative lane，也不开始 C5b。环境继续保持
`BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`，能力继续保持
`BLOCKED_CHECK_CAPABILITY_UNSELECTED`。

解除 C5a blocker 至少需要：

1. PaddlePaddle 提供 exact BOS tar 的 archive-specific LICENSE/NOTICE、官方 SHA-256/内容清单与明确复制/再分发边界；
2. 对 contrib 4.10 两架构 wheel 的 FFmpeg/Qt obligations、第三方许可、图像解码安全和静态 image-only 控制作独立接受；
3. 完整 transitive artifact/source/hash/license plan 无未决项，且不依赖 `--no-deps`、metadata override 或另一 OpenCV distribution。

全部解除后才能另行提出 C5b Offline Environment Materialization + synthetic smoke。C5b 合并与独立 Review 之后，真实
accepted benchmark 仍需新的明确授权。

## 5. 验证与边界

本会话核对了官方 PaddleOCR/PaddleX 固定版本源码、PaddlePaddle 固定模型卡/tree metadata、PyPI release metadata、
opencv-python fixed release license/third-party license 与 OpenCV change log。二进制和 resolver report 仅在 Git 外取证，
仓库文档不记录本机绝对路径。

本轮没有安装 PaddleOCR、PaddleX、PaddlePaddle 或 OpenCV，没有下载新权重、读取 accepted dataset/annotation/review、
编写或运行 benchmark、调用外部模型/API、访问 Hifly/Provider、启动 Worker/Local Agent、SSH/部署、修改生产数据、
创建候选/工单/视频或消耗积分。CI 只证明 docs/check 合同，不证明 environment、benchmark 或 capability。
