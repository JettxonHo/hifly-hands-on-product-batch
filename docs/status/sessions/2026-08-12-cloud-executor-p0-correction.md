# 2026-08-12 Cloud Executor P0 架构纠偏

## Owner 决策

P0 改为纯云端 Control Plane + Cloud Executor Worker。用户只需要浏览器，个人电脑不参与生产运行。Cloud Executor 使用独立身份、独立 service、云端 Chrome/Playwright 和持久磁盘；并发 1、首失败停止、不自动重试。

## 服务器只读核验

- `/opt/hifly-pilot`：`d6e1f5093ee63cbfdb82e9d98eddca90874a5193`，工作树干净。
- Compose 文件实际位于 `/opt/hifly-pilot/docker-compose.production.yml`；旧接力中的 `/opt/hifly-runtime/docker-compose.yml` 已过期，仅 `/opt/hifly-runtime/Dockerfile` 存在。
- app/postgres/proxy 均 healthy。
- app 使用当前新镜像；回滚镜像 `hifly-pilot-app:rollback-cf13679` 仍存在且不同。
- 容器内与 HTTPS `/healthz` 均返回 `{"status":"ok"}`。
- 13 个领域 migration ledger 表存在。
- app 有效配置为 `PRODUCTION_EXECUTOR=fail_closed`；旧 Local Agent 配置仍启用，但本轮没有运行、heartbeat 或 claim。

## CE-01 产出

- `docs/product/CLOUD_EXECUTOR_P0.md`
- `docs/superpowers/specs/2026-08-12-cloud-executor-p0-design.md`
- `docs/superpowers/plans/2026-08-12-cloud-executor-p0.md`
- D-034 与新 `GOAL.md`
- 同步更新治理、架构入口、CURRENT 和 HANDOFF
- 创建 CE-01～CE-08 Issues #136～#143

## 未完成

- CE-02～CE-07 尚未实现。
- Cloud Executor 未部署，云端 Profile/登录/持久输出/控制台状态尚未形成。
- 纯云端真实出片尚未验证；不得宣称 P0 可用。

## 外部动作与费用

- 没有领取 ProductionOrder。
- 没有访问 Hifly 或 DeepSeek。
- 没有真实生成或积分消耗。
- CE-08 仍需单独明确授权。
