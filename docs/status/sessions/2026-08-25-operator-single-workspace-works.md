# Post-stage 作品库方案 A

> 执行日期：2026-08-25
> 固定基线：`origin/main@0b0d1d94df4a06b9209e7385f7082e3cad53a742`
> 治理入口：Issue #248；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，本 Goal 才计为仓库实现；本次没有部署、生产数据或客户验收

## Gate 与实现

- Stage 5 已通过 Issue #246 / PR #247 合并进入固定基线；这只表示仓库实现，不把生产页面、真实 Worker、Provider、
  客户网址或运行环境写成已升级。
- 既有 unpaged `GET /api/works` 保持 `{works}` 合同。只有显式携带 `page`、`pageSize`/`page_size` 或
  `anchorWorkId` 时才进入 additive paged mode；固定 `page_size=6`，返回 `works`、`pagination` 与
  `selected_work_id`。
- paged mode 以 `(created_at DESC, id DESC)` 稳定排序。显式 page 优先于 anchor；仅有 anchor 时由服务端定位真实页。
  foreign、missing、filtered-out 或不属于显式页的 anchor 统一返回 null selection，不泄露对象，也不回落到另一 Work
  形成写目标。超范围 page 收敛到最后一页；空集合为 page 1 / total_pages 0。
- project filter 在 inspection 初始化前执行，delivery status filter 在 enrichment 后执行。paged GET 有意保留既有
  lazy pending-inspection 初始化、ledger 与 audit 语义，故本片不称其为纯读 BFF；没有新增 DB、migration、领域状态、
  写命令或权限角色。
- 新 paged response 内的 list 与 selected detail 使用显式字段 allowlist；既有 legacy exact-detail API 形状保持不变。
  新投影保持 Work、inspection、delivery 的 exact organization/order/product 绑定；inspection 与 delivery 分段读取期间若
  inspection truth 漂移，整次投影以 503 fail closed，不拼接跨代状态。
  当前 `rework_required` 优先于历史 delivery；原 Work、检查与交付历史继续保留。passed 不等于 delivered，download
  不等于 delivery。
- 1440 使用列表 / 详情 / 操作三栏，单行任务摘要为六条作品腾出首屏空间；768 与 390 使用列表 -> 详情 -> 返回，
  390 首屏直接露出第一条作品，详情进入与返回恢复 exact focus。两端共享同一服务端状态、动作和中文业务词，不把桌面
  当作放大的移动布局。
- 列表与 preview 各有独立 request epoch。读取失败立即清除旧 detail/action，仅保留 scoped refresh。检查/返工/交付
  Dialog 固定 logical intent 与 idempotency key；408、5xx、网络未知和 committed-but-hidden response 不自动重试，
  显式载入权威状态后仍须用同一 key 重放来精确确认本次 receipt，不能凭业务状态或交付数量推断成功。确定性 409 则
  载入最新 inspection binding 并换新 key 后由用户再次确认。下载授权还会精确绑定 Work、AssetVersion、到期时间与
  media/size/SHA-256；另一 Work 的 URL 不能消费该 token。

## 精确 allowlist

1. `docs/PROJECT_HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/status/CURRENT.md`
4. `docs/status/sessions/2026-08-25-operator-single-workspace-works.md`
5. `src/work-delivery/work-delivery-service.js`
6. `src/server/app.js`
7. `src/server/routes/work-delivery.js`
8. `web/works.html`
9. `web/works.css`
10. `web/works.js`
11. `test/work-delivery-service.test.js`
12. `test/work-delivery-api.test.js`
13. `test/operator-workbench-v2-works-browser.test.js`
14. `test/operator-single-workspace-works-browser.test.js`
15. `test/work-delivery-browser.test.js`

第 15 个 legacy Works browser test 在编辑前已由 Issue #248 scope checkpoint 明确加入；其修改仅把跨组织 deep link
由旧的首项回落改为 strict null selection，并同步三栏/移动恢复合同。没有调整其领域写入语义。

## RED -> GREEN

1. 基线 service 没有 page/total/anchor；前端抓取全量集合并本地筛选。新增 service/API RED 锁定 9 项的 6+3、稳定
   tie-break、anchor 定位、显式 page 优先、project-before-initialization、server delivery filter 与 invalid input。
2. 基线跨组织/未知深链会回落首个可见 Work。新 public seam 与三组 Works browser 统一为 null selection、零写动作，
   用户必须显式选择本页可见作品。
3. 基线页面没有 popstate/request epoch，失败后可保留旧 detail/action；新 Chrome 回归覆盖 Back/Forward、延迟旧列表、
   延迟旧 preview、成功后 scoped 503、恢复与 exact focus。
4. 基线 committed delivery 的 5xx/网络未知可诱发新 key 重写，也会把另一操作者的 delivery 误认成本次成功。新 Chrome
   回归分别覆盖“本次已 commit 但 503”和“本次未 commit、他人随后写入”：显式载入后 Dialog 不关闭，只有原 key
   精确重放成功才确认本次操作；没有第二条重复 delivery。
5. 基线下载 token 只受 organization 约束，可把 Work A token 放在 Work B URL 下载 A bytes；inspection 与 deliveries
   也可能拼成跨代投影。新 service/API RED 锁定 exact Work/AssetVersion/bytes binding 和并发返工 fail-closed。
6. 旧 768/390 复用桌面双栏或抽屉语义。新回归分别锁定 1440x900、768x900 与 390x844 的 composition、六项分页、
   list/detail-return、Dialog focus/Escape、reduced-motion 与零页面横向溢出。

## 验证与边界

- service/API/三组 Works 真实 Chrome：23/23 pass。
- Stage 5 及共享 Project/API 回归：27 pass；本机 WorkDelivery PostgreSQL integration 因无测试数据库明确 1 skip，
  不把 skip 写成 PostgreSQL 通过。fixed-head required `identity-postgres` 必须实际执行该 integration。
- 默认 `npm test` 自然完成：1188 tests / 1173 pass / 15 个既有环境门禁 skip / 0 fail，约 85.8 秒；
  `npm run check` 检查 247 个 JavaScript 文件，`git diff --check` 与精确 15-file allowlist 通过。
- 官方 npm registry 审计为 0 critical / 0 high / 2 existing moderate（`exceljs -> uuid`）；唯一建议是会把
  `exceljs` 降到破坏性版本的 `npm audit fix --force`，本片不执行。fixed-head commit/run 仍以 Draft PR 元数据和
  结果评论为准，session 不自引用自身最终 head。
- 1440x900、768x900、390x844 临时截图只保存在 `/private/tmp`，SHA-256 分别为
  `0fd3021780a152a978ba22cde0071611589071c089c8476a75f2da3a9e205fa9`、
  `c522b4607d990011648830c9dcd0876993087fe324d1ad0cfba4a5a217a52dce`、
  `dddeb03b9dcf6e8dc407070094c7ec5a96d5848836f35d0463148c37aab6b7bf`。二进制不提交；截图只证明
  synthetic public seam 的响应式 composition，不是部署、真实作品或客户验收证据。
- 未访问 Hifly/Provider，未启动 Worker/Local Agent，未 SSH/部署，未修改生产数据，未创建或重试真实工单/候选/视频，
  未消耗积分；未开始素材中心/移动收口 Goal。
