# 2026-08-23 运营单任务工作区设计与 Product/API 门禁

## 会话目标

在 Owner 正式接受“方案 A：单任务工作区”方向后，只固化正式 UX 合同与 Product/API 门禁，不开始页面或 API 实现。

## 固定基线与治理

- 精确基线：`origin/main@677d79c2cc8256b7cb6661972b934b289c3b456d`。
- 独立 Issue：#236。
- 独立分支：`codex/operator-single-workspace-design`。
- Owner 评审过的研究/HTML 原型是 throwaway 设计输入；其旧分支不合并、不搬运，旧 base 不替代当前 main。
- Lifecycle：Owner 已接受方向；Issue #236 的 Draft PR 合并进入 main 才表示精确合同 `designed`。本会话不表示实现、
  部署、客户采用、Provider 或生产验收。

## 只读真值审计

### 现有页面与工作区

- Project、Copy、Avatar、Plan、Production 各有独立 URL、bootstrap、商品选择、阶段链接、刷新与历史/冲突处理。
- 各领域 API 足以继续持有阶段内真值，但没有 project/product/stage 只读聚合，无法让一个稳定 shell 在不猜测的情况下
  同时投影五阶段读取状态、阻断和唯一下一步。
- 当前没有组织级生产任务索引；新工作区不得由浏览器拼队列，也不得增加 Worker 启停命令。

### 人物图片

- `web/avatar.js` 的目录与详情当前只渲染 initials。
- Avatar repository 内有 `material_asset_version_id`；service 会验证同组织、`kind=avatar_image`、父 Asset `active` 与
  AssetVersion `available`，但公开 workspace 只输出 `preview_kind`/素材状态，没有可用预览授权。
- 通用 Assets 已有组织级短时 download authorization 和受控 bytes route，但作为人物公开入口会暴露内部素材版本关系，
  且不能在同一人物领域 gate 中原子绑定目录可见性、人物版本和素材父 Asset 状态。

## 设计决定

1. 正式工作区不是超长单页：1440 为商品列表/当前任务/辅助上下文/底部操作，768 两栏，390 单面板列表/详情/返回。
2. 使用稳定 `/workspace.html` + project/product/stage 具名上下文；旧阶段页在逐片达到等价前保留。
3. 未来先增加只读 operator workspace projection；阶段写命令继续沿用现有 API，不创建跨阶段写 aggregate。
4. 人物使用专用 `POST /api/avatar-catalog/:avatarId/preview-authorizations`，内部复用 Asset grant/bytes；浏览器不接触
   `material_asset_version_id`、object key 或 Provider URL。
5. Owner 固定后续 Stage Goals 严格串行：Stage 1 商品资料 -> Stage 2 文案 -> Stage 3 人物 -> Stage 4 视频方案 ->
   Stage 5 生产 -> Post-stage 作品库 -> 素材中心/移动收口。Stage 1 只包含商品资料所需最小 shared foundation/只读投影；
   Stage 3 包含 secure real preview；Stage 5 单独高风险 Review，生产门禁保持不变。
6. 作品库后续桌面验收记录为 9 项原型数据第 1 页 6 项、第 2 页 3 项；390 继续列表 -> 详情 -> 返回。该结论属于
   后续 Works Goal，不是本会话的实现证据。

## 文件 allowlist

- `docs/frontend/OPERATOR_SINGLE_WORKSPACE_UX_CONTRACT.md`
- `docs/frontend/OPERATOR_SINGLE_WORKSPACE_PRODUCT_API_GATE.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-23-operator-single-workspace-design-gate.md`

没有修改 HTML、CSS、JavaScript、API、数据库、测试、依赖、部署文件或原型文件。

## 验证

- `npm run check`：提交前执行。
- `git diff --check origin/main...HEAD`：提交前执行。
- strict allowlist、相对链接与动态阶段措辞：提交前执行。
- fixed-head GitHub CI：以 Draft PR 元数据与结果评论为准；本文不在提交正文中自引用最终 head。

## 未执行边界

- 未开始 Stage 1 或任何页面/API 实现；未运行真实浏览器作为生产证明。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker/Local Agent、未读写生产数据、未生成视频、未消耗积分。
- Fidelity C5b、模型安装、accepted benchmark 和既有六项 blocker 均未改变。
