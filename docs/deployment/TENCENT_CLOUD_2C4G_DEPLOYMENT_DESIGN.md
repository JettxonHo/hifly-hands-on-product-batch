# 腾讯云 2C4G 试运行部署设计

> 状态：待 Owner 确认部署级别后实施
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
          -> PostgreSQL 16 (container, loopback/private network)
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

## 当前实现缺口

1. `src/server/start.js` 仍以本地 GUI 启动方式为主，会尝试打开浏览器，并以本地 URL 输出。
2. 生产配置仍依赖 `config.local.json`；缺少只从环境变量/Secret 注入的云端入口。
3. 当前对象存储只有本地文件实现，尚无腾讯云 COS adapter。
4. controlled provider/evaluator 与 fake executor 只能用于演示，不能作为真实生产能力。
5. 缺少生产 Dockerfile、Compose、反向代理、健康检查、备份和部署检查脚本。
6. 缺少 2C4G 实机资源基准、故障恢复演练和受控真实链路验收。

## 实施顺序

1. 新增生产 server 入口：禁用自动开浏览器，固定监听容器端口，配置全部由环境变量注入。
2. 新增 Dockerfile、生产 Compose、反向代理和健康检查。
3. 按 A01-A14 依赖顺序提供显式 migration 命令，部署不在应用启动时偷偷迁移。
4. 建立 volume、备份、恢复和日志轮转说明。
5. 用 fake provider/executor 在 Linux 容器完成无积分端到端验证。
6. 接入真实 Provider；将本地对象存储迁移到 COS。
7. 获得单独授权后，才进行 1 条真实飞影链路验收。

## 2C4G 验收线

- 空闲时总内存不超过 2.5 GB；
- 受控并发下持续可用内存不低于 700 MB；
- 不发生 OOM、容器重启或数据库连接耗尽；
- 上传、异步任务、刷新恢复、交接包、核验和交付全链路通过；
- 备份文件可在全新数据库恢复；
- 服务器重启后服务、数据库与 worker 恢复，未完成任务不被重复提交；
- 全程不依赖服务器桌面或人工打开浏览器。

## 待 Owner 确认

必须先确认首发目标：

- **内部试运行**：采用第一阶段一体化 2C4G，成本最低，后续再拆 COS/数据库；
- **直接面向外部客户**：采用第二阶段，2C4G 仅作应用节点，从第一天使用托管 PostgreSQL 与 COS。

