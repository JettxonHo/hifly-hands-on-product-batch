# 阿里云 Cloud Executor CE-07 运行手册

本文是 Issue #142 的部署合同，适用于阿里云 2C4G 内部 standby 验收。它只描述可审查的 Worker
部署、健康、持久卷和回滚步骤；本轮代码交付不包含 SSH、实机部署、飞影访问、Provider 调用、工单
claim 或积分验证。

## 默认安全边界

`cloud_executor` 是独立进程和独立 Compose service，不由 Web app 启动。默认环境为：

```text
CLOUD_EXECUTOR_ENABLED=false
CLOUD_EXECUTOR_MODE=fail_closed
CLOUD_EXECUTOR_CONCURRENCY=1
CLOUD_EXECUTOR_NOVNC_BIND_HOST=127.0.0.1
```

在此状态下 Worker 只启动 no-side-effect standby/disabled 进程和本机 `/healthz`；不创建 PostgreSQL
连接、不读取 Hifly config、不构造浏览器、不运行 Provider preflight、不列出或 claim production order，
也不伪造 `available`。健康结果中的 `readiness=disabled` 与 `claim_enabled=false` 是禁用语义。

只有完成独立授权和密钥注入后，才可把 `CLOUD_EXECUTOR_ENABLED=true`、设置 `mode=playwright`、
`CLOUD_EXECUTOR_ID`、组织 ID、heartbeat URL/token 与外部 Hifly config 路径。真实执行不属于本轮
验收；不能把 `fake` 当成飞影生产证明。

## 部署前静态检查

在服务器工作树中只读确认目标分支/提交和工作树状态；不要提交 `.env`、Profile、媒体、日志、备份或
volume 内容：

```bash
git status --short --branch
git rev-parse HEAD
POSTGRES_PASSWORD='use-a-local-shell-value' \
  docker compose -p hifly-pilot -f docker-compose.production.yml config
```

`docker compose config` 只解析 Compose，不启动容器，不产生 Provider 请求。确认 `cloud_executor`
只有一个 service 实例，`CLOUD_EXECUTOR_CONCURRENCY=1`，noVNC 宿主机映射为
`127.0.0.1:6080:6080`，没有 `0.0.0.0` 宿主机映射；Worker 的 health 只通过 internal network
访问 Web heartbeat route。

## 显式 migration 与启动顺序

Worker 容器启动只做 schema-current 检查，绝不自动 migration。首次部署或代码包含新 migration 时，
先备份，再由操作者显式执行：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml exec app npm run db:backup
docker compose -p hifly-pilot -f docker-compose.production.yml up -d postgres
docker compose -p hifly-pilot -f docker-compose.production.yml run --rm app npm run migrate:production
docker compose -p hifly-pilot -f docker-compose.production.yml up -d app proxy cloud_executor
```

migration 失败或 schema 不完整时应停止后续启动并修复，不要在 Worker 内执行 migration，也不要用
`cloud_executor` 代替 `app` migration 命令。

## Disabled/standby 验收

以下检查不访问飞影、不访问 Provider、不 claim 工单且不消耗积分：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml ps
docker compose -p hifly-pilot -f docker-compose.production.yml exec cloud_executor \
  node -e "fetch('http://127.0.0.1:3001/healthz').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
docker compose -p hifly-pilot -f docker-compose.production.yml logs --tail=50 cloud_executor
```

期望健康 JSON 只包含 `status`、`runtime`、`readiness`、`worker`、`concurrency`、`claim_enabled`，
并在默认配置下看到 `readiness=disabled`、`claim_enabled=false`。不要以网页“online”或容器 healthy
推断 Worker 可用；heartbeat 只有在显式启用且通过真实鉴权后才上报受控 readiness/progress。

## 持久卷、重启与 noVNC

Profile、assets、outputs、evidence、batches、locks 分别使用 named volume；共享的
`/var/lib/hifly/manual-handoff-packages` 以只读方式来自 Web app 数据卷。检查目录和非敏感重启 marker：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml exec cloud_executor \
  test -f /var/lib/hifly-executor/profile/.cloud-executor-profile.marker
docker compose -p hifly-pilot -f docker-compose.production.yml exec cloud_executor \
  sh -c 'find /var/lib/hifly-executor -mindepth 1 -maxdepth 1 -type d -print'
docker compose -p hifly-pilot -f docker-compose.production.yml restart cloud_executor
docker compose -p hifly-pilot -f docker-compose.production.yml exec cloud_executor \
  test -f /var/lib/hifly-executor/profile/.cloud-executor-profile.marker
```

本轮不要求生成媒体来证明 volume；不得为了验证按钮启动真实执行。noVNC 不应有公网监听。需要人工
诊断时，仅通过 SSH tunnel 访问宿主机 loopback，例如：

```bash
ssh -N -L 6080:127.0.0.1:6080 <user>@<aliyun-host>
```

浏览器打开本地 `http://127.0.0.1:6080/`；不要在安全组开放 6080，不要把 Compose 映射改为
`0.0.0.0`，不要把 websockify 的 container-local bind 误当成公网授权。

## 健康、内存与磁盘观察

在不启动执行任务的前提下，记录 app、PostgreSQL、Worker 的资源边界和持久卷容量：

```bash
docker stats --no-stream hifly-pilot-cloud_executor-1 hifly-pilot-app-1 hifly-pilot-postgres-1
free -h
swapon --show
df -h /var/lib/docker
docker system df
docker compose -p hifly-pilot -f docker-compose.production.yml exec cloud_executor df -h /var/lib/hifly-executor /var/lib/hifly
docker inspect --format '{{json .State.Health}}' "$(docker compose -p hifly-pilot -f docker-compose.production.yml ps -q cloud_executor)"
```

Compose 硬边界为 Worker `mem_limit=1024m`、`mem_reservation=512m`、`cpus=0.75`、
`pids_limit=256`，并发固定为 1。磁盘门限默认 1 GiB，由
`CLOUD_EXECUTOR_MIN_FREE_BYTES` 控制；低于门限或无法 statfs 时应看到受控 `storage_blocked`，
不能继续列单或 claim。

## 回滚步骤

回滚前保留当前 health、`git rev-parse HEAD`、Compose config 和 DB backup 证据。只回滚 Worker 镜像
或代码时，先停止 Worker，保留数据库和 named volumes：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml stop cloud_executor
docker tag hifly-cloud-executor:previous hifly-cloud-executor:rollback-ce07
docker compose -p hifly-pilot -f docker-compose.production.yml up -d cloud_executor
```

若新 migration 已执行，不能假定降级镜像可读旧 schema；需要数据库恢复时，停止写入流量、确认备份和
目标库，再由有权限的操作者显式执行 `npm run db:restore -- --input <backup> --confirm`，随后重新按
schema/health 顺序启动。不要删除 named volumes 作为普通回滚步骤；Profile、handoff、outputs、
evidence 与数据库备份需先取得独立保留/恢复确认。

任何回滚后都复核：Worker health 为 disabled/fail_closed 或明确受控状态、无 claim 新增、无 Hifly
访问、无 Provider 请求；本轮部署不提供真实出片或积分结算证据。
