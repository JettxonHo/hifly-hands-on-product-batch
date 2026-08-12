# 当前 Goal：P0 Cloud Executor 纯云端生产闭环

> 状态：GOAL_APPROVED / ACTIVE
> Owner：JettxonHo
> 启动日期：2026-08-12
> 权威产品合同：`docs/product/CLOUD_EXECUTOR_P0.md`（D-034）
> 实施设计与计划：`docs/superpowers/specs/2026-08-12-cloud-executor-p0-design.md`、`docs/superpowers/plans/2026-08-12-cloud-executor-p0.md`

## 最终目标

把当前 Cloud Control Plane + Mac Local Agent 的已验证链路纠偏为不依赖个人电脑在线的纯云端 P0：

```text
Cloud GUI
→ Cloud Executor Worker（云端 Chrome / Playwright）
→ Hifly「手里有货」
→ 云端持久视频
→ A12
→ Work / Delivery
→ 浏览器鉴权预览与下载
```

Local Agent 保留但不再作为 P0 生产路径或验收依据。

## 当前基线

- VSA-A01～A14、P1 DeepSeek adapters、P2 人物目录/登记/推荐已进入 `main`。
- Cloud Control Plane → Mac Local Agent → Hifly → 回传 → A12 → Work 已有一条真实 Evidence。
- Cloud Executor Worker、云端持久目录、受控登录入口、Playwright adapter 与控制面均已实现；`main@1cfe0c9` 已部署到阿里云。
- CE-07 disabled/fail-closed standby 已实证：heartbeat online、重启恢复、Profile marker 持久、无 claim、无新增 attempt。该证据不等同于真实出片。
- 当前只缺 CE-08 运行证明：云端飞影登录与 Profile 重启保留、`playwright` 激活、唯一新零-attempt 工单，以及 Hifly → 云端 artifact → A12 → Work → 鉴权下载。
- Local Agent 默认关闭，仅保留为 legacy fallback，不作为生产路径或验收依据。

## 里程碑

| 阶段 | 结果 | 状态 |
|---|---|---|
| CE-01 / #136 | 产品合同、Goal、设计、计划、决策与 Issues | 已完成 |
| CE-02 / #137 | `cloud_executor` 身份与 fail-closed 串行 Worker | 已完成 |
| CE-03 / #138 | 复用现有 Hifly Playwright 核心 | 已完成 |
| CE-04 / #139 | 持久 Profile、可视登录、readiness | 已实现，待云端登录实证 |
| CE-05 / #140 | 持久素材/视频、鉴权下载、磁盘门限 | 已完成 |
| CE-06 / #141 | 控制台 Cloud Executor 状态与作品体验 | 已完成 |
| CE-07 / #142 | 阿里云无副作用部署、standby 与重启恢复 | 运行实证通过，待关闭 Issue |
| CE-08 / #143 | 一条纯云端真实出片验收 | 已获单条积分授权，执行中 |

## 执行规则

1. CE-01→CE-08 严格串行，一个 Issue/分支/PR。
2. 实现 Agent 只使用准确自定义 Agent `luna-worker`；Sol 独立 Review；实现者不得批准或合并自己的 PR。
3. 每项 TDD、focused tests、`npm run check`、`npm test`、`git diff --check`、CI。
4. CE-08 已获一次单条真实生成授权；执行前仍必须复核唯一新工单、零 attempt、审批链、交接包和云端登录态。首失败即停，禁止自动重试和第二条。
5. Cloud Executor 默认 disabled/fail_closed；并发固定为 1；登录/存储未就绪时 claim 前失败关闭。
6. 不删除 Local Agent，不复制 Hifly DOM 自动化，不把 Cloud Executor 伪装成 Local Agent。
7. Profile、Cookie、素材、视频、Evidence、Token 和服务器绝对路径不得进入 Git或公共 API。
8. 完成 Agent 任务后立即关闭对应子智能体。
9. 验收期间 `LOCAL_AGENT_ENABLED=false`，不得启动 Mac Local Agent；纯云端闭环完成前不扩展文案、人物、背景/姿势、动效、Capture HTTP、并行或高可用。

## Goal 完成标准

`docs/product/CLOUD_EXECUTOR_P0.md` 第 9 节 11 项全部满足。尤其必须完成一个新的零 attempt 工单的纯云端真实链路，且验收时不启动任何 Local Agent。未完成前不得宣称 P0 可投入内部试运行。
