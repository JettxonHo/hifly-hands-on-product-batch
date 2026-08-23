# 2026-08-23 运营单任务工作区 Stage 1 商品资料

## Goal 与固定基线

- Goal：从已接受的方案 A 合同实现 Stage 1 商品资料，不开始 Stage 2。
- 精确基线：`origin/main@b7716acf8f58edb9bc1a5f9cb1016532436fb7b4`。
- 独立 Issue：#238；独立分支：`codex/operator-single-workspace-stage-1`。
- Lifecycle：本 Draft PR 经独立 Review 并合并后才表示 Stage 1 仓库实现成立；Draft、CI 或截图均不表示部署、生产验收或
  Stage 2 授权。

## Product/API gate

- 现有 Project Content service 已能按组织读取 exact Project、Product 与 current ProductRevision，Stage 1 不需要新领域状态、
  数据库持久对象、跨阶段写 aggregate 或生产队列。
- 新 operator workspace 是默认关闭的 additive read-only projection，只调用现有 `getProject`。Product 与 Project 不匹配、
  missing 或 cross-org 对外统一 404；非法 stage 为 400；当前权威读取失败为 503；未认证沿用 401。
- `product_content` 为 `workspace/ok`。`copy/avatar/video_plan/production` 固定为 `legacy/not_loaded`，对象、业务状态、
  blocker 和推荐动作均为空，service 不读取这些领域。
- `action_registry_version=1` 只接受七个商品资料 action。未知 registry/code、错 stage 或错 kind 在客户端 fail closed，
  不显示、不执行主动作。

## 实现

- 新增默认关闭的 `/workspace.html?project=<id>&product=<id>&stage=<code>` opt-in shell；1440 为商品列表、当前任务、
  辅助上下文与固定操作区，768 收敛为两栏，390 为列表/详情/返回与底部主动作。
- 商品资料继续复用既有 Project Content 表单和写命令，保留 current/history、dirty、saving/saved、409 显式恢复、Ready
  blockers、商品图片 `product_image + active + available`、素材竞态和 scoped refresh。
- 四个未迁移阶段使用固定本地 route registry 返回既有 Copy/Avatar/Plan/Production 页面，保留目标页支持的具名上下文，
  不把 API 字段当任意 URL，也不形成 workspace 跳转循环。
- 移动端进入详情后聚焦任务标题，返回时聚焦重绘后的 exact current 商品；创建新商品后 URL 与当前表单绑定新商品，
  不继续显示旧 active product。

## RED -> GREEN

1. 首个真实 Chrome RED：Stage 1 页面尚不存在，等待“确认商品资料”45 秒超时。最小 GREEN 建立 opt-in shell、只读 seam
   与 exact Product Content panel。
2. Service/API RED：缺少 service module；非法 stage 误为 500；authority failure 误为 404。GREEN 后分别得到稳定模块、400
   与 503，并锁定组织隔离和四阶段 zero-read。
3. 移动焦点 RED：商品切换重绘列表后，返回焦点落到第一项。GREEN 改为聚焦重绘后的 `aria-current` 等价商品。
4. 浏览器 recovery RED：非确定性 reload 未真正消费 fail-once。GREEN 将失败注入精确绑定当前 workspace bootstrap，证明
   初始 503 后唯一“刷新当前商品”可完整恢复。
5. 浏览器纵向链 GREEN：七 action 与固定优先级、unknown/wrong-stage/wrong-kind fail closed、dirty 商品切换与刷新保护、
   Ready parent 历史返回、409 本地输入保留、商品图类型过滤及新商品 exact 选择均由公开 seam 覆盖。

## 验证证据

- focused service/API：14 pass；默认环境的 PostgreSQL case 为显式 env-gated skip。
- 本地一次性 PostgreSQL 16：`PROJECT_CONTENT_TEST_DATABASE_URL=... node --test test/project-content-postgres.integration.test.js`
  为 1/1 pass；容器随后停止并移除。
- Stage 1 真实 Chrome：2/2 pass。
- 直接受影响 Chrome 兼容组：14/14 pass；Production 补充组：1/1 pass。
- 三视口临时 PNG：`stage-1-product-content-1440x900.png`、`768x900.png`、`390x844.png`，像素头与文件名一致；
  截图仅位于 `/private/tmp/hifly-stage-1-screenshots`，不提交 Git。
- 默认 `npm test`：1113 total / 1098 pass / 15 existing env-gated skip / 0 fail；`npm run check`：243 个
  JavaScript 文件通过。最终 range diff、allowlist 与 fixed-head CI 以 PR 元数据和结果评论为准。

## 未执行边界

- 未实现或读取 Copy、Avatar、VideoPlan、Production workspace 投影；未开始 Stage 2。
- 未改变审核、权限、领域状态、eligible/attempt/Worker 或生产安全语义。
- 未部署、未 SSH、未访问 Hifly/Provider、未启动 Worker/Local Agent、未读写生产数据、未生成视频、未消耗积分。
