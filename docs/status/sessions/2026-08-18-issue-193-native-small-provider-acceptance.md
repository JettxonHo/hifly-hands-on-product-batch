# Issue #193 原生 `small` 档真实 Provider 单条验收

> 日期：2026-08-18
> 证据性质：主控已执行并复核的真实单条 Provider 运行；本 session 仅持久化仓库证据与缺陷边界
> 结论：尺寸验收 FAIL；外观保真 PARTIAL/FAIL；正式端到端合同 FAIL

仓库文档分支基于 `origin/main@d8f44b6aef4f1a4d70a5b36a195e8b629bcbaf44`；真实运行使用的内部验收环境仍为
已部署代码 `main@80bdfd4500c66cd564daeb7a3badcfd070478809`。后者是运行证据基线，前者只增加此前部署收口文档，
不得把文档提交误写为已部署应用版本。

## 1. 授权与范围

本次运行使用一条明确授权的真实 Cloud Executor 工单，允许一次飞影付费生成动作，失败立即停止且不自动重试。
本次文档收口没有执行 SSH、访问 Hifly、启动 Worker/Local Agent、修改生产数据、生成视频或消耗积分。

验收对象：

- SKU：`SUNSCREEN-20260818-003`
- 商品：安热沙金瓶防晒霜（原生小档验收）
- Product：`aa4f3086-141c-4e02-8cf2-0e129a99adac`
- ProductRevision：`d0143b27-068e-489d-b65e-3f4f0f98adf8`
  - `physical_dimensions` 为 SQL `NULL`
  - 商品图 AssetVersion：`91c08155-41b6-4e09-836c-325afbeed53d`
- CopyVersion：`60617e25-7e65-44a5-b9c4-5c2871483b0c`
- AvatarSelection：`37b04879…`
- Avatar AssetVersion：`4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0`
- VideoPlan：`581a6f08-1769-4eb2-b94d-d7875890da15`
  - `frozen / approved / warning`
  - `presentation_size_code=small`
- ProductionOrder：`8e60e8b3-28c3-421d-baad-089d46ae419c`
- Handoff：`1a33fa4f-14c5-455c-a5e6-a7b24e1a9631`，`ready v1`
  - manifest SHA-256：`0d35d8a10a4fab7131d6e3da2914b6c687cddef0c38692883edca5dc5c545b8e`
  - package SHA-256：`995dfdf5e4318015953ea1051d3031dfe1bbfffab350e73dcec2227ae46781db`
  - manifest 明确包含 `small`

## 2. 激活门禁与首次容器启动

付费执行前的门禁为：

- Worker off；
- `eligible=[8e60e8b3-28c3-421d-baad-089d46ae419c]`；
- 当前 order attempts=0；
- active attempts=0。

第一次启动没有领取工单、没有创建 attempt、没有进入付费动作。根因是当前容器 hostname 与持久 Profile
`SingletonLock` 内记录的 hostname 不同。三把 Chromium singleton 锁已移动到可恢复目录
`/profile/.stale-chromium-locks-20260818-203142`，没有删除。第二次启动仍属于同一获授权单次执行，不构成重试一次
已经开始的付费 attempt。

## 3. 唯一执行结果

- 唯一 Attempt：`b5ba1480-da8e-408c-933a-312ab3ac1afd`
- Attempt 最终状态：`failed`
- Report：`26906357-d092-43e2-99bf-e91bc29694b8`
  - `outcome=failed`
  - `failure_stage=playwright_execution`
  - `retryability=not_retryable`
- Provider remote ID：`713098`
- Candidate：`638fc536-3452-42c8-965e-719f16e18083`
  - 已上传
  - `video/mp4`
  - 50,650,990 bytes
  - SHA-256：`3921fc8e803cf319598505e542d59463987f7d018f80e0f10497e5ded460f260`
- A12 jobs：0
- Works：0

候选 forensic 副本位于：

`/Users/ketchup/Downloads/SUNSCREEN-20260818-003-native-small-forensic.mp4`

它为 17.56 秒、H.264 1600×2848 25fps + AAC。该副本来自候选 forensic 路径，不是 A12/Work 鉴权下载，
不能代替 Cloud GUI → A12 → Work → 鉴权真实字节的正式成功合同。

## 4. Provider 选档证据与效果结论

运行证据 `/private/tmp/hifly-size-accept-evidence-mkXyDr/modal-after-generate-small.png` 显示：在点击“立即生成 150积分”后，飞影弹窗仍视觉高亮
“智能适配”，不是期望的“小”。仓库当前 `src/hifly-page.js` 使用目标图片的本地化 `alt` 加父容器
`actived` 类来判断选择成功；真实页面证据证明该 seam 可能是假阳性。

三次运行的 8 秒位置对比图
`/private/tmp/hifly-size-accept-evidence-mkXyDr/three-run-8s-comparison.jpg` 显示：本次 native-small 成片仍为双手托持，商品尺寸未小于 Run1 baseline；金瓶和斜蓝盖
得以保留，没有再次变成泵头，但瓶身比例与标签清晰度仍不完全保真。

结论严格分开：

- 原生尺寸档位验收：FAIL；
- 商品外观保真：PARTIAL/FAIL；
- 总体正式验收：FAIL。

呈现大小不能自动通过外观保真。瓶盖、包装、标签、比例与商品形态仍须由 Works 检查和 `rework_required` 表达。

## 5. 积分证据边界

Provider 弹窗按钮显示 150 积分，并发生一次付费生成动作。Hifly header 在点击前与外层提交后都显示 `44007`，
但没有刷新并验证最终余额。因此只能记录“发生一次付费生成动作，确切余额变化未验证”，不得声称精确扣除 150 积分
或任何其他余额差值。

## 6. Candidate 上传后报告失败的竞态假设

已观察事件顺序：

| 时间 | 事件 |
|---|---|
| 12:37:29.890 | candidate authorized |
| 12:37:29.951 | heartbeat |
| 12:37:29.979 | candidate uploaded |
| 12:37:29.994 | failed report |

源码真值：

- `cloud-executor-service.runAttempt()` 在执行器返回后读取一次 `currentAttempt`，随后保存 candidate，再用此前对象的
  `row_version` 保存完成报告；
- 定时 heartbeat 与 progress heartbeat 均会更新 attempt；
- PostgreSQL `heartbeatCloudAttempt()` 每次成功写入都会将 `row_version` 加一；
- PostgreSQL `saveReport()` 要求 `current.row_version === expectedRevision`，否则抛出
  `MANUAL_EXECUTION_ATTEMPT_CONFLICT`。

上述源码与约 104ms 的事件交错强烈支持 heartbeat 使完成报告 revision 过期的竞态解释，但本轮没有隔离 TDD 或直接错误码
证据。因此这仍是待确认根因，不能写成已证明事实。Issue #201 必须先 deterministic RED，再决定最小修复。

## 7. Production 首屏终态缺陷

运行结束后 order 与唯一 attempt 均明确为 `failed`，但 Production 首屏“当前任务”仍显示：

- “等待生产门禁核对”；
- “生产门禁未通过”。

这错误地把持久化失败终态降级为激活前门禁状态。Issue #202 独立跟踪该投影；其修复不得增加 Web Worker 启停、自动重试、
重新领取或自动创建下一单。

## 8. 后续 Issues 与严格顺序

1. Issue #200：修复 Provider 原生商品大小选中态假阳性；付费前无法证明期望档位时 fail closed。
2. Issue #201：用 memory + PostgreSQL TDD 确认或推翻 heartbeat/report `row_version` 竞态，再做最小并发安全修复。
3. Issue #202：让 failed 工单首屏恢复持久化失败真值与安全下一步。

三个 Issue 是独立缺陷，不构成重试当前失败工单的授权。新的真实 Provider 运行必须等待三项分别完成实现、独立 Review、
合并和部署复验，并重新使用唯一新工单、零 attempt、单条积分授权。

## 9. 最终安全状态

- `CLOUD_EXECUTOR_ENABLED=false`
- `CLOUD_EXECUTOR_MODE=fail_closed`
- `LOCAL_AGENT_ENABLED=false`
- `PRODUCTION_EXECUTOR=fail_closed`
- Cloud Executor stopped
- App healthy
- eligible=0
- active attempts=0
- waiting orders=0
- total attempts=16（含历史）

本次文档收口没有执行任何生产动作，也没有修改或删除 Profile 锁、候选、工单、attempt、报告或 forensic 文件。
