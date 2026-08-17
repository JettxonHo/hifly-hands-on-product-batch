# Issue #186 · Operator Workbench V2-E1

## 接管信息

- 日期：2026-08-18
- Issue：#186
- 分支：`codex/operator-workbench-v2-e1`
- 精确基线：`929a786c60eb1a5afb1c50b47a4b46bcd249b0fb`
- 逻辑角色：`IMPLEMENTER`
- 请求 custom agent：`luna-worker`
- 配置模型：`gpt-5.6-luna`
- reasoning：`max`
- 实际运行时模型：`UNVERIFIED_RUNTIME_MODEL`
- `luna-worker` 完成边界内实现与初步 RED/GREEN 后已关闭；Sol 复核并修正了新增保存测试的网络响应收口，未扩大产品范围。

## 范围与边界

只实现 V2-E1：Projects 项目列表刷新作用域、Project/Copy 业务中文与品类展示映射、Copy 质检/审核 Tab 的公开键盘与鼠标语义。未修改后端、API、DB、认证、依赖、Avatar、Plan、Production、Provider、Worker 或生产数据。

未访问 Hifly，未启动 Worker，未生成视频，未消耗飞影积分；本轮没有新的批次、错误批次或下载产物。

## 实际改动

- Projects 刷新按钮标记 `data-refresh-scope="project-list"`，文案、任务推荐动作与错误恢复统一为“刷新项目列表”；初始 runtime 失败仍保留完整 bootstrap reload 恢复。
- Project 将服务端 `general` 展示为“未细分品类”，保存该展示值时仍提交 `general`；自定义品类原样提交。默认静态输入也使用业务展示值。
- Copy 商品上下文将 `general` 展示为“未细分品类”。Copy 任务、质检门禁、指导语、Dialog 与错误动作使用“质检问题/质检结果/质检配置”等业务中文；技术变量、DOM/API 字段与审计元数据保留。
- Copy Tab 保留既有 `tablist`、`tab`、`tabpanel`、`aria-selected`、`aria-controls` 与 QC/HumanReview 分离；补充唯一 `tabindex=0`、非活动 `-1`，并支持鼠标与 ArrowLeft/ArrowRight/Home/End 的焦点/选中/面板同步。
- 公开 browser tests 补充刷新、品类映射、业务中文与 Tab seam。

## TDD 证据（精确命令与结果）

### 基线与测试可靠性

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/operator-task-flow-slice-a-browser.test.js test/copy-generation-browser.test.js test/copy-quality-browser.test.js
```

初次结果：Copy generation 与 Copy quality 子测试通过；Slice A 在组合进程无进一步输出，人工中止，不能视为组合全绿。
复核定位到新增品类测试在第二次保存后未等待对应 PATCH 响应便移除 route，导致组合 teardown 等待。测试改为逐次等待
对应 PATCH 的成功响应后，同一三文件公开矩阵稳定为 `8/8 pass, 0 fail, 0 skipped`，约 10.9 秒。

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/operator-task-flow-slice-a-browser.test.js
```

修正后的 Slice A 单文件结果：`6/6 pass, 0 fail, 0 skipped`，约 10.3 秒。

### Slice 1：Projects 刷新作用域

RED：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test --test-name-pattern='Projects names project-list refresh' test/operator-task-flow-slice-a-browser.test.js
```

结果：失败；`locator.getAttribute: Timeout 30000ms exceeded`，找不到名称为“刷新项目列表”的按钮。

GREEN：同一命令。

结果：`1/1 pass, 0 fail`，约 1.5 秒；覆盖按钮文案/scope、runtime 初始失败完整恢复、项目列表失败错误与推荐动作。

### Slice 2：Project 品类展示与保存 payload

RED：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test --test-name-pattern='general category' test/operator-task-flow-slice-a-browser.test.js
```

结果：失败；实际输入值 `general`，期望 `未细分品类`。

GREEN：同一命令。

结果：`1/1 pass, 0 fail`，约 2.3 秒；公开断言保存“未细分品类”提交 `general`，自定义“家居”保持不变。

### Slice 3：Copy 品类展示

RED：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/copy-generation-browser.test.js
```

结果：失败；`#revisionMeta` 实际为 `商品快照 v6 · general`，不匹配 `/未细分品类$/`。

GREEN：同一命令。

结果：`1/1 pass, 0 fail`，约 6.8 秒。

### Slice 4：Copy 业务中文

RED：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/copy-quality-browser.test.js
```

结果：失败；公开 `main` 文本含 `处理待判断 Finding`、`QualityResult`/`Profile` 等原始标识。

GREEN：同一命令。

结果：`1/1 pass, 0 fail`，约 7.0 秒；Dialog 公开名称改为“接受质检问题”，历史 fixture 标题改为中文业务表达。

### Slice 5：Copy Tab 键盘/鼠标语义

RED：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/copy-quality-browser.test.js
```

结果：失败；Tab 公开 seam 断言唯一 `tabindex="0"` 时得到 `0 !== 1`。

GREEN：同一命令。

结果：`1/1 pass, 0 fail`，约 6.9 秒；覆盖初始/切换后的 tabindex、aria-selected、aria-controls、tabpanel 可见性、焦点、ArrowLeft/ArrowRight/Home/End 与鼠标选择。

## 浏览器与视觉证据

真实宿主 Chrome 运行以下受影响公开矩阵：

```text
IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test \
  test/operator-task-flow-slice-a-browser.test.js \
  test/copy-generation-browser.test.js \
  test/copy-quality-browser.test.js \
  test/operator-workbench-v2-foundation-browser.test.js \
  test/project-content-browser.test.js
```

结果：`10/10 pass, 0 fail, 0 skipped`。截图位于仓库外
`/private/tmp/hifly-v2-e1-screenshots-20260818c/`，未提交。PNG 像素头核验包括：

- Login、Projects、Project：1440 / 768 / 390；
- Copy 任务与阶段：1440x900 / 768x900 / 390x844；
- Copy 质检终态：1440 与 390。

公开 seam 同时断言 Project/Copy 1440、768、390 无页面级横向滚动，以及 reduced-motion；人工看图未发现文字或控件溢出。
这些是假数据本地浏览器证据，不是部署、Provider 或真实生产证据。

## 仓库验证

- `npm run check`：229 个 JavaScript 文件通过。
- 完整 `npm test` 首次为 `1023 pass / 14 skip / 1 fail`；唯一失败是未改动的
  `yingdao-rpa-executor.test.js` 在全量并发负载下产生一次 unhandled-rejection 时序告警。该用例立即单独复跑 `1/1 pass`。
  第二次默认并行运行已完成本次新增 Slice A 的 `6/6`，随后在未改动的 Assets 浏览器文件等待 Chrome teardown 超过
  三分钟，人工停止，不能算完整通过。单并发全量同样在长期浏览器进程中等待，未用它冒充绿色证据。
- 为分离本机多 Chrome 资源争抢，全部非浏览器测试使用同一工作树运行：`991 pass / 13 skip / 0 fail`；13 个 skip
  均为需要可选 PostgreSQL 的既有 integration tests。受影响真实 Chrome 公开矩阵另为 `10/10 pass`，无 skip。
  默认完整并行矩阵仍以 fixed-head 三组 CI 为最终门禁。
- `git diff --check` 与 12 文件 strict allowlist 在提交前复核。

## 当前边界

V2-E1 仅为仓库页面实现与本地浏览器证据，尚未部署或经过客户/真实 Provider 验收。V2-E2 未开始；没有部署、SSH、
Hifly、Worker、生产数据、视频生成或积分动作。
