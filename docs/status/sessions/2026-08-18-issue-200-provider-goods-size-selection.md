# Issue #200 Provider 商品大小选中态修复

> 日期：2026-08-18
> 基线：`origin/main@dc47cf0ceeffe09b91b886c96cf3d4e15250ab7f`
> 分支：`codex/issue200-provider-goods-size`
> 状态：仓库实现候选；独立 Review、合并、部署与真实 Provider 复验分别待后续 gate

## 范围与边界

本轮只修复 Issue #200：飞影“手持商品图”弹窗在付费生成前必须可靠证明期望的原生商品大小已被选中。
六个 canonical code/value、VideoPlan、Production snapshot、handoff 和执行器调用顺序保持不变。

本轮没有 SSH、部署、启动 Cloud Executor/Local Agent、创建或重试生产工单、修改生产数据、点击付费生成、生成视频或
消耗积分；没有开始 Issue #201 或 #202。真实 Provider 复验仍须新的唯一零-attempt 工单和单条积分授权。

## Provider 真值与最小设计

既有脱敏静态资源显示，Provider 用同一状态同时驱动：

- 提交请求的 `goods_size`；
- 当前选项图片框的 `actived`；
- 当前选项文字的 `gradient`。

六档仍为智能适配 `0`、超大 `50`、大 `40`、中 `30`、小 `20`、超小 `10`。本轮不按 DOM 顺序或仅凭本地化
文案推断选中值：文案只定位 canonical 选项，Provider 自有的两类选中标记共同证明状态。

最小修复在当前可见“手持商品图”弹窗内读取完整六档组，并要求：

1. 六个 canonical 标签完整且无重复；
2. 每项图片框和文字选中标记一致；
3. 只有期望档位被选中；
4. 上述状态连续两次成立。

默认“智能适配”仍高亮、多个选项同时选中、标记不一致、档位缺失或结构漂移时，执行器抛出
`HIFLY_GOODS_SIZE_SELECTION_UNVERIFIED`。`createHandsOnImage()` 的既有顺序保证异常发生在付费
`立即生成` 之前。

## TDD 证据

### RED

公开 adapter seam 构造了真实缺陷形状：目标“小”的父节点返回 `actived`，但完整六档仍由“智能适配”的图片框与
文字共同标记为选中。旧实现只看目标父节点，测试得到 `Missing expected rejection`，证明假阳性可确定复现。

命令：

```text
node --test --test-name-pattern="target-only active false positive" test/batch-runner.test.js
```

结果：1 fail，失败原因是旧实现错误成功返回。

### GREEN

改为完整六档唯一一致状态验证后，目标假阳性被拒绝；正常由智能适配切换到小档的路径通过，控件缺失、状态不可验证
与付费按钮前停止的既有合同继续通过。

本地结果：

- 选档与付费前停止聚焦组：5/5；
- `test/batch-runner.test.js`：88/88；
- batch runner + Cloud Playwright adapter + local package compiler：100/100；
- `npm run check`：230 个 JavaScript 文件；
- 默认 `npm test`：1051 total / 1037 pass / 14 skip / 0 fail。14 个 skip 为未提供数据库连接的 13 个
  PostgreSQL 集成测试和未开启 `IDENTITY_BROWSER_SMOKE` 的 1 个真实浏览器测试；本轮改动不涉及这些 seam；
- `git diff --check` 与五文件 allowlist：通过。

本地或 CI 绿色均不替代部署和真实 Provider 付费复验。

## 文件边界

- `src/hifly-page.js`
- `test/batch-runner.test.js`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-18-issue-200-provider-goods-size-selection.md`

不修改 API、数据库、领域状态、依赖、部署文件、Provider 映射或生产控制面。
