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
- production PostgreSQL 使用专用 Work-library read port，在单个 `REPEATABLE READ` 事务内完成 organization/project/
  delivery status、total、anchor 与稳定页定位；只锁定并读取当前页最多 6 个 Work，也只为这 6 个缺失 inspection 的
  Work 初始化 pending inspection、ledger 与 audit。页外 Work 不读取、不初始化；memory adapter 保持同一业务语义供
  public Chrome seam 使用。paged GET 因页内 lazy 初始化仍不称为纯读 BFF；没有新增 DB、migration、领域状态、写命令
  或权限角色。
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
  载入最新 inspection binding 并换新 key 后由用户再次确认。不确定 intent 未精确收口前，作品切换、分页、筛选与
  same-document Back 均 fail closed 并恢复原 Dialog/URL/焦点，避免跨作品覆盖原 key。下载授权还会精确绑定 Work、
  AssetVersion、到期时间与 media/size/SHA-256；另一 Work 的 URL 不能消费该 token。
- 390/768 顺序详情只显示一个可见可执行品牌主操作；不可用或已撤回 Work 显示“当前作品不可操作”，不打开 Dialog、
  不发送写请求。1440、768、390 的业务状态与服务端动作真值相同，composition 分别验收。

## 精确 allowlist

1. `docs/PROJECT_HANDOFF.md`
2. `docs/ROADMAP.md`
3. `docs/status/CURRENT.md`
4. `docs/status/sessions/2026-08-25-operator-single-workspace-works.md`
5. `src/work-delivery/work-delivery-service.js`
6. `src/work-delivery/work-library-read-port.js`
7. `src/server/app.js`
8. `src/server/routes/work-delivery.js`
9. `web/works.html`
10. `web/works.css`
11. `web/works.js`
12. `test/work-delivery-service.test.js`
13. `test/work-delivery-api.test.js`
14. `test/work-delivery-postgres.integration.test.js`
15. `test/operator-workbench-v2-works-browser.test.js`
16. `test/operator-single-workspace-works-browser.test.js`
17. `test/work-delivery-browser.test.js`

第 15 个原始 scope 文件（legacy Works browser test）在编辑前已由 Issue #248 scope checkpoint 明确加入；其修改仅把
跨组织 deep link 由旧的首项回落改为 strict null selection，并同步三栏/移动恢复合同。独立复审发现首版分页仍会全量
扫描并初始化页外 Work 后，Issue/PR 又在修改前 checkpoint 增加专用 read port 与 PostgreSQL integration test；总范围
因此固定为上述 17 个文件，没有调整既有领域写命令或 migration。

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
7. 首版所谓“分页”会先全量读取并为所有组织 Work 建 inspection，40 条反例虽只返回 6 条，却写入 40 组
   inspection/audit/ledger。专用 PostgreSQL read port 将 filter/total/anchor/page 下沉到有界查询；60 条真实 PG fixture
   证明首两页每次只初始化 6 条且 54 条页外 Work 保持零写，调用规模不随组织全集线性增长。
8. 首版在不确定交付期间切换作品、分页或筛选会覆盖原 intent key；390 同时出现面板与底部两个主操作，不可用 Work
   还显示可点击但无效的“标记为通过”。真实 Chrome RED 现锁定跨上下文阻断与同 key 重放、每态最多一个可见可执行
   品牌主操作，以及 unavailable/withdrawn 的零 Dialog、零 POST。

## 验证与边界

- service/API/三组 Works 真实 Chrome：23/23 pass；Stage 5 及共享 Production/startup/Project API 回归：63/63 pass。
- 本机一次性 PostgreSQL 16 的 WorkDelivery integration：1/1 pass、0 skip；60 条新增 Work 加既有 1 条，精确验证
  6 项页、61 total/11 pages、project/status/anchor，以及页外 inspection/audit/ledger 零写；容器已停止并移除。
- 首 implementation head 的默认 `npm test` 曾自然完成：1188 tests / 1173 pass / 15 个既有环境门禁 skip / 0 fail。
  独立复审修复树再次运行时，在默认并发下出现一条未改 Stage 5 committed-503 Chrome 用例 30 秒超时，随后套件长期
  无输出，故该次被终止且不计 full pass；同一 Stage 5 文件立即隔离复跑 6/6 pass。该非绿色历史不由 focused 结果覆盖，
  fixed-head Ubuntu/Windows 默认套件仍是最终门禁。
- `npm run check` 检查 248 个 JavaScript 文件；`git diff --check` 与精确 17-file allowlist 通过。
- 首 implementation head `28b0e50` 的 CI run 32764298402 中 Ubuntu/Windows 成功，identity job 的 Production/
  WorkDelivery PostgreSQL authority chain 亦成功，但后续未改 identity browser smoke 长时无输出后被明确取消；该 head
  又因独立复审 P1 被替代，因此从未宣称三项 required context 全绿。最终 fixed-head CI 以 Draft PR 结果评论为准。
- 官方 npm registry 审计为 0 critical / 0 high / 2 existing moderate（`exceljs -> uuid`）；唯一建议是会把
  `exceljs` 降到破坏性版本的 `npm audit fix --force`，本片不执行。fixed-head commit/run 仍以 Draft PR 元数据和
  结果评论为准，session 不自引用自身最终 head。
- 1440x900、768x900、390x844 临时截图只保存在 `/private/tmp`，SHA-256 分别为
  `98162f0bf3c341abdb6045c92a73a4e8d85a1eac120c7c6a97bc02e25394e2b4`、
  `6f0fbcc4f32dc2ae92057fd21ebfde71fdec459faa2aa9e2a27f2857d17091ca`、
  `ea6501f2a8985774024716f3188d7a50916bf80674c54507e0291cd7910f7ac6`。二进制不提交；截图只证明
  synthetic public seam 的响应式 composition，不是部署、真实作品或客户验收证据。
- 未访问 Hifly/Provider，未启动 Worker/Local Agent，未 SSH/部署，未修改生产数据，未创建或重试真实工单/候选/视频，
  未消耗积分；未开始素材中心/移动收口 Goal。
