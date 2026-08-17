# 2026-08-18 运营工作台 V2-E 回补审计

## 任务边界

- 固定基线：`origin/main@513dab70e3541085260975da8608a0189c2ea524`。
- Issue：#184。
- 只审计 Projects、Project、Copy、Avatar、Plan；不写页面、API、数据库或测试实现。
- 允许文件严格为本审计报告、CURRENT、ROADMAP 与本 session 共 4 份文档。

## 真值调查

- V2-A/B/C/D 已进入基线；本轮以 V2 合同和已合并公开 browser seams 为准。
- 同一 runtime/admin 的一级导航顺序一致；组织级生产任务索引不存在时“生产任务”继续隐藏。
- 五阶段状态、唯一推荐动作、错误/冲突恢复和三视口层级未发现需要整体返工的漂移。
- 发现两个后续最小回补候选：V2-E1（Projects/Project/Copy）与 V2-E2（Avatar/Plan）。主要问题是内部英文/ID 暴露、Projects 刷新作用域和 Plan Tab 语义，而不是领域状态或 API 错误。

## 浏览器证据

首次运行因新 worktree 没有 Playwright 依赖而在加载测试模块时失败；这是本地环境缺依赖，不是产品 RED。随后只复用已安装的同仓库依赖，并运行：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
SLICE_A_SCREENSHOTS_DIR=/private/tmp/hifly-v2-e-audit-evidence-20260818/slice-a \
SLICE_B_SCREENSHOTS_DIR=/private/tmp/hifly-v2-e-audit-evidence-20260818/slice-b \
V2_A_SCREENSHOTS_DIR=/private/tmp/hifly-v2-e-audit-evidence-20260818/foundation \
node --test --test-reporter=spec \
 test/operator-task-flow-slice-a-browser.test.js \
 test/copy-generation-browser.test.js \
 test/copy-quality-browser.test.js \
 test/avatar-selection-browser.test.js \
 test/video-planning-browser.test.js \
 test/operator-workbench-v2-foundation-browser.test.js
```

结果：真实 Chrome `10/10` 通过，`0` skip。

临时 PNG 像素头/实际尺寸：

- Projects：`1440x900`、`768x900`、`390x962`。
- Project：`1440x1124`、`768x1464`、`390x1882`。
- Copy / Avatar / Plan：各 `1440x900`、`768x900`、`390x844`。

Slice A/B 截图可证明假数据公开 seam 下的业务 DOM 与响应式行为。Foundation 截图来自 shell stub，只用于壳层布局，不作为业务状态视觉证明。全部截图位于 `/private/tmp`，未提交仓库。

## 结论与后续

- 本审计存在实质但局部的跨页漂移，因此不能宣布“不需要 V2-E 实现”。
- 也不需要全站返工；后续仅在本审计经合并接受后，按 V2-E1 → V2-E2 严格串行进入独立实现 gate。
- 本轮未运行部署、SSH、Hifly、Worker、生产数据、视频生成或积分动作；无部署或 Provider 证据。

## 验证门禁

- 本地 `npm run check`：通过，检查 `229` 个 JavaScript 文件。
- 本地 `git diff --check`：通过。
- 分支只允许 4 份文档；截图、临时依赖链接和一次性证据均不进入 Git。
- fixed-head Ubuntu / Windows / identity-postgres CI 必须全部成功后，才可交由主控进行 acceptance review；CI 结果以 PR 固定 head 为准，不在提交前预写成功。
