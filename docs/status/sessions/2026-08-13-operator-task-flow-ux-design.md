# 2026-08-13 运营任务流 UX V1 设计会话

## 任务

- Issue：#164 `UX-D01: 固化运营任务流优先的 UX V1 设计契约`
- 基线：`origin/main@8bcfaac59b5fe4c012de7b648d2b3d41419a3208`
- 分支：`codex/operator-task-flow-ux-v1`
- 性质：doc-only 设计合同；不是前端实现、部署或客户验收

## Owner 决策

Owner 批准方案 A“运营任务流优先”：页面首先降低运营人员判断负担，首屏必须回答当前项目/商品、步骤、业务状态、唯一推荐下一步和阻断。技术执行对象进入可展开详情，但生产安全与审计能力不得删除或弱化。

## 已核验输入

- `AGENTS.md`、CURRENT、ROADMAP 与多 Agent 协作规范；
- Kimi K3 Stage 0 视觉审计与前端升级计划；
- VSA A04-A14 页面设计与全链路审计；
- 产品信息架构、低保真页面结构和用户流程；
- 当前 `tokens.css`、`base.css`、`shell.css`；
- Projects、Project、Copy、Avatar、Plan、Production、Works、Assets 的页面结构；
- 现有项目、文案、人物、方案、生产、核验、作品、素材和 A14 浏览器测试合同；
- Taste redesign skill 的 targeted-upgrade、状态完整性、语义结构、焦点和可访问性原则。

## Taste skill 适用性裁决

本项目是高频企业运营工作台，不是营销网站。采用既有栈内的 targeted upgrades、清晰层级、完整加载/空/错误状态、键盘焦点、语义 HTML 与克制交互；不采用外部字体、图片、纹理、视差、滚动叙事、玻璃效果、营销 Hero 或新依赖。已批准的冷中性灰、品牌蓝、基础控件和 CSP 优先于通用风格建议。

## 事实与范围

1. Frontend Foundation 已实现，tokens、基础控件和应用壳层继续复用，不重建设计系统。
2. 历史设计保留为证据；新合同只在任务叙事、主操作、技术信息降级和页面结构上 supersede 旧方向。
3. 主工作区仍为旧 `gui/visual-refresh` 且有用户脏改动。本轮使用独立 clone，从精确 main 基线工作，未合并或覆盖旧 CSS-only 改动。
4. 后续共享样式必须 opt-in，未迁移页面不得被宽泛 CSS 选择器意外改变。
5. 三个实现切片严格串行，各自另建 Issue 和 Draft PR；本会话不创建实现分支。

## 文档改动

- 新增 `docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md`；
- 更新 `docs/status/CURRENT.md`；
- 更新 `docs/ROADMAP.md`；
- 新增本 session。

未更新 ADR：该方向可按页面切片回退，不满足硬不可逆门槛。未更新 `docs/agent-collaboration.md`：现有协作规则已足够，Issue #164 和 CURRENT 已提供当前指针。

## 安全与生产边界

- 未修改 HTML、CSS、JavaScript、API、数据库、Migration、状态机或测试。
- 未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
- 保留 Cloud Executor disabled/fail-closed、并发 1、唯一 eligible、零 attempt、失败即停、无自动重试和人工审核合同。

## 验证

- `npm run check`：通过，检查 229 个 JavaScript 文件。
- `git diff --check`：通过。
- 基线：当前 HEAD 仍为精确 `8bcfaac59b5fe4c012de7b648d2b3d41419a3208`，且该提交可作为本分支祖先追溯。
- 文档 allowlist：通过，仅包含 `docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md`、`docs/status/CURRENT.md`、
  `docs/ROADMAP.md` 和本 session 文档。
- Draft PR 三组 CI：待执行。

## 后续

设计 PR 经独立 Review 并合并后，才创建 Slice A 的独立实现 Issue。Slice A 合并后开始 B，B 合并后开始 C。代码、部署和运行时验收均需各自阶段证据，不得由本设计会话提前宣称完成。
