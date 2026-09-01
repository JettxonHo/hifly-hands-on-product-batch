# 项目当前状态

> 最后更新：2026-09-02
> 当前 Goal：RBV-GOAL-001；当前 bounded engineering implementation：Issue #278 `HIFLY_HANDS_ON_PRODUCT_V1` provider-free/Hifly-free production contract revision（独立分支 `codex/hifly-hands-on-product-v1-contract`；exact base `3fbca9647b0d8fab89423ec0e55fd5ee7b71821c`，working head 为本阶段候选）
> 当前阶段：`HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_REWORK`；字段级 Production Evidence Contract、Cloud/Local structured pre-point verifier 与 Hifly post-handheld exact-ratio stop 已实现并 focused GREEN。`CONTRACT_IMPLEMENTATION = GAP` 仍成立：native voice exact identity、final-video ratio/audio、Stage 1→Stage 2 dimension behavior 需要独立真实证据与 Gate。Issue #275 已为历史 `COMPLETE/MERGED/DEPLOYED`（PR #276 squash merge 至 `main@fbc722ee40054045d8883f0a7e20beb1a11e4221`，GitHub Issue #275 CLOSED；exact-head CI run `33418338737` 三绿）。真实 Plan Create、Provider/Hifly、登录与积分动作仍禁止。RBV Readiness Freeze 记录仍为 `docs/status/RBV_CALIBRATION_READINESS_FREEZE.md`，产品方向继续引用 D-037 与 `docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`。
>
> 2026-08-13 收敛前的完整时间序列已保留在
> `docs/status/archive/CURRENT-through-2026-08-13-pre-closeout.md`。

## Issue #278 `HIFLY_HANDS_ON_PRODUCT_V1` bounded contract（2026-09-01，provider-free candidate）

### 2026-09-02 Production Contract Engineering Revision（provider-free）

- 新增字段级 `Production Evidence Contract` helper：每条证据固定表达
  `field/expected/actual/evidence_source/verification_stage/paid_boundary/result`；
  `production.target_aspect_ratio` 仅表示 target，handheld/final actual 分开记录，
  `handheld_aspect_ratio_policy=record_only` 默认只记录而不阻断，只有显式
  `require_exact` 才在 Confirm 前硬阻断。
- Hifly Stage 1 结果在 UI Confirm 前读取 natural dimensions，严格使用
  `width * 16 === height * 9`；当前默认 `record_only` 会记录历史样本
  `1600x2848 → FAIL_EXACT_MATCH` 但可继续，只有显式不可变
  `require_exact` 才返回 `requires_action`、不 Confirm、不进入 Stage 2。
  历史真实运行当时明确要求 exact，因此其停止事实保持不变；final-video ratio
  仍为 `NOT_PROVEN`。商品保真只对消费者可见的重大身份/形状/颜色/腐化/替换/矛盾硬阻断；不可读小字不启用 OCR，记录为 `NOT_OBSERVABLE`/`NOT_REQUIRED`。
- Cloud 与 Local real V1 路径共享 structured verifier 检查；bare boolean、缺失、字段不全、上下文/期望值不匹配或未验证结果均在 `createAsset`/`submitVideo` 前停止，并投影受控结构化 evidence。`ui_input_copy_match` 与 `final_audio_copy_correspondence`、UI-visible voice 与 voice exact identity 分开记录；后者的 `id`/`tts_voice_id`/name 等未知值保持 `NOT_CAPTURED`/`NOT_PROVEN`，不得由 UI 展示推断。
- TDD/验证记录见 [`2026-09-01-issue-278-hifly-hands-on-product-v1.md`](sessions/2026-09-01-issue-278-hifly-hands-on-product-v1.md)；本阶段无 Provider/Hifly、真实登录、业务对象、部署或积分动作。新 run 的默认 evidence status 不直接给 `hands_on_product=PROVEN`；历史基线单独保留为 PROVEN。

- 独立分支 `codex/hifly-hands-on-product-v1-contract` 从 exact base `3fbca9647b0d8fab89423ec0e55fd5ee7b71821c` 实现窄化「手里有货」合同：结构化 builder/validator/canonical hash、生产配置显式 marker、ProductionOrder input snapshot、manual handoff manifest、Local/Cloud package compiler、conditional execution digest 与 Cloud Playwright pre-point verifier seam。
- Contract 固定 `mode=hands_on_product`、`target_aspect_ratio=9:16`、`handheld_aspect_ratio_policy=record_only`、`voice_source=hifly_native`、`single_scene/fixed_simple/smart_fit` 与 no-B-roll/no-additional-characters/no-external-TTS/no-standalone-lipsync/no-copy-AI；不解析 `output_instructions`，不建设通用 DSL。Avatar server-private seam 只解析 current selection → AvatarVersion → registered MaterialVersion，并返回已核验 media/size/SHA，不加入公共投影；显式 contract + exact material checksum 才是 routing gate，不依赖通用 capability 名称。
- 历史基线中的 9:16 与 native voice 没有可靠 Playwright set/read-back 证据；当前 revision 已把 ratio 改为 Stage 1 结果的 post-handheld exact-ratio evidence gate，而 pre-point verifier 只要求结构化 `target_aspect_ratio` 与 voice/source evidence，不要求 post-paid handheld actual。无 verifier 时 Cloud adapter 以 `CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE`（fields=`target_aspect_ratio,voice_source`）browser-zero 停止；注入 structured verifier 时才在同一已创建 page/hiflyPage 上、runBatch/point action 前执行。现有 Hifly page 在 inner Generate 前复用既有 toggle/script set/read-back，`copy_ai_generation=false` 为 `CONTRACT_MACHINE_ENFORCED`。Evidence coverage 与最小未来录制要求见 [`HIFLY_HANDS_ON_PRODUCT_V1.md`](../product/HIFLY_HANDS_ON_PRODUCT_V1.md)。
- 本轮 TDD focused GREEN：contract 19/19、avatar material 8/8、execution snapshot 5/5、Local compiler 7/7、manual handoff service 13/13、real-chain 1/1、batch/Hifly page 90/90、Cloud Playwright 10/10、Cloud runtime 24/24、Cloud login 10/10、Local runner 16/16、production-start 15/15；这些 per-file 计数存在重叠，不相加；第三轮归档边界与 historical hybrid hash 回归后最终相关套件 aggregate 为 262 tests / 261 pass / 1 expected PostgreSQL skip（此前基线为 259 / 258 / 1 skip）。本轮治理回归另计为 30 tests / 30 pass / 0 skip，不并入上述代码 aggregate。`npm run check` 检查 251 JS 文件，`git diff --check` 通过。完整 RED/GREEN 与命令见 [`2026-09-01-issue-278-hifly-hands-on-product-v1.md`](sessions/2026-09-01-issue-278-hifly-hands-on-product-v1.md)。
- Stage verdict：`CONTRACT_IMPLEMENTATION = GAP`（provider-free structural/identity candidate GREEN；ratio/native voice machine verification unresolved，production Gate BLOCKED）。本 Stage 无 Provider/Hifly 请求、无真实登录/浏览器生产动作、无 Generate、无积分、无 ProductionOrder/Handoff/Attempt/Cloud claim、无部署；候选等待独立 Review 与 Owner merge/deploy Gate，不将工程 GREEN 写成 MBL/RBV/真实生产完成。

## Issue #275 VideoPlan Create Idempotency-Key Seam（2026-09-01，已合并/部署）

- 在独立分支 `codex/videoplan-precommitted-idempotency-seam`（基准 `69558fdb38e83eadee6e3ab187ba09cc6da22300`）完成 provider-free bounded implementation，PR #276 已 squash merge 至 `main@fbc722ee40054045d8883f0a7e20beb1a11e4221`，GitHub Issue #275 已 CLOSED。新增 `/video-plan-create-idempotency.js` 浏览器 resolver：`undefined`、`null`、exact empty string 通过 `crypto.randomUUID()` 生成 key；供给或生成的 key 必须是非空字符串、长度 `<=128`，并经运行时 `Headers` round-trip 后逐字节相同才原样返回（不 trim、不 hash）；leading/trailing OWS、header-invalid controls、超长或非字符串在同步阶段抛出 `VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID`。
- legacy `/plan.html` 与 integrated `/workspace.html` 的创建表单均展示 `创建请求标识（可选）`，`maxlength=128`、`autocomplete=off`；空值生成后回填字段。若结果不明确，界面要求保留该标识并先只读核对结果，未经授权不要更改标识或再次创建。仅 create command 使用该 key；保存、派生、预检、审核等其他命令继续使用既有生成 key，auth/org/product/server header contract 不变。服务端仅通过现有组织/成员/命令作用域的幂等 receipt 持久化 exact caller key 供审计；不写日志、不放入 public response。
- TDD 证据：首轮 helper RED 为文件缺失；依赖安装前 browser RED 未能捕获（Playwright 未安装，`ERR_MODULE_NOT_FOUND`），未把该外部依赖错误伪造为产品失败。`node --test test/video-plan-create-idempotency.test.js` 为 `3 pass`；`node --test test/video-planning-browser.test.js` 为 `1 pass`；`node --test test/operator-single-workspace-stage-4-browser.test.js` 为 `9 pass`；`node --test test/video-planning-api.test.js test/video-planning-service.test.js` 为 `26 pass`。
- 本 Stage 只执行本地测试与静态检查；随后由 Owner/Orchestrator 完成零业务变更 App-only 部署。部署目标镜像 digest 为 `sha256:58cad7e50bc0268cd76a02ec5cfb668de7a86a3b2305c203a3dc244efcba6189`，App healthy/restart=0，Proxy/Postgres/Cloud Executor unchanged/restart=0。真实 Plan Create/Provider/Hifly 仍禁止，当前下一 Gate 仅为 `OWNER_AUTHORIZATION_REQUIRED_FOR_ONE_REAL_VIDEOPLAN_V1_CREATE`；不得把该实现写成 MBL/RBV 或真实生产验收完成。

### Issue #275 closeout evidence（Owner/Orchestrator，2026-09-01）

- exact-head CI run `33418338737` required Ubuntu、Windows、identity-postgres，三项均 `SUCCESS`；独立最终 Review `APPROVED`，P0/P1/P2 均为 none。App-only 部署目标为 `sha256:58cad7e50bc0268cd76a02ec5cfb668de7a86a3b2305c203a3dc244efcba6189`；rollback tag 为 `hifly-pilot-app:rollback-issue275-69558fdb`。
- 部署前备份 `/var/backups/hifly/hifly-issue275-predeploy-20260831T172610Z-524715.dump` 为 `709442` bytes、mode `0600`，`pg_restore-list` 通过。App healthy/restart=0；Proxy/Postgres/Cloud Executor IDs unchanged/restart=0；5 个 public static bytes exact；`/auth/me` anonymous 为 `401`。
- 全部 7 个队列、order、attempt、claim 均为 `0`；exact Product Plan/Head/candidate receipt/Preflight/Review/Handoff/Order/Attempt=0 核对通过。Provider ledger unchanged `11/1/1`；Copy/Review/Selection row `2`；Cloud disabled/standby/claim=false，Local disabled，Hifly token absent，Provider/Hifly/points delta `0`。
- 透明 incident：首次 maintenance script 停止 App 后 SQL quoting 失败，在 success/rollback marker 前结束，App 保持 stopped 且 target 未启动；随后正确的 `SERIALIZABLE READ ONLY` 查询确认 7 queues 为 `0`，target 启动并 healthy。Composite postcheck 仅返回到 nginx reload，拆分短命令独立证明全部 postchecks。全程无 Provider 调用或业务 mutation。

## Issue #273 RBV-012 Copy Quality One-Attempt Contract Correction（2026-08-31）

- 本节为 Issue #273 已完成并已合并/部署的历史 provider-free/deployment 记录；当前无 active bounded engineering implementation，不得再将 #273 作为 active engineering pointer。GitHub Issue #273 仍保持 OPEN，工程阶段为历史/非当前。
- 在独立分支 `codex/rbv-quality-one-attempt`（基准 `b79dde707461cc785100e0f07d39fda140fad21a`）完成 provider-free bounded correction；正式新 QualityRun 默认 `attempt_policy=provider_at_most_once_v1`、`max_attempts=1`，Rewrite 继续独立使用 `max_attempts=3`。既有数据库行由迁移默认标记 `legacy`，不把历史运行误报为严格一次。
- QualityRun 新增持久化 dispatch permit 与真实 HTTP invocation 分离计数：`provider_dispatch_count` 与 `provider_http_request_count` 均最多 1，且 HTTP 不得超过 dispatch；dispatch 在执行前提交，HTTP invocation marker 在客户端调用前提交。lease/reclaim/duplicate worker/崩溃均 fail-closed，不会重新进入 Provider。usage/token/charge 使用显式 `reported`/`unknown` 状态和 nullable 字段；local cost 保留 `not_calculated`/`unknown`，不调用 billing API，不保存 prompt/response/secret。
- DeepSeek semantic evaluator 删除 malformed/schema correction request，要求通过 durable `providerRequest` seam 调用；production selector `deepseek_hybrid`、provider `DeepSeek`、model `deepseek-v4-flash` 分开持久化。Quality 开始时仍冻结待评 v2 以稳定字节，但通过 additive `supersedeParent=false` 保持 parent v1 的 status/body/row_version 不变。
- Memory/PG repositories 均实现一次性 dispatch、usage/charge/audit、严格过期终止与 per-copy strict unique index；retry endpoint 对 strict run 返回 `QUALITY_ONE_ATTEMPT_RETRY_BLOCKED`，不同 start key 也只回放既有 strict run。Copy quality API 与 operator/browser projection 隐藏 strict retry/start action，显示 Owner-gated stop。
- TDD 证据：`node --test test/copy-quality-one-attempt.test.js`（27 pass）、`node --test test/copy-quality-api.test.js`（8 pass）、`node --test test/copy-quality-browser.test.js`（2 pass，含桌面/390px strict stop/cancelled/legacy-unknown/invalid stop）、`node --test test/copy-generation-service.test.js`（11 pass，含旧 freeze receipt replay）、`node --test test/copy-quality-evaluators.test.js test/copy-quality-service.test.js test/operator-workspace-service.test.js`（全部 pass）、`node --test test/production-start.test.js`（15 pass）、`npm run check`（249 JS files）。临时 PostgreSQL 16.14 容器 `hifly-quality-one-attempt-pg` 上 `TEST_DATABASE_URL=... node --test test/copy-quality-postgres.integration.test.js` 为 2 pass；迁移版本、legacy nullable counts/active fail-closed/terminal unknown, strict unique race, count/check, usage/charge unknown, completion response gate, lease no-reclaim 均通过。完整 A–J 映射与首轮 RED 见 `docs/status/sessions/2026-08-31-issue-273-quality-one-attempt.md`。
- 本历史 Stage 未调用真实 Provider/DeepSeek/Hifly、未发送外部请求、未登录、未创建真实 QualityRun 或下游对象，积分与 Provider tokens/cost 为 `0`；Issue #273 的工程变更已合并/部署但 GitHub Issue 仍保持 OPEN，不再是当前 active stage。

## Issue #264 DeepSeek provider activation deployment mapping（2026-08-30）

- Issue #264 当前在独立分支 `codex/rbv-deepseek-provider-activation` 实施，仅收敛 production Compose 的 app 环境映射：`COPY_GENERATION_PROVIDER`、`COPY_QUALITY_EVALUATOR` 与 `COPY_QUALITY_REWRITER` 默认保持 `phase1_controlled_test_double`；`DEEPSEEK_API_KEY` 仅透传 `${DEEPSEEK_API_KEY}`，不在仓库提供字面量或默认值。
- TDD 证据：旧 head `0eb52fa` 加入部署合同断言后 `node --test test/production-deployment.test.js` 为 `7 pass / 1 fail`（RED）；加入最小 Compose 映射后同一测试为 `8 pass / 0 fail`（GREEN）。
- `node --test test/production-start.test.js` 为 `15 pass / 0 fail`；`npm run check` 检查 `249` 个 JavaScript 文件。该仓库候选不改变 production-start 的 Provider 选择或 fail-closed 行为。
- 本轮没有 Provider/DeepSeek 请求、没有业务数据、没有登录、没有飞影、没有部署或 CI 写入，积分消耗为 `0`。生产部署与 exact-head CI 仍 pending；Owner 已明确授权在独立 Review 与 exact-head CI 通过后进入 deployment/provider activation stage。真实 smoke/认证和费用验证在本 Stage 明确 deferred，首个真实 Copy job 仍需另行授权。
- `.dockerignore` P0 secret-context 排除已闭合：`.env`、`.env.*` 被忽略，`!.env.example` 保留示例配置；当前 exact allowlist 为 7 个文件。
- Activation maintenance gate 已固定：旧 App 运行时先构建新镜像；重建前只停 `app`，不停止 Proxy/PostgreSQL；App 停止后跨全部组织只读核对 `copy_generation_jobs`、`copy_quality_runs`、`copy_rewrite_jobs` 中 `status IN ('queued', 'running')`，三者均须为 `0`（不因 `attempts` 已达上限而豁免）才能启动新 App。任一失败或非零即恢复受控配置/旧 App 并停止。当前只读基线：generation `succeeded=9, active=0`；quality `succeeded=9, active=0`；rewrite `active=0`。

## Issue #261 RBV-002 Calibration Readiness Freeze（2026-08-29）

- 唯一现行 Goal 为 [`RBV-GOAL-001`](../../GOAL.md)；Stage 1 合同与人工门禁（Issue #259 / PR #260）已完成历史。当前 Readiness Freeze 记录为 [`RBV_CALIBRATION_READINESS_FREEZE.md`](RBV_CALIBRATION_READINESS_FREEZE.md)，唯一结论 `BLOCKED_PRE_REAL_RUN`。
- `RBV-CAL-001` 冻结 `SKU-CAL-001` ～ `SKU-CAL-005` 的 source-aligned identity、fixture 分离、图片数量/格式/尺寸/构图、网页图片权利、人工目标、候选人物、Provider 输入、`max_points=1200`、Evidence alias/relative ref 与逐 SKU blocker；五项 gate status 均为 `BLOCKED`。
- Owner facts：`OP-CAL-001`、batch hard cap `6000`、per SKU `1200`、concurrency `1`、`automatic_retry=false`、日期 `2026-08-29`、时区 `Asia/Shanghai`、窗口 Owner confirmation → `23:59:59+08:00`。上限是最大暴露，不是消费授权；non-author operator 继续 `pending`，不阻塞 Calibration readiness 但阻塞 Repeatable。
- 候选人物只引用 `RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png`；PNG `1122x1402`、`1666036` bytes、mode `0600`、SHA-256 `0887c7e4748caf2f9735e7d7d1afd6788d2f3b6e4d3a9a53a9c88f1767093b10`，文件与七个 Evidence 目录骨架均在 Git 外。内部/Provider 上传权限与 live upload 未授权；不创建 Hifly avatar。
- 当前 real run 另受 `LOGIN_RUNTIME_UNVERIFIED`、`UPSTREAM_PRODUCT_FACTS_UNVERIFIED`、`UPSTREAM_COPY_NOT_VERIFIED`、`AVATAR_SELECTION_NOT_VERIFIED`、`VIDEO_PLAN_NOT_VERIFIED`、`ORDER_READINESS_NOT_VERIFIED`、`PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED`、`PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED`、`POINTS_SPEND_UNAUTHORIZED` 阻塞。现有 Playwright 直接人物+商品上传仅是工程基线；不创建 ProductionOrder/attempt，不登录、上传、生成、下载或消耗积分。
- 本轮不修改 UI/API/DB/Cloud Executor，不访问 Provider/Hifly，不部署、不发布；Evidence 目录 mode `0700` 且无真实 evidence。独立 Reviewer 与 Owner Gate 前保持停止。

## 历史：Issue #259 RBV-001 Stage 1：合同与人工门禁（2026-08-29）

- 当时唯一现行 Goal 为 [`RBV-GOAL-001`](../../GOAL.md)，产品决策为 [`D-037`](../../docs/product/DECISION_LOG.md#d-037-real-batch-production-validation)，执行合同为 [`REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`](../../docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)。该 Stage 1 快照现为历史；旧 P0 Goal 仅保留在 [`docs/status/archive/GOAL-cloud-executor-p0-complete-2026-08-13.md`](archive/GOAL-cloud-executor-p0-complete-2026-08-13.md) 作为历史事实。
- Stage 1 合同锁定 3–5 个真实或已授权去标识化商品、至少 2 个品类、至少 1 次人工修正；不预设成功率。后续真实批次须达到可复现的至少 10 条，连续 5 条作业期间不得修改生产代码；成本不合理时停在 Owner Gate，不得自行缩样。上述规则继续约束当前 Readiness Freeze。
- 当时真实运行前，Owner 必须逐项确认 Calibration roster、每个素材的权利/用途/留存与脱敏、非作者运营者、可接受积分/成本上限、允许登录窗口及证据红线；当时没有 roster、素材、成本、运行、发布或反馈结果可记录。
- 当时真实业务门禁还要求至少一名非作者运营者启动第二批，以及至少一条真实视频已交付、展示或用于运营；fixture/fake/mock/controlled provider/本地 demo 只能作为工程证据。Provider、飞影、Secret、积分、客户素材、公开发布、生产部署与破坏性操作均 fail-closed，按动作等待 Owner 明确授权。
- Stage 1 历史验收要求独立 Reviewer 标记 `APPROVED`；实现者不得自审或批准。Draft PR 在 Owner Gate 停止，不合并、不开始 Calibration。治理测试、验证结果和本阶段边界记录在 [`2026-08-29-rbv-001-calibration-contract.md`](sessions/2026-08-29-rbv-001-calibration-contract.md)。

## REL-001 可信 TLS 仓库门禁（已合并，未部署，2026-08-27）

- 固定基线：`4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`；实现分支：`codex/rel-001-trusted-tls`；PR #256 已由 Owner 授权管理员 squash 合并为 `main@4c8c27fca76ed5deaa6fb2f4f2ef348484feec23`。该仓库实现尚未部署或改变当前运行入口。
- Production Compose 将 Nginx 配置作为 `/etc/nginx/templates/default.conf.template` 只读模板挂载，Proxy 只传入
  `PUBLIC_HOST`，`NGINX_ENVSUBST_FILTER` 精确限制为 `^PUBLIC_HOST$`。公网 80 对精确 Host 统一 308 到固定
  `https://${PUBLIC_HOST}$request_uri`，未知 Host 命中 default server `444`，不反射 `$host`。
- Proxy 健康检查改为容器 loopback `127.0.0.1:8080/healthz`，8080 不发布；公网 HTTPS（含 `/healthz`）走普通 App proxy，
  继续由既有 trusted Host/Origin gate fail-closed。HTTPS 只增加 `Strict-Transport-Security: max-age=31536000`，未启用
  `includeSubDomains`/`preload`，Secure Cookie 与身份逻辑未改动。
- 固定 base 的 RED 为 production-deployment `5 pass / 1 fail`；实现后 focused production tests `21/21`、`npm run check`
  检查 248 个 JS 文件、`git diff --check` 均通过。完整证据见
  `docs/status/sessions/2026-08-27-rel-001-trusted-tls.md`。
- 当前公网仍是 IP + 自签证书内部试运行；正式域名、DNS、可信证书、严格 CA/browser 验收与任何部署动作均未完成。
  2026-08-27 无登录字节复核确认公网 Works/Assets 六个静态文件逐项精确匹配
  `8787b60c82f928a1277467b95868ae47d011ec64`，并与 `main@4ae506e` 全部不同；新 workspace 静态资源仍为 404。
  因而当前只可把公网 Web bundle 认定为旧部署，不能把已合并视觉升级或本 TLS 候选记作已上线；后端/数据库精确版本仍需获授权的只读 SSH 审计。
  Owner 已允许继续域名以外的生产化工作；严格只读 SSH 确认服务器 Git 与 App OCI revision 均为精确 `8787b60c`、工作树干净，
  app/postgres/proxy healthy 且零重启，Cloud Executor 容器不存在，Local Agent/Cloud Executor 均 disabled、执行器 fail-closed。
  最新 `hifly-20260824T132240Z.dump` 已在无网络的独立 PostgreSQL 15 临时容器完整恢复出 92 张 public tables 与 13 个 migration ledger，
  临时容器/volume 已精确删除，生产服务未停止或改变。当前仍缺已部署的自动/异机备份、监控告警、主机防火墙与 SSH 最小权限收口；
  `ufw` inactive，SSH 为 key-only 但允许 root、X11 与 TCP forwarding。本轮 Hifly=0、points=0、无部署、无生产业务状态写入、无 Worker/Local Agent。
  REL-001 同时新增每日数据库备份的 systemd 仓库候选（service/timer/runner），但尚未安装、enable、start 或做真实备份验收；当前主机仍无该 timer/cron。
  Owner 手动登录后，对既有 Work `80958749-9f92-40e6-a30e-7c886b555ef6` 的短时下载授权为 POST 201；Proxy 记录完整 GET 200、
  发送 `43,425,097` bytes。输出卷源文件只读复核为同一大小，SHA-256 为
  `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`；页面仍为待检查、尚无交付记录。

## Issue #252 公共数字人缩略图同步（2026-08-26，真实只读校准）

- 已在独立 worktree 的 fixed `main@831c927` 实现只读 thumbnail source seam 与素材中心导入/绑定闭环：source 输出只含受控 bytes、media、size、SHA-256；provider identity、真实 MIME、claimed size/SHA、10 MB cap 均服务端 fail closed。
- sync source 预取另有最多 100 个条目 / 64 MiB 的聚合内存上限；超限条目仍保留官方列表分页结果但中性计为 `thumbnail_unavailable`，不进行 Asset 写入，避免恶意目录导致无界 Buffer 累积。
- Memory sync barrier 期间普通 Assets/Avatar list/get/version 与 generic download authorization 经过 read gate，commit/rollback 完成后同一 turn 才放行；provisional Asset/AvatarVersion 不进入普通 projection。Provider key 额外拒绝 DEL/C1（`U+007F–U+009F`）。
- 现有管理员显式同步入口复用，不新增 endpoint/migration；普通目录/workspace 读保持零 Provider 调用。稳定 provider key+checksum 重放不新增版本，checksum 变化追加 `avatar_image` AssetVersion 并绑定公共 Avatar 当前版本，历史保留；memory 串行 gate 与 PostgreSQL advisory lock/同事务边界覆盖组织隔离、并发和 rollback。
- Owner 于 2026-08-26 明确授权只读登录飞影并校准公共数字人缩略图，禁止创建任务、点击生成、消耗积分或执行 Provider 写操作。实页 `/avatar` 的「公用数字人」卡片确认加载真实 `hfcdn.lingverse.co` 图片；代表人物「周景行」页面图片与公开数字人市场 cover 为同一 JPEG（1,987,252 bytes，SHA-256 `e15b88a3880967db06d0b5ceae12cfd738b19223a5ace610188f652369d6f91d`）。全程 0 task / 0 generate / 0 Provider write / 0 points。
- 该只读校准证明真实缩略图字节存在且公开 CDN 可读，但尚未提供可安全启用的 runtime source：开发者公共人物 API 仍只有 `avatar/kind/title`；页面 DOM 与公开市场响应没有给出 `avatar` 到 cover 的官方精确绑定，公开市场 737 条中还有 31 组重名。产品合同禁止按姓名猜图，因此真实 source 继续 disabled，管理员 sync 未调用；不能把“真实图可见”过称为“已完成自动导入”。
- LocalObjectStore 的 `put/head/get/remove` 以 body+metadata 完整提交为可见边界：metadata 序列化失败清理本调用 body；重启在 body bytes 与请求精确相同时恢复 body-only 或损坏 metadata partial，异 bytes 不覆盖并 fail closed；同进程 per-key lock 与独立 Node 进程的唯一临时 metadata + 固定 `.metadata.v2.json` hard-link 原子不覆盖 publish 保证单一完整赢家，legacy `.metadata.json` 永不 unlink，普通 `get` 不暴露未提交 body。
- 主控最新 default `npm test` 为 1229 total / 1213 pass / 15 skipped / 1 failed；唯一失败是未修改的 Works browser line 599 在并行负载下失败，default 仍不是绿色。随后该文件 isolated rerun 自然通过 1/1；该 isolated 通过不抵消 default 失败。
- final candidate default `npm test` 另一次运行超过 2 分钟后，Node 与本次 Playwright Chrome 均为 0% CPU 且无新增 TAP 输出；仅终止本次命令自身。该 run 非绿色但没有产品断言失败，属于测试/浏览器 harness 无进展；此前 1229/1213/15/1 与 isolated Works 1/1 仍是历史证据，不得过称。

## Issue #254 单任务工作区视觉与交互升级（已合并，未部署）

- 固定基线为 `main@831c92719cf2e6da1680d07de654e82741960939`。Issue #254 / PR #255 沿用已确认原型方向并合并为
  `main@4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`：深色指挥顶栏、
  1440 商品队列 / 当前任务 / 服务端详情三栏、768 两栏、390 单任务详情，以及浅色固定底栏中的单一蓝色推荐动作。
- Stage 1–5 的 route、公共选择器、action registry、URL/history、Dialog、409/503、权限和写命令保持不变；不新增 API、
  数据库、领域状态或 Provider 推断。页面内辅助按钮与页签降为中性样式，底部 `#workspacePrimaryAction` 保持唯一品牌主动作，
  高度 52px（移动 50px）、圆角 16px。
- 当前系统 Chrome 证据为 Stage 1 2/2、Stage 2 3/3、Stage 3 3/3、Stage 4 9/9、Stage 5 6/6；
  1440x900、768x900、390x844 临时截图已人工查看。人物为安全测试 PNG，只证明授权/bytes/layout，不是飞影真实人物视觉。
  default `npm test` 自然结束为 1213 total / 1197 pass / 15 existing environment skip / 1 fail；唯一失败在未修改的 Assets
  移动焦点旧回归，isolated 1/1 通过，因此该次本地 default 不记 GREEN。PR #255 fixed head
  `86e779c6743e3cf8caff45f5d869a3d9cae6e2ab` 的 required CI run `33002623021` 三绿，随后已 squash 合并为
  `main@4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`；该 main head 的 CI run `33029333736` 也已通过，但尚未部署。
- 本轮没有访问 Hifly/Provider、创建任务、点击生成、运行 Worker/Local Agent、部署、写生产数据或消耗积分。完整 allowlist、
  RED/GREEN 与边界见 `docs/status/sessions/2026-08-27-frontend-visual-upgrade.md`。

## Issue #250 素材中心与移动收口

- 固定基线为 `main@255569deaba294807b3348a985277a850be3dce2`。候选包将公共 Assets 收敛为
  `product_image`、`avatar_image`、`work_video` 三种服务端真值；`work_video` 的 rename/new-version/metadata/status/
  delete 由 Asset service/API 对 member/admin 统一只读。missing、cross-org、internal、deleted 的通用新下载授权统一
  generic fail-closed；内部 candidate 不能通过 work output replay 洗成公共作品。
- ProductRevision 图片绑定只接受 `product_image`。memory ProjectContent UoW 新增 LIFO rollback callbacks，并以
  transaction-owned reservation 关闭 bind/delete/disable 交错；PostgreSQL 按 parent Asset -> exact Version 的锁序并持锁至
  enclosing commit。现有删除门禁只覆盖 `asset_references`，不等价于企业人物、AvatarSelection、Work 等跨领域全部历史
  引用；该关系真值与 migration 是明确 deferred 的独立 Product/API gate。
- Assets canonical kind/asset URL、history/popstate、list/preview/action epoch、503 撤权、409 二次确认、Dialog/移动返回
  焦点与 bfcache 身份重读均 fail closed；迟到 download grant 与过期 rename/upload/danger intent 在 route/refresh/pagehide
  后零下载/零写，必须显式 reload/reopen 才重绑定。390 detail 只 mint selected preview，1440 exact detail 缩窄到 390/768
  保持详情 layer；身份重读失败会撤权并切回保留唯一可见 refresh 的 list layer。只有最新成功 list
  snapshot 中 exact available+verified `avatar_image` 复用既有 generic
  same-origin 短时授权生成 list/detail 同 URL 预览；过期、授权失败、decode 或 bytes SHA drift 均清 stale `src`，不把
  token/URL/object key/Provider 信息持久化或写日志。`work_video` 零 image grant。
- 当前 fixed candidate 本地证据为 focused 59/59、PostgreSQL 16 Assets 1/1、新系统 Chrome 19/19、兼容 12/12、A14
  stress 3/3、Stage 5 committed-503 stress 10/10/full 6/6、Stage 1–5 + Works 24/24。review 后本机 default 的两次
  自然结束各有一个不同浏览器时序失败，第三次在
  #595 后 0% CPU hang 并显式终止；因此本地 default 仍不记 GREEN，最终全量终态等待 Draft PR exact-head required CI。
  两个已证实的 harness 竞态均 test-only 收口：A14 先等公开入队 UI 再运行 worker；Stage 5 不再从 Playwright
  `route.fetch()` 同连接重入 public POST，而由测试 server 的公开 handler 先 commit、再一次性返回 503，继续以真实 HTTP
  锁定浏览器自动重读。
  preview ready 后的精确 1440x900、768x900、390x844 临时截图使用 1x1 黑/白 PNG fixture，只证明授权、
  bytes 与布局，不是生产人物视觉。完整 scope、RED/GREEN、hash 与命令见
  `docs/status/sessions/2026-08-25-operator-single-workspace-assets-mobile-closeout.md`。
- 本 Goal 未访问 Provider/Hifly，未启动 Worker/Local Agent，未 SSH/部署、修改生产数据、生成真实视频或消耗积分，也未
  开始视觉研究。只有 Issue #250 经独立 Review 合并后，才可启动独立视觉 refinement/research Goal。

## Issue #190 商品图片候选类型收敛

- Product/API gate 确认现有 `GET /api/assets` 已为每个 Asset 投影服务端 `kind`，Project 页面可直接使用
  `product_image` 真值，不需要新增或修改 API、数据库、领域状态与权限合同。
- Project 的“商品图片”候选只接纳 `kind=product_image`、Asset `active` 且 AssetVersion `available` 的版本。
  `avatar_image` 与 `work_video` 不再展示或可选；历史/脏 revision 中残留的非商品图片版本 ID 不进入
  可引用集合、不能满足 Ready blocker，也不会进入前端保存 payload。
- 公开真实 Chrome 回归使用同一个 `/api/assets` fixture 同时提供三类 active+available 素材：修复前人物图片
  实际进入候选（RED），修复后仅商品图片可见可选，并继续覆盖历史 revision 只读、dirty 保护、409 恢复、
  素材失效刷新和 Ready 竞态提示。
- 该修复已通过 Issue #190 / PR #196 合并，并随 `main@80bdfd45` 部署到内部验收环境。真实管理员只读验收确认
  服务端 active+available 素材中 `product_image=5`、`work_video=7`，Project 商品图片候选恰好只显示 5 个
  商品图片文件且没有任何 mp4/作品视频；本轮没有保存或修改 revision。

## Issue #191 Production 终态真值恢复

- Product/API gate 确认现有组织隔离 seam 已足够：Production workspace 提供所选持久化工单，manual execution
  提供 attempt/report，work verification 提供 A12 job 与 Work ID，`GET /api/works/:workId` 提供检查和交付真值；
  不需要新增或修改 API、数据库、领域状态与权限合同。
- 当所选工单已为 `succeeded` 时，Production 首屏从该工单的持久化 execution、A12 与 Work 投影恢复下一步，
  不再因 Cloud Executor 离线、`current_order=null`、交接包下载授权过期或手工交接功能关闭而回落为激活前状态。
  A12 未发起、排队/运行、
  失败/需处理、通过但尚未登记 Work，以及 Work 的 `pending_review` / `rework_required` / `deliverable` /
  `delivered` 均保持独立业务状态与唯一下一步。
- A12 已登记 Work 但精确 Work 状态暂时读取失败时，首屏明确显示“作品状态读取失败”，只推荐刷新当前工单；
  不把读取失败伪装成“正在登记作品”，不使用 stale delivery，也不开放下一单。
- A12 状态本身读取失败或响应不属于当前所选工单时，旧 verification/Work 投影立即失效，首屏明确显示
  “核验状态读取失败”，只允许刷新当前工单；恢复后才重新显示同一工单的真实 A12/Work 状态。
- 修复只适用于已成功工单的终态恢复。`waiting_for_executor + ready package` 的激活前 fail-closed、组织级唯一
  eligible、当前工单零 attempt、active attempts=0、claimed/running/failed/requires_action/cancel、失败停批、
  无自动重试和企业 Web 无 Worker 启停命令的合同均未改变。
- 公开真实 Chrome 回归先复现 succeeded + A12 passed + Work pending_review + Worker offline 时错误显示
  “生产门禁未通过”（RED），再锁定持久化 A12/Work 状态矩阵、刷新恢复、唯一推荐动作及 1440/768/390。
- 该修复已通过 Issue #191 / PR #197 合并，并随 `main@80bdfd45` 部署到内部验收环境。真实管理员只读验收在
  Worker offline、`current_order=null` 时确认 persisted succeeded 工单首屏为“作品待检查”，唯一推荐动作
  “进入作品库检查”指向 exact Work；“生产门禁未通过”未出现，创建工单入口保持 disabled。

## 下一代运营单任务工作区 Stage 0 至 Stage 5 门禁

- Owner 已于 2026-08-23 接受“一个商品、一个稳定工作区、一个当前阶段、一个唯一推荐动作”的方向。1440 使用
  商品列表 / 当前任务 / 辅助上下文 / 底部操作，768 收敛为两栏，390 使用单面板与列表/详情/返回。
- Issue #236 / PR #237 已把正式 UX 合同与 Product/API 门禁合并进入 `main@b7716acf8f58edb9bc1a5f9cb1016532436fb7b4`，
  因而 Stage 0 状态为 `designed`。这不表示后续阶段已实现、已部署、已被客户采用或通过 Provider 验收；Owner 评审过的
  throwaway 原型仍只作为设计输入，不得直接合并或当成运行证据。
- Product/API 审计确认各阶段现有 API 继续持有写入和业务状态真值，但稳定工作区缺少 project/product/stage 的只读
  聚合投影。Stage 1 只读取商品资料；未迁移阶段稳定返回 `legacy/not_loaded` 并导航到既有页面，不投影对象、业务状态、
  blocker 或推荐动作。推荐动作使用按 Goal additive 的版本化 registry；未知或错阶段 code 一律不显示、不执行。不得创建
  组织级队列、跨阶段写事务或前端 Production 门禁推断。
- Stage 3 人物的 Product/API gate 复用现有私有目录素材绑定与通用短时 Asset grant/bytes，并新增人物专用
  preview authorization：memory 在相应串行门禁内；PostgreSQL 的预览与企业目录登记先取得同一组织级跨表事务锁，再以
  同一事务行锁重核 actor/organization、可见 active
  目录条目、私有素材绑定、`avatar_image` 父 Asset `active`、exact AssetVersion `available` 以及已验证
  media/size/SHA-256，再 mint 短时 grant，关闭目录读取与通用授权之间的 interleaving 和相反行锁顺序。下载时还会把
  object bytes 与 grant 中的 exact size/SHA-256 重新比对，漂移即 fail closed。公共响应只投影短时
  preview URL 与受控元数据，不返回 `material_asset_version_id`、object key、永久/Provider URL 或凭据。真实缩略图与大图
  使用同一受控版本；只有缺失、不可用、授权或解码失败时才显示带自然中文原因的首字 fallback。390 使用人物列表 ->
  详情 -> 返回，并恢复 exact list item 焦点。
- 后续严格串行 Stage Goals：Stage 1 商品资料（含所需最小 shared foundation/只读投影）-> Stage 2 文案 -> Stage 3 人物
  （含 secure real preview）-> Stage 4 视频方案 -> Stage 5 生产 -> Post-stage 作品库 -> 素材中心/移动收口。作品库的后续
  桌面验收固定为 9 项原型数据第 1 页 6 项、第 2 页 3 项；390 保持列表 -> 详情 -> 返回。每个 Goal 独立 Issue、Draft PR、
  真实 Chrome 1440/768/390、CI 和 Review；前一 Goal 合并后才开始下一 Goal，不自动部署，也不得搬运 throwaway 原型或旧
  `gui/visual-refresh` 改动。
- Issue #238 / PR #239 已把 Stage 1 商品资料仓库实现合并进入 `main@f87c2068d4668f72f40396ddfc815c0a472fc003`：新增默认关闭的 `/workspace.html` opt-in、只读取
  Product/Project/current ProductRevision 的 operator workspace projection、v1 七动作 registry，以及商品列表/当前任务/
  辅助上下文/固定操作区。canonical local/demo/production 启动链均有显式配置路径；local 与 production 默认关闭，受控
  demo 明确开启且继续使用 fake executor。`copy/avatar/video_plan/production` 固定为 `legacy/not_loaded` 并回既有页面；
  路由只消费实时选中商品和 revision，商品或版本变化后不沿用旧 copy/plan/order 上下文。Back/Forward 的 dirty 取消恢复
  exact 已接受路由；投影、Project 或 Assets 读取失败时隐藏旧表单并移除桌面/移动全部阶段 href，只保留 scoped refresh，
  恢复成功后才按 exact current 商品与 revision 重建导航。该合并只表示 Stage 1 仓库实现成立，仍不表示部署或生产验收。
- Issue #240 / PR #241 已把 Stage 2 文案仓库实现合并进入 `main@c6ce40166a9b68da58dfb91c77682148f9876c60`：在同一 opt-in workspace 中 additive 投影 exact current
  CopyVersion、生成任务、QualityResult 与 HumanReview，并保持 QC passed 与人工批准分离。Stage 2 只扩展 `copy`；
  `avatar/video_plan/production` 继续 `legacy/not_loaded`，不读取或伪造后续阶段真值。推荐动作 registry 仅增加
  文案动作，未知版本、未知动作或错阶段动作 fail closed。CopyGeneration 投影按 repository 的 newest-first 契约读取当前
  任务；`needs_review` 只复用既有 finding resolution API，接受理由、返回商品资料与人工修改保持可审计，hard block 不可
  接受，effective QC 真正通过前不开放人工审核。AI 改写仍由既有 Copy 页面承载，本片未迁入。该合并只表示 Stage 2
  仓库实现成立；不表示部署、真实 Provider 生成或生产验收。
- Issue #242 / PR #243 已把 Stage 3 人物仓库实现合并进入 `main@4293be0e80deafc0d844f596239626be4bcdead4`：
  additive 投影 exact current AvatarSelection、组织可见目录及授权/素材/能力门禁，并通过人物专用短时授权提供同一受控
  `avatar_image` 版本的缩略图与大图。memory 串行门禁与 PostgreSQL 组织级事务锁、同事务行锁关闭目录、私有绑定、父
  Asset/Version 与 grant 间的 interleaving；下载时复核实际 bytes 的 size/SHA-256。权威刷新、自然到期、授权失败和
  解码失败均清除 stale `src` 并显示有原因的首字 fallback；390 保持列表 -> 详情 -> 返回及 exact 焦点恢复。同商品
  CopyVersion 替换保留旧人物选择为失效历史，Stage 4/5 counted/throwing 端口为零读取。该合并只表示 Stage 3 仓库实现，
  不表示部署、真实 Provider 或生产验收。
- Issue #244 / PR #245 已把 Stage 4 视频方案仓库实现合并进入 `main@334a88198192121694ded34844f247c0ed983bbf`：
  additive 投影 exact current VideoPlan、preflight run/result、人工审核与历史，保持 preflight passed/warning 与人工批准
  严格分离；既有 VideoPlanning API/状态机继续持有创建、保存、派生、预检与审核写入真值。计划链 identity、current head、
  run/result 双向绑定、幂等回放、审核原子门禁、dirty/409、异步读取与三视口恢复均 fail closed。该合并只表示 Stage 4
  仓库实现成立，不表示部署或生产验收。
- Issue #246 / PR #247 已把 Stage 5 生产仓库实现合并进入 `main@0b0d1d94df4a06b9209e7385f7082e3cad53a742`：
  additive 读取 selected ProductionOrder、handoff package、ManualExecution attempt/report、A12 verification 与
  Work/delivery，并继续由既有服务持有写入真值；不读取或推断 eligible、active attempts 或 Worker 状态，也不提供
  Worker 启停、自动重试、重新领取或自动创建下一单。该合并不表示部署、运行时或生产验收。
- Issue #248 是 Post-stage 作品库方案 A 的独立 acceptance gate。新增分页模式固定 page size 6，以专用 PostgreSQL
  read port 在单个 `REPEATABLE READ` 事务内计算 `(created_at DESC, id DESC)`、filter、6+3、total、anchor 与 exact
  selected Work；只锁定/读取当前页最多 6 个 Work，也只为当前页缺 inspection 的 Work 初始化 pending
  inspection/audit/ledger，页外保持零写；两个首次 GET 竞争同一 Work 初始化时不泄漏 raw PostgreSQL unique code，且
  最终只产生一组初始化记录。不可见/过滤外/本页外 anchor 统一为 null selection，不回落到另一作品形成
  写目标；本片不新增 DB、migration、领域状态或写命令。1440 使用列表/详情/操作三栏，768/390 使用列表 -> 详情 ->
  返回；读取失败、stale async、409 与模糊写响应均 fail-visible。模糊结果必须以原 idempotency key 显式重放确认，
  不能用状态/数量猜测；未收口前阻止跨作品/分页/筛选/Back，确定性 409 才使用最新 inspection binding 与新 key。
  390/768 每态最多一个可见可执行主操作，不可用/已撤回 Work 零 Dialog、零 POST。
  下载授权精确绑定 Work、AssetVersion、期限与已核验 media/size/SHA-256，跨 Work URL fail closed。
  只有 Draft PR 经独立 Review 合并后才计为仓库实现；不表示部署、生产数据或客户验收，也不授权素材中心实现。
- `main` 分支保护的 required status checks 已在不改变 strict 与既有 Ubuntu/Windows context 的前提下 additive 加入
  `identity-postgres`；此后 PostgreSQL required check 失败会阻止 merge，不再只依赖人工门禁。

## UX V1 Slice A 仓库实现

- Owner 已批准 UX 方案 A“运营任务流优先”；Issue #164 / PR #165 已将精确合同合并进入 `main`，当前状态为 `designed`。
- `docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md` 固化首屏五问、业务状态优先、唯一推荐下一步、技术详情折叠、
  Entry seam、Production 时序门禁、Works 列表+预览、Assets 类型/用途分组和 1440/768/390 验收合同。
- Issue #166 / PR #167 已完成 Slice A 的仓库实现；2026-08-18 该实现随 `main@5c6384d` 部署到内部验收环境，
  Entry、Login、Projects 与 Project 的核心路径通过真实管理员只读验收。该证据仍不是客户采用或公网发布证明。
- 企业能力开启时，直接访问 `/` 进入 Projects；登录、改密、会话恢复与成员无权限回落继续使用现有企业落点。
  显式 `/index.html` 保留本地/运维 legacy fallback，并提示企业流程进入项目；feature-off 或 runtime/auth 请求失败时
  安全保留 legacy 页面，不产生空白页、跳转循环或权限绕过。
- Projects 覆盖加载、空、失败、有项目和创建 Dialog；有项目时优先继续最近项目。Project 覆盖无商品、草稿、
  未保存/保存中/已保存、Ready、superseded、Ready 阻断和 409 版本冲突。商品切换、刷新和冲突后载入最新版本
  均显式保护本地修改；只有商品的当前 revision 可编辑，任何非当前 revision（包括状态仍为 Ready 的父版本）
  都作为只读历史快照呈现并提供回到当前版本的入口。409 恢复按冲突商品重新选择其最新 current revision，
  不会回到旧父版本。历史 revision 深链通过组织隔离的只读 seam 加载：404 或归属核对失败安全回落，
  网络、5xx 或无效响应则显式失败且保留请求上下文。草稿首屏按 active asset + available version 的交集计算
  Ready 阻断；素材竞态失效时刷新可引用集合并要求重新选择。Projects 快照不足时明确提示进入项目核对，
  不伪造零阻断。
- 新样式仅在 `.operator-task-page` 根节点下生效，未迁移企业页面和 legacy GUI 不受共享 CSS 意外影响；浏览器回归覆盖
  1440/768/390、无页面级横向滚动、Dialog 焦点恢复、可见焦点和 reduced-motion。
- Production 合同按时序执行：每轮激活前 Worker off，只为当前 SKU 准备 order + ready handoff，eligible 严格为
  `[currentOrderId]`，当前 order `attempts=[]` 且 active attempts=0；terminal 后立即关 Worker并保留 attempt。
  失败/需处理停止且不创建下一条、不自动重试；成功须经 A12 passed、Work available 与鉴权真实字节下载后，
  才能在 Worker off 下准备下一条。
- UX 页面实施保持严格串行：Slice A（Entry seam + opt-in foundation + Projects/Project）与 Slice B
  （Copy/Avatar/Plan）均已合并，并已随 `main@5c6384d` 部署到内部验收环境。Slice B 后不直接开始 Slice C，而是先完成 Owner 已锁定的
  successor gate；该 gate 完成后只决定 Slice C（Production/Works/Assets）rebase 或吸收到后续分片，
  不再照旧直接实施。
  每个实施分片仍须独立 Issue、Draft PR、浏览器回归和 Review，且不自动部署。
- 旧 `gui/visual-refresh` 工作树及 CSS-only 改动不是本轮基线，不得合并、搬运或覆盖；现有 tokens、基础组件、
  vanilla HTML/CSS/JS、组织授权、状态机和 fail-closed 生产合同继续保留；唯一新增 API 是组织隔离的
  `GET /api/product-revisions/:revisionId` 只读 seam，写路径与领域语义不变。

## UX V1 Slice B 仓库实现

- Issue #168 / PR #169 已完成 Slice B 的实现与 acceptance gate；2026-08-18 已随 `main@5c6384d` 部署。
  Copy、Avatar 与 Plan 的状态驱动任务摘要、唯一推荐下一步和业务状态区分已通过真实管理员只读验收；这不代表
  客户采用，也没有改变或重新验证真实飞影生产链路。
- Copy 首屏区分生成、质检与人工审核：生成成功不等于质检通过，QC passed 不等于 HumanReview approved。
  异步生成中可离页恢复，生成/质检失败提供同阶段重试；脏文案与 409 冲突继续保留本地输入和现有恢复动作。
  只有当前有效的人工批准文案才推荐进入人物选择。
- Avatar 首屏以当前商品的 approved copy、当前人物选择及可用性门禁为真值；“为商品选择人物”是主任务，
  企业人物登记仍是管理员次级入口。未选择、选择已失效、授权或素材阻断均不会伪造可继续状态；每个商品保持
  独立选择，只有当前有效确认才推荐进入 Plan。
- Plan 首屏区分草稿、未保存、预检中、预检失败、预检 warning/passed、人工审核中、需修改、已批准和上游失效。
  preflight passed/warning 不等于 Plan approved；冲突保留本地输入，非当前方案只读，只有当前有效
  HumanReview approved 方案才进入“等待生产工单能力”状态。
- 三页继续复用现有 vanilla HTML/CSS/JS、API、状态机、授权和审计证据；没有新增依赖、后端 seam 或自动终态。
  浏览器回归覆盖 1440/768/390、无页面级横向滚动、可见焦点与 reduced-motion；截图只写入临时目录且不入 Git。
- Slice B 完成后的 successor gate 顺序已由 Owner 锁定：内部问题审计、定向外部研究、Issue #174 的 V2
  独立设计合同和 V2-A shared foundation 均已合并。实现必须继续按 Production → Works → Assets → 必要时
  回补 A/B 严格串行；设计合同或仓库实现不等于部署或客户采用。

## 运营工作台 successor gate

- Issue #170 已完成 Slice B 之后的内部问题审计；`docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md` 已进入
  `main`，成为后续定向研究与设计合同的权威输入。
- 审计从角色任务、频率、错误成本、权限/审计、安全门禁、现有 API/领域状态和中文环境出发，覆盖企业入口、
  Projects/Project、Copy/Avatar/Plan、Production/Works、Assets/Members 与显式 legacy `/index.html`。
- 当前主要 P1 聚类是：一级导航与项目阶段导航职责不清且缺少全局生产任务入口、Production 技术状态抢占业务主叙事、
  Works 已交付终态仍有多个竞争动作、Assets 缺少类型/用途/关联语义，以及内部英文术语和移动端首屏层级不一致。
  同一管理员/runtime 的跨九页取证确认一级导航显隐一致，不再把不同测试 fixture 的能力/角色差异误判为跨页不稳定。本轮本地假数据
  公开 seam 未发现新的 P0，但这不替代真实 Provider、部署或长期运行证据。
- Issue #172 已完成定向外部研究，`docs/frontend/OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md` 已进入
  `main`。研究只回答内部审计的明确问题，并把外部模式分类为 adopt、adapt 或 reject；它不等于最终 IA、
  页面方案、实现、部署或生产采用。
- Issue #174 已将 `docs/frontend/OPERATOR_WORKBENCH_UX_V2_CONTRACT.md` 合并进入 `main`，V2 设计状态为
  `designed`；这只表示设计获批，代码实现、部署和客户采用仍为独立门禁。
- Issue #176 / PR #177 已将 V2-A shared IA/content/control foundation 合并进入 `main`。企业壳层已统一
  一级导航顺序、五阶段标签、V2 中文词典、刷新作用域及 opt-in 审计/技术详情原语；全局“生产任务”在组织级
  真实索引 gate 通过前继续隐藏。未迁移页面与显式 legacy `/index.html` 不受共享样式影响；该入口边界已在
  2026-08-18 内部验收环境复核。
- Issue #178 / PR #179 已将 V2-B Production Task Flow 合并进入 `main`。Production 仓库页面已采用逐单业务摘要、
  完整工单/交接包/执行/A12/Work 状态矩阵、唯一推荐下一步、完整 bootstrap 恢复，以及默认折叠的
  Cloud Executor/attempt/handoff 技术详情。#191 已修复 Worker 关闭后的 terminal Work 投影，并随
  `main@80bdfd45` 完成真实管理员只读验收；该证据仍不是新一轮真实生产、客户采用或公网发布证明。
- Production 仅在当前商品零工单且上游 gate 允许时开放“创建生产工单”；任一已有工单（含 claimed/running、
  failed/requires_action、已交付但未完成真实字节验收）都会真实禁用两个创建入口。Work 的 `pending_review`、
  `rework_required`、`deliverable`、`delivered` 均按控制面同名状态进入作品库对应动作，不回落成生产门禁错误，
  也不在真实字节证明前宣称本单完成或开放下一单。
- 当前 API 不提供组织级 `eligible=[currentOrderId]` 和 active attempts=0 的可验证前端投影。V2-B 因此在 `ready`
  交接包阶段保持“生产门禁未通过”，等待获授权运维在既有部署控制面核对；前端不拼装组织队列、不显示 Worker
  启停命令，也不把 `worker.connection=online` 或 `readiness.status=available` 单独解释成可安全领取。
- 固定实施顺序为：V2-A shared IA/content/control foundation → Production → Works → Assets，最后仅在证据
  需要时回补 Slice A/B；每片仍须独立 Issue、Draft PR、公开浏览器回归和 Review。
- Issue #180 / PR #181 已将 V2-C Works Review and Delivery 合并进入 `main`：作品库仓库页面完成列表/预览层级、
  四种业务状态、终态动作收敛、显式追加交付、移动端列表/详情分层，以及服务端授权的文件名、媒体类型、大小、
  校验值与真实字节下载合同。该页面已部署并完成只读 UI 验收；本轮没有创建下载授权或重新验证真实字节下载，
  因此不替代既有下载证据，也不等于客户采用。
- Issue #182 / PR #183 已将 V2-D Assets by Real Type 合并进入 `main`：素材中心按 `product_image`、
  `avatar_image`、`work_video` 三种服务端真值分组，明确 Asset/AssetVersion 层级，并保持作品视频只读、
  图片上传与临时下载授权、乐观冲突和组织权限语义。素材用途、业务关联、缩略图、搜索和分页没有现成 API 真值，
  不由前端推断。该页面已部署并通过三类素材与 `work_video` 只读的核心验收；#190 已收敛 Project 商品图片
  选择器，并随 `main@80bdfd45` 完成真实管理员只读验收。
- Issue #184 / PR #185 已完成 V2-E 回补审计并进入 `main`。审计证据不支持全站返工，只接受两个严格串行的
  最小回补：V2-E1（Projects/Project/Copy 的业务中文、刷新作用域与 Copy Tab 键盘语义）已通过 Issue #186 / PR #187
  合并；V2-E2 已通过 Issue #188 / PR #189 合并并随 `main@5c6384d` 部署。Avatar/Plan 的业务中文、技术详情层级与
  Plan Tab 键盘语义已完成真实管理员只读验收，但仍不代表客户或 Provider 采用。Avatar 的内部 ID、
  原始代码和能力依据引用只移入折叠审计详情，Plan 只使用现有 API 可证明的商品与业务状态；未新增或猜测业务名称。
  若展示修复需要改变存储/API 真值，必须停在 Product/API gate。
- Production 的企业 Web/API 当前只提供 `GET /api/cloud-executor/status` 只读状态；Worker 启停继续由获授权运维在
  既有部署控制面执行。V2 页面不得向组织用户推荐不存在的“启动工单/Worker”命令；未来若要 Web 启停必须另过
  Product/API、安全授权和审计 gate。

## 2026-08-18 运营工作台 V2 内部部署与 UI 验收

- 内部验收环境已更新到精确 `main@5c6384d523cc8b251a2def04f47e99b3cdbd142a`。13 组 production migration
  全部成功；只 recreate App 并 restart Proxy，PostgreSQL 未重启。App、PostgreSQL、Proxy 均 healthy，公网
  `/healthz` 返回 ok。
- 部署前数据库备份为 `/var/backups/hifly/hifly-20260818T004615Z.dump`。管理员应急密码恢复前另创建
  `/var/backups/hifly/hifly-20260818T010850Z-pre-password-reset.dump`。
- Cloud Executor 保持 `exited / running=false / exit=0`，`eligible=0`、`active_attempts=0`。未访问 Hifly、未生成
  视频、未消耗积分，也未修改商品、订单、作品或交付等生产业务数据。
- 因唯一管理员忘记密码且没有第二管理员，按既有身份合同执行一次应急自重置：追加 `admin_reset` credential、设置
  `requires_password_change=true`、撤销旧会话并写入 `identity.password_reset` 审计。用户随后完成首次改密并登录；
  旧密码未被读取或回显。该动作属于受控身份恢复，不应误写为“完全没有生产数据写入”。

## Issue #193 实物尺寸与商品呈现大小

- Issue #193 的仓库实现为 ProductRevision 增加可选实物尺寸、容量和重量事实，未知值保持未知，
  不从图片像素推断。VideoPlan 使用飞影原生六档商品呈现大小，并将两类事实纳入版本、
  上游失效、Production 固定输入快照、交接包和 Playwright 执行输入。
- 只读静态证据已核实飞影六档映射：智能适配 `0`、超大 `50`、大 `40`、中 `30`、小 `20`、
  超小 `10`；选中态由对应图片的本地化 `alt` 与父容器 `actived` 类共同验证。执行器在付费生成前
  必须选择并验证期望档位；控件缺失、映射不支持或选中态不可验证时 fail closed。
- Issue #193 已随精确 `main@db36cc53d63f1db85e810bd72b0a8b21d86aedfa` 部署到阿里云内部验收环境。
  13 组 production migration 全部成功：`physical_dimensions` 为 nullable JSONB 且 object check 生效；
  `presentation_size_code` 为 NOT NULL、默认 `smart_fit` 且六档 check 生效。既有 10 个 ProductRevision 保持
  SQL `NULL`，既有 6 个 VideoPlan 安全回填 `smart_fit`，invalid=0。
- PostgreSQL 16 回归已覆盖实物尺寸默认未知、对象往返和显式清空：未知或清空使用 SQL `NULL`，不写入
  JSONB `null`。CI 的 PostgreSQL job 严格串行执行 Identity、ProjectContent v2 与 VideoPlanning v2 集成测试；
  VideoPlanning 测试先应用其真实依赖的 Asset migrations，避免缺表被环境 skip 掩盖。
- 候选 App image 在 `--network none` 下完成 Issue #193 相关隔离组 139/139；部署后的 Project、Plan、Production
  六个 HTML/JS 文件与仓库目标提交逐字节一致。只 recreate App，App healthy 后 restart Proxy；PostgreSQL 未重启，
  Cloud Executor 与 Local Agent 均保持关闭，最终 `eligible=0`、`active_attempts=0`、`waiting_orders=0`。
- 真实管理员只读验收确认：防晒霜当前 ProductRevision 的实物尺寸保持未知且 UI 留空；当前 approved/frozen Plan
  显示六档原生选择并以“智能适配”承接迁移默认；历史 ProductionOrder 的冻结 input snapshot 没有新字段，页面诚实
  显示“实物尺寸：未知 / 商品呈现大小：未设置”，没有用当前 Plan 反向改写历史。三页 console errors=[]，本轮没有
  保存 ProductRevision、derive/save/preflight/review Plan，也没有创建工单或新交接包。
- #190/#191 已随精确 `main@80bdfd4500c66cd564daeb7a3badcfd070478809` 统一部署并完成真实管理员只读复验；
  两项旧行为均未再出现。该复验没有点击 Works、下载、保存、创建、刷新或其他写操作。
- 上述部署与只读验收阶段未访问 Hifly、未启动 Worker、未生成视频、未消耗积分。随后另一次获授权的真实单条
  Provider 验收已执行，结果见下节；不能再把 #193 写成“尚未执行真实付费出片”。呈现大小仍不自动证明瓶盖、
  包装、标签或商品形态保真。入口仍是 IP + 自签证书，不能宣称公网生产就绪。
- 完整部署与证据边界见 `docs/status/sessions/2026-08-18-issue-193-internal-deployment.md`。

## 2026-08-18 Issue #193 真实 `small` 档单条验收失败

- 验收对象为 `SUNSCREEN-20260818-003 · 安热沙金瓶防晒霜（原生小档验收）`。Product、ProductRevision、
  CopyVersion、AvatarSelection、VideoPlan、Order 与 ready handoff 均已固定；Plan 为 `frozen / approved / warning`，
  `presentation_size_code=small`，交接 manifest 也包含 `small`。
- 激活前 Worker off，组织级 eligible 只有当前 order，当前 order attempts=0 且 active attempts=0。第一次容器启动因
  Profile 中上一容器遗留的 Chromium `Singleton*` 锁未领取工单、未创建 attempt、未进入付费动作；三把锁已移动到
  Profile 内可恢复目录而非删除。第二次启动仍属于同一获授权单次执行。
- 唯一 attempt `b5ba1480-da8e-408c-933a-312ab3ac1afd` 最终为 `failed`，报告
  `26906357-d092-43e2-99bf-e91bc29694b8` 为 `outcome=failed / failure_stage=playwright_execution /
  retryability=not_retryable`，没有自动重试。
- Hifly 产生 `remote_id=713098`；候选 `638fc536-3452-42c8-965e-719f16e18083` 已上传为
  `video/mp4`，50,650,990 bytes，SHA-256
  `3921fc8e803cf319598505e542d59463987f7d018f80e0f10497e5ded460f260`。本机 forensic 副本不是
  A12/Work 鉴权下载；本轮 `A12 jobs=0`、`Works=0`，因此不满足正式成功合同。
- 真实 Provider 证据显示：点击“立即生成 150积分”后，弹窗仍视觉高亮“智能适配”，而非期望的“小”。当前
  `img alt + parent actived` 校验在真实页面可能是假阳性，Issue #200 跟踪选档真值与付费前 fail-closed 修复。
  成片仍为双手托持，商品尺寸未小于 baseline；金瓶和斜蓝盖保留、未变泵头，但瓶身比例与标签清晰度不完全保真。
  尺寸验收为 FAIL，外观保真为 PARTIAL/FAIL，总体为 FAIL。
- 候选授权、heartbeat、上传与失败报告在约 104ms 内交错。Issue #201 后续已用 memory 与 PostgreSQL 隔离 TDD
  确认 `MANUAL_EXECUTION_ATTEMPT_CONFLICT` 竞态，并以不放宽乐观锁的统一终态门禁完成仓库修复。
- 订单已经明确 `failed`，但 Production 首屏仍显示激活前的“等待生产门禁核对 / 生产门禁未通过”。Issue #202
  独立跟踪 failed 工单持久终态投影；本次修复只有进入 `main` 后才成立，不得把它与竞态或“重试当前失败工单”合并。
- Provider 按钮显示 150 积分，且发生一次付费生成动作；点击前与外层提交后 header 都显示 `44007`，但最终余额
  没有刷新验证，因此不得声称精确扣分数。完整对象、时间序列、候选与安全收尾见
  `docs/status/sessions/2026-08-18-issue-193-native-small-provider-acceptance.md`。
- 最终恢复 `CLOUD_EXECUTOR_ENABLED=false`、`CLOUD_EXECUTOR_MODE=fail_closed`、
  `LOCAL_AGENT_ENABLED=false`、`PRODUCTION_EXECUTOR=fail_closed`；Cloud Executor stopped，App healthy，
  `eligible=0`、active attempts=0、waiting=0、total attempts=16。

## Issue #200 Provider 商品大小选中态

- Provider 静态资源真值显示六档由同一内部状态同时驱动请求 `goods_size`、图片框 `actived` 和文字
  `gradient`。修复继续使用已核实的六个 canonical code/value，不按 DOM 顺序猜测映射。
- 付费前校验不再只读取目标图片父节点。当前可见“手持商品图”弹窗必须呈现完整且唯一的六档集合，图片框与文字
  选中标记必须一致，并连续两次只选中期望档位；默认“智能适配”残留高亮、多选、标记不一致或结构漂移均返回
  `HIFLY_GOODS_SIZE_SELECTION_UNVERIFIED`，从而在 `立即生成` 前 fail closed。
- 无积分公开回归先复现“目标 `小` 父节点看似 active、但完整组选中仍为智能适配”会被旧实现放行，再锁定新实现拒绝该
  假阳性；现有测试继续证明任何选档校验失败都不会点击付费生成按钮。
- Issue #200 / PR #204 已合并，并随 `main@8787b60c` 部署。后续唯一新工单的真实 Provider 复验证明：完整六档
  图片框与文字标记一致，连续观测仅“小”处于选中态，默认“智能适配”未残留高亮，付费前校验通过。该证据只证明
  选档真值，不自动证明成片包装外观保真。

## Issue #201 heartbeat/report 版本竞态

- memory repository 与真实 PostgreSQL 16 的 Cloud Executor 服务 seam 均确定性插入同一交错：candidate 上传完成后、
  terminal report 持久化前，heartbeat 将 attempt `row_version` 推进一版。未修复基线两套 RED 都捕获
  `MANUAL_EXECUTION_ATTEMPT_CONFLICT`，并观察到成功候选被外层失败收口改写为 failed；因此上次真实运行的竞态
  假设现已由隔离 TDD 确认。
- 最小修复不放宽 repository 乐观锁：执行器终态前停止接受新的定时 heartbeat，等待已排队 heartbeat 完成，检查
  heartbeat/progress 错误后重新读取并验证同一 Cloud Executor 所属、仍为 running 的 attempt，再以最新 revision
  写入唯一 terminal report。成功 candidate 上传期间仍续租；执行器正常返回及抛异常形成的失败、需人工处理和成功
  报告均使用相同终态快照门禁。排队 heartbeat/progress、最终 attempt 读取、归属校验或 running 状态任一失败均统一按
  `CLOUD_EXECUTOR_LEASE_LOST` 停闭；门禁失败后不再通过兜底读取写 terminal report。
- GREEN 同时证明：只有一个 attempt、一个绑定该 attempt 的 primary candidate、一个 completed report 和一次 A12 请求；
  candidate 进入 `pending_verification`，没有 failed report、重复终态、自动重试或第二次领取。既有租约失效、身份隔离、
  report 幂等、candidate 绑定与 A12/Work 条件均保持。
- CI 的 PostgreSQL job 增加 ManualExecution/Cloud Executor 集成测试，避免真实并发合同只在本地或 memory 测试中存在。
  Issue #201 / PR #205 已合并，并随 `main@8787b60c` 部署；后续真实复验的唯一 attempt 完成 candidate、唯一 terminal
  report 与 A12，没有再次出现 heartbeat/report revision conflict。

## Issue #202 failed 工单首屏终态

- Product/API gate 确认现有 Production workspace、manual execution 与 Cloud Executor 状态投影已足够，不需要扩展
  API、数据库、领域状态或权限合同。
- 对所选持久化 `failed` 工单，即使 Worker offline、`current_order=null`，或 Cloud status 仍残留同一工单的
  claimed/running/failed 与 pending execution 投影，首屏仍优先显示“生产失败，已停止”；只有 exact execution
  workspace 中同一工单的 failed attempt 与 failed report 同时成立时才提供唯一“查看失败详情”动作，否则只允许
  返回视频方案检查输入。
- 失败摘要明确不会自动重试、重新领取或创建下一单。在线 current order 的失败/需处理语义、
  `waiting_for_executor + ready package` 激活前 fail-closed、requires_action、取消与 succeeded+A12+Work 状态矩阵保持不变。
- 公开真实 Chrome seam 在未修复基线得到“生产门禁未通过”（RED），最小修复后锁定失败终态、唯一安全动作、
  创建入口禁用与 1440/768/390 无横向溢出（GREEN）。Issue #202 / PR #206 已合并并随 `main@8787b60c`
  部署；部署后旧 failed 工单只读显示“生产失败，已停止”与唯一“查看失败详情”，没有被离线 Worker 状态覆盖。

## 2026-08-19 Issue #193 真实 `small` 档复验：技术通过、外观返工

- 验收对象为 `SUNSCREEN-20260819-004 · 安热沙金瓶防晒霜（原生小档复验）`。新 ProductRevision、批准 Copy、
  AvatarSelection 与 frozen/approved VideoPlan 均绑定到本次新工单；`presentation_size_code=small`，实物尺寸保持未知。
  工单 `c440c19e-671e-4b27-8c38-2d8535952268` 的 ready handoff 为
  `73829028-442a-4d74-8ddb-379e839889b5`。激活前 Worker off、eligible 仅该工单、attempts=[]、active attempts=0。
- 第一次启动发现 Profile 中三个 Chromium `Singleton*` 符号链接仍指向旧容器；此时没有 Chromium、claim、attempt 或
  付费动作。Worker 关闭后把三条精确链接移到 `/var/backups/hifly/cloud-profile-singletons-20260819T0054CST`
  可恢复目录，再次激活仍属于同一获授权单次执行。
- 真实 Provider 弹窗的完整六档图片框与文字标记连续两次唯一选中“小”，“智能适配”没有残留高亮；随后只点击一次
  `立即生成 150积分`。发生一次付费动作，但页面余额未刷新核对，因此不声明精确扣分。
- 唯一 attempt `5ebd4199-1f32-4d37-ac08-e73103d856dd` 与 report
  `d72adefa-69fe-43b8-8ecc-68bd61f464fa` 均成功；Hifly `remote_id=713273`。primary candidate
  `7ba1e9f1-1758-4200-a07d-91a2d699ba02` 为 69,782,276 bytes，SHA-256
  `537a43d19d6dbe173cbd45e3118c3f5ce417ad2c6958781729961e08c35c33dd`。A12 verification passed，Work
  `08fdf795-734b-4d0e-a541-0b932d12b1fb` 为 available；鉴权下载得到同字节数与同 SHA-256 的真实 MP4。
- 成片为 23.64 秒、1600×2848、H.264/AAC。商品呈现大小在全片相对较小且稳定，尺寸档位验收为 PASS；但原图的
  平滑斜切蓝色瓶盖被持续生成成明显蓝色钻石/宝石造型，核心包装几何失真。金色修长瓶身及 ANESSA/SPF50+ 大体保留，
  外观保真仍为 FAIL，整体内容验收为 FAIL。
- Work 检查 `30080e8d-4851-43b5-8913-e7e0d16500ea` 已登记 `rework_required`，类别
  `visual_quality`、目标 `video_plan`；没有交付记录。不得把 technical success、A12 passed 或 Work available
  解释为内容批准，也不得自动重试、重新领取或创建下一单。
- terminal 后 Worker 立即关闭并恢复 `CLOUD_EXECUTOR_ENABLED=false`、`CLOUD_EXECUTOR_MODE=fail_closed`、
  `LOCAL_AGENT_ENABLED=false`。最终 eligible=0、active attempts=0、waiting orders=0、total attempts=17。
  完整证据见 `docs/status/sessions/2026-08-19-issue-193-native-small-provider-revalidation.md`。

## Issue #208 通用商品外观保真门禁

- Owner 已把真实瓶盖几何失真提升为所有商品通用的身份一致性合同；商品呈现大小与外观保真保持独立，SKU 说明
  只能作为可选补充，不能形成商品专用代码或固定禁词。
- Fidelity-0 已通过一次获授权候选生成建立有界 Provider Evidence：精确本地源图 419685 bytes、SHA-256
  `e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5` 与 Provider 上传预览逐字节一致；
  候选响应把 `gen_id=lZRGIwOKPBScFlEz` 与 275745-byte JPEG 绑定，候选 SHA-256 为
  `1778a04198280c4cf2d08f78ba544085da44611d76f69b0653004bffe483244b`。没有保存完整 URL 或凭据。
- 候选在点击“确认”和外层视频提交前安全停下；关闭浏览器上下文后，同一受控 Profile 可恢复候选就绪。没有点击
  候选确认、外层视频生成，也没有创建或复用生产工单。长期/跨设备生命周期、正式下载 API、Provider 评分和产品
  领域 AssetVersion 绑定仍未证明。
- Fidelity-A 的 acceptance artifact 为 `docs/product/PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md`。该文档随对应 PR
  合并进入 `main` 后才计为 `designed`：选择 ProductionOrder 前独立候选门禁，显式冻结
  `source_asset_version_id`，把候选 bytes 写入系统管理 AssetVersion；不可变 Candidate、可变 CandidateState、带有效期的
  ProviderReferenceObservation、精确 CheckRun/Result、人工 AppearanceReview 与最终 WorkInspection 分别持有真值。
  Production 创建和 claim 分别绑定 exact Observation；过期、读取失败或无法安全再观察均为 unknown，任一未知零 attempt
  失败关闭。
- 候选生成本身可能收费。本次恰好执行一次显示“150积分”的候选生成动作，但余额未刷新，精确变化未知；门禁只能
  阻止后续视频提交，不能宣称候选阶段零积分。后续真实探测仍需当次独立授权。
- D-035 与 `docs/product/PRODUCT_APPEARANCE_FIDELITY_GATE.md` 定义产品边界；D-036 固定生产前候选门禁。
  Fidelity-A 已进入 `main`，只表示设计完成，不等于实现、部署或 Provider 验收。

## Fidelity-B Provider capture 与 Fidelity-C0 能力门禁

- Issue #214 / PR #215 已合并为 `main@c4abb79271c5ede127b8e3d51b3d10632a5d7336`。仓库现具有默认关闭的
  `AppearanceCaptureRequest`、不可变 `AppearanceCandidate`、1:1 `AppearanceCandidateState`、append-only
  `ProviderReferenceObservation`、内部 `appearance_candidate_image` AssetVersion、组织作用域 REST 与短任务 Worker。
- 创建 request 只冻结当前 ProductRevision、精确 `source_asset_version_id`、approved Copy、confirmed Avatar、
  frozen/approved VideoPlan 与呈现大小，不调用 Provider。管理员授权固定 `max_candidate_generations=1`；request
  失败或取消后 terminal，不提供 retry/resume。source bytes/media/size/SHA-256 在创建与 claim 前均从受控存储复核。
- Provider Adapter 是注入 seam，生产配置默认 `APPEARANCE_FIDELITY_ENABLED=false`，默认 Adapter 为 disabled，
  Worker 默认不启动。脱敏 fake Adapter 的候选输出按不可信输入验证 media/magic/size/checksum、request/source/reference
  绑定与安全对象键；Candidate、State、Observation、内部 AssetVersion 和 request succeeded 在同一事务完成，失败回滚并
  删除暂存对象。
- Provider Observation 采用 `valid_until=observed_at` 的 same-gate-only 策略，不凭 `gen_id`、历史成功或旧时间推断
  current availability。真实 Hifly observation seam、合理正 TTL、长期/跨设备恢复与 claim-side 无副作用再观察仍未证明，
  因此 Fidelity-D 继续是 stop condition。
- PR #215 独立审阅后的纠偏进一步锁定：默认 App/Asset 端口可直接读取精确已验证源图且创建 request 不触发 Provider；
  Provider 未来时间不能延长零时效；内部候选不能经通用 Assets 精确读取、改名、禁用、删除或下载；PostgreSQL
  request 的冻结上游/源图/身份/授权上限及 terminal truth 由数据库 trigger 阻止同状态改写。这些现在是 repository truth，
  但尚未部署或接入真实 Hifly Adapter。
- Fidelity-B 只实现 capture/storage/API 基础，不实现 Fidelity-C 自动检查与人工审核 UI，不修改 Production
  create/eligible/claim/handoff，不部署，也没有访问 Hifly、生成候选/视频或消耗积分。
- Issue #216 的只读 gate 确认 `src/` 没有 AppearanceCheckRun/Result、AppearanceReview 或视觉检查 Adapter，依赖中也没有
  已接受的视觉/OCR模型；D-036 明确保留的模型、阈值、误判率、费用和数据治理 Evidence 均未建立。因此 Fidelity-C 代码
  失败关闭，先由 `docs/product/PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md` 定义 capability shortlist、受控 benchmark、
  逐维证据与 Owner acceptance。fake Adapter、固定 passed、单张截图或总分不能越过该门禁。
- Issue #218 / PR #219 的 Fidelity-C1 shortlist 已合并进入 `main@8c9930f430738c381a6ed6cc67fd06a02c4f8391`，只表示官方来源研究完成。
  当前只有本地 PaddleOCR/OpenCV 基线具备进入独立受控 benchmark 的资格。OpenAI 固定 snapshot 因官方输入要求禁止 Logo
  图片而保持 reserve/blocked；Google Vertex AI 因旧 lifecycle URL 重定向、当前版本锁定与迁移语义待复核而保持 reserve；
  混合方案在合规多模态组件获接受前保持 deferred。没有调用模型或上传图片，逐维覆盖、严重误放行、误阻断、unknown、
  延迟和真实费用仍全部未验证，`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持不变。
- Issue #220 / PR #221 的 Fidelity-C2 readiness blocker 审计与 Issue #222 / PR #223 的 Fidelity-C3 准入合同已进入
  `main@f8d63e7c387a02c2b41f0695f71cb2e305529828`。C2 当时的 `DATASET_BLOCKER` + `ANNOTATION_BLOCKER` 已由 Fidelity-C4
  仓库外受控包解除：alias `HIFLY_APPEARANCE_BENCHMARK_V1` 包含 4 个 exact source/candidate 配对、4 类/4 商品族；
  `ANT-01` 完成 4 samples x 7 axes，独立盲审角色 `RV-01` 精确绑定 annotation SHA-256 并 accepted，0 changes requested、
  0 unresolved。Owner 已批准 12 个月保留至 2027-08-21、2027-07-22 前复审且不自动续期。图片和 annotation/review JSON
  正文仍在 Git 外；仓库只记录 alias、相对 artifact、bytes/SHA-256 与 acceptance 结论。
- Issue #224 / PR #225 已将仓库侧 Fidelity-C4 acceptance 合并进入 `main@fb04b4870b721be00f4b6f093654526e230a921c`。
  Issue #226 / PR #227 已将 Fidelity-C5 环境与 harness 合同合并进入 `main@a65a74ef0f94c131df0712e9943b68a0c835220e`：合同锁定 exact dataset 输入、可证明的
  Python/PaddleOCR/PaddleX/PaddlePaddle/OpenCV/OCI 发行制品 hash、canonical Linux/amd64 lane、离线缓存、盲评和逐维
  raw Evidence 合同；C3 annotation axes 与 D-036 runtime dimensions 保持显式双层映射，一对多不得复制真值，明显伪影不新增
  第八维。OpenCV 只允许 versioned policy 明列的静态图像处理/测量，继续禁止视频/codec/FFmpeg。Issue #228 / PR #229 已进入
  `main@4e352334374fee6a077fb95a599944239b12f5c1`：仓库外 artifact audit 取得 det/rec 权重 exact bytes/SHA-256 和安全 archive
  containment，仓库 synthetic validator/harness 使用 C4 同构字段；raw Evidence 固定 exact
  manifest/dataset/pair，scoring 拒绝跨数据集 truth，并以 version+content hash 锁定 mapping 和原子回链；测试 lock 只能得到
  `synthetic_contract_validated`。C4 review 的逐样本/逐轴决定必须全部解决，顶层 accepted 不得掩盖 changes requested；infer 与
  score 均按真实路径阻止直接或经 symlink 写回受控数据包。Synthetic truth 同时锁定 C4 pack 类型、sample 版本/时间、review
  时间与逐轴审计字段，`accept_annotation` 必须有独立 `decision_note`。它不表示 runnable environment、accepted benchmark 或能力结论。
  Issue #230 / PR #231 的 C5a 只读 Evidence 已进入 `main@4e18f1166869f2259d68083cd2975452cbbeb476`，把 tar 内 det/rec `inference.pdiparams` SHA-256 精确绑定到 PaddlePaddle 官方模型仓库固定
  commit 的 LFS OID；两个模型卡均声明 Apache-2.0。这证明 exact 参数 bytes 的第一方许可，不证明无 LICENSE/NOTICE 的 BOS tar
  可复制或再分发，故保持 `PP_OCRV6_BOS_ARCHIVE_REDISTRIBUTION_UNVERIFIED`。Issue #232 / PR #233 已进入
  `main@eab7758af94253aa22dd057f943f55d226f597b3`，接受后续 blocker Evidence：
  Linux/amd64 与 macOS/arm64 resolver 只能规范化为 64/62 条 `name==version` 记录，尚未形成 exact selected artifact/hash/license
  graph；PaddleX `ocr-core` 精确要求 `opencv-contrib-python==4.10.0.84`，headless 4.13 不能替代。contrib wheel 打包 FFmpeg，
  Linux 与 macOS non-headless wheels 均另有 Qt5；CVE-2025-53644 又将 OpenCV 4.10.0 列为受影响版本，未见 exact wheel
  backport Evidence。Issue #234 / PR #235 已进入 `main@677d79c2cc8256b7cb6661972b934b289c3b456d`，进一步只读核对最新固定版本：PaddleX `v3.7.2` 仍精确 pin contrib 4.10；
  OpenCV 4.14 两架构 patched wheels 存在但没有官方支持的 Paddle graph；第一方 fixed model tree 缺完整 SHA-256、
  `LICENSE` / `NOTICE` 与替代 BOS tar 的官方声明。该合并只固化 successor blocker Evidence，不提交 accepted lock、
  不安装或运行模型。
  `BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持不变。

## 历史：P0.5 内部验收环境部署（2026-08-13）

- `docs/product/CLOUD_EXECUTOR_P0.md` 是已完成 P0 的历史合同（非现行），仅作为历史事实查阅。

- 2026-08-13 将内部验收环境从 `main@40e92414d4ef4a4015da9bb3f709f775c67843b6`
  更新到精确 `main@5e449021eee6802b51a220009a8a3620d9bd40f4`；服务器 Git 工作树保持 clean。
- 因阿里云到 GitHub 的直连历史不稳定，本次使用本地验证过、仅包含 `40e9241..5e449021` 的 Git bundle
  快进，没有混入其他分支或工作区改动。
- 部署前 App、PostgreSQL、Proxy 均 healthy，Cloud Executor 为 `exited 0`；执行配置保持
  `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`、`CLOUD_EXECUTOR_CONCURRENCY=1`。standby heartbeat 环境变量仍为 true，
  但 Worker 容器未启动。
- 部署前 SQL 为 `eligible=0`、`active_attempts=0`、`total_attempts=13`。数据库备份为
  `/var/backups/hifly/hifly-20260813T092726Z.dump`（533808 bytes），回滚镜像为
  `hifly-pilot-app:rollback-40e9241-pre-5e449021`。
- 使用 `/opt/hifly-runtime/Dockerfile` 构建新 App；它与仓库 Dockerfile 的唯一长期差异仍是阿里云 Debian
  apt mirror。构建审计为 `0 critical / 0 high / 2 moderate`，没有运行 `npm audit fix --force`；13 组
  production migrations 全部成功，Archiver 8 `ZipArchive` 可实际加载。
- 只重建 App，App healthy 后重启 Proxy；PostgreSQL 未重启，Cloud Executor 未启动。部署后 App、PostgreSQL、
  Proxy 均 healthy，本机和公网 HTTPS `/healthz` 均返回 ok，`login.html` 返回 200。
- 容器内 `web/works.js` 和 `manual-handoff-package-store.js` 与目标提交逐文件校验一致；镜像实际依赖为
  `@fastify/static@10.1.3`、`archiver@8.0.0`、`fastify@5.11.3`、`sharp@0.35.3`。
- 部署后 SQL 仍为 `eligible=0`、`active_attempts=0`、`total_attempts=13`；Cloud Executor 仍为
  `exited / running=false / exit=0`，App 日志只有正常 production startup。
- 使用既有登录会话只读打开
  `/works.html?work=936e9b2e-027a-496b-9b3b-067f5b401cfc`：首次严格选中该 Work，详情为
  `SKU003 · 麦香坚果脆`，列表显示 10 条，未跳转登录且 console errors 为 0。因此 #156 已获得部署后的
  只读运行时证据。
- 本轮没有点击下载、创建下载授权或执行其他写操作；未访问 `hifly.cc`、未生成视频、未消耗积分、未启动
  Worker，也未新增 attempt。
- 完整部署、回滚、校验值和边界见
  `docs/status/sessions/2026-08-13-release-readiness-internal-deployment.md`。

## P0.4 三条严格串行内部试运行

- 生产代码与部署基线为 `main@40e92414d4ef4a4015da9bb3f709f775c67843b6`，App 在最终重启后保持 healthy。
- SKU001、SKU002、SKU003 先分别完成到 approved VideoPlan；每轮只在 Worker 关闭时创建当前唯一
  `waiting_for_executor` ProductionOrder 和 `ready` handoff package。激活前全组织 eligible 恰好为 1，
  当前工单 attempts 为空；上一轮完成 A12、Work 与鉴权字节下载后才创建下一轮。
- 三个工单均由 Cloud Executor 严格串行完成，且每单恰好一个 succeeded attempt、一个通过的 A12、
  一个 available Work；没有失败、`requires_action`、重试、重复提交或 Mac Local Agent 参与。
- 三个鉴权下载均返回真实 `video/mp4` 字节，大小与已登记 checksum 一致；最终 App 重启后作品库仍显示
  包含 SKU001/002/003 的 5 个作品，SKU003 的鉴权下载在该重启后再次通过。
- 飞影仅记录运行中观察值：SKU001 `06:36:12 / 51,464`、SKU002 `06:58:24 / 50,864`、
  SKU003 `07:14:18 / 50,259`。最终标签页卡住，三条完成后的动态余额未验证，因此不得据此推断总积分消耗。
- 收尾后 `eligible=[]`、`active_attempts=[]`，Mac Local Agent 进程为空；生产配置恢复为
  `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`、`CLOUD_EXECUTOR_CONCURRENCY=1`，Cloud Executor `stopped / exited 0`。
- 完整对象 ID、包哈希、文件大小、SHA-256 和逐轮边界见
  `docs/status/sessions/2026-08-13-cloud-executor-three-product-internal-trial.md`。

## 历史：CE-08 生产收尾证据

- 代码基线为 `main@f519d42db26ef5f59cb8a6a6fb80bf8b68fb7eb3`；PR #155 已 squash merge。
- Ubuntu、Windows、identity-postgres 三组 CI 均为 green。
- 云端仓库工作树已快进至该提交；部署前数据库备份已写入受保护的备份卷
  （471289 bytes），回滚镜像为 `hifly-pilot-app:rollback-dc4ca9f-ce08-download`。
- 本次只重建并重启 App。App healthy；Cloud Executor 输出卷在 App 内以只读方式挂载；
  Cloud Executor 本轮保持 exited/未启动，没有领取新工单。
- 既有唯一订单
  `ff5285cd-d2b7-4552-a276-cff18015fc67`、attempt
  `46d1f209-caf8-4998-8d5d-5e435b0b0f11`、candidate
  `09891151-59e6-4c87-849e-c6f0defc1be4`、A12
  `2e8adabc-c570-4ef6-b5bb-26733c4ad262` 与 Work
  `80958749-9f92-40e6-a30e-7c886b555ef6` 已逐项复核：订单/attempt 为
  `succeeded`，candidate 为 `pending_verification / passed`，A12 为
  `succeeded / passed`，Work 为 `available`。
- App 部署后及随后再次重启 App 后，真实 HTTPS 鉴权下载均为授权创建 POST 201、鉴权 GET 200；
  重启后的完整响应发送 `43,425,097` bytes。
- 下载文件、数据库 candidate/AssetVersion 与输出卷内容的 SHA-256 均为
  `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`。
- 本轮未访问飞影、未启动 Worker、未新增 attempt：`target_attempts=1`、`active=0`、`total=10`；
  积分记录仍只有原 CE-08 真实生成的 650。

## 历史：P0 验收结论

- 新的零-attempt 工单已经完成
  `Cloud GUI → Cloud Executor → Hifly → 下载 → 云端 artifact → A12 → Work → 用户鉴权下载`。
- Cloud Executor P0 合同的单条纯云端闭环已满足，GOAL 为 `COMPLETE`；P0.4 三条严格串行内部试运行也已通过，下一阶段为 release-readiness。
- Worker 仍保持单实例、并发 1、失败即停和默认 disabled/fail-closed；Local Agent 未参与本次闭环。
- 本结论只证明三条由人工门禁逐轮暴露的严格串行路径，不证明自动队列批量运行、更大规模或长期稳定性，也不宣称公网生产就绪、正式 SLA、高可用或灾备。

## 历史：发布就绪后续（P0）

- 现有公网证书仍为自签名，严格 CA 校验失败；仓库已补充
  `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md`，但正式域名、可信证书签发、部署和严格 CA 验收尚未执行。
- #157 的仓库侧依赖治理已完成：官方 npm registry 的生产审计由
  `0 critical / 20 high / 1 moderate` 收敛到 `0 critical / 0 high / 2 moderate`。剩余两项均来自
  `exceljs@4.4.0 → uuid@8.3.2` 的同一 moderate advisory；当前代码只使用 ExcelJS 读取工作簿，未调用受影响的
  UUID v3/v5/v6 buffer API。当前 latest `exceljs@4.4.0` 没有可向前升级的修复版本；npm audit 仅建议
  semver-major 回退到 `exceljs@3.4.0`，本轮未把依赖降级当作安全升级。详细证据和复查门禁见
  `docs/status/sessions/2026-08-13-issue-157-release-readiness.md`。
- #156 的最小修复已完成并通过本地浏览器回归：`works.html?work=<id>` 首次加载会选中
  组织内可见目标；缺失或不可见 ID 回落到第一条可见作品且不渲染隐藏作品信息。该修复现已部署到内部
  验收环境，并完成指定非首项 Work 的只读运行时验证。
- #157 的依赖治理已随 `main@5e449021` 部署并通过健康检查，但 Issue 仍保持 OPEN：入口仍为 IP + 自签证书，
  严格 CA、正式域名/DNS 和可信证书尚未完成；当前 HTTP `/healthz` 仍返回 200 而不是跳转到 HTTPS。

## 历史：当前运行时边界（P0）

- Cloud Control Plane 负责订单、attempt、交接包、报告、A12、Work 和 Delivery 的业务状态与鉴权。
- Cloud Executor 是独立执行身份；本轮完成证据来自云端链路，不将其伪装为人工成员或 Local Agent。
- 生产 Worker 的并发上限保持 1；同一订单最多一个活动 attempt，lease 过期或阶段不确定时进入受控状态。
- 飞影 Profile、商品/人物素材、Evidence 和输出视频位于云端持久卷；App 只读访问输出卷作为下载回退。
- 数据库只保留 artifact/AssetVersion 等受控元数据和内部引用，公共投影不暴露 Token、Cookie、服务器路径或对象存储 key。
- 三条试运行及本次单条复验都只在严格门禁后短时激活 Worker；terminal 后立即停止并恢复 fail-closed。本次 A12、Work、
  鉴权下载和人工检查完成后，Worker 已关闭且无 eligible order、waiting order 或 active attempt。
- Local Agent 继续保留为 legacy fallback；本轮未启动，后续也不得以它作为 P0 生产执行器。

## 历史：P0 完成定义映射

合同第 9 节的 11 项均有当前证据或既有实现覆盖：

1. 个人电脑关闭不影响本次云端订单完成。
2. 本次验收及下载复验未启动 Local Agent。
3. 浏览器 GUI 可提交、观察状态并下载鉴权 Work。
4. CE-07 已证明 Worker/Profile 重启恢复；CE-08 收尾证明 App 重启后视频持久性与下载字节保持。
5. Worker 运行约束为单实例、并发 1。
6. 订单与 attempt 使用既有幂等/租约合同，未发生重复提交。
7. 登录、存储和 readiness 门禁在 claim 前失败关闭。
8. 失败状态不自动重试，也不自动创建新 attempt。
9. 视频落在云端持久输出卷并可通过鉴权下载。
10. 新零-attempt 工单完成 Cloud GUI 到用户下载的完整链路。
11. 第 10 项完成后进入严格串行、受控内部试运行，而非公网生产。

## 历史：生产操作护栏（P0）

- 每条内部试运行在 Worker off 时只准备当前 SKU 的唯一工单和 ready handoff；激活前复核全组织 eligible
  严格等于当前 order、当前 order `attempts=[]`、active attempts=0、审批链、Profile/login readiness 和磁盘门限。
- terminal 后立即停止 Worker并保留 attempt 历史；失败/需处理不创建下一条且禁止自动重试、重新领取或再次生产；
  成功须完成 A12 passed、Work available 与鉴权真实字节下载，才可在 Worker off 下准备下一条。
- 真实飞影动作与积分消耗必须有当次明确授权，并记录订单、attempt、作品、产物路径和账单边界。
- 发生下载、A12 或 Work 异常时优先复用既有成功产物做无积分复验，不重新生成。
- 任何并发扩容、Provider/API 接入、Local Agent 恢复或公网发布都需 Owner 单独决策。

## 权威文档与恢复顺序

1. `AGENTS.md`：范围、积分、文件和协作安全门禁。
2. `GOAL.md`、`docs/product/DECISION_LOG.md`（D-037）、`docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`：RBV-GOAL-001 当前 Readiness Freeze 合同与门禁；Stage 1 合同与人工门禁已完成历史。
3. `docs/status/RBV_CALIBRATION_READINESS_FREEZE.md`：Issue #261 当前 Readiness Freeze record、五 SKU 状态、Evidence alias 和唯一 verdict `BLOCKED_PRE_REAL_RUN`。
4. `docs/ROADMAP.md`：RBV-GOAL-001 当前 Readiness Freeze roadmap 与后续 Owner Gate。
5. 本文件：当前 RBV-002 状态；历史 Stage 1、P0 与过程见 archive 和 sessions。
6. `docs/PROJECT_HANDOFF.md`：接力背景，不能覆盖当前 Goal 或 Readiness Freeze record。

## 历史：里程碑状态（P0）

| 里程碑 | 结果 | 状态 |
|---|---|---|
| CE-01 / #136 | 合同、Goal、设计、计划与 Issues | 已完成 |
| CE-02 / #137 | `cloud_executor` 身份、默认 fail-closed 串行 Worker | 已完成 |
| CE-03 / #138 | 复用现有 Hifly Playwright 核心 | 已完成 |
| CE-04 / #139 | 持久 Profile、受控可视登录、readiness | 已完成并实证 |
| CE-05 / #140 | 持久素材/视频、鉴权下载、磁盘门限 | 已完成 |
| CE-06 / #141 | 控制面状态与作品体验 | 已完成 |
| CE-07 / #142 | 阿里云 standby、卷与重启恢复 | 已完成并实证 |
| CE-08 / #143 | 一条纯云端真实出片验收 | 已完成并关闭 |
| P0.4 / #132 | 三条严格串行 Cloud Executor 内部试运行 | 已完成并关闭 |

## 历史：下一步（P0/REL-001，当前 Goal 之前）

1. #200/#201/#202 已完成实现、独立 Review、合并、部署与单条真实复验；尺寸选档和技术闭环通过，但 Work 已因瓶盖造型
   失真登记返工。没有新的重试或再次生产授权，保持本单 `rework_required` 且不交付。
2. Fidelity-0 Evidence、Fidelity-A、Fidelity-B、Issue #216 能力门禁、Issue #218 shortlist、Issue #220 blocker 审计与
   Issue #222 / PR #223 准入合同均已进入 `main`；本地 PaddleOCR/OpenCV 只是唯一具备后续受控 benchmark 资格的候选。
   Fidelity-C4 的仓库外 exact bytes、用途依据、4 类/4 商品族脱敏 manifest，以及不同角色完成的七维人工真值已随
   Issue #224 / PR #225 进入 `main`，Issue #226 / PR #227 已完成 Fidelity-C5 合同 acceptance，Issue #228 / PR #229 已把
   synthetic environment/harness seam 合并进入 `main@4e352334`；Issue #230 / PR #231 的 C5a 首轮 Evidence 已进入
   `main@4e18f116`；Issue #232 / PR #233 的 blocker Evidence 已进入 `main@eab7758`；Issue #234 / PR #235 的 patched lane 与
   fixed model route successor Evidence 已进入 `main@677d79c2`，只接受“最新固定 PaddleX 仍 pin contrib 4.10、OpenCV 4.14
   不能无官方支持地替换、fixed model tree 尚不足以替代 BOS tar”的增量结论，没有建立 accepted lane。下一步必须取得 archive-specific 官方再分发 Evidence、
   完整 model file identity/license route，或官方发布两架构受支持的 patched dependency graph；之后才可另行决定是否授权
   C5b 离线环境 materialization + synthetic smoke。不得以 headless 4.13/4.14、手工 contrib 4.14、
   `--no-deps`、metadata override 或 resolver report 绕过；C5b Review 前不得运行 accepted benchmark。capability、policy/model version、阈值、误判、unknown、费用与数据治理仍需 Owner 接受；真实 Provider Observation 的合理
   有效期与 claim-side 无副作用再观察仍未证明，Fidelity-D 继续保持 stop condition。
3. Issue #236 / PR #237 的单任务工作区合同已进入 `main@b7716acf` 并计为 designed；Stage 1 至 Stage 5 已随
   Issues #238/#240/#242/#244/#246 和 PRs #239/#241/#243/#245/#247 严格串行进入 `main@0b0d1d94`。Stage 5
   只 additive 读取并组织既有 ProductionOrder、handoff、ManualExecution、A12 与 Work/delivery 真值，不读取或推断
   eligible/active attempts/Worker，不自动重试、重新领取或创建下一单；合并不表示部署或生产验收。Issue #248 / PR #249
   的 Post-stage 作品库已以固定有界服务端六项分页、页外零初始化、strict null anchor、模糊 intent 跨上下文阻断与
   1440/768/390 composition 进入 `main@255569de`。Issue #250 素材中心/移动收口保持独立 Draft gate；只有 exact-head CI、
   独立 Review 与合并后才计为仓库实现，且任何仓库实现均不自动成为部署或生产验收事实。#250 合并后另开独立视觉 refinement/research
   gate：PC 的 1440 主工作区与 768 收敛、移动 390 的列表/详情分层是并行的一等合同，不设 PC/移动优先级，也不把
   桌面当作移动布局放大。两端共享业务真值、动作和状态词，但可采用不同响应式 composition；实现合并前均须真实
   Chrome 行为/截图与人工视觉 acceptance。外部设计站点只按 Hifly 自身任务选择性取证，不直接复制风格。
4. 任何真实 capability probe、候选生成或再次验收都必须使用当次明确单条积分授权；若进入视频工单，还必须使用
   新批准、唯一新工单与零 attempt，不能复用或重试本次工单。
5. 继续 P0.5 release-readiness：正式域名、DNS、可信证书、严格 CA 和 HTTP→HTTPS 仍未完成，当前环境只用于内部验收。
6. 保持 Cloud Executor/Local Agent disabled、Cloud Executor 并发 1，并按“激活前唯一当前 eligible + 当前 order 零 attempt；
   terminal 立即关 Worker；失败停批且不自动重试；成功验收后才准备下一条”的逐单时序护栏执行。
7. 是否扩大试运行规模、开放自动队列或宣称长期稳定，必须基于新的运行证据和 Owner 单独决策；历史三条成功与本次
   单条失败都不能直接外推。

## 长期边界

- Local Agent 保留为 legacy fallback，不是当前 P0 生产路径或验收依据。
- 不在本阶段扩展并行生产、Capture HTTP、声音/背景/姿势/动效、复杂对象存储或高可用。
- Profile、Cookie、素材、视频、Evidence、Token、下载文件和服务器绝对路径不得进入 Git、公共 API 或日志。

## 历史：已执行验证与证据索引（P0/CE-08）

- PR #155 的 Ubuntu、Windows、identity-postgres CI 均通过；基线与部署提交一致。
- App 部署前数据库备份可读且非空；回滚镜像已保留。
- App healthy、输出卷只读挂载、App 重启后鉴权下载 201/200 与完整字节发送均已实测。
- 下载、candidate/AssetVersion 与输出卷 SHA-256 已交叉核对一致。
- #132 三条试运行均为单一 eligible、零初始 attempt、一个 succeeded attempt；A12/Work/鉴权下载逐条通过，最终无 eligible order 或 active attempt。
- `main@5e449021` 已完成数据库备份、migration、App/Proxy 受控更新与健康检查；#156 指定 Work 的部署后
  只读浏览器验证通过，部署前后无 eligible order、active attempt 或新增 attempt。
- 本文档只记录生产收尾事实；历史实现过程、失败尝试和旧门禁详见归档 CURRENT 与各 session 文档。
