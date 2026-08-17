# 运营工作台 V2-E 回补审计

> Lifecycle gate: 本文随审计 PR 合并进入 `main` 后，才构成 V2-E 回补决策的仓库真值；本文不等于回补实现、部署或真实生产验收。
>
> 审计基线：`origin/main@513dab70e3541085260975da8608a0189c2ea524`

## 1. 结论

V2-A、V2-B、V2-C 与 V2-D 合并后，Projects、Project、Copy、Avatar、Plan 的一级导航、五阶段状态、主要恢复路径和三视口布局没有出现需要整体返工的跨页漂移。

仍有两组可证实的局部漂移，需要在本审计获接受后严格串行回补：

1. **V2-E1：Projects / Project / Copy 业务语言、刷新作用域与 Copy Tab 键盘语义。** 主任务层仍显示 `general`、`Finding`、`QualityResult`、`Profile` 等内部值或英文对象名，Projects 刷新动作没有说明作用域；Copy 页签虽有基础 ARIA 关系，但缺少完整键盘合同。
2. **V2-E2：Avatar / Plan 业务语言、技术详情与 Plan Tab 键盘语义。** Avatar 的任务上下文显示短内部 ID，`avatar_image`、`Evidence`、`verified capability`、`Organization` 则主要出现在可见管理员/事实区和部分阻断文案；Plan 主上下文显示短 ID，且页签缺少完整 ARIA 与键盘合同。

本审计不需要也不授权 V2-E 的页面实现。不得为“保持一致”改写已经通过公开 seam 的状态机、导航或恢复逻辑。

## 2. 证据方法与边界

### 2.1 使用的证据

- 源码与 DOM 审计：当前 `web/` 页面、共享 shell、现有公开 browser tests。
- 本地真实 Chrome：使用现有假数据公开 seam，串行运行 Slice A、Copy、Avatar、Plan 和 V2 foundation 浏览器回归，结果 `10/10` 通过。
- 视觉证据：临时目录 `/private/tmp/hifly-v2-e-audit-evidence-20260818/`，未提交 Git。
  - Projects：`1440x900`、`768x900`、`390x962`。
  - Project：`1440x1124`、`768x1464`、`390x1882`。
  - Copy / Avatar / Plan：`1440x900`、`768x900`、`390x844`。

### 2.2 证据边界

- Slice A/B 截图来自本地假数据公开 browser seam，可证明 DOM、业务文案、状态映射、焦点和响应式行为；不能证明已部署或真实 Provider 行为。
- V2 foundation 截图由 shell stub 生成，只能证明壳层布局，不作为业务状态视觉证据。
- 本轮未连接部署环境、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。

## 3. 已确认无实质漂移

| 范围 | 证据 | 结论 |
| --- | --- | --- |
| 一级导航 | 同一 full-feature runtime 与同一 admin 跨企业页面均显示“项目 / 作品库 / 素材中心 / 成员管理”；member 不显示成员管理；组织级生产任务索引 gate 未通过时不显示“生产任务” | 符合 V2 合同，不做回补 |
| 五阶段状态 | 页面以 `completed / current / available / blocked` 显式标记，而不是以是否有链接推断完成；Copy 未人工批准时人物阶段可访问但不显示已完成 | 符合阶段真值，不改变现有领域导航 |
| 唯一推荐下一步 | 公开 seam 覆盖的加载、草稿、阻断、冲突和终态中，代表页面的 `data-recommended-action` 未出现竞争主操作 | 不做横向重写；后续仅修正文案与语义 |
| 错误与冲突恢复 | Projects 可从初始失败恢复；Project 保护 dirty、409、本项目历史深链与 404/5xx 分流；Copy/Avatar/Plan 均有完整 bootstrap 恢复和冲突/异步状态保留 | 当前恢复合同成立，不新增 API |
| 三视口层级 | 1440/768/390 浏览器 seam 无页面级横向滚动；移动端任务摘要先于详情，阶段导航可换行且操作可达 | 无整体布局返工需要 |

## 4. 可证实漂移

| 优先级 | 页面/状态 | 证据 | 用户影响 | 根因类别 | 最小回补方向 |
| --- | --- | --- | --- | --- | --- |
| P1 | Project / Copy 商品上下文 | `web/project.html` 的品类默认值及 `web/project.js`、`web/copy.js` 的主任务文案直接显示服务端值 `general`；三视口截图可见 | 运营人员看到内部默认代码，不知道真实业务含义 | 中文内容/领域映射 | 只在展示层提供业务化名称并保留原始存储值；若映射会改变存储或 API 合同，停在 Product/content gate |
| P1 | Copy 质检与审核 | Dialog 与主任务文案直接显示 `Finding`、`QualityResult`、`Profile`；公开测试也以“接受 Finding”为可见名称 | 自动质检对象和人工审核概念混用，增加学习成本 | 中文词典/信息层级 | 主任务层改为“质检问题/质检结果/质检规则配置”；内部对象名仅可留在折叠技术详情或审计记录 |
| P1 | Avatar 人物选择与管理 | 任务上下文显示短文案 ID；`avatar_image`、`Evidence`、`verified capability`、`Organization` 主要位于可见管理员/事实区及部分 blocker | 商品运营被迫理解素材代码、证据模型和组织内部术语 | 中文词典/技术详情 | 任务上下文使用业务对象；管理员/事实区使用“人物图片/能力依据/已验证能力/当前企业”；ID 与原始证据引用进入可展开技术详情，审计数据不得删除 |
| P1 | Plan 上游上下文 | 主上下文与上游卡片显示文案/人物短 ID，例如 `copy-app`、`selectio` | 无法据此辨识业务对象，技术 ID 抢占首屏 | 信息层级 | 主层显示业务状态和已选对象名称；短 ID 只在技术详情中保留 |
| P2 | Projects 刷新 | `web/projects.html` 使用泛化“刷新”，无 `data-refresh-scope`；错误文案与按钮没有形成明确作用域 | 用户不知道刷新列表还是整个工作台 | 控件语义 | 明确“刷新项目列表”，标记对应 scope，错误推荐动作与按钮一致 |
| P2 | Copy 质检/审核切换 | `web/copy.html` 已有 tablist/tab/tabpanel 与 `aria-selected`，但 `web/copy.js` 只有 click 切换，没有 roving tabindex、ArrowLeft/ArrowRight/Home/End 或焦点迁移 | 键盘用户无法按标准 Tab 模式切换质检与审核 | 控件语义/可访问性 | 在保留 QC 与人工审核状态分离的前提下补齐完整 Tab 键盘合同 |
| P2 | Plan 预检/审核切换 | `.decision-tabs` 只有 `role=tablist`，按钮缺少 tab 角色、选中/面板关联，也没有 roving tabindex、方向键/Home/End 与焦点迁移 | 键盘和读屏用户无法获得一致页签状态 | 控件语义/可访问性 | 独立补齐 Plan 的完整 Tab ARIA 与键盘合同，不改变预检/人工批准业务状态 |

## 5. 严格串行回补建议

### 5.1 V2-E1：Projects / Project / Copy

**候选生产文件**

- `web/projects.html`
- `web/projects.js`
- `web/project.html`
- `web/project.js`
- `web/copy.html`
- `web/copy.js`

**候选公开 browser seams**

- `test/operator-task-flow-slice-a-browser.test.js`
- `test/copy-generation-browser.test.js`
- `test/copy-quality-browser.test.js`
- 必要时 `test/operator-workbench-v2-foundation-browser.test.js`，仅用于同 runtime 一致性回归

**先 RED 的行为**

1. Project 与 Copy 主业务上下文不得把 `general` 原样作为用户品类；提交/保存仍保留服务端原值。
2. 主任务、阻断、Dialog 不再把 `Finding / QualityResult / Profile` 作为业务名称；历史与折叠审计仍可访问。
3. Projects 的刷新按钮和错误恢复明确为“刷新项目列表”，并使用同一推荐动作。
4. Copy 质检/审核切换必须同时具备 `tablist / tab / tabpanel`、`aria-selected / aria-controls`、单一 Tab 停靠点，以及 ArrowLeft/ArrowRight/Home/End 的焦点与选中同步；不得改变 QC 与人工批准的业务状态。

**停止条件**

- 若品类本地化需要修改存储值、API 字段或领域枚举，立即停止并提交 Product/content gate；前端不得静默重写服务端真值。
- 不修改 Copy 质检、人工审核、版本或冲突状态机。

### 5.2 V2-E2：Avatar / Plan

**候选生产文件**

- `web/avatar.html`
- `web/avatar.js`
- `web/plan.html`
- `web/plan.js`

**候选公开 browser seams**

- `test/avatar-selection-browser.test.js`
- `test/video-planning-browser.test.js`
- 必要时 `test/operator-workbench-v2-foundation-browser.test.js`

**先 RED 的行为**

1. Avatar 的任务上下文和 Plan 主层不得显示短内部 ID；Avatar 可见管理员/事实区与 blocker 不再直接使用 `avatar_image / Evidence / verified capability / Organization` 作为业务名称。ID、证据引用和原始代码仍保留在折叠技术详情。
2. Plan 预检/审核切换必须同时具备 `tablist / tab / tabpanel`、`aria-selected / aria-controls`、单一 Tab 停靠点，以及 ArrowLeft/ArrowRight/Home/End 的焦点与选中同步。
3. QC passed 仍不等于人工批准，preflight passed/warning 仍不等于 Plan approved。

**停止条件**

- 若展示业务对象名需要新增 API 字段或改变现有对象合同，停止并给出最小 Product/API 缺口；不得由前端猜测名称。
- 不修改人物授权、素材门禁、方案预检或人工审核领域语义。

## 6. Acceptance gates

每个回补片必须独立 Issue、独立 Draft PR、独立 Review，且前一片合并后才开始下一片。每片至少要求：

- 公开 browser seam 的真实 RED → 最小 GREEN；
- 同一 runtime/角色的导航与阶段真值回归；
- 1440/768/390、无横向滚动、可见焦点、reduced-motion；
- loading/error/dirty/409/history/async 既有恢复路径不回归；
- `npm run check`、完整 `npm test`、`git diff --check`、严格 allowlist 和 fixed-head CI；
- 不部署、不访问 Provider、不把本地假数据证据写成生产证据。
