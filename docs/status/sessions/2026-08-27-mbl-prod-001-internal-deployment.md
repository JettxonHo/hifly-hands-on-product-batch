# MBL-PROD-001 内部发布与每日备份验收

> 日期：2026-08-27
> 跟踪：Issue #257
> 发布 commit：`d0d4cc84b99ea2c88962fd7e1f93b8d1d33e8fa4`
> 结论：内部 App 发布与每日备份验收 PASS；域名/TLS 上线、运营人员无积分闭环与单条真实生成仍属后续门禁

## 1. 授权与边界

- Owner 确认继续 Issue #257 的 MBL 内部生产化。本轮允许部署非域名版本并安装每日备份。
- 正式域名、DNS、可信证书、HTTP→HTTPS 与 HSTS 因备案延期；本轮禁止重建 Proxy 或激活该候选。
- 本轮不启动 Cloud Executor/Local Agent，不访问 Hifly/Provider，不创建生产工单、attempt、视频或交付，积分动作为 0。

## 2. 部署前只读核对

- 仓库最终 `main` 为 `d0d4cc84b99ea2c88962fd7e1f93b8d1d33e8fa4`。服务器原运行代码与 App OCI revision 均为
  `8787b60c82f928a1277467b95868ae47d011ec64`，App/PostgreSQL/Proxy 全部 healthy。
- 安全开关为 `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、
  `CLOUD_EXECUTOR_ENABLED=false`、`CLOUD_EXECUTOR_MODE=fail_closed`；`HIFLY_API_TOKEN` 未配置。
- 数据库控制面为 `waiting_orders=0 / eligible_orders=0 / active_attempts=0 / total_attempts=17`。
  磁盘可用约 17 GiB；服务器已有多个 App rollback image，无已安装的备份 timer/cron。
- 目标 Dockerfile 与旧仓库 Dockerfile 一致；服务器专用 Dockerfile 只保留既有阿里云 apt mirror 差异。

## 3. 发布包、备份与回滚点

- 本地从 exact `origin/main` 生成完整 Git bundle，4,608,418 bytes，SHA-256
  `5b4a1a4505462ce51d8abf8c9403cbf1eb71593421dbfac25fa18b44cd28f526`；服务器重算相同并通过 `git bundle verify`。
- 服务器建立独立干净 release checkout `/opt/hifly-releases/d0d4cc84b99e`。保留
  `/opt/hifly-pilot@8787b60c` 作为当前 IP + 自签入口的 Compose/Proxy 根，不把新 Nginx template 暴露给运行 Proxy。
- 部署前备份 `/var/backups/hifly/hifly-20260827T101509Z-pre-d0d4cc8.dump` 为 624,070 bytes、mode 600，
  exact `pg_restore --list` 成功。最初证据脚本误在宿主机检查容器持久卷路径而提前终止；备份与 archive 校验本身已成功，后续在 App 容器内确认权限为 600。
- 旧 App 镜像 `sha256:ee418c877e470e1f52dd2853cd10e2b3959f6d6c924abbf4248823a4c61b8d60`
  已标记为 `hifly-pilot-app:rollback-8787b60c-pre-d0d4cc8-20260827T101509Z`。

## 4. App 发布与运行态

- 候选 App image 为
  `sha256:56a16567b50e5188e37fefbd42d02d492aa02cb583bab4d37c6f640c6fda15b5`，OCI revision 精确为
  `d0d4cc84b99ea2c88962fd7e1f93b8d1d33e8fa4`；候选镜像在 `--network none` 下通过 `npm run check`，检查 249 个 JavaScript 文件。
- 14 组 production migration 全部成功：identity、assets、projectContent、copyGeneration、copyQuality、
  copyReview、avatarSelection、videoPlanning、productionOrders、manualHandoff、manualExecution、
  artifactVerification、appearanceFidelity、workDelivery。
- 只以旧 Compose 合同 `--no-deps --no-build --force-recreate app` 重建 App。PostgreSQL `StartedAt`
  保持 `2026-08-09T16:39:22.666960071Z`，Proxy `StartedAt` 保持
  `2026-08-18T16:40:32.410002866Z`，两者没有重启。
- 部署后 App/PostgreSQL/Proxy 全部 healthy，loopback 与公网 `/healthz` 均返回 `ok`，
  `workspace.html` 与 `login.html` 均返回 200，HSTS header 不存在。目标静态文件哈希为：

```text
workspace.html c463a122edace42807ba70fb7e940e345bee74feb140fb309532a99d7ca3eb74
workspace.css  db773854ba064f70cf7afc32bb008a2d23cb1a9452ca4f736aa98d6dede3aa44
assets.js      bacf32b6d023e91cd517a79a96b97d84b9de1e3b44ac7b835106551ab4fa6df0
works.js       51127d1e7aa06bce5e089f13ae4c8cf98da2c74d8d5e25f2dbfd2eadba71df3c
```

- 部署后安全开关与控制面计数与部署前一致；Cloud Executor 容器为 `created/false/0`，App 最近日志未匹配 `error|fatal|unhandled|exception`。

## 5. 每日备份

- 已安装 exact `hifly-pilot-backup.service` 与 `hifly-pilot-backup.timer`。由于内部发布故意分离新 App release 与旧 Proxy/Compose 根，一个 systemd drop-in 只将 `ExecStart` 指向
  `/opt/hifly-releases/d0d4cc84b99e/deploy/systemd/run-hifly-backup.sh`；原 service 其余 hardening 和
  `WorkingDirectory=/opt/hifly-pilot` 保持不变。
- 首次手动 `systemctl start hifly-pilot-backup.service` 为 `Result=success / ExecMainStatus=0`。生成
  `/var/backups/hifly/hifly-systemd-20260827T102118Z-618654.dump`，670,552 bytes、mode 600、owner
  `node:node`；runner 对该 exact path 执行 `pg_restore --list` 成功。
- timer 已 `enabled/active`，系统已给出下一次运行时间。本轮未删除旧备份、未上传备份、未自动重试。异机副本与本次新备份的完整恢复演练仍未完成。

## 6. 结论与下一步

- Issue #257 第 3 步的“冻结并部署非域名内部版本 + 安装/运行/校验每日备份”已完成。
- 下一门禁是运营人员在 Cloud Executor 关闭、零积分条件下，从新建项目完成到“可创建生产工单”门前的全流程，同时覆盖权限、恢复、冲突与移动端。
- 真实生成尚未获得本轮积分授权。后续只能使用一个新商品、唯一新工单、零 attempt、并发 1，失败即停且不自动重试。
