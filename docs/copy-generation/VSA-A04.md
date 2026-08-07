# VSA-A04 文案生成与不可变版本

> GitHub Issue #60；产品依据：`DOMAIN_MODEL_AND_STATE_MACHINES.md` §7、D-023、D-030。

## 交付边界

A04 基于明确的 Ready `ProductRevision` 异步生成 `CopyVersion`，并提供文案版本工作区。
本轮使用 Provider-neutral 接口和 Phase 1 受控测试生成器，不接入真实大模型、Hifly 或 Local Agent。

本轮提供：

- Ready 商品快照的异步文案生成、离开页面后恢复状态和生成失败安全重试。
- 生成请求与冻结命令幂等；同一已接受重试请求可在响应丢失后安全重放。
- `CopyVersion` 生命周期 `draft / frozen / superseded` 与完整历史。
- draft 乐观并发编辑；frozen 正文只读，修改时创建新的 draft，不覆盖历史。
- 单个 ProductRevision 同时最多一个当前 draft；并发生成完成时按仓储顺序分配版本号。
- 持久化任务租约、心跳、超时恢复、最大尝试次数和取消服务合同。
- Organization 隔离、关键命令审计和不公开生成输入快照的 API 投影。
- `/copy.html` 桌面双栏与 390px 移动端版本抽屉；版本比较、未保存切换保护和 409 冲突恢复。

A05 自动质检和 A06 人工审核尚未实现。页面名称沿用已经批准的统一工作区「文案与质检」，但
不显示质检结论、审核按钮或未来阶段假链接。

## API

| 方法与路径 | 用途 |
|---|---|
| `POST /api/product-revisions/:id/copy-generations` | 幂等发起异步生成 |
| `GET /api/product-revisions/:id/copy-generation-jobs` | 恢复该商品快照的任务历史 |
| `GET /api/copy-generation-jobs/:id` | 获取单个任务状态 |
| `POST /api/copy-generation-jobs/:id/retry` | 幂等重试失败任务 |
| `POST /api/copy-generation-jobs/:id/abort` | 取消 queued/running 任务的服务合同 |
| `GET /api/product-revisions/:id/copy-versions` | 获取版本历史 |
| `GET /api/copy-versions/:id` | 获取单个版本 |
| `PATCH /api/copy-versions/:id` | 用 `expected_revision` 保存 draft 或从 frozen 派生新 draft |
| `POST /api/copy-versions/:id/freeze` | 幂等冻结 draft，供 A05 后续接入 |

Organization 归属只来自认证身份。普通响应不包含生成任务的 `input_snapshot`、租约 token 或
Provider 内部异常；失败只公开受控 failure code。

## PostgreSQL 与迁移

A04 与 A01-A03 共用 PostgreSQL pool，但使用独立 migration ledger：

```text
src/copy-generation/migrations/001_vsa_a04_copy_generation.sql
copy_generation_schema_migrations
```

部署时依次执行：

```bash
npm run migrate:identity
npm run migrate:assets
npm run migrate:project-content
npm run migrate:copy-generation
```

应用启动只检查 schema，不自动执行生产 migration。数据库约束保留 frozen/superseded 正文，
并限制同一 ProductRevision 只能有一个 draft。回滚采用应用回退并保留历史表，不自动删除文案、
任务、幂等收据或审计记录。

## 启用与测试替身

默认 `gui.copyGeneration.enabled = false`。启用 A04 时，identity、assets、projectContent 也必须
启用。`phase1_controlled_test_double` 只根据商品快照生成可预测文案，用于 Slice A 验收；它不
访问外部网络，不代表真实 Provider 集成，也不允许普通用户选择 Provider 或模型。

## 非目标

不实现 A05 QC、A06 人工审核、真实模型、Hifly、批量文案生成、复杂 RBAC 或跨商品批量操作。
本轮不访问 Hifly，不执行真实外部生成，不消耗飞影积分。
