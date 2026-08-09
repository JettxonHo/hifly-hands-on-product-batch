# 腾讯云 2C4G 试运行部署设计

> 状态：Owner 已确认第一阶段内部试运行；部署基线已实现并通过本地隔离验收
> 基线：`main` 已包含 A01-A14 与一键本地演示（PR #97）

## 结论

腾讯云 2 核 4 GB Linux 服务器可以承载本系统的低并发试运行，但不能把它当作无限容量的
一体化视频生产节点。

适合放在 2C4G 上的能力：

- Fastify Web/API 与静态前端；
- A01-A14 企业工作流；
- 低并发异步 worker；
- 小团队、串行任务的 PostgreSQL；
- 通过 Capture HTTP 或人工交接方式连接外部执行链路。

不建议同机长期运行的能力：

- 多个并发 Chromium / Playwright 浏览器；
- 大量视频永久存储和下载分发；
- 高并发文案生成、质检和视频任务；
- 数据库、应用、浏览器执行器三者同时承受生产峰值。

## 推荐拓扑

### 第一阶段：2C4G 内部试运行

```text
Internet
  -> HTTPS reverse proxy (80/443)
      -> Node/Fastify app (container, private port)
          -> PostgreSQL 15 (container, loopback/private network)
          -> persistent local volume
          -> external provider / manual execution
```

约束：

- 单实例、低并发、串行生产；
- Playwright 只作应急兜底，不在服务器内并发运行；
- 视频和素材设容量告警，达到阈值前迁移腾讯云 COS；
- 数据库每日备份到服务器外；
- 只开放 80/443，SSH 限制来源 IP，数据库不开放公网；
- 生产必须使用 HTTPS、Secure Cookie、真实 Host/Origin 白名单与独立生产密码。

该阶段适合内部运营和少量受控客户试用，不承诺高可用。

### 第二阶段：正式客户生产

```text
Internet
  -> HTTPS / load balancer
      -> 2C4G application node
          -> managed PostgreSQL
          -> Tencent COS
          -> separate execution worker or Capture HTTP
```

正式生产应把数据库和文件从应用机拆出。这样 2C4G 只承担 Web/API 与轻量 worker，后续可直接
横向扩容；Playwright 若仍保留，应部署到独立的 4C8G 或更高执行节点。

## 当前实现状态与剩余缺口

已完成生产专用入口、环境变量配置、显式 migration、Dockerfile、Compose、Nginx、健康检查及
PostgreSQL 备份/恢复。默认执行器为 `fail_closed`，不会把演示结果伪装成真实生产结果。

仍未完成：

1. 当前对象存储只有本地文件实现，尚无腾讯云 COS adapter；
2. controlled provider/evaluator 仅适合流程试点，尚未接入正式文案与质检 Provider；
3. 真实飞影执行链未接入云端生产入口，Playwright 仍只保留为本地兜底；
4. 尚未在真实 2C4G 云主机完成持续资源基准、服务器重启恢复与异机备份演练；
5. 尚未完成面向公网客户所需的托管数据库、密钥托管、监控告警和安全运维。

## 后续实施顺序

1. 在腾讯云 2C4G 实机按 runbook 部署内部试运行环境并采集资源基准；
2. 配置正式域名、证书、安全组、异机备份和监控告警；
3. 接入真实 Provider，并将本地对象存储迁移到 COS；
4. 获得单独积分授权后，才进行 1 条真实飞影链路验收；
5. 外部客户生产前拆分托管 PostgreSQL、COS 与独立执行节点。

## 2C4G 验收线

- 空闲时总内存不超过 2.5 GB；
- 受控并发下持续可用内存不低于 700 MB；
- 不发生 OOM、容器重启或数据库连接耗尽；
- 上传、异步任务、刷新恢复、交接包、核验和交付全链路通过；
- 备份文件可在全新数据库恢复；
- 服务器重启后服务、数据库与 worker 恢复，未完成任务不被重复提交；
- 全程不依赖服务器桌面或人工打开浏览器。

## Owner 决策

首发采用第一阶段一体化 2C4G 内部试运行。该决定不等于批准公网生产，也不授权真实飞影积分执行；
进入第二阶段前仍需单独验收和授权。
