# VSA-A02 项目与商品权威快照

> GitHub Issue #58；产品依据：`DOMAIN_MODEL_AND_STATE_MACHINES.md` §5、D-021、D-022。

## 交付边界

A02 独立位于 `src/project-content/`，使用 `project_content_schema_migrations`，与 A01/A03
共用 PostgreSQL pool。它不读取 A03 内部表；`draft -> ready` 只调用
`assetReferencePort.bindAvailableVersion`，并传入 A02 当前 transaction client。

本轮提供：

- 空白 Project 创建、列表与详情；名称必填，说明和交付日期可选。
- Product 与完整快照 ProductRevision；状态为 `draft` / `ready` / `superseded`。
- 商品名称、说明、默认 `general` 品类、可选 ContentBrief、AssetVersion IDs、stable-id 卖点、创建人/时间/父 revision。
- 卖点逐条确认；已确认卖点文本变化后自动回到未确认。
- ready revision 编辑时创建 child draft；child ready 成功后才 supersede parent。
- Ready 快照保存相同规范化内容时直接 no-op；页面重入不会生成重复 revision。
- Organization 隔离、乐观并发、Project/Product 创建幂等、ready 幂等与关键命令审计。
- `productRevisionPort.getReadySnapshot`，只返回同 Organization 的 ready 完整快照。
- `/projects.html` 与 `/project.html` 最小企业 UI；feature 默认关闭。

## Ready 门禁与事务

服务端要求商品名称非空、至少一条非空且逐条确认的卖点、至少一个 A03 `available`
商品图片版本。所有图片绑定、revision 状态、旧 ready supersede、审计和幂等收据在同一事务中；
任一 A03 bind 失败时整体回滚。PostgreSQL trigger 阻止 ready/superseded 快照字段被直接覆盖。

## API

- `GET/POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/products`
- `PATCH /api/product-revisions/:id`
- `POST /api/product-revisions/:id/selling-points/:pointId/confirm`
- `POST /api/product-revisions/:id/ready`
- `GET /api/runtime` 的 `projectContentEnabled`

Project/Product creation 要求 `Idempotency-Key`。范围为 Organization + actor + command + key；
规范化 payload 使用稳定 JSON 字符串，同 payload 重放原结果，不同 payload 返回 409。
draft PATCH 和卖点确认使用 `expected_revision`，过期写入返回 409。

## 启用与 Migration

默认 `gui.projectContent.enabled = false`。生产配置启用时还必须启用 identity 与 assets，部署前依次执行：

```bash
npm run migrate:identity
npm run migrate:assets
npm run migrate:project-content
```

应用启动只检查 schema，不自动执行 production migration。

## 非目标

未实现 A04、LLM、文案生成、COS、队列或复杂 RBAC；未访问 Hifly 或真实外部 HTTP，未消耗积分。
