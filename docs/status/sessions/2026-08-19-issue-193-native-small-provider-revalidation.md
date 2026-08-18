# Issue #193 `small` 原生档位与外观保真真实复验

> 日期：2026-08-19
> 结论：技术闭环 PASS；商品呈现大小 PASS；外观保真 FAIL；整体内容验收 FAIL / `rework_required`

## 1. 授权与边界

- Owner 明确授权在 #200/#201/#202 完成后部署最新 `main`，再用一个全新工单执行一次商品大小与外观保真验收。
- 本次只允许一个商品、一个新工单、一个 attempt、一次 Provider 付费生成；任一门禁或执行失败即停止，不自动重试、
  重新领取、再次生产或创建第二工单。
- 本次允许 SSH、部署、短时启动 Cloud Executor、访问 Hifly 和一次积分动作。Local Agent 全程关闭。
- Provider 按钮显示 `立即生成 150积分`，实际只点击一次；页面余额没有刷新核对，因此只记录发生一次付费动作，
  不声明精确扣分数。

## 2. 部署真值

- 部署目标为精确 `main@8787b60c82f928a1277467b95868ae47d011ec64`，包含 #200、#201、#202。
- 本地与服务器 Git bundle SHA-256 均为
  `d35f370b43a5e232d08d63b0c75fcd1ca5307dd1723e4e9b6238dd828acdeeba`。
- 部署前数据库备份：`/var/backups/hifly/hifly-20260818T162423Z-pre-8787b60c.dump`，596,957 bytes，权限 600。
- App rollback image：`hifly-pilot-app:rollback-80bdfd45-pre-8787b60c-20260818T162423Z`；Cloud rollback image：
  `hifly-pilot-cloud_executor:rollback-80bdfd45-pre-8787b60c-20260818T162423Z`。
- App image 为 `sha256:ee418c877e470e1f52dd2853cd10e2b3959f6d6c924abbf4248823a4c61b8d60`。
  Cloud 标准构建在 Playwright 浏览器安装阶段长时间无进展，未切换运行容器即安全取消；随后以旧已验证浏览器系统层、
  新 App image 的精确 `node_modules` 和目标提交源码构建 overlay image
  `sha256:a4139db0f6a6f0c76bcd454e030a414abf45235e41a7a994f8575d0e377a9779`。
  第一次 overlay 因旧依赖残留导致 `Minimatch` import error，被隔离测试拒绝；最终 image 先移除旧
  `/app/node_modules` 再复制新依赖，并在 `--network none` 下通过 import 与 112/112 隔离测试。
- 13 组 production migration 全部成功。只 recreate App，App healthy 后 restart Proxy；PostgreSQL 未重启。
  repo/App/Cloud 的 `production.js`、`hifly-page.js`、`cloud-executor-service.js` 与 `package-lock.json` 字节一致，
  loopback 与公网 `/healthz` 均为 ok。
- 部署前 SQL：eligible=0、active attempts=0、waiting orders=0、total attempts=16。Cloud Executor 保持 fail closed。

## 3. 新商品与激活前门禁

- Project：`cbd2399e-d1bc-4bc8-b295-bb0a9e15ce07`
- Product：`4643a721-065d-4f0b-8244-baf196222802`
- ProductRevision：`c8b78534-1e41-4f55-8a65-0c2060fa4ef8`，名称
  `SUNSCREEN-20260819-004 · 安热沙金瓶防晒霜（原生小档复验）`；商品图为既有
  `SUNSCREEN-20260818-001.png`，实物尺寸保持未知。
- CopyVersion：`cd969d4d-c3a4-4fb5-846f-65675a8bc065`，QC passed 且人工批准。
- 人物使用 Lin Xiaoman，AssetVersion `4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0`，每商品独立确认。
- VideoPlan v1 为 frozen/approved，`presentation_size_code=small`；制作说明要求保持修长金色瓶身、平滑斜切蓝盖、
  ANESSA 与 SPF50+ 标识，不得放大或扭曲。
- ProductionOrder：`c440c19e-671e-4b27-8c38-2d8535952268`。
- ready handoff：`73829028-442a-4d74-8ddb-379e839889b5`；manifest SHA-256
  `7f94962c9b637abf79f6a3aa3132a57b97c72fd68e5fc84b2c388ca383fc5ae2`，package SHA-256
  `a00ef6dd148b8f67617861e5ba2e4aa9d83ca98b21c864eef3681bc29dbdf836`。
- 激活前 Worker off；组织级 eligible 严格为该 order，order attempts=[]，active attempts=0。

## 4. Profile 锁恢复与唯一执行

- 第一次启动 Worker 后超过四分钟没有 Chromium process，也没有 claim 或 attempt。Profile 中三条
  `SingletonCookie`、`SingletonLock`、`SingletonSocket` 符号链接仍指向旧容器 hostname/PID。
- 立即停止 Worker并复核 order 仍 waiting、attempts=[]、active=0、eligible 仍只有当前 order。将三条精确链接移动到
  `/var/backups/hifly/cloud-profile-singletons-20260819T0054CST`，权限 700；未删除 Profile 其他内容。
- 第二次启动后 Chromium 立即出现并只领取当前 order；仍属于同一获授权单次执行。唯一 attempt：
  `5ebd4199-1f32-4d37-ac08-e73103d856dd`。
- 付费前弹窗完整六档集合可见。连续两次检查均只有“小”的图片框和文字为选中标记，“智能适配”未高亮；随后只点击一次
  `立即生成 150积分`。Hifly remote work ID：`713273`。

## 5. 技术闭环结果

- attempt succeeded；batch `cloud-5ebd4199-1f32-4d37-ac08-e73103d856dd` completed。
- Manual report：`d72adefa-69fe-43b8-8ecc-68bd61f464fa`，`outcome=completed`。
- Candidate：`7ba1e9f1-1758-4200-a07d-91a2d699ba02`，`primary_video`、`video/mp4`，
  69,782,276 bytes，SHA-256
  `537a43d19d6dbe173cbd45e3118c3f5ce417ad2c6958781729961e08c35c33dd`，verification passed。
- A12 job：`7c89e94e-a853-4c21-94e5-882d4e6bd10e`，succeeded / verification passed。
- Work：`08fdf795-734b-4d0e-a541-0b932d12b1fb`，available。
- 通过 Works 鉴权下载取得真实 MP4：69,782,276 bytes，SHA-256 与 candidate 完全一致；本机验收副本为
  `/Users/ketchup/Downloads/cloud-executor-output (2).mp4`。`ffprobe` 为 23.64 秒、1600×2848、25 fps、H.264 + AAC。
- 唯一 attempt、candidate、terminal report、A12 与 Work 均成立，#201 的 heartbeat/report conflict 未复现。

## 6. 内容验收

- 商品呈现大小：PASS。全片商品相对较小且位置/尺度稳定，与 Provider 原生“小”选档证据一致。
- 外观保真：FAIL。原图是修长金色瓶身与平滑斜切蓝色瓶盖；成片从头到尾把蓝盖生成成显眼的蓝色钻石/宝石形，
  核心包装几何失真。金色修长比例及 ANESSA/SPF50+ 标识大体保留，但不足以抵消瓶盖造型错误。
- 整体内容结论：FAIL / `rework_required`。技术成功、A12 passed 与 Work available 不等于内容批准或可交付。
- Work inspection：`30080e8d-4851-43b5-8913-e7e0d16500ea`，revision 2，category `visual_quality`，
  target `video_plan`。返工说明明确要求保持斜切蓝盖、金色修长比例及 ANESSA/SPF50+，并禁止自动重试。
  之前的 pending_review inspection 已 superseded；没有 Delivery 记录。

## 7. 安全收尾与边界

- order terminal 后立即停止 Worker。最终以 `CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`、`LOCAL_AGENT_ENABLED=false` 重建未启动的 Cloud 容器；容器状态为 Created。
- 最终 SQL：eligible=0、active attempts=0、waiting orders=0、total attempts=17。
- 没有自动重试、第二 claim、第二 order、Local Agent、Delivery 或额外积分动作。
- 本次只证明一条内部受控路径的尺寸选档与技术闭环；外观失败明确阻断交付。入口仍为 IP + 自签证书，正式域名、DNS、
  可信 TLS、严格 CA 与 HTTP→HTTPS 未完成；不构成公网生产、规模、并行或长期稳定性证明。
- 再次生成需要新的外观约束方案、独立批准、唯一新工单和新的单条积分授权；本记录不是重试授权。
