# VSA-A08 视频方案、预检与方案审核

> 状态：本地实现与独立 Review 完成（APPROVED），尚未 PR、CI 或合并
> Issue：#64
> 页面设计：`docs/frontend/VSA-A07-A08_UIUX_DESIGN.md`

## 业务边界

A08 固定当前有效的商品快照、已批准文案、已确认人物与实际存在的能力配置快照，形成不可变方案版本。
它不创建生产工单，不连接真实执行环境，不操作 Hifly，也不声明没有 Evidence 的声音、背景或姿势能力。

## 对象与状态

- `VideoPlanVersion`：`draft → frozen → superseded`。草稿只允许修改制作说明；启动预检后冻结；修改冻结版本必须派生新草稿。
- `PreflightRun`：`queued / running / succeeded / failed / cancelled`，只描述技术执行。
- `PreflightResult`：`passed / warning / blocked / invalidated`，只描述业务结论，分为上游有效性、方案完整性、生产准备度三组。
- `PlanReview`：不可变审核记录配合状态头和追加事件，状态为 `pending / approved / changes_requested / revoked`；页面的 `not_submitted` 是无审核记录时的投影。

`PreflightRun failed` 不产生 `PreflightResult blocked`。`passed` 或允许审核的 `warning` 只允许提交人工审核，绝不自动批准。
执行环境离线是 production readiness 的 warning，不阻止保存、预检或人工审核。

## 失效与恢复

ProductRevision、CopyVersion、AvatarSelection、Avatar AssetVersion 或已验证 capability/Evidence 快照任一权威输入变化，会使旧预检失效，并撤销相关 approved Review。
展示名称等未进入权威输入快照的元数据变化不传播失效。被撤销的 Review 不恢复；用户需基于新上游派生方案、重新预检并创建新审核周期。

浏览器刷新与重新进入均从服务端恢复方案、运行、业务结论和审核历史。草稿有未保存输入时不能预检；
切换商品、版本或刷新前必须显式选择保存、放弃或取消。草稿保存采用行版本；409 不覆盖服务端内容，
页面保留用户当前输入并提示查看最新版本。

## API

- `GET /api/products/:productId/video-plan-workspace`
- `POST /api/products/:productId/video-plans`
- `PATCH /api/products/:productId/video-plans/:planId`
- `POST /api/products/:productId/video-plans/:planId/derive`
- `POST /api/products/:productId/video-plans/:planId/preflight`
- `POST /api/products/:productId/video-plans/:planId/reviews`
- `POST /api/products/:productId/plan-reviews/:reviewId/approve`
- `POST /api/products/:productId/plan-reviews/:reviewId/request-changes`

所有写命令由身份上下文确定 Organization 与成员，客户端不能提交 ownership。需要幂等的命令使用
`Idempotency-Key`；相同 key 与相同 payload 回放当前服务端投影，不同 payload 返回冲突。

## A09 边界

页面批准后只显示禁用的「创建生产工单尚未开放」。本模块没有 ProductionOrder 路由、对象或假链接。
