# Session: Cloud Executor three-product internal trial

## 基本信息

- 日期：2026-08-13
- Issue：#132
- 范围：三个不同商品的 Cloud Executor 严格串行真实内部试运行与验收收口
- 生产代码与部署基线：`main@40e92414d4ef4a4015da9bb3f709f775c67843b6`
- 本文由 docs-only 实现 Agent 根据主控已核验的生产证据记录；该 Agent 未执行 SSH、飞影操作、Worker 启停、生产数据变更或积分动作

## 严格串行合同与执行事实

1. SKU001、SKU002、SKU003 先全部完成到 approved VideoPlan，不提前创建后续 ProductionOrder。
2. 每轮在 Worker 关闭时，仅为当前 SKU 创建唯一 ProductionOrder 与 `ready` handoff package。
3. 激活前全组织 eligible 恰好为 1，当前 order 的 attempts 严格为空；Mac Local Agent 进程为空。
4. 当前轮 succeeded 后先停止 Worker、恢复 fail-closed，再完成 A12、Work 和鉴权字节下载验收。
5. 只有上一轮全部验收通过后才创建下一轮 order。三轮均无 failed、`requires_action`、重试或重复提交。

这证明的是人工门禁控制下的三条严格串行路径，不是自动队列批量运行、并行生产、更大规模或长期稳定性证明。

## SKU001

| 对象 | 证据 |
|---|---|
| ProductionOrder | `f2058403-f3f5-44a5-982a-d699a5479aaa` |
| handoff package | `636bbd73-23e6-483d-a623-f20a91384dbd` / v1 |
| manifest SHA-256 | `4085df9b73d5048a6150bd5b8b417e8336c3aa73f2c9bbc6bb3a5b332ea1de1c` |
| package SHA-256 | `187bd7f4470f42cfdae6df13cc2cbe60e1689be91b5285c442dbce999ead407e` |
| ExecutionAttempt | `a1af23ec-8d4f-470c-972c-d20555117f57` / succeeded / 恰好 1 次 |
| Candidate | `3973558d-5a49-49f7-a182-f5a00b96aeb4` |
| A12 | `f00c9484-07e6-4d14-9d85-49d2b2afcaf7` / succeeded / passed / attempts=1 |
| Work | `624632bd-6361-4cf3-9c2c-e82f729bd517` / available |
| 视频 | `29,266,534` bytes / `video/mp4` |
| 视频 SHA-256 | `4b05d992134136c50efa890467084c3d7e6d3a68bdee065d24fe1a7fdc1cdc04` |

- 鉴权下载返回真实字节，本地文件类型、大小和 SHA-256 与登记值一致；验收副本已可恢复地移入废纸篓。
- 飞影页面在 `06:36:12` 观察到生成中，余额 `51,464`。该观察值不是最终扣分结论。

## SKU002

| 对象 | 证据 |
|---|---|
| ProductionOrder | `78762f75-e500-4805-b010-c039d9c97b9c` |
| handoff package | `95cd4ef0-cdae-43ef-ab0a-e57ecaecea38` / v1 |
| manifest SHA-256 | `0723312071dd77b13b8fbf578e66e4f57b16f0388062b92d2bd0ff55ac91f449` |
| package SHA-256 | `a872701dcb364e04ee6287a2daeb7b84c42d9b1757a2da8074d887e41e0890d6` |
| ExecutionAttempt | `78c9aede-1217-479f-a9ff-1cc42e1fd7eb` / succeeded / 恰好 1 次 |
| Candidate | `280c5e62-d616-4c9b-99f7-6438f6aca5f6` |
| A12 | `1eb4dac1-68b2-4aef-bfbd-c08a6be6c722` / succeeded / passed / attempts=1 |
| Work | `1a1fa1e5-6206-408c-b080-35bd5cca8a7f` / available |
| 视频 | `30,833,948` bytes / `video/mp4` |
| 视频 SHA-256 | `338d74ae2536e3e0000bafbd2d56c181097bef513460529504dc6de10d4c0f77` |

- 鉴权下载返回真实字节，本地大小和 SHA-256 与登记值一致；验收副本已移入废纸篓。
- 飞影页面在 `06:58:24` 观察到生成中，余额 `50,864`。该观察值不是最终扣分结论。

## SKU003

| 对象 | 证据 |
|---|---|
| ProductionOrder | `7439c502-5ed5-4feb-93a1-c0dc3ff6e05b` |
| handoff package | `c518a484-46e5-401f-8ef5-a21751fbdc4a` / v1 |
| manifest SHA-256 | `be6e4b9e1f6b69329164d875e0143ca997a1e151e7eb013607cef18c2228d401` |
| package SHA-256 | `2acf47db7600bf4dd32f093c0981dc43fb77b41cf302c1b0431d464e415922a3` |
| ExecutionAttempt | `da5b1204-c9ca-42d4-a08c-2abc7f36537e` / succeeded / 恰好 1 次 |
| Candidate | `8d01c00d-20ba-4301-92a3-8ae87cb0d86d` |
| A12 | `1cec23cc-6ea3-467e-a854-ce7fb73d4c3e` / succeeded / passed / attempts=1 |
| Work | `936e9b2e-027a-496b-9b3b-067f5b401cfc` / available |
| 视频 | `31,317,700` bytes / `video/mp4` |
| 视频 SHA-256 | `0c5adef7562cdd74f431014b5f23a5efab7104d27e515f44b9ca672befb35163` |

- 鉴权下载返回真实字节，本地大小和 SHA-256 与登记值一致；验收副本已移入废纸篓。
- 飞影页面在 `07:14:18` 观察到生成中，余额截图可见 `50,259`。该观察值不是最终扣分结论。

## 持久化与最终运行态

- 每条终态后均先停止 Worker、恢复 fail-closed，再完成 A12、Work 和下载验收；App 每轮重建后均恢复 healthy。
- 最终 App 重启后，作品库显示 5 个作品，其中包含 SKU001、SKU002、SKU003。
- SKU003 的鉴权下载发生在最终 App 重启后，证明数据库、对象存储/持久输出卷和下载授权链在该重启后仍可用。
- 最终 `eligible=[]`、`active_attempts=[]`；Mac Local Agent 进程为空。
- 最终配置：`PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、
  `CLOUD_EXECUTOR_ENABLED=false`、`CLOUD_EXECUTOR_MODE=fail_closed`、`CLOUD_EXECUTOR_CONCURRENCY=1`。
- Cloud Executor 为 `stopped / exited 0`；服务器内存共 `3495 MiB`、available `2622 MiB`，磁盘 available `23 GiB`。

## 积分证据边界

- 三条均无重试。
- 仅记录飞影页面在三次生成中观察到的余额：`51,464`、`50,864`、`50,259`。
- 飞影最终标签页卡住，三条全部完成后的动态余额未验证；不得由上述中间观察值推断或对外宣称总积分消耗。

## 验收结论

- #132 的三个不同商品、严格串行、Cloud Executor only 验收条件已满足。
- 每个 order 恰好一个 attempt；每条均完成云端 artifact、A12 passed、Work available 和鉴权真实字节下载。
- 本结论允许进入 release-readiness，不表示公网生产就绪、自动批量队列、更大规模或长期稳定性已验证。
