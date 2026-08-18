# Issue #202 persisted failed 工单首屏终态

> 日期：2026-08-18
> 基线：`origin/main@49c93a44a012e2eff0a559e947589ec827c28e7e`
> 分支：`codex/issue202-failed-order-summary`
> 状态：仓库修复候选；随对应 PR 合并进入 `main` 后计为仓库完成，部署与真实 Provider 复验另行 gate

## Product/API gate

现有公开 seam 已足够：Production workspace 提供所选持久化工单，manual execution 提供 exact attempt/report，
Cloud Executor status 提供 Worker offline 与 `current_order=null`。本轮不需要新增或修改 API、数据库、领域状态、
权限、Provider 或依赖。

## TDD

公开真实 Chrome RED 使用现有 Production browser seam 构造：

- selected order 为 persisted `failed`；
- exact current attempt 与最新 report 均为 `failed`，report 为 `not_retryable`；
- Worker offline、`current_order=null`；
- 当前工单已有 ready handoff。

未修复基线实际得到：

```text
actual: 生产门禁未通过
expected: 生产失败，已停止
```

最小 GREEN 让非 current claim 的 persisted failed order 优先于交接包与激活门禁 fallback。首屏显示
“生产失败，已停止”，明确不会自动重试、重新领取或创建下一单；同工单 report 可用时唯一推荐“查看失败详情”，
否则只返回视频方案检查输入。在线 current order 的失败处理分支保持原样。

同一公开测试继续覆盖 waiting-for-executor fail-closed、claimed/running、requires_action、取消、
succeeded + A12 各阶段与 Work `pending_review` / `rework_required` / `deliverable` / `delivered`，以及初始加载失败后的
Refresh 恢复。failed 状态另在 1440/768/390 验证唯一推荐动作和无页面级横向溢出，PNG 只写入临时目录、不提交。

本机验证：

- #202 focused real Chrome：1/1；Production affected real Chrome：2/2；
- 默认并行 `npm test` 在 580 个已通过用例后，两个既有浏览器文件静默挂起超过 5 分钟，未产生产品断言失败，
  因此该次运行被终止且不记为全量通过；串行等价运行也在同一既有 Slice A 浏览器文件后静默挂起；
- 将发生挂起的 Slice A、Assets 与 Work Delivery 三个浏览器文件独立组合运行：15/15；
- `npm run check`：230 个 JavaScript 文件；`git diff --check`：通过；
- fixed-head Ubuntu、Windows 与 identity-postgres CI 继续作为默认全量合并门禁，结果记录在 Draft PR。

## 文件边界

- `web/production.js`
- `test/operator-workbench-v2-production-browser.test.js`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-18-issue-202-failed-order-summary.md`

本轮没有部署、SSH、访问 Hifly、启动 Worker/Local Agent、修改生产数据、创建或重试工单、生成视频或消耗积分；
没有 mark Ready、merge 或关闭 Issue #202。
