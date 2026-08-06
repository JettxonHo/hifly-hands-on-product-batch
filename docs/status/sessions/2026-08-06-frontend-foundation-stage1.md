# Frontend Foundation Stage 1

## 基本信息

- **日期**：2026-08-06
- **执行者/工具**：Codex（实现与测试）；Kimi K3 Stage 0 审计为设计依据
- **基线 commit**：`21d4174`

## 目标

实现 Issue #77：为 A01-A03 已有企业页面建立统一设计变量、应用壳层、基础控件、状态语义、响应式布局和克制动效，不改变业务 API 与状态机。

## 实际修改

- 新增共享 `web/tokens.css`、`web/base.css`、`web/shell.css`、`web/shell.js`。
- 统一登录、项目列表、项目商品、素材中心、成员管理的页面结构与视觉语言。
- 创建项目、商品和成员改为原生对话框；成员停用增加危险确认。
- 商品、素材、成员状态增加中文显示映射，保留服务端原始值。
- 增加 390px 布局、长文本约束、键盘焦点和 reduced-motion。
- 新增 Stage 1 浏览器合同测试，并更新受显示文案与创建流程影响的现有浏览器测试。
- 独立 Reviewer 首轮发现受权限/feature 控制的导航在异步响应前可短暂闪现；已改为默认隐藏、正向授权后显示，并用延迟身份响应回归锁定。

## 验证命令与结果

```text
npm run check
# 99 JavaScript files checked

npm test
# 628 total / 624 pass / 0 fail / 4 environment skips

node --test test/frontend-foundation-browser.test.js
# 1/1 pass（系统 Chrome，本地内存数据）

node --test test/project-content-browser.test.js
# 1/1 pass（系统 Chrome，创建项目/商品/卖点/Ready/刷新恢复）

git diff --check
# pass
```

视觉验收证据在仓库外 `/private/tmp/hifly-stage1-visual-qa/`，包含登录、项目、商品、素材和成员页面的 1440px 与 390px 截图。

## Git / PR / Issue

- Issue：#77
- 分支：`codex/frontend-foundation-stage1`
- PR：待独立 Review 完成后创建

## 真实飞影访问情况

- 是否访问飞影：否
- 是否消耗积分：否
- 涉及批次/SKU：无

## 未完成项

- 独立 Reviewer 首轮提出 1 个 important；修复后快速复审 `APPROVED`，无剩余 blocker/important。
- PR 尚未创建。

## 下一步

1. commit、push、创建 ready PR。
2. 等待 Owner 单独授权合并和关闭 Issue #77。
