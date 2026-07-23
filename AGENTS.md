# AGENTS.md

本文件是项目级协作规范。无论接手者是 Codex、Claude Code，还是其他代码代理，都必须先阅读并遵守本文件，再继续执行任务。

## 当前最高优先级

当前工作重心是先把本地 GUI 跑通。不要在 GUI 端到端可用前继续做大范围优化。

GUI 跑通的最低标准：

1. 用户能通过本地网页 GUI 上传商品图，单条录入或批量导入商品信息。
2. GUI 能按商品表数量执行，一个商品生成一条视频。
3. 飞影网页自动化能完成「上传人物+产品图」「弹窗立即生成」「生成完成确认」「外层立即生成视频」「下载作品」。
4. GUI 出错后能显示明确状态，并允许对失败或需人工核对的批次重新执行，不需要重新逐条录入。
5. 调试真实飞影链路前，必须确认用户允许消耗积分。

## 必读接力文档

继续任何开发、测试或排障前，先阅读：

```text
docs/PROJECT_HANDOFF.md
```

该文档记录当前项目状态、已知卡点、关键批次、验证命令和接力步骤。若上下文丢失、模型切换、账号切换或工具切换，应以该文档为恢复入口。

## 持久化记录规则

为了避免不同模型之间产生误解，每个接手代理都必须把重要工作进度写入持久文档。

必须记录的内容：

1. 已完成的实际改动。
2. 正在处理的任务和当前卡点。
3. 下一步计划。
4. 已执行的验证命令和结果。
5. 是否涉及飞影真实积分消耗。
6. 当前关键批次、状态、错误信息和下载产物路径。

记录位置：

- 长期接力状态写入 `docs/PROJECT_HANDOFF.md`。
- 若是架构或流程决策，新增或更新 `docs/` 下合适的说明文档。
- 不要只把关键状态留在聊天上下文里。
- 不要用某个模型私有的记忆空间（如 Claude 的 `~/.claude` memory）替代项目文档——本项目跨模型协作，知识必须落在随仓库的 `docs/` 里，其他模型才看得到。

`docs/` 文档职责划分（学到的经验、坑、决策按主题写进对应文档，不要全堆进 PROJECT_HANDOFF）：

| 文档 | 写什么 |
|------|--------|
| `docs/PROJECT_HANDOFF.md` | 接力状态：当前进度、卡点、下一步、关键批次状态、积分消耗记录。时间序列，最新章节放最上面。 |
| `docs/CALIBRATION.md` | 飞影页面校准：配置字段含义 + 页面已知行为/坑（如手持图账号级残留、删图关弹窗）+ 页面调试方法（如 `dumpModalDomSnapshot`）。 |
| `docs/ENVIRONMENT.md` | 运行环境：依赖、安装、GUI 启动、配置项、输出目录、打包 + 运行相关的坑（如改代码必须重启、沙箱/代理网络）。 |
| `docs/SOP.md` | 批量生产标准操作流程。 |
| `docs/飞影提示词模板.md` | 提示词与口播模板。 |
| `docs/飞影标准视频工作流.md` | 工作流定义。 |

判断原则：一次性的当前状态 → `PROJECT_HANDOFF`；长期有效的页面行为/调试经验 → `CALIBRATION`；长期有效的环境/运行经验 → `ENVIRONMENT`；生产流程 → `SOP`。

完成一轮重要修改后，至少更新一次 `docs/PROJECT_HANDOFF.md`。如果即将切换模型、账号、工具或长时间暂停，也必须先更新接力文档。

## 当前关键批次

Playwright 历史 GUI 排障批次：

```text
batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f
```

它目前是混合态（已有完成产物 + 失败/待执行条目），仅作为 GUI 重试行为的历史样本；不要为了验证一个按钮从头重跑并消耗积分。

当前 Capture HTTP 调试批次：

```text
batch-ec174f28-e9b8-4541-b2e7-c60b10e22474
```

最近状态：

```text
batch status: real_batch_completed (2026-07-23 恢复后)
MULTI-001: completed / remote_id 652265 / artifacts/未命名.mp4
MULTI-002: pending (未获新的积分授权，未执行)
```

原 manifest drift 已按正确流程恢复：重新录制当前响应 → 脱敏 → offline replay + real_dry_run → 用户授权下以 `resume: true`、`pointBudget: 1` 完成首条。详见 `docs/PROJECT_HANDOFF.md` 顶部。后续不得执行 `MULTI-002`，除非用户在新会话再次明确授权积分风险。

## 飞影积分和真实执行规则

飞影真实生成会消耗积分。默认只做本地无积分验证。

真实执行前必须：

1. 告知用户将消耗积分。
2. 获得用户明确允许。
3. 优先限制为 1 条商品。
4. 记录批次 ID、SKU、飞影作品时间、下载路径和失败阶段。

禁止为了调试确认按钮或下载按钮，反复从素材上传开始跑完整流程。

## Git 与文件安全

本项目可能存在用户或其他代理留下的未提交改动。

执行前必须查看：

```bash
git status --short --branch
```

规则：

- 不要回滚未理解的改动。
- 不要删除用户文件。
- 只提交与当前任务相关的文件。
- 不要提交 `config.local.json`、登录态、批次数据、下载视频、日志、截图、`outputs/` 或 `node_modules/`。

## 常用命令

启动 GUI：

```bash
npm run gui
```

登录飞影：

```bash
npm run login
```

本地测试：

```bash
npm test
npm run check
```

重点测试：

```bash
node --test test/state-machine.test.js test/server-api.test.js test/batch-runner.test.js
npm run check
```

检查当前关键批次：

```bash
node -e "const fs=require('fs');const p='batches/batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f/batch.json';const b=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({status:b.status,execution_error:b.execution_error,items:b.items.map(i=>({sku:i.sku,status:i.status,error_phase:i.error_phase,error_message:i.error_message,output_path:i.output_path,submit_checkpoint:i.submit_checkpoint&&{phase:i.submit_checkpoint.phase,observed_at:i.submit_checkpoint.observed_at}}))},null,2));"
```
