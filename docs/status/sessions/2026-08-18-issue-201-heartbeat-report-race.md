# Issue #201 Cloud Executor heartbeat/report 版本竞态

> 日期：2026-08-18
> 基线：`origin/main@c072493689c8f87385fa6ccb335feb7aa1afb25c`
> 分支：`codex/issue201-heartbeat-report-race`
> 状态：仓库修复候选；随对应 PR 合并进入 `main` 后计为仓库修复完成，部署与真实 Provider 复验另行 gate

## 范围与边界

本轮只处理 Issue #201：确定性复现 candidate 上传完成后 heartbeat 与 terminal report 竞争 attempt
`row_version` 的行为，并在不放宽乐观锁、租约、身份或终态合同的前提下收束 Cloud Executor 完成时序。

本轮没有 SSH、部署、访问 Hifly、启动生产 Worker/Local Agent、创建或重试生产工单、修改生产数据、生成视频或
消耗积分；没有开始 Issue #202。2026-08-18 真实运行的约 104ms 时间线只作为调查起点，根因结论来自本轮隔离 TDD。

## 确认的根因

未修复基线的调用顺序为：

1. `runAttempt()` 在执行器返回后读取一次 `currentAttempt`；
2. candidate 授权、对象写入与上传完成继续执行；
3. 定时或 progress heartbeat 可在此期间把同一 attempt 的 `row_version` 加一；
4. terminal `saveReport()` 仍使用上传前 attempt 的 `expectedRevision`；
5. repository 拒绝旧 revision，外层 catch 随后使用最新 attempt 记录 failed report。

memory repository 与真实 PostgreSQL 16 均使用同一公开 Cloud Executor service seam，在
`markCandidateUploaded()` 完成后确定性插入一次真实 heartbeat。两套 RED 都捕获：

```text
actual report errors = ["MANUAL_EXECUTION_ATTEMPT_CONFLICT"]
expected report errors = []
```

并且未修复服务返回 `failed` 而不是 `succeeded`。因此 Issue #201 的 heartbeat/report revision 竞态已确认，
不再只是从生产事件时间线推断。

第一版候选只在执行器正常返回的 completed、failed、requires_action 分支调用 heartbeat 收束器；执行器抛异常、
candidate 保存异常或 post-submit unknown 抛异常仍由外层 catch 直接读取 attempt 并写报告。独立审阅后新增的 memory 与
PostgreSQL RED 均在排队 heartbeat 后让执行器抛异常，并再次确定性捕获 `MANUAL_EXECUTION_ATTEMPT_CONFLICT`；这证明
异常出口也必须进入同一终态门禁，而不是把既有绿色外推到未覆盖路径。

## 最小修复

- 执行期 heartbeat 通过单一队列串行，避免定时 heartbeat 与 progress heartbeat 自身重叠；
- terminal report 前关闭新的定时 heartbeat，并等待已经排队的 heartbeat 完成；
- heartbeat 或 progress heartbeat 失败仍转换为 `CLOUD_EXECUTOR_LEASE_LOST`，保持 fail closed；
- candidate 上传完成后重新读取同一组织、同一 Cloud Executor 所属且仍为 `running` 的 exact attempt；
- 使用该最新 `row_version` 一次写入 terminal report 与 candidate 状态；repository 的 `expectedRevision` 校验完全保留；
- 正常返回和抛异常形成的 failed、requires_action 与 completed terminal report 全部共用同一个幂等 heartbeat 收束器
  与最新 attempt 门禁；排队 heartbeat/progress、最终 attempt 读取、Cloud Executor 归属校验或 running 状态任一失败均统一
  转为 `CLOUD_EXECUTOR_LEASE_LOST`，不继续写 terminal report，也不通过兜底重读恢复报告写入。

该修复不自动重试 Provider、不复用失败生产单、不创建第二个 attempt，也不改变 A12/Work 触发条件。

## TDD 与验证

RED：

```text
node --test --test-name-pattern='candidate upload completion survives' test/cloud-executor.test.js
IDENTITY_TEST_DATABASE_URL=<temporary-postgresql-16> node --test test/manual-execution-postgres.integration.test.js
```

未修复精确基线两条命令均失败，并明确捕获 `MANUAL_EXECUTION_ATTEMPT_CONFLICT`。

GREEN：

- memory 竞态 seam：1/1；
- PostgreSQL 16 集成：1/1；
- 正常 candidate 上传竞态以及异常 failed/requires_action 竞态均有 memory RED；异常 failed 分支另有 PostgreSQL RED；
- `test/cloud-executor.test.js`：23/23，其中 heartbeat 冲突、最终 attempt 读取失败与归属不匹配均明确保持零 terminal report；
- Cloud Executor + ManualExecution service + control plane + Playwright adapter 相关组：45/45；
- `npm run check`：230 个 JavaScript 文件；
- `git diff --check`：通过。

初版候选的本机默认 `npm test` 曾在浏览器套件开始后长期无新增输出，未形成可引用的完整汇总，因此未记为通过。异常出口
纠正后重新运行默认全量得到 1055 total / 1040 pass / 14 skip / 1 fail；唯一失败是既有
`yingdao-rpa-executor.test.js` 在临时 task 文件已被清理后读取并触发 `ENOENT`，同时产生测试结束后的 timeout rejection，
与本轮 7 文件 allowlist 无关，故不把本机全量记为绿色。固定 head Ubuntu、Windows 与 identity-postgres CI 是本轮默认全量
和 PostgreSQL 门禁。代码提交
`a9b1395dd214efe060d1bcf7b51c4b3c411221d2` 的 run `32145259001` 三组均为 SUCCESS：Ubuntu 59 秒、Windows
1 分 40 秒、identity-postgres 59 秒；后者实际串行执行 Identity、ProjectContent v2、VideoPlanning v2 与本轮新增的
ManualExecution Cloud Executor PostgreSQL 集成。该 run 发生在异常出口纠正前，只证明当时 fixed head。异常出口纠正
代码提交 `fc7f54362f117d43797dff41d5b7a207c4edfae5` 的 run `32146906399` 三组也均为 SUCCESS：Ubuntu 56 秒、
Windows 1 分 37 秒、identity-postgres 1 分 5 秒。本地或 CI 绿色不替代部署、真实 Worker、Provider 或积分验收。

第二轮独立审阅进一步指出：第一版异常收口只把已标记为 lease-lost 的门禁错误视为 fail closed；最终 attempt 读取失败或
归属不匹配会保留原错误码，外层随后通过兜底读取写 failed/requires_action。新增两条 memory RED 在未修复 head
`b7ac56d63b3d94083d6bc2ffea05478c0686d72c` 均得到 `Missing expected rejection`，证明旧实现实际落回了终态报告路径。
GREEN 将所有终态门禁失败归一为 `CLOUD_EXECUTOR_LEASE_LOST`，并要求 terminal write 只能消费门禁成功返回的 exact
owned/running attempt；两条回归 2/2、Cloud Executor 23/23、相关组 45/45，真实 PostgreSQL 16 集成仍为 1/1。
同一候选在最终检查时重新运行默认 `npm test`，得到 1057 total / 1043 pass / 14 既有环境门禁 skip / 0 fail；此前
影刀临时文件竞态未在本次运行复现。该结果不改写上一次真实失败记录，也不替代 fixed-head CI。

## 文件边界

- `.github/workflows/ci.yml`
- `src/cloud-executor/cloud-executor-service.js`
- `test/cloud-executor.test.js`
- `test/manual-execution-postgres.integration.test.js`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-18-issue-201-heartbeat-report-race.md`

未修改 API、数据库 migration、repository 并发规则、领域状态、依赖、部署或 Provider 页面实现。
