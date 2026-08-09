# 仓库清理审计

> 状态：仅盘点，未删除任何文件
> 原则：当前说明保持简洁，历史决策保留可追溯；用户私有文件不擅自处理。

## 立即更新，不删除

- `docs/status/CURRENT.md`：应成为唯一精简当前快照，移除已合并 PR 的等待态。
- `docs/ROADMAP.md`：仍写 A01 正在开发，需更新为 A01-A14 已完成并进入云端试运行阶段。
- `README.md`、`docs/ENVIRONMENT.md`：继续保留本地演示与旧 GUI 两种入口，但应新增生产部署入口后再改。

## 必须保留

- `AGENTS.md`、`GOAL.md`、`docs/product/`、`docs/decisions/`；
- `docs/SOP.md`、`docs/CALIBRATION.md`、`docs/rpa/`；
- `docs/frontend/`：是已实施页面的设计依据和 A14 审计证据；
- `docs/status/sessions/`：是跨 Agent 的验收与交接历史；
- `docs/PROJECT_HANDOFF.md`：虽很长，但含真实飞影积分、事故和恢复记录，当前只适合归档化，不适合直接删除。

## 归档候选

- `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 中已经完成、且不再作为当前实施入口的旧计划；
- 已完成阶段的长篇 `docs/status/sessions/`；
- `docs/prompts/CLAUDE_KIMI_K3_FRONTEND_HANDOFF.md` 等一次性交接提示词。

推荐后续统一移动到 `docs/archive/`，保留 Git 历史与相对链接；移动前先跑引用检查和文档链接检查，
不在部署 PR 中混入大规模文件搬迁。

## 根工作区脏文件分类

以下改动在本轮开始前已经存在，本轮未触碰：

- `.gitignore`、`package.json`、`package-lock.json`、`wrangler.jsonc`：Cloudflare/Wrangler 静态部署实验。
  当前 `wrangler.jsonc` 只发布 `web/`，不能运行 Fastify、PostgreSQL 或 A01-A14 后端，不应合入腾讯云
  生产路线。建议在用户确认后从根工作区撤销这些实验改动，而不是移植到新分支。
- `.claude/`：约 97 MB 的本地工具设置、预览脚本和 worktree，不进入仓库；先保留，待确认相关
  worktree 不再使用后再单独清理。
- `docs/resume/`：约 7.4 MB 的用户简历资料，与项目无关；不得删除。建议由用户移出仓库目录，或仅在
  `.git/info/exclude` 本机忽略，避免把个人资料写入项目 `.gitignore` 形成公开目录约定。

## 暂不执行的动作

- 不删除历史文档；
- 不清理 `.claude/worktrees`；
- 不回滚根工作区的 package 或 Wrangler 改动；
- 不移动 `docs/resume/`；
- 不把清理与腾讯云部署代码放进同一个 PR。

## 后续清理 PR 验收

1. 先合并部署基线，确保当前入口稳定。
2. 对候选文件执行仓库引用扫描。
3. 只移动确认完成且无运行时依赖的文档。
4. 修复所有相对链接并运行完整测试与 `git diff --check`。
5. PR 只包含文档归档和状态说明，不混入依赖或生产代码。

