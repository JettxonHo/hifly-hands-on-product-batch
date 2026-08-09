# 腾讯云 2C4G 一体化内部试运行运行手册

本文档描述 A01-A14 的单机低并发内部试运行基线，不是公网生产交付方案。默认执行器是
`fail_closed`：未配置真实受控 provider/executor 时，应用不会伪造飞影或视频生成成功；本方案不访问
`hifly.cc`，不读取 `config.local.json`，不启动本地浏览器，也不消耗飞影积分。

## Sol 隔离实机验收证据（2026-08-09）

Sol 使用独立 Compose project `hifly-pilot-verify` 完成隔离实机验证，对外测试端口为 HTTP `28080`、HTTPS
`28443`。本次使用临时自签证书和测试密码，均不是生产证书/凭据；image build success。Docker Hub 首次拉取时
出现若干 EOF，重试后成功，确认不是代码失败。

- `postgres:15-alpine` healthy，13 个 A01-A14 migration steps 全部成功。
- app healthy，`nginx:1.30.4-alpine` healthy；HTTPS `GET /healthz` 返回 `200 {"status":"ok"}`，
  `/login.html` 返回 200。
- `pg_dump` backup success；restore 到 fresh `hifly_restore_verify` success；恢复后 public tables count 为 92。
- 全量 `npm test` 为 821 total / 776 pass / 45 skip / 0 fail（约 40 秒）；production targeted 9/9，
  `npm run check` 检查 193 个 JS，`git diff --check` 与 Compose config 均通过。
- 验收使用的临时容器随后由 Sol 清理；临时自签证书不具备生产用途。全程未访问 Hifly、未运行真实 provider/Playwright/Capture，
  未消耗飞影积分。

## 资源与网络边界

- 建议使用 2 vCPU / 4 GiB 云主机；Compose 为 `app` 约 1.5 GiB、PostgreSQL 约 768 MiB、Nginx
  约 128 MiB 的硬内存上限，并将执行并发保持为 1。Playwright 不常驻在生产入口中。
- 反向代理固定为 `nginx:1.30.4-alpine`；HTTPS 使用 `listen 443 ssl;` 与独立的 `http2 on;` 配置。
- `app` 和 `postgres` 不发布宿主机端口；只有 `proxy` 发布 HTTP/HTTPS 端口。云安全组/防火墙应只允许
 试点内网来源访问这些端口。
- 默认对外端口为 80/443，可用 `HTTP_PORT`、`HTTPS_PORT` 覆盖。当前机器已有服务占用 80/443 时，
  验证可使用 `HTTP_PORT=18080 HTTPS_PORT=18443`，不要停止既有容器。
- PostgreSQL 15、应用持久文件和备份分别使用 named volume；备份目录为容器内的
  `/var/backups/hifly`，由 `hifly_pilot_backups` 挂载。
- 单次批量请求上限为 128 MiB；生产配置 `maxBatchBytes` 与 Nginx `client_max_body_size` 已对齐，适配
  2C4G 低并发试点。

## 首次准备

```bash
cp .env.example .env
```

编辑 `.env`，至少替换以下占位值：`PUBLIC_HOST`、`PUBLIC_ORIGIN`、PostgreSQL 密码与
`DATABASE_URL`，以及启用初始管理员 seed 时的四个 `INITIAL_ADMIN_*`/组织字段。生产必须使用 HTTPS，
`PUBLIC_ORIGIN` 必须是 `https://`；不要把 `.env` 提交到 Git。

如需启用飞影官方 API，在服务端 `.env` 设置 `HIFLY_API_TOKEN`。留空时官方 API 功能保持禁用；设置后也不会
在启动或页面加载时自动访问飞影。只有管理员显式调用 `POST /api/providers/hifly/connection-test` 才会执行
账户积分查询，该调用不创建视频任务。当前公开 API 未确认「手里有货」，因此该 Token 不会替换 Capture HTTP
或 Playwright 路径，`PRODUCTION_EXECUTOR` 仍默认保持 `fail_closed`。正式企业环境应把 Token 迁移到云端
SecretStore，不写入镜像、Git、日志或前端配置。

配置完成后可在应用容器内显式验证 Token 和积分查询；该命令不会创建视频任务：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml exec app npm run hifly:check
```

准备证书目录（默认 `./deploy/certs`，也可用 `TLS_CERT_DIR` 指定宿主机目录）：

```text
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```

证书只读挂载到 Nginx 的 `/etc/nginx/certs/`。没有有效证书不要启动 proxy。

先检查变量展开和服务合同；可使用非冲突端口：

```bash
HTTP_PORT=18080 HTTPS_PORT=18443 \
  docker compose -p hifly-pilot -f docker-compose.production.yml config
```

## 显式 migration 与启动

应用启动不会偷偷执行 migration。必须先显式执行一次：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml up -d postgres
docker compose -p hifly-pilot -f docker-compose.production.yml run --rm app npm run migrate:production
docker compose -p hifly-pilot -f docker-compose.production.yml up -d
```

`migrate:production` 按以下依赖顺序执行当前 A01-A14 schema：

```text
identity → assets → projectContent → copyGeneration → copyQuality → copyReview
→ avatarSelection → videoPlanning → productionOrders → manualHandoff
→ manualExecution → artifactVerification → workDelivery
```

生产入口只初始化 repository 并检查 schema-current；migration 失败或 schema 不匹配时拒绝启动。入口固定
监听 `0.0.0.0:${PORT}`，只尝试显式端口一次，不自动跳到其他端口。

## 健康检查与 Host/Origin

`/healthz` 不受 `/api` identity guard 约束，但仍受 trusted Host 校验并检查数据库可用性。Nginx 的
health location 显式转发 `Host: 127.0.0.1:3000`，该值已包含在生产 trusted hosts；正常 API/UI 代理保留
客户端 Host 和 Origin 语义，并转发 X-Forwarded 头。

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml ps
curl -H 'Host: pilot.example.invalid' http://127.0.0.1:18080/healthz
```

把示例域名替换为 `.env` 中的 `PUBLIC_HOST`；若使用 80/443，则相应替换 curl 端口。

## 备份与恢复

备份是显式命令，文件写入挂载目录。CLI 会从 `DATABASE_URL` 解析出不含密码的连接 URI，
通过子进程 `PGPASSWORD` 传递密码；不会把完整 `DATABASE_URL` 放入 argv 或日志：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml exec app npm run db:backup
docker compose -p hifly-pilot -f docker-compose.production.yml cp \
  app:/var/backups/hifly/hifly-YYYYMMDDTHHMMSSZ.dump ./pilot-backups/
```

恢复是破坏性操作，必须显式传入 `--confirm` 和备份文件路径；不执行隐式恢复：

```bash
docker compose -p hifly-pilot -f docker-compose.production.yml cp \
  ./pilot-backups/hifly-YYYYMMDDTHHMMSSZ.dump app:/var/backups/hifly/
docker compose -p hifly-pilot -f docker-compose.production.yml run --rm app \
  npm run db:restore -- --input /var/backups/hifly/hifly-YYYYMMDDTHHMMSSZ.dump --confirm
```

恢复前应停止写入流量并确认目标数据库；恢复后按上面的 health/schema 检查复核。不要把连接串写入命令
行、日志或工单。

## 试点边界与退出条件

本基线适合内部、低并发、人工接管的试运行。真实飞影 transport、真实 provider、Playwright 常驻并发、
COS/托管 PostgreSQL、弹性扩容、监控告警、密钥托管和公网安全策略均不在本任务交付内。要进入客户公网
生产，必须另行完成这些基础设施与安全评审；在此之前保持 `PRODUCTION_EXECUTOR=fail_closed`。
