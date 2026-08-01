# 项目当前状态

> 最后更新：2026-08-02
> 最后验证 commit：`2774285` (docs: finalize Windows CI recovery session record)
> 稳定 main commit：`2774285`

## Open PR

| # | 标题 | 分支 | 状态 |
|---|------|------|------|
| 15 | style(gui): 视觉与交互细节刷新(仅样式层) | gui/visual-refresh | Open, 等待 owner 视觉确认 |

## 当前工作分支

无

## 当前生产路径

- **默认批量生产**：Playwright 浏览器自动化（GUI → Fastify → 状态机 → Playwright → 飞影网页）
- **Capture HTTP**：默认关闭，仅作为实验/恢复能力，不替代 Playwright

## 真实积分授权状态

**当前没有真实飞影执行授权。**

- 不得执行 `MULTI-002`。
- `pointBudget` 表示本次最多执行任务数，不等于飞影实际积分数。
- 真实积分必须以飞影后台为准。

## 当前关键批次

| 批次 ID | 状态 | 说明 |
|---------|------|------|
| `batch-ec174f28-e9b8-4541-b2e7-c60b10e22474` | `real_batch_completed` | MULTI-001 已完成 (remote_id=652265)；MULTI-002 仍 pending |
| `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` | 混合态 | 历史 GUI 排障样本，不重跑 |

## 已知阻塞项

1. MULTI-002 需用户新会话明确授权积分后才可执行。
2. PR #15 需 owner 视觉确认后合并（CI 已全绿）。

## 已知技术债

- CORE-004：portable-path API 边界加固（`toPortableRelativePath` 不强制验证，依赖调用者纪律）

## 下一步（最多 5 项）

1. PR #15 完成视觉验收并由 owner 决定是否合并。
2. 推进 CORE-001：batch schema version 与 migrations。
3. 推进 CORE-002：crash-recovery fault-injection tests。
4. 推进 CORE-003：stale execution-lock recovery。
5. 评审 EXP-001 人物策略实验方案。

## 必须禁止的操作

- 未授权访问飞影 / 运行 Playwright 真实出片 / 运行 Capture HTTP real_live 或 real_batch。
- 执行 MULTI-002。
- 提交 config.local.json、登录态、batches、outputs、视频、HAR、日志、截图、node_modules、docs/resume/。
- 回滚/删除用户未提交文件。
- 执行 git reset --hard / git clean -fd / 修改 stash。

## 最近一次验证

```
npm run check: 66 JavaScript file(s) ✓
npm test: 404 pass / 16 skipped / 0 fail ✓
npm run validate: 3 product rows ✓
GitHub Actions CI: ubuntu-latest + windows-latest 全绿 ✓ (run 30708523937)
```

## 重要文档索引

| 文档 | 用途 |
|------|------|
| `docs/status/CURRENT.md` | 当前状态唯一事实来源（本文件） |
| `docs/status/sessions/` | 每轮重要会话执行记录 |
| `docs/ROADMAP.md` | 版本目标与 Issue 依赖 |
| `docs/decisions/` | 架构决策记录 (ADR) |
| `docs/experiments/` | 实验设计与结果 |
| `docs/PROJECT_HANDOFF.md` | 历史接力记录（不再作为唯一当前状态来源） |
| `AGENTS.md` | 协作规范入口 |
| `docs/SOP.md` | 批量生产标准操作流程 |
| `docs/ENVIRONMENT.md` | 运行环境与打包说明 |
| `docs/CALIBRATION.md` | 飞影页面校准清单 |
