# VSA-A05 文案质检与 Finding 处理

> GitHub Issue #61；产品依据：D-030、`DOMAIN_MODEL_AND_STATE_MACHINES.md` 与
> `docs/frontend/VSA-A04-A06_UIUX_DESIGN.md`。

## 交付边界

A05 在 A04 的冻结 `CopyVersion` 上异步执行质检，并保留可审计、可恢复的业务证据。本轮使用
Provider-neutral evaluator 与受控测试替身，不接真实大模型、Hifly 或外部 HTTP，也不实现 A06
人工审核。

本轮提供：

- `QualityRun` 技术状态 `queued / running / succeeded / failed / cancelled`，与不可变
  `QualityResult` 业务结论 `invalid / blocked / needs_review / passed` 分离。
- evaluator 输入冻结为 CopyVersion、ProductRevision、服务端选择的 profile version 与 rule version 快照；
  技术失败不生成业务结论。
- draft 只有在关联 ProductRevision 同时为 `ready` 且仍是 Product 的 `current_revision_id` 后才会冻结；
  child draft 一旦成为 current，旧 ready revision 即失效，校验失败不会留下冻结副作用。
- worker 落 QualityResult 前会再次解析当前服务端 policy。profile/rule 版本已变化时，旧 Run 以
  `COPY_QUALITY_POLICY_CHANGED` 技术失败收敛且不生成 Result；重试始终使用当前 policy 并完整重检。
- 检查未完整为 `invalid`；hard block 或 fact gate 为 `blocked`；待人工判断为
  `needs_review`；无 Finding 为 `passed`。
- QualityFinding 原始记录不可更新；处理记录追加保存。`accepted_with_reason` 必填理由，
  hard block 与 fact gate 不可接受，也不存在“一键接受全部”。
- evaluator 产生 Finding 时必须完整提供 code、kind、severity、title、matched_text、message、
  evidence_reference、rule_source 与 suggestion；缺失字段属于 `QUALITY_EVALUATION_INVALID` 技术失败，
  服务端不会用泛化默认值补成正式证据。
- `change_requested` 与 `returned_to_facts` 只记录处理路径，不会让旧正文投影为 passed；
  只有所有 review Finding 最终均附理由接受，才形成有效 `passed` 投影。
- AI 改写先持久化 `RewriteJob`，HTTP 202 不同步调用 rewriter。worker 领取任务后创建新的
  CopyVersion、自动冻结并排入一次完整 QC；任务支持查询、租约/心跳、失败重试与刷新恢复，旧版本、
  旧结果和 Finding 均保留。
- Rewrite worker 在调用 Provider 前及取得/恢复改写正文后都会核对 current ProductRevision；若
  Provider 运行期间商品事实变化，Job 以 stale 失败收敛且不会创建新 CopyVersion。
- AI 改写 Dialog 的一次打开对应一个提交意图和固定幂等键；请求期间提交按钮锁定。快速双击不会
  创建两个 Job，只有成功后或用户明确重新打开 Dialog 才生成新键。
- 同 CopyVersion/profile/rule 组合只允许一个有效运行任务，即使请求使用不同幂等键；重跑创建
  新 Run/Result 并保留历史。
- worker 租约、心跳、过期恢复与最大尝试次数；耗尽后以 `QUALITY_RUN_TIMED_OUT` 技术失败收敛。
- Organization 隔离、关键命令审计、公开错误白名单与内部输入快照隐藏。
- `/copy.html` 增量质检右栏：结论、Finding、接受理由 Dialog、返回事实、人工修改、AI 改写、
  历史结果和技术失败重跑；不显示批准或提交审核操作。

`passed` 只表示质检业务结论，不表示文案已获人工批准。A06 必须建立独立 HumanReview 合同，
不得复用本模块的状态冒充审核终态。

`QualityResult.conclusion` 是 worker 完成检查时写入的不可变原始结论。API 返回的
`effective_conclusion` 只是根据 Finding 追加处理记录计算的当前门禁投影；它不是第二份
QualityResult，也不会覆盖或冒充原始结论。

API 读取已完成结果时还会返回服务端计算的 `current_valid` 与 `invalidation_reason`。当 ProductRevision
不再 current/ready，或当前 profile/rule 已变化时，原始 Result 仍保留，但 UI 以 amber 阻断显示，
不得继续呈现为当前“质检通过”。失效原因仅使用 `product_revision_changed` 或
`quality_policy_changed` 两个受控值。失效 Result 的 Finding 卡仍展示历史内容与处理记录，但不再
提供接受、返回事实、人工修改或 AI 改写操作。

## API

| 方法与路径 | 用途 |
|---|---|
| `POST /api/copy-versions/:id/quality-runs` | 冻结 draft（或接受 frozen）并幂等发起 QC |
| `GET /api/copy-versions/:id/quality-runs` | 查询某文案版本的 Run 历史 |
| `GET /api/quality-runs/:id` | 查询 Run、Result、Finding 与追加处理记录 |
| `POST /api/quality-runs/:id/retry` | 从技术失败创建新的完整 QC Run |
| `POST /api/quality-runs/:id/cancel` | 取消 queued/running Run |
| `POST /api/quality-findings/:id/resolutions` | 逐条追加 Finding 处理记录 |
| `POST /api/copy-versions/:id/rewrite-jobs` | 幂等创建 queued RewriteJob；只接收范围与业务指令 |
| `GET /api/copy-versions/:id/rewrite-jobs` | 恢复某文案版本的改写任务历史 |
| `GET /api/rewrite-jobs/:id` | 查询任务、新 CopyVersion 与自动 QC Run 关联 |
| `POST /api/rewrite-jobs/:id/retry` | 安全重试 failed/timed_out 改写任务 |

Organization 归属只取认证身份。普通响应不包含 evaluator 输入快照、租约 token 或内部异常文本。
`COPY_QUALITY_POLICY_CHANGED` 作为稳定公开技术错误返回，运营可安全重新发起完整质检。

## PostgreSQL 与迁移

A05 使用独立 migration ledger：

```text
src/copy-quality/migrations/001_vsa_a05_copy_quality.sql
copy_quality_schema_migrations
```

部署时在 A01-A04 migration 之后执行：

```bash
npm run migrate:copy-quality
```

数据库以 trigger 保护 QualityResult、QualityFinding 和 FindingResolution 的不可变/追加语义，
并以 partial unique index 限制同一版本与规则组合只能存在一个 queued/running Run。应用启动只
检查 schema，不自动修改生产数据库。

迁移只新增 A05 表、索引、约束与触发器，不改写 A01-A04 的既有业务数据。若发布后需要回退
应用版本，应先停用 `gui.copyQuality.enabled` 并回退应用代码，数据库结构与质检历史原样保留；
不提供会删除 QualityResult、Finding 或处理记录的向下迁移。修订后的 A05 应以前向迁移恢复，
避免为了回滚程序而破坏不可变证据。

## 启用与测试替身

默认 `gui.copyQuality.enabled = false`。启用 A05 时必须同时启用 identity、assets、
projectContent 与 copyGeneration。`phase1_controlled_test_double` evaluator/rewriter 仅用于 Slice A
功能验收，不访问网络，也不代表真实 AI Provider 已接入。

## 非目标与已知边界

- 不实现 A06 HumanReview、批准、打回、审核失效传播或“进入人物与素材”业务门禁。
- 不接真实 LLM、Hifly、Local Agent 或批量 QC。
- 受控改写已完成“持久 Job + 新版本 + 自动完整 QC”。改写输出先保存为 Job 内部恢复检查点，
  CopyVersion 与 QC Run 使用 Job ID 派生幂等键；不把跨 A04/A05 repository 的步骤伪装成单一事务。
- 当前 A01 仅有 admin/member 粗粒度角色，A05 没有虚构尚未定义的 QC 专属 RBAC。

本轮未访问 Hifly、未执行真实外部生成、未消耗积分。
