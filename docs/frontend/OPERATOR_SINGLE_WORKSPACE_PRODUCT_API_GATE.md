# 单任务工作区 Product/API 门禁

> 状态：Owner 已接受单任务工作区方向；Issue #236 / 对应 PR 是本设计与 API 门禁的 acceptance gate。
> 只有合并进入 `main` 才计为 `designed`。本文定义未来最小 additive seam，不代表接口已经实现。

## 1. 审计结论

现有五阶段 API 足以继续承担各阶段读取和写入，但不足以让一个稳定工作区在不猜测的情况下同时回答“当前商品、五阶段
状态、阻断和唯一下一步”。人物领域也已经在仓库内部绑定 `material_asset_version_id`，通用 Assets 有短时下载授权，
但人物公开 workspace 只投影 `preview_kind`/素材可用性，没有可供目录显示真实缩略图的受控授权 seam。

因此后续实现需要两个独立、additive、默认关闭的 Product/API gate：

1. 一个只读 operator workspace 聚合投影；
2. 一个绑定人物目录条目的短时 preview authorization。

不需要新领域状态、组织级生产队列、跨阶段写事务或 Worker 命令。本轮不实现任何接口。

## 2. 现有 seam 真值

| 范围 | 现有真值 | 可复用 | 缺口 |
|---|---|---|---|
| Project/Product | `GET /api/projects/:projectId` 与 exact ProductRevision seam | 项目、商品、current revision、历史读取 | 没有五阶段统一读取投影 |
| Copy | generation/version、quality 与 human review 分离 | 保持写命令、QC/人工审核真值 | shell 不能靠页面局部状态判断全局下一阶段 |
| Avatar | `GET /api/products/:productId/avatar-workspace`；内部版本绑定 `material_asset_version_id` | 目录、授权、能力、selection 与失效原因 | 公开目录没有受控图片 URL；当前 UI 只画首字 |
| Plan | workspace/preflight/review API | 保持 preflight 与人工批准分离 | 无统一阶段摘要 |
| Production | product production workspace + package/execution/A12/Work/delivery seams | 完整持久状态矩阵与写命令 | 无组织级队列；浏览器不能推断 eligible/active attempts |
| Assets | org-scoped Asset/Version；短时 download authorization | 受控 bytes、媒体、大小、checksum 与 token 生命周期 | 通用授权不绑定人物目录条目，且人物前端不应拿内部素材 ID |

### 2.1 人物素材的源码事实

人物 management projection 当前只返回目录 ID、业务字段、授权/能力、`asset_version.id`、`preview_kind` 和
`material_status`。`material_asset_version_id` 保留在 repository 内部。`refreshMaterialState()` 已验证同组织、
`kind=avatar_image`、父 Asset `active` 与版本 `available`；注册企业人物时也执行同样门禁。

通用 `POST /api/asset-versions/:id/download-authorizations` 以组织隔离 AssetVersion 创建短时授权，但它是通用素材命令，
不验证该版本仍是当前可见人物目录条目绑定的素材。若直接暴露给 Avatar UI，前端必须知道内部素材版本 ID，也无法在同一
领域入口原子核对目录可见性、人物版本和素材父 Asset 状态。

## 3. Decision A：只读 operator workspace 投影

### 3.1 资源

```http
GET /api/projects/:projectId/products/:productId/operator-workspace?stage=<stageCode>
```

这是只读 BFF projection，不是新领域 aggregate。它只组合现有 org-scoped service 的当前真值，不保存状态、不执行命令，
不创建组织级队列。`stageCode` 仅接受 `product_content|copy|avatar|video_plan|production`。

### 3.2 响应草案

```json
{
  "workspace": {
    "project": { "id": "project-id", "name": "项目名" },
    "product": {
      "id": "product-id",
      "name": "商品名",
      "current_revision_id": "revision-id"
    },
    "requested_stage": "copy",
    "recommended_stage": "copy",
    "recommended_action": {
      "code": "save_copy",
      "label": "保存文案"
    },
    "stages": [
      {
        "code": "product_content",
        "read_status": "ok",
        "navigation_state": "completed",
        "business_status": "商品资料已就绪",
        "blocker_codes": [],
        "current_object": { "type": "product_revision", "id": "revision-id" }
      }
    ]
  }
}
```

约束：

- `recommended_action` 为 `null` 或恰好一个受控 action code；前端只把它映射到当前阶段已有命令，不接受任意 URL/脚本。
- `read_status=error` 时 `navigation_state=null`，显示中性“状态读取失败”；不得把错误写成 available/completed/blocked。
- `current_object` 只允许现有公开业务 ID；不返回 object key、token、Provider URL、Profile 路径或私有部署信息。
- Product 与 Project 必须精确匹配；不能把同组织另一个项目的商品拼入 workspace。
- 本投影不提供 eligible/active attempts，也不产生生产可执行判断；Production 继续消费既有权威 workspace。

### 3.3 授权与错误

沿用全局 identity/session/organization guard。member 与 admin 可读取其组织内已可见项目；权限不因工作区增加。建议稳定错误：

| HTTP | code | 语义 |
|---|---|---|
| 400 | `INVALID_OPERATOR_WORKSPACE_STAGE` | stage code 非法 |
| 401 | 既有 identity 错误 | 未认证 |
| 404 | `OPERATOR_WORKSPACE_NOT_FOUND` | project/product 缺失、跨组织、不可见或不匹配，统一不泄露 |
| 503 | `OPERATOR_WORKSPACE_UNAVAILABLE` | 当前阶段权威读取失败；不返回猜测状态 |

非当前阶段的读取失败可在 `stages[]` 中按 `read_status=error` 投影；当前阶段失败则整个请求 503，确保主任务 fail-visible。

### 3.4 API TDD acceptance

- memory + PostgreSQL 同组织 exact project/product 成功，五阶段 object ID 与状态来源正确；
- missing、cross-org、同组织错 project/product 关系统一 404 且正文不可区分；
- 非法 stage 400，未认证沿用 401；
- 任一当前阶段依赖失败返回 503，不留下 stale/recommended action；
- QC/人工审核、preflight/人工批准、Production persisted terminal truth 不被合并；
- 输出中没有 Worker 命令、eligible 推断、object key、Provider URL、token 或 Profile path。

## 4. Decision B：人物专用短时预览授权

### 4.1 选择

采用人物专用授权入口，内部复用现有 AssetVersion 短时 bytes/grant 机制：

```http
POST /api/avatar-catalog/:avatarId/preview-authorizations
```

不让浏览器读取 `material_asset_version_id` 后再调用通用 AssetVersion 命令。理由：专用入口能在一个服务端 gate 中绑定组织、
当前可见人物目录条目、目录版本、其私有素材引用、父 Asset 和 AssetVersion；同时可返回人物语义的安全 fallback 原因。

### 4.2 服务端门禁

授权前必须重新读取并核对：

1. actor 已认证，角色为现有 member/admin，organization 与目录条目一致；
2. `avatarId` 是当前组织可见且 active 的人物目录条目；cross-org/missing 统一 404；
3. 条目当前版本仍绑定一个私有 `material_asset_version_id`；
4. 素材 Asset 同组织且 `kind=avatar_image`、状态 `active`；AssetVersion 同组织且状态 `available`；
5. `verified_content_type` 在受控图片 allowlist，已核验 size/checksum 存在；
6. 创建现有短时、组织隔离、不可猜 token；不把对象存储路径或底层素材 ID返回给浏览器。

授权创建不是人物业务写入，不改变 selection/catalog revision，不新增 optimistic concurrency 或幂等业务语义。CSRF、Cookie、CSP、
CORS 和 session 使用现有全局规则，不新增角色。

### 4.3 响应草案

```json
{
  "preview": {
    "url": "/api/assets/downloads/<opaque-short-lived-token>",
    "expires_at": "2026-08-23T00:00:00.000Z",
    "media_type": "image/png",
    "size": 419685,
    "checksum_sha256": "<verified-sha256>"
  }
}
```

`url` 可复用现有同源 bytes route；浏览器不得持久化 token。缩略图和大图在授权有效期内复用同一 URL，避免同一页面重复
mint。目录初始加载按可见项懒加载并限制并发；不能为全部历史条目批量预签名。

### 4.4 错误与 fallback

| HTTP | code | UI 语义 |
|---|---|---|
| 401 | 既有 identity 错误 | 登录恢复；不显示图片 |
| 404 | `AVATAR_PREVIEW_NOT_FOUND` | missing/cross-org/invisible 统一；目录刷新或安全移除该项 |
| 422 | `AVATAR_PREVIEW_UNAVAILABLE` | 无受控图片、父 Asset inactive、版本 unavailable 或不支持媒体；首字占位并解释 |
| 503 | `AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE` | 临时读取/授权失败；保留人物业务信息并只重试图片 |

服务端日志和审计不得记录 token、对象路径或完整图片 URL。图片 decode 失败是浏览器可见错误，不能改写服务端人物/素材状态。

### 4.5 API 与浏览器 TDD acceptance

- enterprise 人物 + active `avatar_image` + available version 返回短时 URL 和 verified metadata；GET 返回 exact bytes，hash 一致；
- parent disabled、version unavailable、错误 kind 与无 material 分别 422，不创建 grant；
- missing/cross-org/invisible avatar 统一 404，未认证 401；
- 响应/日志没有 `material_asset_version_id`、object key、Provider URL、Cookie、Token 正文或 Profile path；
- 通用 Assets 列表与现有三类业务语义不变；人物预览不把内部候选图混入 Assets；
- 真实 Chrome 覆盖目录缩略图、选中大图、同版本绑定、授权过期/失败 fallback、390 列表详情返回与焦点恢复；
- 首字只在图片不可用时出现，且有可见中文原因；不得使用假头像。

## 5. 被否决方案

### 5.1 直接公开 `material_asset_version_id`

否决。它把 repository 内部关系变成浏览器合同，要求前端自行组合目录可见性与素材授权，增加 TOCTOU 和误用面。

### 5.2 复用通用 AssetVersion POST 作为公开人物 API

否决为公开 UI seam，但允许在人物 service 内部复用其 grant/bytes 实现。通用命令不能表达人物条目绑定和 fallback 语义，
也不应让人物页面持有底层素材 ID。

### 5.3 把所有阶段数据一次性塞入 HTML 或前端并行拼接

否决。它会把跨领域当前真值和唯一下一步交给浏览器推断，放大 stale、权限与局部失败问题，也会让 390 首屏过载。

### 5.4 新建组织级生产任务队列

不在范围。当前没有服务端真实索引；任何此类能力须独立 Product/API、安全、授权与审计 gate。

## 6. 兼容与推出

- 两个 seam 均 additive、feature-gated、默认关闭；关闭时现有页面/API/Production/Assets 行为不变。
- Stage 1 只实现商品资料所需的最小 operator workspace 读取投影与 opt-in 页面骨架；后续阶段只按当前 Goal 所需
  additive 扩展投影，不得预先横向实现全部阶段。
- Avatar preview 固定在 Stage 3；同一 Goal 内先通过 service/API 的目录绑定与授权回归，再接入人物工作区 UI。
- 旧 URL、DOM/ARIA 与写命令在相应阶段迁移完成前保持；redirect 必须最后单独接受。
- 无 migration/DB 必要性是当前设计假设；若实现审计发现必须持久化新状态或公开内部引用，立即停止并重新过 Product/API gate。

## 7. Stop conditions

以下任一成立，未来实现不得自行扩张：

- 需要修改领域状态、审核语义、组织授权、生产 eligible/attempt/Worker 时序；
- 需要前端拼组织级队列、跨阶段写事务或后台自动重试；
- 无法在授权时原子核对人物目录绑定、父 Asset active 和版本 available；
- 需要暴露 object key、永久 URL、Provider credential/URL/Profile path；
- 现有 API 无法提供业务名称或状态，只能由 ID、缓存或猜测生成；
- 任何真实 Provider、生产或积分动作成为验收前提。

遇到 stop condition 应提交最小事实缺口和候选文件，由新的独立 gate 决定；本合同本身不授权实现。
