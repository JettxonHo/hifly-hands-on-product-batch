# 阿里云 2C4G 内部试运行部署差异说明

本文补充阿里云 Ubuntu 22.04 轻量服务器上的实机差异。应用合同、环境变量、migration、备份和恢复命令仍以
`TENCENT_CLOUD_2C4G_DEPLOYMENT_RUNBOOK.md` 为准。云厂商变化不需要修改业务代码。

Cloud Executor CE-07 的独立 Worker、disabled/standby 验收、持久卷、loopback noVNC、资源观察和回滚步骤见
`ALIYUN_CLOUD_EXECUTOR_CE07_RUNBOOK.md`；本分支只交付代码与部署合同，实机由 Sol 在 PR 合并后执行。

## 已验证基线

- 2 vCPU / 4 GiB、Ubuntu 22.04.5、约 50 GiB 系统盘。
- Docker Engine 29.7.2、Docker Compose v5.4.0。
- `postgres:15-alpine`、应用镜像、`nginx:1.30.4-alpine` 均 healthy。
- 13 组 A01-A14 production migration 成功。
- HTTPS `/healthz` 与登录页通过；初始管理员首次登录进入强制改密状态。
- `pg_dump` 备份与临时数据库恢复通过，恢复库有 92 张 public tables。
- 只有 SSH、HTTP、HTTPS 对外监听；应用与 PostgreSQL 端口不发布到宿主机。

## 镜像和构建网络差异

该实例直接连接 Docker Hub 和 Debian 官方 apt 源时出现超时或连接重置。实机部署采用以下有界处理：

1. 使用 DaoCloud 公共镜像前缀预拉取所需基础镜像，再在宿主机标记为 Compose 期望的镜像名。
2. 在 `/opt/hifly-runtime/Dockerfile` 保存部署专用 Dockerfile，仅将 Debian apt 源替换为阿里云镜像；其余构建步骤与仓库 Dockerfile 一致。
3. 应用镜像本地构建为 `hifly-pilot-app:latest`，Compose 使用该镜像启动。
4. `/etc/docker/daemon.json` 将 `max-concurrent-downloads` 设为 1，降低该网络环境下并发拉取失败概率。

这些文件属于服务器运维配置，不提交到应用仓库。升级 `origin/main` 后，应先比较仓库 Dockerfile 与部署专用
Dockerfile；若仓库构建步骤变化，同步必要变化后再构建，不能长期假设两者相同。

## 证书与 Git 隔离

证书放在 `/opt/hifly-runtime/certs`，`.env` 使用：

```text
TLS_CERT_DIR=/opt/hifly-runtime/certs
```

目录权限为 700，私钥为 600，证书为 644。证书目录不放在仓库工作树，避免私钥成为未跟踪文件或被误提交。
当前 30 天自签 IP 证书只允许内部试运行；正式对外必须替换为域名可信证书。

## 当前运行边界

- `PRODUCTION_EXECUTOR=fail_closed`。
- 服务器未配置 `HIFLY_API_TOKEN`，启动和页面加载不会访问飞影。
- 当前不运行 Playwright 常驻浏览器，也不执行 Capture HTTP 真实生成。
- 任何真实飞影生成都必须重新确认积分授权，并先限制为 1 条。
- 当前单机适合低并发内部试运行；正式客户生产仍需域名备案、可信证书、监控告警、异地备份，以及按负载评估托管 PostgreSQL/对象存储。

## 更新与回滚要点

更新前先备份数据库并确认三个容器 healthy；拉取目标提交后显式执行 production migration，再重建应用。
若 migration 或 health 失败，停止对外流量并使用已验证备份恢复，不要在故障状态继续提交生产任务。

部署完成后至少复核：

```bash
git status --short --branch
docker compose -f docker-compose.production.yml ps
curl -k https://127.0.0.1/healthz
```

服务器 Git 工作树应保持干净；`.env`、证书、备份、数据库 volume、日志和生成产物不得进入 Git。
