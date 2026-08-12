# P2-03 / Issue #130 人物品类推荐

## 当前状态

- 分支：`codex/p2-03-avatar-category-recommendations`
- 基准：`main@4776189abc9412307a9d6bbb43735b0afdf01c15`
- 角色：`IMPLEMENTER`
- 运行时模型：`UNVERIFIED_RUNTIME_MODEL`
- 状态：实现、Sol 独立审查与本地门禁完成；未提交。

## 已完成改动

- `src/avatar-selection/avatar-selection-service.js` 注入 ProductRevision port，从 approved CopyVersion 绑定的 revision 读取 authoritative `primary_category`；新增 provider-neutral workspace/catalog recommendation projection。
- 推荐仅使用 `can_confirm=true` 候选：trim/lowercase 精确匹配优先；无精确匹配时使用空 `category_tags` 通用池；其他人物可浏览但不推荐；不可确认人物永不推荐；排序按推荐层级、名称、版本 ID 稳定排序。
- projection 返回 `recommended`、稳定 `reason_code`、中文 `reason`、`matched_tags`，无匹配/无通用池返回无推荐说明；未新增 schema/列。
- `src/server/app.js` 仅增加 `app.projectContent.productRevisionPort` 的依赖注入。
- `web/avatar.html`、`web/avatar.js`、`web/avatar.css` 在目录、详情和移动抽屉显示推荐 badge/理由，保留原有筛选、确认/更换 Dialog 和只读浏览行为。
- service/API/browser 测试覆盖 exact、fallback、无推荐、不可确认排除、authoritative revision/组织上下文、只读刷新、390px 无横向滚动。

## 验证

- `node --test test/avatar-selection-service.test.js test/avatar-selection-api.test.js test/avatar-selection-browser.test.js`：27/27 通过；两条 browser 用例均通过，包含管理员登记回归与 390px 无横向滚动断言。
- `npm run check`：检查 213 个 JavaScript 文件通过。
- `git diff --check`：通过。
- `node --test --test-concurrency=4 test/*.test.js`：954 total / 940 pass / 14 既有 environment skip / 0 fail。
- Sol 独立审查发现管理员 browser fixture 的模拟 approved CopyVersion 引用了未提供的 ProductRevision；已仅在测试中注入一致的 authoritative revision port，并单独复跑 browser 2/2 通过。生产推荐逻辑无需修改。

## 外部调用与边界

- 未访问 Hifly、DeepSeek、Playwright、Capture、Local Agent production module 或任何外部服务。
- 未运行真实飞影链路，积分消耗 0。
- 未修改数据库 schema/migration、执行路径或其他领域状态机。
- 未部署到生产环境，也未做真实人物/商品生产验证。

## 下一步边界

- 进入 commit、PR、CI 与合并流程；P3 的小批量真实验收仍是独立阶段。
