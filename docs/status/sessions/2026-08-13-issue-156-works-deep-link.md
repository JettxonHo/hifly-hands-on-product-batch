# Issue #156 Works 深链首选项修复

## 范围

- 固定基线：`origin/main@e05b3ee950918f5d79d9571a83062e2bf2287e4c`。
- 仅修复 `/works.html?work=<work-id>` 的首次选择行为。
- 不修改 Work 授权、交付状态、query 格式、生产执行器或 Issue #157。
- 本轮未部署、未 SSH、未访问飞影、未启动 Worker、未修改生产数据，也未消耗积分。

## 实现

- 首次加载从 query 读取目标 Work；目标在当前组织的可见列表中时直接选中，即使它不是第一条。
- query 指向缺失或组织不可见的 Work 时，继续回落到第一条可见 Work，不显示隐藏对象信息。
- 后续刷新仍优先保留用户当前选择，既有交互语义不变。

## TDD 证据

- RED：聚焦浏览器测试访问 `work-a13-rework`，实际错误选中首项“云感保湿乳”，断言失败。
- GREEN：同一公共页面入口正确选中“返工测试商品”；组织不可见 ID 回落到“云感保湿乳”，页面不包含隐藏商品名称。
- 聚焦命令：`node --test test/work-delivery-browser.test.js`，`1/1` 通过。

## 状态

- `npm run check`：229 个 JavaScript 文件通过。
- `npm test`：1003 passed、0 failed、14 skipped（1017 tests）。
- `git diff --check`：通过。
- 实现与回归测试已完成，待独立审阅与合并。
- 生产仍停留在既有安全基线；本修复尚未部署。
