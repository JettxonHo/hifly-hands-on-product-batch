# VSA-A07 已有数字人物目录与选择

> Issue：#63  
> 状态：本地实现、无积分验证与独立 Review 完成；待 Git/CI 交付  
> 基线：`ca47ec9`（PR #81 A06 与 PR #82 A07/A08 UI/UX 设计均已合并）

## 用户结果

当前 Organization 的 member/admin 可以在正式 `/avatar.html` 工作区浏览已有公共/企业数字人物，并为当前商品显式确认一个人物版本。更换人物创建新的 confirmed `AvatarSelection`，旧选择转为 superseded 并保留历史。

## 边界与真实性

- 目录严格为 `existing_only`，只提供读取与选择 API，不存在创建人物、克隆声音或编辑背景的 API。
- Phase 1 目录按 Organization 物化受控种子，界面与 API 均标注「Phase 1 受控预置」。
- `provider_integration=false`、`recommendation=false`；没有 Hifly 实时查询、推荐算法或真实 Provider 调用。
- 能力以独立 Evidence 记录保存；API 的 `verified_capabilities` 只投影 `verified + 非空 evidence_reference`，未知能力显示「未验证」，绝不显示为 supported。

## 领域与持久化

模块：`src/avatar-selection/`。

- `AvatarAsset`：Organization 内的长期人物身份，区分 `public` / `enterprise` 来源。
- `AvatarAssetVersion`：available/unavailable、授权状态/有效期、Organization 使用范围、能力状态与素材可访问性。
- `AvatarVerifiedCapability`：能力代码、展示名与 Evidence 引用；受控种子 Evidence 只证明测试目录合同，不代表真实 Hifly 能力。
- `AvatarSelection`：不可变选择事实；状态头记录 `draft → confirmed → superseded`，商品级 head 提供 `selection_revision` 乐观并发。
- 选择事件与审计 append-only；更换不会删除或覆盖旧记录。
- 独立 migration ledger：`avatar_selection_schema_migrations`，migration `001_vsa_a07_avatar_selection.sql`。

memory 与 PostgreSQL repository 公开相同合同。PostgreSQL 命令在事务内完成：幂等回放检查、商品选择 head 加锁、创建 draft、旧 confirmed supersede、新 draft confirm、head revision 更新、事件、审计与 receipt。receipt 保存首次命令的完整业务响应；A→B 更换后重放 A 的旧 key 仍整体返回 A 首次结果，不与当前 B 的 history 拼接。

## 服务端门禁

正式 A06 port `createCurrentApprovedCopyPort` 读取 CopyVersion 并调用 `getCurrentApprovedGate`。workspace 未提供
`copyVersionId` 时，port 按 Organization + product 查找最新的 current effective approved copy，并通过
`resolved_copy_version_id` 返回；前端商品切换后使用该服务端结果恢复 URL 与确认上下文。浏览不依赖批准；确认命令每次重新验证：

1. 当前商品存在 current effective approved CopyVersion；
2. 人物资产 active 且版本 available；
3. 授权为 valid/expiring，且有效期未经过；
4. 至少一项能力有 verified Evidence；
5. 使用范围为当前 Organization；
6. 必要素材可访问。

授权 expired/incomplete、未知能力、跨 Organization 版本和失效文案批准均阻止新确认。上游批准后续失效时，不主动改写历史 selection；每次 workspace 读取和后续下游 gate 动态返回 `current_valid=false` 与受控原因。这是 A07 的最小可靠失效传播方案。

## 正式 API

- `GET /api/products/:productId/avatar-workspace?copyVersionId=...`（query 可缺省；响应返回 `resolved_copy_version_id`）
- `POST /api/products/:productId/avatar-selections`
  - Header：`Idempotency-Key`
  - Body：`copy_version_id`、`asset_version_id`、`expected_revision`

Organization 只来自认证身份。member/admin 均可浏览和确认；未认证请求拒绝。跨组织 ID 与不存在 ID 使用相同 404，不泄漏对象是否存在。相同 key+payload 回放原结果；相同 key+不同 payload 返回 409；陈旧 `expected_revision` 返回 409。

## UI

- `/avatar.html`：1440px 三栏（288 / 弹性 / 384），目录、详情与当前选择/门禁/历史分区。
- 390px：单栏、人物目录 Dialog、底部 sticky 操作区，无 A08 假链接。
- 确认与更换均使用摘要 Dialog；服务端错误转换为业务语言。
- `/copy.html` 阶段 3 与批准后的下一步已改为真实人物页链接。
- A08 保持禁用「进入视频方案尚未开放」，不创建 `plan.html`。

## 验证证据

- Reviewer 前定向 service/API 实际为 11 pass（修正文档原 10）；两项 Important 回归加入后为 14 pass / 0 fail。
- PostgreSQL 16 clean migration/integration：1 pass / 0 skip（本地 Docker 临时库）。
- 全量：710 tests / 678 pass / 0 fail / 32 environment skips。
- `npm run check`：133 JavaScript files。
- `git diff --check`：通过。
- 主控使用系统 Chrome 实际通过 1/1，覆盖 1440/390、未知能力、确认、更换、刷新历史、目录 Dialog、切换商品后服务端解析批准文案并写回 URL、继续确认、无横向溢出与 A08 禁用边界。
- 最终独立 Reviewer：`APPROVED`，无剩余 Critical/Important。

## 运行与回滚

生产启用前先执行 A01～A06 migration，再执行 `npm run migrate:avatar-selection`，最后配置 `gui.avatarSelection.enabled=true`；默认 false，不改变遗留 GUI/Playwright 基线。

Migration 为 additive。回滚应用时先关闭 feature；数据库回滚依现有项目策略使用部署前备份恢复，不删除已产生的 AvatarSelection 历史。

## 未完成与后续

- 独立 Reviewer 首轮两项 Important 已按 TDD 最小修复，最终复审通过；commit/push/PR/CI/merge/Issue close 尚未执行。
- A08 仍未实现；后续只消费 `current_valid=true` 的 confirmed selection。
- 真实 Hifly avatar catalog/capability Evidence 仍不在 Slice A，本实现不关闭 Q-018/HIFLY-001/SPK-018。
