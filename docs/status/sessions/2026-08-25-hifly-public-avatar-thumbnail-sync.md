# 2026-08-25 Issue #252 公共数字人缩略图同步

## 范围与固定基线

- Issue #252 合同基线：`main@831c927`。
- 本 session 先覆盖 allowlist 内的只读 source seam、既有管理员 sync、`avatar_image` AssetVersion 导入和公共 Avatar material 绑定，以及 LocalObjectStore `put/head/get/remove` 的 partial/并发提交边界；没有新增 endpoint、migration、Worker/调度、私有人物或公开破坏性变更。2026-08-26 经 Owner 单独授权后追加真实 Hifly **只读**登录/页面与公开字节校准，仍禁止任务、生成、积分和 Provider 写入。

## RED → GREEN

- 首个 RED：新增 `test/hifly-public-avatar-thumbnail-source.test.js` 后，旧 head 运行该测试为 `ERR_MODULE_NOT_FOUND`（缺 `src/providers/hifly-public-avatar-thumbnail-source.js`）。该 evidence 已回报 parent。
- 第二个 RED：新增 Assets service seam 后，旧 head 运行 `test/assets-service.test.js` 为 `TypeError: w.service.registerPublicAvatarThumbnail is not a function`。
- 后续读隔离 RED：Memory bind barrier 期间普通 Assets/Avatar reads 与 generic download 在 live Map head 可见 provisional rows，新增 barrier test 为 `ordinary reads must remain behind the transaction gate true !== false`。
- GREEN：catalog + source + Assets service + Avatar service 合并 focused test 67/67（含合法 Unicode/冒号 provider identity、C1 控制字符拒绝、并发收敛和 bind-failure rollback、Memory sync/status/read interleaving、aggregate 64 MiB source cap）；API 8/8；真实临时 PostgreSQL avatar integration 1/1（含双 provider base64url `_` 精确前缀隔离、双 sync、rollback、exact history/latest list 与 COMMIT callback guard）；Stage 3 Chrome exact synthetic PNG 1/1。素材中心三视口 exact-PNG 测试已加入 allowlist，但本机浏览器进程资源状态导致该单测需 owner 在稳定 Chrome lane 重跑。

## 实现边界

- `publicAvatarThumbnailSource` 只接受精确 provider key/title；底层 raw seam 必须回 exact identity、claimed size/checksum；wrapper 真实检测 PNG/JPEG/WebP、大小上限、MIME、字节长度和 SHA-256，向上层只回 bytes/media/size/SHA。
- 同步入口仍是 `POST /api/avatar-catalog/hifly-public/sync` 且 admin-only；ordinary catalog/workspace reads 不读取 source。source 缺失或单项异常计为 `thumbnail_unavailable`，不写素材；register/bind integrity/storage/DB 错误整笔事务 rollback，避免 orphan AssetVersion。
- 为防止恶意或异常目录导致内存放大，source 预取设有聚合上限：最多读取 100 个缩略图且最多保留 64 MiB bytes；达到任一上限后的条目保持官方列表分页结果但计为 `thumbnail_unavailable`，不进入 Asset 写入，未改变官方目录分页合同。
- Asset object key 只在内部 AssetVersion/object store 需要，不进入公开 projection；provider key 与 checksum 派生 key 以组织边界隔离。重复 checksum 使用 put-if-absent 验证已有 object 的组织、media、size、bytes/SHA，兼容 Memory 与 Local store 的 `EEXIST`。LocalObjectStore 的 `put/head/get/remove` 现以 body+metadata 完整提交为可见边界：metadata 序列化失败清理本调用 body；重启后 body bytes 精确相同时可恢复 body-only 或损坏 metadata partial，异 bytes fail closed；同进程 per-key lock 配合唯一临时 metadata，并以固定 `.metadata.v2.json` 的 hard-link 原子 non-overwrite commit，legacy `.metadata.json` 永不 unlink，独立 Node 进程也只产生一个完整赢家且 loser 不删除赢家。
- Memory 使用 avatar transaction snapshot + serial gate，Asset registration 在相同 transaction client 上登记 rollback；PostgreSQL 使用 `avatar-material-boundary` → `avatar-public-sync` 固定锁序，proxy transaction client 具备 rollback hooks，thumbnail object 不在 PG commit 失败时残留。
- Memory ordinary Asset/Avatar reads（list/get/version、preview authorization）均经过各自 read gate；sync transaction 的 gate finalizer 在 Avatar 与 Asset maps 完成 commit/rollback 后同一 turn 释放，barrier 中不泄露 provisional rows 或 download grant。Provider identity 拒绝 C0、DEL 与 C1（U+007F–U+009F）。
- 公共 Avatar immutable history 追加新版本；相同 material replay 不追加；官方标题变化时只更新 material Asset display name，不产生新文件版本。

## Provider / 积分门禁

- 实现与自动化验收仍使用 fake/disabled source + synthetic PNG；这些 fixture 不能作为真实人物视觉证据。
- 2026-08-26 Owner 明确授权只读登录飞影并校准缩略图，禁止创建任务、点击生成、消耗积分或写入 Provider。主控只导航到 `/avatar-market`、`/avatar`，读取 DOM/公开 GET 与 CDN bytes；没有点击「创建作品」「去创作」或任何生成/雇佣按钮，没有调用管理员 sync。
- `/avatar` 的「公用数字人」真实卡片加载 `https://hfcdn.lingverse.co/...` 图片。代表人物「周景行」页面图片（1536×1536）与公开 `digital_human_merchandises_v3` 对应市场 cover 为同一 JPEG：1,987,252 bytes，SHA-256 `e15b88a3880967db06d0b5ceae12cfd738b19223a5ace610188f652369d6f91d`。公开市场列表只读响应为 737 条，其中 554 条具有单一 `hfcdn.lingverse.co/hiflys/avatar-market/` cover；存在 31 组重名。
- 真实 source 仍保持 disabled：官方开发者公共人物 API 条目仅 `avatar/kind/title`，已登录页面 DOM 与公开市场响应没有给出 `avatar` 到 cover 的官方 foreign-key。按 title 连接会在重名下错绑，并违反“不得按人物名拼图”的产品合同。下一门禁是取得飞影官方的 exact identity→thumbnail 字段/端点或等价书面合同；在此之前不得自动导入真实 cover。
- 本次真实校准结论：真实人物缩略图“存在且可读”已验证；“可按开发者 API 人物标识安全自动同步”未验证。0 task / 0 generate / 0 Provider write / 0 points。

## 验证与限制

- 已执行：`node --test --test-concurrency=1 test/hifly-public-avatar-thumbnail-source.test.js test/hifly-public-avatar-catalog.test.js test/avatar-selection-service.test.js test/assets-service.test.js`（67/67，含 aggregate source byte cap、Memory sync/disable-delete/read isolation interleaving）；LocalObjectStore slice `node --test --test-concurrency=1 test/local-object-store.test.js`（8/8，含 metadata failure cleanup、truncated/invalid metadata restart recovery、restart partial adopt/mismatch、replay、固定 v2 commit sidecar、同进程与独立 Node 进程并发）；兼容 Assets/cloud persistent media/manual handoff focused 合计 57/57；真实临时 PostgreSQL avatar integration 1/1（含 printable U+00BE/U+00BF base64url `_` 精确前缀隔离、双 sync、rollback、exact history/latest list 与 COMMIT callback guard）；API 8/8；`npm run check`（249 JS）；`node --check` 相关源码/测试；`git diff --check`。
- parent 最新主控回归：default `npm test` 为 1229 total / 1213 pass / 15 skipped / 1 failed；唯一失败是未修改的 Works browser line 599 在并行负载下失败，因此 default 明确不是绿色。随后对该文件做 isolated rerun，自然通过 1/1；该 isolated 通过不抵消 default 的 1 fail。此前 `npm ci --ignore-scripts`（250 packages，exit 0）后 `pg`/Playwright 已可用，`npm run check`、API/PG focused 与 Stage 3 Chrome 也已运行。真实 Provider 校准需新的授权与独立 session。
- final candidate default run：在最终候选上运行 `npm test` 超过 2 分钟后，Node 与本次 Playwright Chrome 均为 0% CPU 且无新增 TAP 输出；仅终止本次命令自身。该 run 非绿色，但没有产品断言失败，属于测试/浏览器 harness 无进展；此前 1229 total / 1213 pass / 15 skipped / 1 failed 与 isolated Works 1/1 仍保留为历史证据，不得改写成绿色。

## Allowlist diff

Changed tracked files: `docs/CALIBRATION.md`, `docs/PROJECT_HANDOFF.md`, `docs/ROADMAP.md`, `docs/product/DECISION_LOG.md`, `docs/product/HIFLY_CAPABILITY_EVIDENCE.md`, `docs/product/OPEN_QUESTIONS.md`, `docs/status/CURRENT.md`, `src/assets/asset-service.js`, `src/assets/local-object-store.js`, `src/assets/memory-asset-repository.js`, `src/assets/postgres-asset-repository.js`, `src/avatar-selection/avatar-selection-service.js`, `src/avatar-selection/hifly-public-avatar-catalog.js`, `src/avatar-selection/memory-avatar-selection-repository.js`, `src/avatar-selection/postgres-avatar-selection-repository.js`, `src/server/app.js`, `test/assets-service.test.js`, `test/avatar-selection-api.test.js`, `test/avatar-selection-postgres.integration.test.js`, `test/avatar-selection-service.test.js`, `test/hifly-public-avatar-catalog.test.js`, `test/operator-single-workspace-assets-mobile-closeout-browser.test.js`, `test/operator-single-workspace-stage-3-browser.test.js`.

Added allowlisted files: `src/providers/hifly-public-avatar-thumbnail-source.js`, `test/hifly-public-avatar-thumbnail-source.test.js`, `test/local-object-store.test.js`, this session document.

## 2026-08-27 MBL 合并门禁更新

- Owner 明确授权管理员绕过非作者审批并合并。REL-001 PR #256 已先 squash 合并为 `main@4c8c27fca76ed5deaa6fb2f4f2ef348484feec23`；PR #253 随后吸收该基线。仅 `docs/ROADMAP.md` 与 `docs/status/CURRENT.md` 发生内容冲突，按 Issue #257 MBL 当前 Goal、REL-001 已合并但未部署、真实 thumbnail source 继续 disabled 三项事实组合解决。
- 合并基线后的本地聚焦验证：发布门禁 `23/23`；source/catalog/Assets/Avatar/API/LocalObjectStore `83/83`；`npm run check` 检查 249 个 JavaScript 文件；`git diff --check` 通过。该验证不访问 Hifly/Provider，不创建任务或视频，不启动 Worker/Local Agent，也不消耗积分。
- PR #253 必须以本次新 head 自己的 Ubuntu、Windows、identity-postgres 三项 required CI 为最终合并证据；旧 head 的三绿不替代新 head。
