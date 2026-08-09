# Local Agent 最小真实生产执行器设计

> 状态：APPROVED_FOR_IMPLEMENTATION
> 日期：2026-08-10
> 范围：生产能力补齐 P0，不代表云端端到端已验收

## 1. 目标

让新云端系统的一条 `waiting_for_executor` ProductionOrder 能被一台预配置的 macOS Local Agent 领取，使用现有 Playwright 飞影执行内核串行生成一条视频，把候选 MP4 回传云端，并进入现有 A12 核验与 Work 创建链路。

本阶段只证明最小真实执行器闭环具备可实现、可测试、可审计的代码合同。实现和自动测试不得访问飞影、不得消耗积分；真实验收必须另行获得一次性授权。

## 2. 明确不做

- 不补满文案生成、文案质检、人物推荐、人物池、方案推荐等产品能力。
- 不在云服务器内运行长期 Playwright 浏览器，不上传浏览器 Profile、Cookie 或飞影登录态。
- 不把自动 Agent 的执行记录伪装为 `manual` 或归因给某个运营成员。
- 不做多 Agent 调度、并发批量、自动重试、Agent 配对 UI、自动升级和远程桌面。
- 不声明云端端到端可用，不执行真实飞影任务。

## 3. 选定架构

```text
Cloud control plane                         macOS Local Agent
-------------------                         -----------------
ProductionOrder(waiting_for_executor)
  -> Agent claim (lease)  ----------------> poll / claim one task
  -> immutable handoff package ------------> download package
                                             resolve local avatar image
                                             existing Playwright executor
  <- heartbeat / progress ----------------- state only
  <- candidate MP4 upload ----------------- bounded artifact
  <- completion report -------------------- success/failure/requires_action
  -> existing artifact verification
  -> Work only after verification passes
```

云端是权威状态源；Local Agent 只持有执行凭据和飞影浏览器登录态。Agent 成功不等于 ProductionOrder 成功，只有 A12 验证通过并创建 Work 后工单才进入 `succeeded`。

## 4. P0 合同

### 4.1 配置与鉴权

生产端新增显式、默认关闭的 Local Agent 配置：

- `LOCAL_AGENT_ENABLED=false`
- `LOCAL_AGENT_ID`
- `LOCAL_AGENT_ORGANIZATION_ID`
- `LOCAL_AGENT_TOKEN`
- `LOCAL_AGENT_LEASE_MS`

P0 只支持单组织、单 Agent。Bearer token 只存在于云端和 Agent 环境变量，不入库、不进 Git、不写日志。身份会话 guard 对 `/api/agent/v1/*` 让路，由独立 Agent guard 认证；其他 API 行为不变。

### 4.2 执行身份

执行记录必须使用 `executor_type=local_agent` 并保存 `executor_agent_id`。运营成员仍是 ProductionOrder 的业务发起人，但不是自动执行者。审计事件允许 `actor_member_id=null`，并在受控 metadata 中记录 `agent_id`。

现有 manual execution 表可在 P0 通过向后兼容 migration 扩展为双执行者来源；人工路径仍保持原字段、状态和 API 合同。公共输出不得把 local agent 表述为人工。

### 4.3 任务领取与租约

- 只领取本组织 `waiting_for_executor`、有 `ready` handoff package、且没有活跃 attempt 的订单。
- 一次最多领取 1 条；P0 Agent 串行执行。
- claim 创建 `local_agent` attempt 并把工单转为 `claimed`。
- start 把 attempt/order 转为 `running`。
- heartbeat 只延长当前 attempt 的租约并更新受控进度阶段。
- 租约失效不自动重新提交飞影；任务进入 `requires_action`，等待运营确认。

### 4.4 包与素材

Agent 下载现有 handoff ZIP，并使用其中冻结的商品图、批准文案和 VideoPlan 配置。P0 不新增人物生成能力；通过 Agent 本地配置把 `avatar_asset_version_id` 映射到一张本地人物图。缺失映射时在调用飞影前返回 `requires_action`。

### 4.5 结果回传

Agent 上传一个 `primary_video` 候选 MP4，使用现有大小、媒体类型和 checksum 完整性校验。云端记录上传者为 `executor_agent_id`，提交不可变执行报告；completed 报告随后排入现有 A12 artifact verification。失败与需人工处理不自动重试。

### 4.6 Local Agent CLI

新增独立 CLI 进程，职责仅为：

1. heartbeat；
2. claim 一条任务；
3. 下载并解包；
4. 组装现有 batch task；
5. 调用现有 Playwright executor / batch runner；
6. 上传候选并报告结果。

CLI 默认 dry/fake，只有显式配置真实 backend 才可能访问飞影。真实模式仍受单条、失败即停和人工授权约束。

## 5. 最小 API

- `POST /api/agent/v1/heartbeat`
- `POST /api/agent/v1/tasks/claim`
- `POST /api/agent/v1/tasks/:attemptId/start`
- `POST /api/agent/v1/tasks/:attemptId/heartbeat`
- `GET /api/agent/v1/tasks/:attemptId/package`
- `POST /api/agent/v1/tasks/:attemptId/candidate-authorizations`
- `PUT /api/agent/v1/candidate-uploads/:candidateId`
- `POST /api/agent/v1/tasks/:attemptId/candidates/:candidateId/complete`
- `POST /api/agent/v1/tasks/:attemptId/reports`

所有 mutation 使用 `Idempotency-Key`。P0 不提供任意 task id 查询或跨组织枚举。

## 6. 状态与错误

- Agent 不在线：ProductionOrder 保持 `waiting_for_executor`。
- 本地人物映射缺失、登录态失效、页面漂移：`requires_action`，保留失败阶段和受控错误码。
- 飞影生成失败：`failed`，不自动重试。
- Agent 失联/租约过期：`requires_action`，禁止自动重复提交。
- 候选上传成功但 A12 未通过：工单不得显示成功。

错误信息必须是受控 code/message，不持久化 URL、Cookie、Token、页面正文或原始 HTTP 响应。

## 7. 验收边界

代码层 P0 完成需满足：

1. 默认关闭时生产行为与 `fail_closed` 基线一致。
2. fake Agent 能在测试中完成 claim -> start -> upload -> report -> verification -> Work。
3. execution attempt 明确为 `local_agent`，无人工归因。
4. 重复 claim/start/upload/report 幂等，不重复创建 Work。
5. 失联和执行失败不自动重试、不触发第二次提交。
6. Playwright 旧路径及 A01-A14 全量测试无回归。

真实云端验收属于后续独立步骤：部署 Agent、配置一张人物图、明确授权 1 条积分风险、失败即停，并记录工单/attempt/飞影作品/Work/下载产物。未完成该步骤前不得称为云端端到端可用。
