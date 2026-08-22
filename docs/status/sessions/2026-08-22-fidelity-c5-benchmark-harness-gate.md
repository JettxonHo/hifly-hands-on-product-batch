# 2026-08-22 Fidelity-C5 环境与 Harness 设计门禁

## 范围

- 精确基线：`origin/main@fb04b4870b721be00f4b6f093654526e230a921c`。
- 跟踪：Issue #226；对应 Draft PR 是合同 acceptance gate。
- 本轮严格 7 文档 allowlist，只做仓库与官方一手来源的只读审计和设计锁定。
- 没有安装依赖、下载权重、实现或运行 harness/benchmark，也没有访问 Hifly/Provider、Worker/Local Agent、SSH、部署、
  生产数据、候选/工单/视频或积分动作。

## 已核对真值

- Fidelity-C4 已随 PR #225 进入 `main@fb04b4870b721be00f4b6f093654526e230a921c`；仓库外 alias
  `HIFLY_APPEARANCE_BENCHMARK_V1` 已通过 exact-byte、4 类/4 商品族、4 samples x 7 axes 和不同角色盲审 acceptance。
- dataset manifest 固定为 `manifests/dataset-manifest.v1.json`，6083 bytes，SHA-256
  `306db2ba5a0a5c467318ca449e35149962d936ef7bd8488961e3691a7f318df2`。annotation/review 的 bytes 与 SHA-256 沿用
  Fidelity-C4 accepted Evidence；本轮没有提交其正文。
- 官方发行证据支持 PaddleOCR 3.7.0、PaddleX 3.7.0、PaddlePaddle 3.1.1、OpenCV Python headless 4.13.0.92、
  Python 3.11.16 与 architecture-specific OCI/wheel hashes 的候选锁定。
- 官方 PP-OCRv6 model list 提供 `PP-OCRv6_medium_det` / `PP-OCRv6_medium_rec` 名称和下载入口，但未提供权重
  SHA-256；本轮没有下载，因此记录 `DESIGN_BLOCKER_MODEL_ARTIFACT_UNHASHED`。
- 关键顶层 wheel 有官方 hash，但完整传递依赖 lock、模型权重许可证归档和 OpenCV 随附组件安全复核尚未形成
  acceptance Evidence，不能把版本表写成 environment ready。

## 设计结果

- canonical benchmark lane 固定为 Python 3.11.16、Linux/amd64 与 architecture-specific OCI digest；macOS/arm64 只做
  smoke，不与 canonical 性能数据混报。
- fetch 与 offline install/run 分离。未来只有在独立授权后才能建立仓库外 hash-verified cache；正式 run 必须
  `--network none`，所有依赖使用完整 `--require-hashes` lock。
- Harness 只读绑定 exact accepted manifest；inference 与人工真值 scoring 分阶段隔离，禁止在看到真值后调参覆盖结果。
- 没有 accepted policy/threshold 时只能保存 raw Evidence，逐维 provisional verdict 必须 unknown、聚合 needs_review，
  不得产生 passed。
- 结果 manifest 必须持有精确输入、环境、依赖/权重、原始逐维 Evidence、资源、错误与 reviewer hash；CI 绿不替代
  canonical benchmark run 或 Owner acceptance。

## 首轮独立复审纠偏

主控在首轮审阅 head `6d1de8c7a120ddf5295aa4c4cdf32aa03418ffd9` 独立核对了 dataset manifest、四组关键
wheel 文件名/bytes/SHA-256、Python OCI index/amd64/arm64 digest、PaddleOCR/OpenCV tag commit 和 3.7 compatibility
区间；这些 Evidence 成立。审阅同时要求并已在后续提交纠偏：

- 冻结 C3 七个 annotation axes 到 D-036 runtime dimensions 的双层映射。评分同时保留 axis、dimension 和映射依据；
  一对多不复制结论，`obvious_artifacts` 不形成第八维，无法归属时为 unknown。
- OpenCV 边界改为静态图像解码和 versioned policy 明列的受控处理/测量，继续禁止 video capture、codec 和 FFmpeg。
- 用于 fixed compatibility/license 的 GitHub 链接固定到 tag；Docker mutable tag metadata 只记录 2026-08-22 observed evidence，
  实际运行身份仍只能使用 architecture-specific digest。

本轮没有更新 Decision Log：Fidelity-C5 是仍带模型 artifact blocker 的可逆设计 gate，没有新增已实现公共接口或替代 D-036。

## 验证记录

- 纠偏后 `npm run check`：237 个 JavaScript 文件通过。
- 纠偏后 working-tree `git diff --check`：通过；提交后继续用 `origin/main...HEAD` 复核固定范围。
- 纠偏后 7 文档 relative links 与 21 个官方来源：通过；21 个来源于 2026-08-22 均返回 HTTP 200。
- mutable GitHub branch source、stale wording、绝对路径/敏感值和 strict allowlist：通过；fixed lock/license 证据均为 tag 路径。
- fixed-head GitHub CI：以对应 PR 元数据和结果评论为准；session 不在提交正文中自引用最终 head。

## 下一步

PR 合并进入 `main` 后只表示 Fidelity-C5 合同 designed/locked。下一步仍需独立授权 environment/harness implementation gate：
取得并核验 PP-OCRv6 权重、生成完整依赖 lock、建立离线 cache 与 TDD harness；实现独立复审后，才可另行授权真实本地
benchmark。`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持，不开始 Fidelity-C 产品实现。
