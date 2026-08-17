# 2026-08-17 运营工作台定向外部研究

## 任务合同

- Issue：#172 `UX Targeted Research: enterprise operator workbench patterns`
- 精确 base：`origin/main@62df1d5ebe4a8f073139454a92a1591d0e411099`
- 分支：`codex/operator-ux-targeted-research`
- 工作树：`/private/tmp/hifly-operator-ux-targeted-research`
- 性质：research/doc-only；不是设计、实现、部署或客户验收

## 已完成

1. 以 `docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md` 的 P1/P2 为问题清单，而非先选竞品。
2. 定向研究 Shopify Admin、Jira/Atlassian、Adobe Workfront/Frame.io、飞书项目四组案例。
3. 只采用官方产品文档、官方帮助中心和官方设计系统，记录 2026-08-17 访问日期及直接链接。
4. 对导航、任务聚合、终态、筛选/批量、素材、中文状态和 390px 层级分别给出 adopt/adapt/reject；
   其中移动端任务排序和错误恢复下一步明确标为外部模式与内部审计结合所得的 `Inference / Adapt`。
5. 映射回现有 API、领域状态、组织授权和 Production 严格串行门禁，并列出后续设计合同 acceptance gates。
6. 明确原 Slice C 不照旧直接开始或实施；设计合同通过后只决定 rebase 或吸收，优先作为 Taste 严格串行实施候选。

## 来源核验方法

- 通过官方域名检索并打开直接文档；未使用社区帖子、营销截图集或二手趋势报告作为结论依据。
- 案例按问题匹配选择：Shopify 回答资源集合和响应式；Jira 回答导航职责及有条件批量；Workfront/Frame.io
  回答任务聚合、媒体版本和审核终态；飞书回答中文待办、筛选和权限语义。
- 外部产品具备的字段、搜索或批量接口不被当成本仓库现有能力。

## 主控复审修正

- CURRENT 与 ROADMAP 的 active 真值已统一：原 Slice C 不再照旧直接实施，设计合同通过后只决定
  Production/Works/Assets rebase 或被新的 Taste 串行切片吸收。
- 390px 的任务优先重排、列表/详情切换和渐进披露，明确标为 Shopify 响应式模式与本项目内部审计结合所得的
  `Inference / Adapt`，不是外部来源原话。
- 错误态替代陈旧内容并提供恢复下一步，明确标为权限模式与本项目 loading/error 证据结合所得的
  `Inference / Adapt`；没有为该推断伪造一手来源。

## 允许文件

1. `docs/frontend/OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md`
2. `docs/status/CURRENT.md`
3. `docs/ROADMAP.md`
4. `docs/status/sessions/2026-08-17-operator-ux-targeted-external-research.md`

## 验证

- 16 个官方直接来源经 `curl -L` 可访问性检查均返回 HTTP 200。
- `npm run check`：229 个 JavaScript 文件通过。
- `git diff --check`：通过。
- 文档相对链接检查：4 个 allowlist 文件通过。
- Git 文件边界：严格为本 session 列出的 4 个文档。
- 阶段措辞检查：研究只作为设计合同输入，未表述为最终设计、实现、部署或采用。
- stale wording 检查：active CURRENT/ROADMAP 中不再存在“照旧实施、rebase 或吸收”的旧三选一。
- Draft PR fixed-head Ubuntu、Windows、identity-postgres CI 由 PR checks 记录并在最终结果包报告。

## 未执行边界

- 没有修改 HTML、CSS、JavaScript、API、数据库、测试、依赖或部署文件。
- 没有输出最终 IA、完整页面设计或代码任务，没有开始 Taste、Slice C 或全局重构。
- 没有部署、SSH、访问 Hifly、启动 Worker、修改生产数据、生成视频或消耗积分。
- 本研究合并后只成为独立设计合同的输入；不表示设计、实现、部署或客户采用已经完成。
