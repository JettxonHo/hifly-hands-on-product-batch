# 2026-08-07 VSA-A08 VideoPlan / Preflight / PlanReview

## 当前状态

Issue #64 的本地实现、两轮独立 Review 修复与最终复审已完成，最终结论为 `APPROVED`，无剩余
Critical/Important；尚未 commit、push、PR、CI 或合并。

## 实际改动

- 新增 `src/video-planning/`：领域 service、受控预检器、异步 worker、memory/PostgreSQL repositories、migration。
- 新增正式视频方案 API 与 feature flag；接入 A07 服务端规划输入，不信任浏览器 ownership。
- 新增 `web/plan.html/css/js`，覆盖桌面三栏、390px 单栏/版本 Dialog、版本、制作说明、预检三组、审核历史、409 恢复和 A09 禁用边界。
- A07 页面阶段 4 与「进入视频方案」改为真实链接。
- 修复审核决定回放：receipt 查询早于 pending/revision 检查，回放返回当前服务端投影；能力或 Evidence
  快照变化会使预检失效并撤销批准，展示元数据变化不传播。
- 草稿未保存时禁用预检；商品、版本和刷新切换使用保存/放弃/取消对话框；A08 feature flag 关闭时
  A07 不暴露可点击入口。静态 DOM 默认无 A08 `href`，只有 runtime 明确启用后才添加链接。

## 本地验证

- `node --test test/video-planning-service.test.js test/video-planning-api.test.js`：12 pass / 0 fail。
- PostgreSQL 16 clean schema：`test/video-planning-postgres.integration.test.js` 1/1 pass。
- 系统 Chrome：A07 回归与 A08 创建、预检、审核、刷新恢复、1440/390 页面合同 2/2 pass。
- `npm run check`：142 个 JavaScript 文件通过。
- `npm test`：724 tests / 690 pass / 0 fail / 34 environment skips。
- 全量命令在普通沙箱中仍按条件跳过浏览器和数据库用例；上述两类测试已在本机可用环境分别定向实跑通过。

## 下一步

1. 由主控执行 Git/PR/CI；CI 全绿后按 Goal 授权直接合并并关闭 Issue #64。
2. A08 合并后先由 Kimi K3 完成 A09-A10 页面级设计，再启动 A09。

## 外部执行声明

本轮未访问 Hifly，未调用真实 Provider 或外部生产，未运行 `MULTI-002`，未消耗积分。
