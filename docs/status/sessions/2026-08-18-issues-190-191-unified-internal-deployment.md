# Issues #190/#191 统一内部部署与只读验收

## 基本信息

- 日期：2026-08-18
- 环境：阿里云 `8.163.60.0` 内部验收环境
- 部署前 commit：`db36cc53d63f1db85e810bd72b0a8b21d86aedfa`
- 部署后 commit：`80bdfd4500c66cd564daeb7a3badcfd070478809`
- 关联任务：Issue #190 商品图片类型收敛；Issue #191 Production terminal Work 真值恢复
- 文档收口：Issue #198；本 session 只固化主控已经实际完成并复核的部署、运行态与真实管理员只读证据
- 结论：#190/#191 已统一部署且内部只读验收通过；这不是公网生产就绪、真实 Provider 出片或长期稳定性证明

## Git、备份与回滚

- 候选通过本地与服务器 Git bundle 传输；两端 bundle SHA-256 均为
  `a6eca781c8f46e1a7e5d29e3edb14f191e727149b75b703c83999f764d2f7dd4`。
- 服务器从 `db36cc53d63f1db85e810bd72b0a8b21d86aedfa` fast-forward 到
  `80bdfd4500c66cd564daeb7a3badcfd070478809`，最终 Git worktree clean。
- 部署前数据库备份：`/var/backups/hifly/hifly-20260818T111243Z-pre-80bdfd45.dump`，581342 bytes。
- 回滚镜像：`hifly-pilot-app:rollback-db36cc53-pre-80bdfd45-20260818T111243Z`，image
  `sha256:d9cf8c8099091e182dc7674c00c9350755b417254c1af50c8d678a26011c0e4e`。
- 新 App image：`sha256:fcf5b4d14cab057c7065518535d56dc042d637d1e023acd00d65942c1abaf8fa`，OCI revision
  `80bdfd4500c66cd564daeb7a3badcfd070478809`。

## Migration、容器与 fail-closed 运行态

- 13 组 production migrations 全部成功。
- 只 recreate App；App healthy 后 restart Proxy。PostgreSQL 未重启，其 `StartedAt` 前后均为
  `2026-08-09T16:39:22.666960071Z`。
- 最终 App、PostgreSQL、Proxy 均 healthy；公网与 loopback HTTPS health 均返回 ok，`login.html` 返回 200；
  App 日志只包含正常 production startup。
- Cloud Executor 全程保持 `running=false / exited / exit=0`。配置保持：

```text
PRODUCTION_EXECUTOR=fail_closed
LOCAL_AGENT_ENABLED=false
CLOUD_EXECUTOR_ENABLED=false
CLOUD_EXECUTOR_MODE=fail_closed
HIFLY_API_TOKEN=
```

- 部署前、部署后及 UI 验收结束后，数据库控制面真值均为：

```text
eligible=0
active_attempts=0
waiting_orders=0
total_attempts=15
```

`total_attempts=15` 仅为保留的历史记录；本轮没有 claim 或新增 attempt。

## 部署内容一致性

- 容器内 `web/project.js` 与目标仓库文件逐字节一致，SHA-256：
  `ea365faf8b87160802bcbb66e492c16bd8e1bed6680425484af221a37221ce9b`。
- 容器内 `web/production.js` 与目标仓库文件逐字节一致，SHA-256：
  `ded6f77fff994d3670992f3c3c4df566aa87fc913cb82208eff4cde56ee2cbd7`。
- 这些哈希只证明部署文件与目标 commit 一致，不是 Provider、业务效果或公网发布证据。

## Issue #190 真实管理员只读验收

- 项目：`cbd2399e-d1bc-4bc8-b295-bb0a9e15ce07`。
- ProductRevision：`08cff1ef-1a6b-4276-9a55-5239465c41ca`。
- 数据库中真实 active Asset + available AssetVersion 集合为 `product_image=5`、`work_video=7`。
- Project“商品图片”候选恰好为以下 5 个商品图片：

```text
SUNSCREEN-20260818-001.png
SKU003.png
SKU002.png
SKU001.png
IPAD-CUSTOM-SCRIPT-001.png
```

- 候选中没有 mp4、`cloud-executor-output` 或 iPad 平板电脑作品视频。
- 本轮没有保存或修改 revision。该证据确认 #190 的 Project 消费端类型过滤已部署，不改写素材中心三类真值。

## Issue #191 真实管理员只读验收

- Product：`ca54826c-91b3-4b9e-9fb7-f922a4152e1d`。
- ProductionOrder：`ff5285cd-d2b7-4552-a276-cff18015fc67`，持久状态为 `succeeded`。
- Work：`80958749-9f92-40e6-a30e-7c886b555ef6`，持久状态为 `available`。
- 在 Worker offline、Cloud Executor `current_order=null` 时，Production 首屏显示“作品待检查”，唯一推荐动作是
  “进入作品库检查”，链接指向上述 exact Work。
- 页面中“生产门禁未通过”为 0 个；“+ 创建工单”保持 disabled；browser console errors 为空。
- 本轮没有点击 Works 链接、下载、保存、创建、刷新或任何写操作。该证据确认 #191 的 terminal Work 投影已部署，
  但不重新证明鉴权字节下载或真实生产执行。
- 浏览器验收结束后恢复到 `https://8.163.60.0/assets.html`。

## 证据边界与后续门禁

- 本轮没有访问 Hifly，没有启动 Cloud Executor Worker 或 Local Agent，没有 claim、创建 attempt、修改生产业务对象、
  生成视频或消耗积分。
- 结论仅为 #190/#191 已统一部署且内部真实管理员只读验收通过；不代表公网生产就绪、自动批量队列、并行能力、
  长期稳定性或正式 SLA。
- 入口仍为 IP + 自签证书。正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 尚未完成。
- Issue #193 的真实 Provider 商品呈现大小效果与瓶盖、包装、标签、商品形态保真仍未验证；下一次真实生成必须
  使用独立零-attempt 工单并取得新的单条积分授权，失败立即停止且不自动重试。

## 文档收口门禁

本 docs-only 收口严格限制为：

```text
docs/status/CURRENT.md
docs/ROADMAP.md
docs/status/sessions/2026-08-18-issues-190-191-unified-internal-deployment.md
```

固定 head 必须通过 `npm run check`、`git diff --check`、strict allowlist 与三组 CI 后，才交给主控独立审阅。
