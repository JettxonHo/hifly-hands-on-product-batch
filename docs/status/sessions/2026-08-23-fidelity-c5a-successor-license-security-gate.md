# 2026-08-23 Fidelity-C5a 后续许可证、依赖与安全门禁

## 范围与生命周期

- 精确基线：`origin/main@4e18f1166869f2259d68083cd2975452cbbeb476`。
- 跟踪：Issue #232；对应 Draft PR 是本轮 Evidence acceptance gate。
- 严格 allowlist：
  - `docs/product/PRODUCT_APPEARANCE_CHECK_ENVIRONMENT_EVIDENCE.md`
  - `docs/product/PRODUCT_APPEARANCE_CHECK_BENCHMARK_HARNESS_CONTRACT.md`
  - `docs/product/README.md`
  - `docs/status/CURRENT.md`
  - `docs/ROADMAP.md`
  - `docs/status/sessions/2026-08-23-fidelity-c5a-successor-license-security-gate.md`
- 只有对应 PR 合并进入 main 后，才计为 blocker Evidence accepted；不建立 D-037、accepted environment lane 或 C5b 授权。

## 只读真值审计

开始前确认 PR #231 已合并、Issue #230 已关闭，远端没有同主题在途 Issue/PR，因此只创建 Issue #232。主工作区旧
`gui/visual-refresh` 与脏改动未触碰；本轮使用独立 worktree/branch。

本轮仅访问官方公开文档、固定源码/tag、PyPI release JSON、既有仓库外 no-install resolver 文本和 BOS `HEAD` metadata：

1. PP-OCRv6 medium det/rec 的固定参数 LFS OID 与合同 tar 内参数 SHA-256 一致，模型卡声明 Apache-2.0；但 exact BOS tar
   没有 archive-specific LICENSE/NOTICE、官方 SHA-256、内容清单或再分发声明，保持
   `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`。
2. Linux/amd64 与 macOS/arm64 resolver reports 可规范化为 64/62 条 `name==version` 记录；它们只证明 metadata graph
   可解，没有锁定 target 实际选择的 wheel/source、hash、wheel 内第三方许可或 native graph。
3. exact `opencv-contrib-python==4.10.0.84` wheels 的 PyPI bytes/SHA 与既有合同一致。release 84 的固定第三方许可清单证明
   所有 packages 含 FFmpeg，non-headless Linux 和 macOS packages 均含 Qt5；image-only 运行约定不会取消分发义务。
4. CVE-2025-53644 将 OpenCV 4.10.0/4.11.0 列为受影响版本，JPEG 2000 `imdecode` 可触发堆写，修复于 4.12；4.13 固定
   changelog 又记录了 PNG/BMP 等后续修复。未找到回移到 exact 4.10 wheel 的官方 Evidence，因此静态 decode lane 不接受。

## 决定与最小后续输入

本轮没有 accepted lane。以下输入全部完成并经独立 Review 前，不得开始 C5b：

- archive-specific 官方再分发 Evidence，或 Owner 明确改变 artifact 获取/分发路线；
- 两架构 exact selected artifact/source/hash、inside-wheel LICENSE/NOTICE、native dependency/SBOM 与 obligations plan；
- Owner 指定的法律/开源合规角色接受 FFmpeg、Qt5 及其他逐 artifact 义务；
- 上游受支持的 patched OpenCV lane/backport Evidence，或 Owner 基于独立安全评估接受 exact 4.10 风险；
- versioned image-only policy、资源上限、sandbox 与 negative controls 的后续 TDD acceptance。

因此继续保持：

- `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`
- `OPENCV_CONTRIB_4_10_LICENSE_OBLIGATIONS_UNACCEPTED`
- `OPENCV_CONTRIB_4_10_IMAGE_SECURITY_UNACCEPTED`
- `TRANSITIVE_ARTIFACT_CACHE_AND_OFFLINE_REQUIRE_HASHES_INSTALL_UNVERIFIED`
- `BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`
- `BLOCKED_CHECK_CAPABILITY_UNSELECTED`

## 验证与边界

本轮是 docs-only Evidence/decision gate，没有代码 RED/GREEN。最终 fixed-head 与 CI 以 Draft PR 元数据和结果评论为准，避免
session 在提交正文中自引用可变 head。

未下载或安装模型、wheel、PaddleOCR、PaddleX、PaddlePaddle 或 OpenCV；未读取 accepted 四对图片、annotation/review，
未运行 harness/benchmark。未访问 Hifly/Provider，未上传图片，未启动 Worker/Local Agent，未 SSH/部署、修改生产数据、
创建候选/工单/视频或消耗积分。Git 未接收二进制、resolver report、metadata snapshot、cache、权重、本机绝对路径或敏感值。
