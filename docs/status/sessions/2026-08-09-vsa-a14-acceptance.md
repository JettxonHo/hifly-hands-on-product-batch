# 2026-08-09 VSA-A14 全链路验收

## 范围

- Issue：#70 `VSA-A14: Vertical Slice A end-to-end acceptance and hardening`
- 设计：`docs/frontend/VSA-A14_FULL_CHAIN_UX_AUDIT.md`，PR #93 已合并。
- 实现 worktree：`/private/tmp/hifly-vsa-a14-implementation`
- 分支：`codex/vsa-a14-acceptance`
- 基线：`ed6567ceb4b266f2ee4ec823ab01b9263bdc71d6`

## Agent 路由

- 主控与独立 Reviewer：Sol。
- 实现：准确自定义 Agent `luna-worker`。
- 配置：`~/.codex/agents/luna-worker.toml`，`gpt-5.6-luna`，Max。
- 模型状态：`CONFIG_VERIFIED / UNVERIFIED_RUNTIME_MODEL`。
- 未使用 Terra；实现者未批准或合并自己的改动。

## 已完成

- 企业功能开启时，登录、改密、已登录重入落到项目页；功能关闭时保留遗留 `/` 入口。
- 非管理员误入成员管理时返回对应企业入口。
- 商品 revision 写入 URL，刷新和从文案页返回时恢复正确商品。
- project 乐观并发 409 显示明确刷新提示，不再被通用失败文案覆盖。
- 素材核验存在运行态时每 2 秒刷新，终态、失败或离页后停止。
- 修复 production-enabled 且尚无视频方案时服务层空引用；浏览器主路径从真实空状态创建首个方案。
- 补齐现有设计 token，移除作品列表装饰位移，删除永久隐藏的核验恢复死控件。
- 新增从全新企业登录到 Work 检查和 DeliveryRecord 的系统 Chrome 主路径测试。

## 验证

```text
node --test test/vsa-a14-acceptance-browser.test.js test/manual-handoff-package-browser.test.js
2 pass / 0 fail / 0 skip

npm run check
178 JavaScript files checked

npm test
803 tests / 789 pass / 0 fail / 14 environment skips

git diff --check
pass
```

截图证据仅保存在仓库外：

```text
/private/tmp/hifly-vsa-a14-screenshots/a14-production-1440.png
/private/tmp/hifly-vsa-a14-screenshots/a14-works-390.png
```

## 安全与执行边界

- 未访问 Hifly。
- 未调用真实 Provider、Capture HTTP、Playwright/影刀生产执行。
- 未运行真实批次，未消耗飞影积分。
- 未提交配置、登录态、批次、输出视频、HAR、日志、截图或 `node_modules`。

## 最终状态

1. PR #94 已于 2026-08-09 squash merge，merge commit 为 `ba687de`。
2. Ubuntu、Windows、PostgreSQL CI 均已通过，Issue #70 已关闭。
3. Vertical Slice A Goal 最终结论为 `GOAL_APPROVED`；真实 Hifly 与积分生产不在本 Goal 范围内。
