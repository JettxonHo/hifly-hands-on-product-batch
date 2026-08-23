# 2026-08-23 Fidelity-C5a patched lane 与 fixed model route Evidence

## 范围与生命周期

- 精确基线：`origin/main@eab7758af94253aa22dd057f943f55d226f597b3`。
- 跟踪：Issue #234；对应 Draft PR 是本轮 successor Evidence acceptance gate。
- Owner 路线：不接受 exact OpenCV 4.10 / CVE-2025-53644 风险，不批准复制、缓存、镜像或再分发缺
  archive-specific Evidence 的 BOS tar，也不虚构法律或开源合规责任人及其 acceptance。
- 只有对应 PR 合并进入 main 后，才计为本轮增量审计 accepted；不建立 D-037、accepted environment lane 或 C5b 授权。

严格 allowlist：

- `docs/product/PRODUCT_APPEARANCE_CHECK_ENVIRONMENT_EVIDENCE.md`
- `docs/product/PRODUCT_APPEARANCE_CHECK_BENCHMARK_HARNESS_CONTRACT.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-23-fidelity-c5a-patched-lane-evidence.md`

## 只读 gate

开始前确认 `origin/main` 精确为上述基线，PR #233 已合并、Issue #232 已关闭，且没有同主题在途 Issue/PR。主工作区旧
`gui/visual-refresh` 与脏改动未触碰；本轮使用独立 worktree/branch。

官方固定版本 Evidence 有真实增量，因此没有返回 `NO_NEW_EVIDENCE`：

1. PaddleOCR 最新固定 release 仍是 `v3.7.0`，要求 PaddleX `>=3.7,<3.8`；最新固定 PaddleX `v3.7.2` 的
   `ocr-core` 仍精确要求 `opencv-contrib-python==4.10.0.84`。`v3.7.0`、`v3.7.1` 与 `v3.7.2` 的固定 metadata
   均保持该 pin。
2. opencv-python release `94` 已发布基于 OpenCV 4.14.0 的 Linux/amd64 与 macOS/arm64 contrib/headless wheels，
   exact 文件名、bytes、SHA-256 与 source commits 可由固定 release/PyPI metadata 复核。NVD 的 CVE-2025-53644 范围为
   `>=4.10,<4.12`，所以 4.14 不在该特定范围内；这不是全部 image decoder 或 wheel 安全 acceptance。
3. PaddleX metadata 没有接受 contrib 4.14；headless 4.14 还是不同 distribution。手工替换任一项都需要
   `--no-deps`、metadata override 或 unsupported equivalence assumption，违反既有 stop condition。
4. release `94` 的固定第三方清单仍表明所有 packages 带 FFmpeg，non-headless Linux/macOS packages 带 Qt5；Owner 没有
   接受这些义务，patched version 的存在也不会消除许可与分发 gate。
5. 第一方 Hugging Face det/rec fixed tree 可固定到不可变 commit，参数文件有 LFS SHA-256；普通 JSON/YAML/README 只有
   Git blob OID，tree 无 `LICENSE` / `NOTICE`，且没有官方声明该五文件集合等价替代 BOS inference archive。

## Route 决定

本轮没有 accepted lane：

| Route | 结果 | 原因 |
|---|---|---|
| PaddleOCR/PaddleX exact graph | rejected | 仍选择 Owner 明确拒绝的 contrib 4.10 |
| 手工替换 contrib 4.14 | rejected | 违反 PaddleX exact metadata |
| 手工替换 headless 4.14 | rejected | 不同 distribution，且没有官方支持合同 |
| 自行用低层 PaddlePaddle 绕开 OpenCV | rejected for this gate | 属于新 integration，不是官方支持的 PaddleOCR/PaddleX lane |
| fixed model tree 替代 BOS tar | candidate blocked | 缺完整 SHA-256、许可/notice scope 与官方 file-set equivalence |

继续保持六项 blocker：

- `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`
- `OPENCV_CONTRIB_4_10_LICENSE_OBLIGATIONS_UNACCEPTED`
- `OPENCV_CONTRIB_4_10_IMAGE_SECURITY_UNACCEPTED`
- `TRANSITIVE_ARTIFACT_CACHE_AND_OFFLINE_REQUIRE_HASHES_INSTALL_UNVERIFIED`
- `BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`
- `BLOCKED_CHECK_CAPABILITY_UNSELECTED`

最小后续输入是上游发布受支持的 patched Paddle dependency graph，或为 fixed model file set 提供完整 SHA-256、许可/notice
scope 与受支持 inference artifact 声明；随后仍须形成两架构 exact artifact/source/hash/license graph 并独立接受。Owner
“确认继续”不表示接受法律义务、已知安全风险或 unsupported dependency replacement。

## 验证与边界

本轮是 docs-only Evidence gate，没有代码 RED/GREEN。最终 fixed-head、验证与 CI 以 Draft PR 元数据和结果评论为准，避免
session 在提交正文中自引用可变 head。

只读取官方公开 release/tag/API/PyPI/NVD metadata；没有下载 artifact body、安装依赖或模型，也没有读取 accepted
dataset/annotation/review、运行 harness/benchmark。未访问 Hifly/Provider、上传图片、启动 Worker/Local Agent、SSH/部署、
修改生产数据、创建候选/工单/视频或消耗积分。Git 未接收二进制、cache、权重、resolver report、本机绝对路径或敏感值。
