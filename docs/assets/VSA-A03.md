# VSA-A03 商品图片资产上传与核验

权威来源：Issue #59、D-026、D-030。A03 只交付商品图片资产，不包含项目、商品、
`ProductRevision`、人物、声音、背景、COS、Hifly、Local Agent 或 Playwright 集成。

## 状态与门禁

`AssetVersion` 状态：

```text
upload_pending -> uploading -> verifying -> available
                                      \-> verification_failed
available --------------------------------> unavailable
```

上传请求完成只会进入 `verifying`。worker 重新读取私有对象并核验存在性、真实文件类型、
大小、SHA-256 checksum 和 Organization ownership 后，才能写入 `available`。核验失败的
版本不可引用。已 available 版本的对象键、声明和核验后的文件身份不可原地修改；上传授权
传入同组织 active `asset_id` 时，新内容会在同一 Asset 下创建递增的 `AssetVersion`。并发
创建由 Asset 行锁与 `(asset_id, version_number)` 唯一约束保证版本号不重复。

`Asset` 状态为 `active / disabled / deleted`。disable 保留所有历史；存在
`AssetReference` 时拒绝 delete。Asset 的 `display_name` 是可变展示 metadata，普通成员可
用乐观锁修改且不会创建 AssetVersion；同 Organization 管理员才能 disable/delete。

## HTTP API

所有 Organization 归属只来自 `request.identity`。请求体中的 `organization_id` 不参与授权。

| 方法与路径 | 结果 |
|---|---|
| `GET /api/assets` | 当前 Organization 的素材与版本状态 |
| `POST /api/assets/upload-authorizations` | 用 `Idempotency-Key` 创建短时受控上传授权；可选 `asset_id` |
| `PUT /api/assets/uploads/:token` | 上传 JPG/PNG/WebP 到授权对象键 |
| `POST /api/assets/upload-completions` | 幂等完成回调并原子创建核验任务 |
| `GET /api/asset-versions/:id` | 恢复服务端版本状态 |
| `PATCH /api/assets/:id` | 修改 `display_name`，需 `expected_revision` |
| `POST /api/assets/:id/disable` | 管理员 disable，需 `expected_revision` |
| `DELETE /api/assets/:id` | 管理员 delete，需 `expected_revision` |
| `POST /api/asset-versions/:id/download-authorizations` | 创建短时站内下载授权 |
| `GET /api/assets/downloads/:token` | 同 Organization 受控读取 |

创建上传授权的幂等边界是 `(organization_id, actor_member_id, Idempotency-Key)`。payload
使用规范化后的 `asset_id / filename / content_type / size / checksum_sha256` 稳定字符串，
不增加 hash。same key/same payload 返回原 Asset、AssetVersion 和 upload session，不重复
审计；未过期且未完成的 session 会重签短时 bearer token 并更新数据库 token digest，原始
token 不明文落库。same key/conflicting payload 返回 `409 IDEMPOTENCY_CONFLICT`。

complete 的 `(organization_id, idempotency_key)` 是另一独立幂等边界。same key/same payload 返回原
响应；same key/conflicting payload 返回 `409 IDEMPOTENCY_CONFLICT`。不同 key 的并发回调
也受 upload session 锁和 job 唯一约束保护，不会产生重复版本或 job。

## A02 共享端口

A02 只能依赖：

```js
app.assets.assetReferencePort.bindAvailableVersion({
  organizationId,
  assetVersionId,
  referenceType: "product_revision",
  referenceId,
  role: "product_image",
  transactionClient
});
```

端口在服务端重新验证 Asset active、AssetVersion available 和同 Organization，幂等追加
`AssetReference`，并返回不可变的 content type、size、checksum 核验快照。A02 不读取
upload session、object store 或 async job 表。

需要与 A02 的 ProductRevision 原子提交时，A02 必须从 buildApp 共用的同一个 PostgreSQL
pool 获取 client，并把它明确作为 `transactionClient` 传入：

```js
const transactionClient = await pool.connect();
try {
  await transactionClient.query("BEGIN");
  // A02 在此 client 中写入自己的 ProductRevision。
  const snapshot = await assetReferencePort.bindAvailableVersion({
    organizationId,
    assetVersionId,
    referenceType: "product_revision",
    referenceId,
    role: "product_image",
    transactionClient
  });
  await transactionClient.query("COMMIT");
  return snapshot;
} catch (error) {
  await transactionClient.query("ROLLBACK");
  throw error;
} finally {
  transactionClient.release();
}
```

提供 client 时，PostgreSQL asset repository 在该外部事务内重新验证并写入引用，不另开
事务、不提交；A02 的 rollback 会同时撤销 AssetReference。未提供 client 时，端口维持 A03
自己的短事务行为。A03 不实现 ProductRevision。

## PostgreSQL 与迁移

A03 与 A01 使用同一个 PostgreSQL 数据库，但拥有独立迁移目录和 ledger：

```text
src/assets/migrations/001_vsa_a03_assets.sql
asset_schema_migrations
```

先运行 `npm run migrate:identity`，再运行 `npm run migrate:assets`。应用启动只校验两个
schema 是否为当前版本，不自动执行生产 migration。A03 migration 依赖并通过 FK 引用
`identity_organizations` 和 `identity_members`，不会改变 `identity_schema_migrations`。

回滚采用应用回退并保留 A03 表；migration 创建的是新表和触发器，不改写 A01 数据。
如需物理删除 A03 schema，必须在确认无资产历史引用后由人工执行独立数据迁移，不在应用
启动或普通回滚中自动 DROP。

## ObjectStore 与恢复

`ObjectStore` 是窄接口。本轮只实现 `local` development adapter，文件和 metadata sidecar
均以私有权限保存在 `gui.assets.localRoot`。它用于本地开发和功能验收，不代表 COS 已接入，
也不应作为企业生产对象存储。上传 bearer token 只以 SHA-256 digest 落库；API 不返回对象
键、文件系统路径或永久 URL。

核验任务持久化在 `asset_async_jobs`。单实例 worker 启动后恢复 `queued/running` 任务；任务
和 complete receipt 保证重启后可重试。当前不建设消息队列、多实例租约或复杂调度。

## 素材中心

`/assets.html` 支持选择商品图片、上传、查看 uploading/verifying/available/失败状态、手动
刷新和重新进入恢复。页面不显示虚假进度；失败信息说明原因与重新上传或联系管理员的下一步。

启用示例：

```json
{
  "gui": {
    "identity": { "enabled": true },
    "assets": {
      "enabled": true,
      "adapter": "local",
      "localRoot": ".local-assets"
    }
  }
}
```

identity/assets 默认关闭时，原本地 GUI、Playwright 默认 backend 和全部既有批次路径不变。
