# 项目 Roadmap

> 最后更新：2026-08-13
> 当前状态：Vertical Slice A、CE-08 与 P0.4 已完成；release-readiness 代码已部署到内部验收环境，可信 TLS 仍是公网发布阻断；运营任务流方向 A 已获 Owner 批准，Issue #164 / PR #165 是精确 UX V1 合同进入 `designed` 的 acceptance gate

## 1. 已完成基线

- A01～A14 已完成企业登录、项目与商品、文案版本/QC/人工审核、人物选择、VideoPlan、ProductionOrder、交接包、执行报告、作品核验与交付。
- 阿里云 2C4G 内部试运行环境已部署。
- 历史单条真实工单曾通过 Mac Local Agent 完成闭环；该路径现仅为 legacy fallback，不再作为生产路径或当前验收依据。
- 官方 Hifly API Token 已完成只读积分连接验证；「手里有货」仍走 Playwright。
- Cloud Executor CE-01～CE-08 已实现并部署；disabled/fail-closed standby 的 heartbeat、持久目录、重启恢复、无 claim/无新增 attempt 已在阿里云实证。
- CE-08 新零-attempt 工单已完成 Cloud GUI → Hifly → 云端 artifact → A12 → Work → 鉴权下载；当前结论允许受控内部试运行，不等同于公网生产就绪。
- P0.4 已完成三个不同商品的严格串行 Cloud Executor 内部试运行：每轮仅暴露一个 eligible、零-attempt 工单，三条均一次成功并通过 A12、Work 和鉴权字节下载；Mac Local Agent 全程关闭。
- `main@5e449021` 已部署到阿里云内部验收环境；#156 深链修复完成部署后只读 UI 验证，#157 依赖治理的
  实际镜像审计为 `0 critical / 0 high / 2 moderate`。部署没有启动 Worker 或新增 attempt。

## 2. 当前升级顺序

```text
P0.1  云端飞影登录并证明 Profile 重启保留（已完成）
P0.2  激活单实例 Cloud Executor（playwright / concurrency=1）（已完成）
P0.3  CE-08 一条纯云端真实闭环：Cloud GUI → Hifly → A12 → Work → 鉴权下载（已完成）
P0.4  3 条严格串行、受控内部试运行（已完成）
P0.5  release-readiness：代码/依赖部署完成；正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 待执行（当前阶段）
UX V1 运营任务流优先：acceptance gate → designed → Slice A → Slice B → Slice C（方向已批准；代码尚未实现）
P1+   上述内部试运行、release-readiness 与获批 UX 切片完成后，再决定产品增强与规模化
```

Cloud Executor 的权威范围、门禁和完成标准见 `docs/product/CLOUD_EXECUTOR_P0.md`；三条严格串行内部试运行由 #132 跟踪，Issue 已关闭并已补充最终验收证据；release-readiness 由 #156、#157 跟踪。

## 3. 下一阶段

release-readiness 的 `works.html?work=<id>` 首选项修复与生产依赖治理已部署到内部验收环境；指定非首项 Work 的只读页面验证通过，实际镜像审计已无 critical/high。可信 CA 证书仍缺正式域名、DNS、签发和部署实证，当前 HTTP `/healthz` 也尚未跳转 HTTPS；必须按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 完成严格 CA 与 HTTP→HTTPS 验收后，才能评估公网发布。继续保持 Mac Local Agent 关闭、Cloud Executor 默认 disabled/fail-closed 与 concurrency=1；任何新增真实生成仍需新的授权和逐单门禁。

P0.4 的三条结果证明人工控制下的严格串行路径可重复完成，但不构成自动队列批量运行、更大规模、长时间稳定性、并行能力或公网生产 SLA 的证据。

Owner 已批准“运营任务流优先”作为页面升级方向；Issue #164 / PR #165 是
`docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md` 的 acceptance gate。合同只有随 PR 合并进入 `main` 才计为
`designed`；该状态不代表代码已实现、已部署或客户已验收。后续实施必须按以下顺序串行：

1. Slice A：Entry seam + shared opt-in UX foundation + Projects/Project；企业能力开启时 `/`、登录和会话恢复进入
   Projects，显式 `/index.html` 保留 legacy fallback；共享 CSS 不得意外改变未迁移页面。
2. Slice B：Copy/Avatar/Plan；清楚区分自动检查与人工批准。
3. Slice C：Production/Works/Assets；Production 必须按时序保持激活前 Worker off、唯一当前 eligible、当前 order
   零 attempt 与 active attempts=0；terminal 后立即关 Worker并保留 attempt；失败停批且无自动重试；成功经
   A12、Work 和真实字节下载后才准备下一条。Works 保留深链授权，Assets 不伪造 API 未提供的类型或关联。

每个切片独立 Issue、独立 Draft PR、独立浏览器回归；只有前一切片合并后才开始下一切片，且不自动部署。

## 4. 保留但不抢跑的工作

- 文案增强、人物推荐、背景/场景/姿势、动效精修、Capture HTTP、Local Agent 新功能、并行生产、复杂对象存储和高可用全部暂停。
- Local Agent 保留已验证代码但默认关闭，并从生产主路径/操作说明中退出；纯云端稳定至少 10 条或 1～2 周后再决定是否删除。
- 当前 2C4G/2C4G 级试运行服务器只证明内部功能闭环，不承诺正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁；复用既有成功产物的下载/A12/Work 复验不重新生成。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
