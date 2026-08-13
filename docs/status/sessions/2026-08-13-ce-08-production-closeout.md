# Session: CE-08 production closeout

## 基本信息

- 日期：2026-08-13
- 范围：CE-08 纯云端闭环的部署后鉴权下载复验与文档收口
- 代码基线：`main@f519d42db26ef5f59cb8a6a6fb80bf8b68fb7eb3`（PR #155 squash merged）
- CI：Ubuntu、Windows、identity-postgres 全部 green
- 本文由 docs-only 实现 Agent 记录；部署、GitHub、SSH 与生产复验由主控在授权边界内执行并独立核对。文档 Agent 本身未执行这些外部操作，也未访问飞影

## 云端部署证据

- 云端仓库工作树已快进至基线提交。
- 部署前数据库备份已写入受保护的备份卷，471289 bytes。
- 回滚镜像：`hifly-pilot-app:rollback-dc4ca9f-ce08-download`。
- 只重建/重启 App；App healthy；App 对 Cloud Executor 输出卷使用只读挂载。
- Cloud Executor 在本轮保持 exited/未启动，未领取工单；Local Agent 未参与。

## 既有 CE-08 产物链

本次复验复用了已成功的唯一订单和产物，不重新生成：

| 对象 | ID | 结果 |
|---|---|---|
| ProductionOrder | `ff5285cd-d2b7-4552-a276-cff18015fc67` | succeeded |
| ExecutionAttempt | `46d1f209-caf8-4998-8d5d-5e435b0b0f11` | succeeded |
| Candidate | `09891151-59e6-4c87-849e-c6f0defc1be4` | pending_verification / passed |
| A12 verification | `2e8adabc-c570-4ef6-b5bb-26733c4ad262` | succeeded / passed |
| Work | `80958749-9f92-40e6-a30e-7c886b555ef6` | available |

- App 部署后及随后再次重启 App 后，下载授权创建 POST 均为 201，鉴权 GET 均为 200。
- 重启后的完整响应发送 `43,425,097` bytes。
- 下载文件、数据库 candidate/AssetVersion 与输出卷 SHA-256 均为
  `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`。

## 计费与执行边界

- Closeout 本轮未访问飞影、未启动 Worker、未新增 attempt、未上传素材、未点击生成。
- `target_attempts=1`、`active=0`、`total=10`；积分记录仍只有原 CE-08 真实生成的 650。
- 成功产物的下载/A12/Work 复验不构成新生成授权，也不改变失败即停与并发 1 护栏。

## 结论与后续

- Cloud Executor P0 合同的单条纯云端闭环已满足，可进入 3 条严格串行、受控内部试运行。
- 该结论不表示公网生产就绪；现有公网证书为自签名，严格 CA 校验失败。
- `npm audit --omit=dev` 为 `0 critical / 5 high / 2 moderate`，为既存依赖风险，未由 PR #155 引入。
- 已确认非阻塞 UX follow-up #156：`works.html?work=<id>` 首次加载忽略 query、默认选择第一条；人工重新选择目标后下载正常。
- 下一阶段由 #132 跟踪；CE-08 授权不延续，每条须重新取得明确的单条积分授权，并复核唯一工单、零 attempt、审批链、handoff ready、Profile/login readiness 和磁盘门限；每次只执行一条，首失败即停，不自动重试。
- 可信证书与依赖治理由 #157 跟踪。

## 文档动作

- 旧 `docs/status/CURRENT.md` 原样归档至
  `docs/status/archive/CURRENT-through-2026-08-13-pre-closeout.md`，新 CURRENT 只保留收尾事实和下一步。
- GOAL 标记 `GOAL_COMPLETE`；CE-04/CE-08 和 Roadmap 状态同步为已完成。
- `docs/product/CLOUD_EXECUTOR_P0.md` 仅更新实现状态与当前 Evidence，不改产品合同边界。
- 2026-07 的两个旧 ADR 保留 ADR-001/002；2026-08-01 的 local-first/cloud-control 决策改编号为 ADR-004/005，并标记由 D-034 supersede。
