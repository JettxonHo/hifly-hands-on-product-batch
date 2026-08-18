# 运营工作台 V2 内部部署与 UI 验收

## 基本信息

- 日期：2026-08-18
- 环境：阿里云 `8.163.60.0` 内部验收环境
- 部署 commit：`5c6384d523cc8b251a2def04f47e99b3cdbd142a`
- 执行边界：部署与浏览器验收由主控在 Owner 授权下完成；本 session 仅据实固化仓库文档
- 结论：部署成功，核心 V2 可用，带 #190/#191 两个 P1 条件通过

## 部署与回滚证据

- 部署前数据库备份：`/var/backups/hifly/hifly-20260818T004615Z.dump`。
- 管理员应急密码恢复前备份：`/var/backups/hifly/hifly-20260818T010850Z-pre-password-reset.dump`。
- 13 组 production migration 全部成功。
- 只 recreate App；App healthy 后 restart Proxy。PostgreSQL 未重启。
- 部署后 App、PostgreSQL、Proxy 均 healthy；公网 `/healthz` 返回 ok。
- Cloud Executor 保持 `exited / running=false / exit=0`；部署与验收结束时 `eligible=0`、
  `active_attempts=0`。

本轮没有访问 Hifly、没有启动 Worker、没有生成视频或消耗积分，也没有修改商品、文案、人物、方案、订单、
attempt、作品或交付等生产业务数据。

## 唯一管理员应急身份恢复

唯一管理员忘记密码且组织内没有第二管理员。主控没有读取或回显旧密码，而是按现有身份合同执行一次受控自重置：

1. 追加 `admin_reset` credential；
2. 设置 `requires_password_change=true`；
3. 撤销既有会话；
4. 成功写入 `identity.password_reset` 审计；
5. 用户完成首次改密并重新登录。

该过程修改了身份凭据、会话与审计数据，因此不能概括为“完全没有生产数据写入”；准确边界是未修改生产业务对象，
身份侧只发生上述受控恢复动作。任何密码值、Cookie 或会话凭据均未写入仓库文档。

## 真实管理员只读 UI 验收

### 入口与导航

- 根路径在登录后进入 `/projects.html`。
- 显式 `/index.html` 保留 legacy 本地/运维工作台，并提供“进入项目”入口。
- Projects、Project、Copy、Avatar、Plan、Production、Works、Assets、Members 九页的一级导航稳定为
  “项目 / 作品库 / 素材中心 / 成员管理”。未出现无真实组织级索引的“生产任务”死链。

### 业务状态与控件语义

- Project→Copy→Avatar→Plan 五阶段顺序和上下文保持连续。
- Copy 清楚区分 QC 与人工审核；QC passed 没有被写成人工批准。
- Plan 清楚区分 preflight 与人工批准；preflight passed/warning 没有被写成 Plan approved。
- Copy 与 Plan 的 Tab 实跑验证 `tablist / tab / tabpanel`、ARIA 关系及 roving tabindex。
- Works 的 delivered 终态唯一推荐主操作为“查看交付记录”。
- Assets 显示商品图片、人物图片、作品视频三种真实分类；`work_video` 在素材中心保持只读。
- 九页浏览器 console errors 均为空。

### 响应式证据

九页分别在以下真实 Chrome viewport 中检查：

```text
1440x900
768x900
390x844
```

三个视口均未出现页面级横向溢出。该证据证明当前内部验收环境的页面层级与核心操作可用，不是视觉像素基准、
客户验收、真实 Provider 验收或长时间运行证明。

## 条件通过的两个 P1

### #190 商品资料页素材类型混入

- 素材中心真值为商品图片、人物图片、作品视频三类。
- Project 的“商品图片”选择器却会列出 available 的 `work_video`。
- 源码根因已定位为 `web/project.js::loadAssets()` 只过滤 active Asset 与 available AssetVersion，未限制
  `kind=product_image`。
- 影响：运营人员可能把作品视频误当商品图片选择。
- 状态：Issue #190 OPEN；本 session 不实施修复。

### #191 Worker 离线后 Production 丢失终态 Work 真值

部署环境中的稳定服务端事实为：

```text
ProductionOrder ff5285cd-d2b7-4552-a276-cff18015fc67: succeeded
attempt 46d1f209-caf8-4998-8d5d-5e435b0b0f11: succeeded
Work 80958749-9f92-40e6-a30e-7c886b555ef6: available
latest inspection: pending
delivery records: 0
```

Worker 关闭后，Production 首屏却显示“等待生产门禁核对 / 生产门禁未通过”，没有推荐进入作品库检查；Works 同一
对象正确显示“待检查 / 完成作品检查”。根因是 `web/production.js::renderTaskSummary()` 的终态投影错误依赖
`cloudExecutor.current_order` 与所选 order 匹配。

- 影响：已完成生产并登记 Work 的工单被错误呈现为尚未获生产授权，混淆激活前门禁与终态作品处理。
- 状态：Issue #191 OPEN；本 session 不实施修复。
- 修复边界：必须恢复 terminal Work 真值，同时保留激活前 Worker off、唯一 eligible、order `attempts=[]`、
  active attempts=0、terminal 关 Worker、失败停批及不自动重试合同。

## 后续严格顺序

1. 先修 #190。它是 Project 商品图片选择器的窄类型过滤问题，验收必须覆盖 `product_image` 可见且
   `avatar_image/work_video` 不可见、不可选择。
2. #190 合并后再修 #191。它涉及 Production 终态投影，需独立浏览器 RED/GREEN 并防止弱化 fail-closed 门禁。
3. 两个 P1 处理后，再决定是否部署修复版本并重复对应真实 UI 验收。
4. 正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 仍按 release-readiness 独立 gate 执行。

## 证据边界与未执行动作

- 本轮 UI 验收是现有生产数据的只读页面检查；除受控管理员身份恢复外，没有生产写入。
- 未访问 Hifly、未启动 Cloud Executor 或 Local Agent、未 claim 工单、未新增 attempt、未生成视频、未消耗积分。
- 未验证自动批量队列、并发、长期稳定性、正式 SLA 或公网可信 TLS。
- 入口仍为 IP + 自签证书；不得宣称公网生产就绪。

## 仓库文档门禁

本 docs-only 收口严格限制为：

```text
docs/status/CURRENT.md
docs/ROADMAP.md
docs/status/sessions/2026-08-18-operator-workbench-v2-internal-deployment.md
```

固定 head 必须通过 `npm run check`、`git diff --check`、strict allowlist 和三组 CI 后，才能交给主控独立审阅。
