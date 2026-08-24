# 素材中心与移动收口

> 执行日期：2026-08-25
> 固定基线：`origin/main@255569deaba294807b3348a985277a850be3dce2`
> 治理入口：Issue #250；对应 Draft PR 是独立 acceptance gate
> 生命周期：本文记录 fixed candidate；只有 Draft PR 的 exact-head CI 与独立复审通过并合并后，才计为仓库实现，不表示部署、生产数据、真实人物视觉或客户验收

## Product/API gate 与实现边界

- Assets 公共目录只承认 `product_image`、`avatar_image`、`work_video` 三种服务端类型；内部
  `appearance_candidate_image` 不进入公共 list/detail，通用下载授权也不能成为内部素材出口。
- `work_video` 在公共 Assets 中保持审计、历史和短时下载可读，但创建新版本、重命名、停用、删除及 metadata 修改均由
  Asset service/API 返回 `ASSET_READ_ONLY`；普通 member 与 admin 使用同一服务端只读门禁，不能靠隐藏按钮代替授权。
- 通用 `POST /api/asset-versions/:id/download-authorizations` 对 missing、cross-organization、internal 与 deleted parent
  统一 generic fail-closed，不泄露对象是否存在，也不生成可消费 grant；deleted Version exact GET 为 404。disabled Asset
  延续既有审计语义：其已核验 available 版本可预览/下载并显示 disabled 标记，但不能新增或修改。
- `registerVerifiedOutput` 的 replay 在 memory/PostgreSQL 同构校验 exact organization、父 Asset `work_video`、父状态
  `active`、版本 `available`、media、size 与 SHA-256；内部候选或 disabled work parent 不能被 object-key replay 洗成作品视频。
- 商品 revision 绑定只接受 `product_image`。PostgreSQL 先锁 parent Asset，再锁 exact Version，并把 Asset 行锁保持到 enclosing
  transaction commit；memory 以 transaction owner 可重入的串行 reservation 配合 `onCommit/onRollback`，避免 bind/delete
  交错、同事务双 bind 自锁或 rollback 后残留永久 reservation。ProjectContent memory UoW 在失败时按 LIFO 执行 rollback
  callbacks。
- 删除门禁只精确覆盖仓库现有 `asset_references`，即 ProductRevision 的原子图片绑定。企业人物目录、AvatarSelection、Work
  等跨领域历史引用没有统一关系真值，本 Goal 不宣称已全部阻止删除；若产品要求跨领域统一保留，必须另开 Product/API、
  migration 与并发合同 gate。无论该 deferred gate，deleted parent 的公共 list/detail/new grant 均已 fail closed。

## 浏览器合同

- canonical URL 为 `/assets.html?kind=<product_image|avatar_image|work_video>&asset=<visible-id>`；无 query 保留旧商品图片列表，
  missing/foreign/wrong-kind Asset 会清除 `asset`，不会回落到另一可写素材。分类、选择、返回与 Back/Forward 使用真实
  history；同一分类或同一行重复点击不制造重复 history。
- list、preview 与 action 使用独立 epoch；download 还绑定 exact route/Asset/AssetVersion，rename/upload/danger intent
  绑定 exact authority epoch、Asset 与 revision。每次 route、refresh、popstate、pagehide/pageshow 或权限重读都会先 abort
  迟到授权并撤销旧 selection、mutation、download 与 `src`；旧 intent 只能显式 reload/reopen 后重新绑定，503 只保留当前分类
  的唯一 refresh。bfcache 恢复重新读取 `/api/auth/me`，鉴权完成前不会
  暴露旧详情或下载动作；390/768 的身份重读失败会切回 list layer，保持唯一 refresh 可见、可聚焦且可恢复 exact route。
- 本 Goal 只为 Assets 目录中的 exact `avatar_image` 新增真实图片预览：取最新一次成功 `/api/assets` snapshot 的
  `versions[0]`，要求 `available` 且具有已验证 image media/size/SHA-256，复用既有通用短时授权。list/detail 对同一
  Asset/version/epoch 只 mint 一次并共享同一 same-origin `/api/assets/downloads/<single-opaque-segment>` URL；不把 URL、token、
  object key 或 Provider 字段写入 history/storage/log。该语义不额外宣称 mint 时仍原子为 current head。
- preview 只调度 selected 与当前可见人物行，旧 epoch 用 AbortController 取消；自然到期、授权失败、corrupt decode、实际 bytes
  SHA drift 或权限撤销都会同步清除 `src` 并显示自然中文 fallback，重试只重取当前 key。`work_video` 零 image grant。
- rename/disable/delete 的 409 都保留本次 intent，载入同一 Asset 最新 revision 后要求用户再次明确提交；旧 revision 不会
  自动重放。成功上传/重命名/停用/删除在 native Dialog `close` 完成后分别恢复详情、同一动作或当前分类焦点；in-flight/503
  时只回可用 refresh。
- 1440 使用列表/详情双栏；768 与 390 使用列表 -> 详情 -> 返回并恢复 exact row focus。三视口最多一个可见推荐主动作，
  `work_video` 无 mutation UI/request。跨页 route smoke 只证明 enterprise/legacy/direct-assets-off 路由与 shell；Stage 1–5
  和 Works 的业务深度由既有独立浏览器矩阵持有，不把浅 route smoke 写成 full-feature E2E。

## 精确 allowlist

1. `.github/workflows/ci.yml`
2. `docs/PROJECT_HANDOFF.md`
3. `docs/ROADMAP.md`
4. `docs/status/CURRENT.md`
5. `docs/status/sessions/2026-08-25-operator-single-workspace-assets-mobile-closeout.md`
6. `src/assets/asset-service.js`
7. `src/assets/memory-asset-repository.js`
8. `src/assets/postgres-asset-repository.js`
9. `src/server/app.js`
10. `test/asset-postgres.integration.test.js`
11. `test/assets-api.test.js`
12. `test/assets-service.test.js`
13. `test/operator-single-workspace-assets-mobile-closeout-browser.test.js`
14. `web/assets.css`
15. `web/assets.html`
16. `web/assets.js`
17. `src/project-content/memory-project-content-repository.js`
18. `test/project-content-service.test.js`
19. `test/assets-browser.test.js`
20. `test/vsa-a14-acceptance-browser.test.js`
21. `test/operator-workbench-v2-assets-browser.test.js`
22. `test/operator-single-workspace-stage-5-browser.test.js`

第 17–18 项在编辑前通过 Issue checkpoint 加入，只用于 memory UoW `onRollback` 与实际 ProjectContent outer transaction
并发回归，不扩大 public API/domain。第 19–21 项随后按兼容 RED checkpoint 加入：前两项只把双面板中“核验中/核验通过”
定位限定到既有 `#assetList`；第 21 项已有上传/停用/删除焦点断言直接锁定产品修复，无需放宽断言。总 scope 固定为 22
个文件；其中第 21 项若无需修改可以保持工作树无 diff。第 22 项在第二次 default 的同名 Stage 5 committed-503 用例再次
超时后另行 checkpoint，只稳定既有 compatibility harness 的公开 HTTP/UI readiness，不修改 runtime。

## RED -> GREEN

1. 基线只在前端隐藏 work-video 写按钮，service 可修改；active image metadata 也缺 server guard。service/API RED 现锁定
   member/admin 对 disabled、deleted、work_video 的写入均 fail closed。
2. 基线 memory bind 可在 outer transaction rollback 后泄漏 reference，或 delete 先成功后 commit callback 再写 reference；
   PostgreSQL bind 也没有先锁 parent Asset。真实 interleaving 覆盖 delete-first、bind-first commit、bind-first rollback、
   disable-first 与 bind-first disable，以及同一 revision 第二次 bind 失败后 reservation 清理。
3. 基线 memory work replay 只验 object key/hash/size，可把内部 candidate 当成 work output；memory/PG regression 现锁定完整父子
   identity/status/media/hash 同构。
4. 基线页面状态只存内存，没有 URL/history/popstate/request epoch；旧 GET、grant、decode/error 可覆盖新 route，503 后仍可
   操作 stale detail。真实 Chrome RED 锁定 canonical URL、wrong-kind 清除、held A 不阻塞 B、late A 不覆盖 B、503 撤权和恢复。
5. 基线 Assets 没有人物预览。新 seam 使用真实 generic grant 与真实 bytes SHA，锁定 list/detail 同 URL、单次 mint、same-origin
   opaque path、自然到期、corrupt decode、bytes drift 与 `work_video` 零授权；不使用 fake/provider/object-key 路径。
6. 基线 danger 409 可用旧 revision 再次 POST，Dialog 首焦点/关闭焦点和移动返回不稳定。新回归要求 reload 最新 revision 后
   第二次确认、显式首焦点/Escape、成功 mutation 与 revoked trigger 的稳定焦点、1440/768/390 无横向溢出。
7. 基线 pageshow 复用旧 identity/detail，且 390 exact detail 上身份 503 会把唯一 refresh 留在隐藏的 detail layer。
   held `/api/auth/me` 与 fail-once 503 回归证明恢复时立即清空旧详情、动作和 preview；失败时切回 list 并聚焦唯一 refresh，
   释放或显式刷新成功后才恢复 exact URL/Asset。
8. 第一版 fixed head `a8119f0` 的独立 review 复现出迟到 download grant 仍创建 link、danger/rename/upload 旧 intent 在
   refresh/pagehide 后仍能写、390 detail 为隐藏人物行额外 mint grant，以及 1440 exact detail 缩窄后落在隐藏 list layer。
   真实 Chrome RED 的旧值分别为 link trigger `1`、旧 mutation POST/PATCH `1`、selected+hidden 两个 grant，以及 390 下
   `listVisible=true/detailVisible=false`。action epoch/Abort、显式 reload/reopen、严格 rect 可见性与 resize layer 同步后，新增
   11 项回归全部 GREEN；reduced-motion 双截图在旧实现即通过，未冒充 RED。
9. 默认并发 suite 暴露 A14 acceptance test 在 click 后立即运行内嵌 worker 的竞态：首次 run 在等待“质检通过”时超时，
   单文件复现证明 worker 可能早于浏览器 listener 完成入队。测试现先等待公开“质检中，可离开本页”与 plan route 的
   `#preflightBadge=预检中` 再运行 worker；修复后 A14 串行 stress 3/3。这里只修测试同步，不改变业务 UI/API。
10. Stage 5 committed-hidden compatibility test 原用 Playwright `route.fetch()` 在浏览器拦截连接内完成真实 POST，再从同一
    handler 向浏览器伪装 503；跨日复现时服务端已 commit、客户端也进入 authority reload，但恢复 GET 偶发永远无 response。
    DOM 证据为 dialog 仍 open、title=`正在读取生产状态`、loading visible、body hidden、create count/order count 均为 1。
    这属于测试 transport re-entry flake，不是已证实产品 bug。最终 test-only seam 完全移除 Playwright interception：测试
    server 的公开 POST handler 仍按真实请求先 commit state/receipt/object，再由一次性 flag 直接向浏览器返回 503；客户端
    随后必须经真实 HTTP 自动重读并达到 exact task/action/summary。server call counter 与 committed objects 都保持恰好 1。

## 验证、截图与后继门禁

- focused service/API/ProjectContent：59/59 pass；PostgreSQL 16 Assets integration：1/1 pass、0 skip。`npm run check`
  检查 248 个 JavaScript 文件，`npm run validate` 验证 3 条商品，`git diff --check` 通过。新 Assets 系统 Chrome
  closeout 19/19 pass；其中 review 后新增 action/download/visibility/resize/稳定截图回归 11/11 pass。
- 既有兼容按文件隔离为 Assets browser 3/3、V2 Assets 8/8、A14 1/1，合计 12/12；A14 同步修复后另做 stress 3/3。
  Stage 5 server-direct committed-503 seam 独立进程 stress 10/10（单轮 1.42–1.52 秒）且全文件 6/6；Stage 1–5 + Works
  最终按独立 Node 进程串行复跑为 24/24 pass、0 fail/skip：Stage 1 2/2（5.92 秒）、Stage 2 3/3（9.57 秒）、
  Stage 3 3/3（11.87 秒）、Stage 4 9/9（20.21 秒）、Stage 5 6/6（10.14 秒）、Works 1/1（7.83 秒），均自然退出。
  组合兼容 runner 曾在 V2 中 0% CPU hang，Stage 组合 runner
  曾在 Stage 2 中 hang；均显式终止且不计绿色/产品失败，随后相应文件单跑自然 GREEN。
- review 后本机 default `npm test` 没有形成最终绿色证据：第一次自然结束为 1213 total / 1197 pass / 15 skip / 1 fail
  （A14 入队竞态）；第二次相同总数与单一失败，但失败换成已独立 6/6 的 Stage 5 HTTP 503 浏览器用例；第三次在
  `manual-execution-api` #595 已通过后、`manual-execution-browser` #596 输出前 0% CPU hang，2 分 21 秒后以 Ctrl-C
  明确终止（exit 130）。A14 已按上述公开 seam 修复并 stress GREEN；没有为 Stage 5 或 A11 无证据改产品。本 fixed
  candidate 的全量终态以 Draft PR exact-head required CI 为准，CI 未完成前不得写成本地 default GREEN。旧
  `a8119f0` 的 required CI 虽成功，但已被 REQUEST CHANGES 与后续 diff 取代，不是当前 head 证据。
- preview `ready` 后生成的 viewport-only 人物详情 PNG 保存在临时目录且不入 Git：
  `/private/tmp/hifly-issue-250-assets-screenshots/assets-avatar-detail-1440.png`（1440x900）、
  `assets-avatar-detail-768.png`（768x900）、`assets-avatar-detail-390.png`（390x844）。SHA-256 依次为
  `2af71e31ed8e648ab8803d89ae540f6afb0dd2ebdb1e55794ceae88d2eb4b23e`、
  `e2dea358aee0d22c8c7dd2fb49597440f276c7c34eec5c4845102e18a533658d`、
  `eeb3bef9b69656d0411362df87fbec2c16d8678fa72df292b56ac0b08163a782`。fixture 只是 1x1 黑/白 PNG，截图只证明授权、
  bytes 与响应式布局，不是生产人物视觉或视觉品质验收。1440 evidence 使用 reduced-motion、禁用动画并对落盘帧与同状态
  第二帧做 byte-identical SHA 断言；三张 exact viewport 图均已人工查看，没有把 full-page 拼接图冒充 viewport 证据。
- 本轮未开始视觉研究。只有本 Goal 经独立 Review 合并后，才可另开视觉 refinement/research Goal；不能把本轮黑白 fixture
  截图当作该后继 Goal 的设计输入结论。
- 未访问 Hifly/Provider，未启动 Worker/Local Agent，未 SSH/部署，未修改生产数据，未创建、领取、运行或重试真实工单/
  视频，未消耗积分。
