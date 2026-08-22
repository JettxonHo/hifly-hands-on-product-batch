# 2026-08-22 Fidelity-C5 Environment/Harness Implementation Gate

## 范围与基线

- 精确基线：`origin/main@a65a74ef0f94c131df0712e9943b68a0c835220e`。
- 跟踪：Issue #228；对应 Draft PR 是 implementation acceptance gate。
- 本轮只实现 synthetic fixture 可验证的公开 CLI seam，并在仓库外核验获授权的官方开源 artifacts。
- 没有读取或运行 alias `HIFLY_APPEARANCE_BENCHMARK_V1` 的 accepted 四对数据、annotation 或 review；没有运行真实 benchmark。

## RED -> GREEN

1. `validate-environment` 初始因 CLI 不存在失败；最小 GREEN 后只接受 exact storage alias、受控相对 manifest、当前合法 lane，
   并在推理前核对普通非 symlink 图片、bytes/SHA-256、PNG/JPEG magic 与 encoded dimensions。
2. 未登记文件 RED 曾被接受；GREEN 后 dataset tree 的额外文件和 symlink 均 fail closed，bytes/hash drift 也以稳定错误停止，
   stderr 不回显本机绝对路径。
3. `infer` 初始返回 `BENCHMARK_COMMAND_INVALID`；GREEN 后只允许 `synthetic-contract-smoke`，只读 source/candidate 和 versioned
   operation policy，使用不可覆盖输出封存 raw Evidence。未接受阈值时七个 runtime dimensions 全部为 `unknown`，聚合固定
   `needs_review`，不能输出 `passed`。
4. `score` 初始返回 `BENCHMARK_COMMAND_INVALID`；GREEN 后验证 raw Evidence seal 与 annotation/review exact SHA binding，同时保留
   七个 annotation axes 和七个 D-036 runtime dimensions。一个 axis 映射多个 dimension 时，缺少目标专属 Evidence 的目标保持
   `unknown`；`obvious_artifacts` 不形成第八维。
5. 独立审阅在首轮 head 复现 C4 schema RED：fixture 的 `path` 和旧 review 字段使 accepted schema 无法通过。GREEN 后 synthetic
   fixture 改用 `relative_path`、`status=completed`、`review_status=accepted`、`annotation_pack_sha256`、分离的
   `annotator_id/reviewer_id` 与 blind 标记；测试不读取 accepted 四对数据。
6. 跨数据集 RED 将相同 sample ID 的 annotation/review 一并改为另一 dataset/version，旧 scoring 仍封存结果。GREEN 后 raw
   Evidence 固定 manifest 相对引用/bytes/SHA-256、dataset ID/version/status 与 source/candidate exact identity，scoring mismatch
   以 `BENCHMARK_DATASET_BINDING_MISMATCH` fail closed。
7. mapping RED 证明有效七维内的任意重映射和重复 target 可通过旧 validator。GREEN 后 `d036-c3-v1` mapping 以 exact content
   SHA-256 锁定；输出保留人工 reason code/reason/evidence/visibility、atomic mapping record 与 raw Evidence 回链；缺目标 Evidence
   的一对多映射保持 `unknown`，`obvious_artifacts` 不生成第八维。
8. 首轮 fake lock 能得到 `environment_validated`。GREEN 后测试 lock 必须显式为 `synthetic_contract_only`，唯一成功状态为
   `synthetic_contract_validated`；任意格式正确但未经完整 lock/cache/runtime Evidence 验证的外部 JSON 均 fail closed。
9. 第二轮独立审阅证明顶层 `review_status=accepted` 会掩盖逐轴 `changes_requested`。GREEN 后 synthetic review 与 C4
   `sample_reviews` 同构，并逐 sample/7 axes 校验 annotator/reviewer status、match 与决定；缺项、重复、错绑定、空决定和未解决
   分歧均 fail closed，只有带理由的 `accept_annotation` 可接受人工分歧。测试仍不读取 accepted truth。
10. 第二轮输出边界 RED 证明 inference 可经父级 symlink 写回 dataset，scoring 也可直接写回。GREEN 后两个阶段共用
    storage alias root 与输出父目录的真实路径 containment；直接写回、symlink/junction 写回均被拒绝，既有不可覆盖输出保持。
11. 第三轮独立审阅证明 synthetic truth 仍缺 C4 `pack_type`、sample version/time、review time 与逐轴审计字段，且
    `accept_annotation` 可用普通 `reason` 代替 `decision_note`。GREEN 后 fixture 与仓库外 C4 validator 的公共 schema 同构；
    缺失或篡改上述字段均 fail closed，分歧决定必须有至少 4 字符的独立 `decision_note`。本轮只读核对 validator 脚本，未读取
    accepted 四对图片、annotation 或 review 内容。

## 官方 Artifact 取证与停止条件

- 仓库外下载并核对合同列出的六个顶层 wheel；bytes/SHA-256 与官方 PyPI metadata 一致。PaddleOCR、PaddleX、PaddlePaddle
  wheel 内含 Apache-2.0 LICENSE；OpenCV headless wheel 含 LICENSE 与 third-party notices。
- 官方 v3.7.0 model list 下载入口得到：
  - `PP-OCRv6_medium_det_infer.tar`：62279680 bytes，SHA-256
    `144d0621e059566e5086e228829171591c144c2deb07b2dad4962214fbabfcf7`；
  - `PP-OCRv6_medium_rec_infer.tar`：76851200 bytes，SHA-256
    `4eecc1c6a4623765042e6fc15446da0da110b7d875b6b72b2d351d2b2dbd4da6`。
- 两个 tar 只含模型目录与 `inference.pdiparams`、`inference.yml`、`inference.json`，没有路径穿越、symlink 或非普通文件。
- 硬阻断一：两个权重 tar 无 LICENSE/NOTICE，官方 model list 与 PP-OCRv6 文档没有权重许可 Evidence；源码 Apache-2.0 不得外推。
- 硬阻断二：Linux/amd64 与 macOS/arm64 的候选解析都得到 66 个包，并因 `paddlex[ocr-core]` 引入
  `opencv-contrib-python==4.10.0.84`；这超出已接受 `opencv-python-headless==4.13.0.92` 与 image-only allowlist。
- 硬阻断三：传递 artifact cache 未建立，离线 `--no-index --find-links --require-hashes` install 未验证。候选 requirements
  不进入 Git，也不称为 lock。

因此状态为 `BLOCKED_ENVIRONMENT_ARTIFACT_LICENSE_AND_DEPENDENCY_CONFLICT`。仓库中的 environment evidence 配置故意没有
可运行 lanes，public validator 会 fail closed。Issue #228 / 对应 PR 合并最多表示 synthetic repository seams accepted，
不表示 environment ready、模型已安装、accepted benchmark 已运行或能力已选择。

## 安全与边界

- 未安装 PaddleOCR/PaddleX/PaddlePaddle/OpenCV，未运行权重或模型，未上传图片或调用外部模型/API。
- 未访问 Hifly/Provider，未启动 Worker/Local Agent，未 SSH/部署，未改生产数据，未创建候选/工单/视频或消耗积分。
- Git 不含 dataset bytes、annotation/review JSON、wheel、权重、缓存、候选 requirements、本机绝对路径、真人身份或敏感值。
- `BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持；Fidelity-C 产品 Run/Result/Review 与 Fidelity-D/E 未开始。

## 验证记录

- Focused public CLI tests：`node --test test/appearance-benchmark-environment.test.js test/appearance-benchmark-harness.test.js`
  在 macOS/arm64 smoke lane 通过；覆盖 C4 schema-compatible synthetic inputs、alias/identity/tree/symlink/hash、synthetic-only/
  blocked repository lock、blind isolation、exact dataset binding、不可变输出、annotation visibility、未登记 operation、重复 run、
  sealed partial output、mapping drift/第八维与一对多 mapping fail-closed。
- fresh worktree 先执行 `npm ci` 恢复仓库锁定依赖；首个 implementation head 的 default `npm test` 为 1094 total /
  1079 pass / 15 skip / 0 fail。15 个 skip 是 14 个需显式 PostgreSQL 测试数据库环境变量的 integration tests，以及需
  `IDENTITY_BROWSER_SMOKE=1` 的 identity browser smoke；本轮新增 CLI tests 在受支持的 macOS/arm64 lane 未 skip。
- 修正跨 lane 测试期望后，本地 focused 仍为 9/9；第二次 default suite 在无失败输出下停在既有 browser test 622，超过
  4 分钟后手动停止。该次不计 pass，也不覆盖首轮完整结果；最终固定头的全量证据以 GitHub CI 为准。
- 首轮 required fixes 后，focused public CLI 为 12/12；default `npm test` 自然完成为 1097 total / 1082 pass /
  15 skip / 0 fail。15 个 skip 仍是 14 个需显式 PostgreSQL 测试数据库环境变量的 integration tests 与 1 个
  `IDENTITY_BROWSER_SMOKE=1` browser smoke；没有用 `--test-concurrency=1` 或其他串行替代。
- 第二轮 required fixes 的 focused public CLI 为 15/15；新增覆盖逐项独立 review、inference symlink writeback，以及 scoring
  直接/symlink writeback。随后 default `npm test` 的前 48 项（含新增 C5 seam）通过，但宿主在既有
  `assets-browser.test.js` / `operator-workbench-v2-assets-browser.test.js` 进程无失败输出地停留超过 6 分钟，本次由开发者终止且
  不计 pass；fixed-head 完整回归必须由 PR 三组 required CI 自然完成为 SUCCESS，不能用该本地长等待冒充绿色。
- 第三轮 required fix 后 focused public CLI 为 16/16；新增 exact C4 truth schema 缺失/篡改与独立 `decision_note` 回归。
- `npm run check`：241 JavaScript files；`git diff --check` 与 strict 15-file allowlist 通过。
- `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high`：0 critical / 0 high / 2 moderate；
  没有执行 `audit fix` 或 `--force`。
- 首个 Draft PR head `dafa4162afed6493ddb2b89f5876530a62dd0515` 的 Ubuntu CI 在环境验证测试中失败：实现正确返回
  `linux-amd64-canonical`，测试期望却硬编码为 `macos-arm64-smoke`。后续修复改为断言当前 accepted lane；该失败不作为
  environment 或 benchmark 成功 Evidence，也不被后续绿色覆盖。
- 独立审阅 head `3e7e5119f514587ee37a93ff62aa9fc54c1abdd7` 的 Ubuntu/Windows 为 SUCCESS，identity-postgres 为
  CANCELLED，`mergeStateStatus=UNSTABLE`；该 head 不计 required checks 全绿。后续修复 head 必须三组 required CI 全部自然结束为
  SUCCESS，不能用取消或反复重跑覆盖本事实。
- 第二轮修复 head `08234458ade0c65758378763a92321e8b6ba45aa` 的 run `32577105302` 未通过且不计 fixed-head
  绿色：Windows SUCCESS；Ubuntu 的 15 个 C5 tests 全绿，但既有 `cloud-executor-deployment` 用例因额外一次 `xdpyinfo` 调用失败；
  identity-postgres 在既有 VideoPlanning integration 中期望 `VIDEO_PLAN_REVIEW_ACTIVE_EXISTS`、实际收到 PostgreSQL `23505`。
  两项失败均需保留为该 head 的真实历史，后续证据提交触发的新 head CI 必须自然三绿，不能重跑本 run 掩盖。
- fixed-head CI：以 Draft PR 元数据与结果评论为准，session 不自引用最终 commit。
