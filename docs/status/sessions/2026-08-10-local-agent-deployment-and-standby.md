# Local Agent 部署与 standby 配对记录

日期：2026-08-10

## 目标与边界

把已合并的最小 Local Agent 执行器部署到阿里云试运行环境，执行 production migration，并在不领取任务、
不访问飞影、不消耗积分的前提下验证 Mac 与云端的 Bearer/readiness 心跳。

本记录不代表真实飞影生成、候选视频回传、A12 核验或 Work 创建已经通过。

## 部署结果

- 部署前版本：`646c0a9df00a3fe1b7555a1c8b7a8fda60ec13e9`
- 部署后版本：`8846602cf3af6a804322d6c88c49968fb32e3b32`
- 部署目录：`/opt/hifly-pilot`
- 数据库备份：`/var/backups/hifly/hifly-20260810T020113Z.dump`
- 旧应用镜像：保留 `rollback-646c0a9` 标签
- 新镜像：使用 `/opt/hifly-runtime/Dockerfile` 和当前 main 构建

执行 `npm run migrate:production` 后，identity、assets、projectContent、copyGeneration、copyQuality、
copyReview、avatarSelection、videoPlanning、productionOrders、manualHandoff、manualExecution、
artifactVerification、workDelivery 共 13 组 migration 全部成功。Local Agent 002/003 migration 由
manualExecution migration runner 应用。

重建后 app、postgres、proxy 全部 healthy；HTTPS `/healthz` 返回 `200 {"status":"ok"}`；服务器仓库为
`main@8846602` 且工作树干净。近期 app 日志未匹配到 uncaught、unhandled、fatal、migration failed、
LOCAL_AGENT_CONFIG_REQUIRED 或 connection refused。

## 配置与凭据边界

云端启用 `mac-agent-01` 并绑定试运行 Organization，`PRODUCTION_EXECUTOR` 继续保持 `fail_closed`。Bearer Token
只写入服务器 `.env` 和 Mac 用户级 `~/.config/hifly-local-agent/cloud.env`，两处权限均为 600；证书副本位于
`~/.config/hifly-local-agent/aliyun-pilot-ca.pem`。本文档只记录配置位置，不记录真实 Token。

Mac 为执行器准备独立干净 checkout：

```text
~/.local/share/hifly-local-agent/app
```

它与云端均使用 `8846602`，避免根工作区历史分支和未提交文件参与执行。

## standby 验证

未设置 `LOCAL_AGENT_FAKE_EXECUTION` 或 `LOCAL_AGENT_REAL_EXECUTION`，运行：

```bash
set -a
. ~/.config/hifly-local-agent/cloud.env
set +a
cd ~/.local/share/hifly-local-agent/app
npm run local-agent:run-once
```

结果：

```text
local_agent_http { operation: 'heartbeat', status: 200 }
local_agent_standby {}
```

因此当前已验证 HTTPS、自签 CA、Bearer、Organization/Agent 绑定和 readiness 心跳。standby 不调用 claim，
所以没有生产工单被领取、没有交接包下载、没有飞影请求、没有候选视频或 A12/Work 状态变化。

## 下一步门禁

1. 在新云端系统准备 1 个已批准 VideoPlan、ProductionOrder 和 A10 交接包。
2. 在 Mac 配置该工单人物素材版本对应的本地绝对图片路径。
3. 由 Owner 另行明确授权 1 条真实飞影生成及积分风险。
4. 仅运行一次 `LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real`。
5. 任意失败立即停止，不自动重试；核对 ProductionOrder、attempt、飞影作品、候选上传、A12 和 Work。

本阶段飞影积分消耗：0。
