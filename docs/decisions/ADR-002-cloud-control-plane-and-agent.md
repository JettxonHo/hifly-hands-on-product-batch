# ADR-002: 云控制面 + 执行 Agent 架构（未来方向）

- **状态**：Accepted as future direction
- **日期**：2026-08-01
- **决策者**：项目 owner + 执行代理共识

## 背景

当前本地优先架构无法支持多人协作和远程管理。未来需要云端控制面来协调批次、用户和产物，同时保持 Playwright 在有持久化环境的节点上执行。

## 决策

未来架构方向为：

```
云端控制面
├── Web GUI（静态站 / SSR）
├── 用户、项目、批次 API
├── 数据库（批次状态、用户、审计）
├── 任务队列（拉取式）
└── 对象存储（视频产物、商品图）

本地或 VPS 执行 Agent
├── 持久化 Playwright profile
├── 拉取任务
├── 串行执行
├── 上报心跳和状态
└── 上传产物
```

## 约束

1. **Cloudflare Workers 不直接承载长时间 Playwright 执行**：Workers 有 CPU 时间限制（30s free / 5min paid），不足以运行 5-6 分钟的视频生成流程。
2. **Cloudflare 可承担的角色**：静态站托管、API 网关、KV/D1 元数据、R2 对象存储、队列触发。
3. **执行 Agent 必须有持久化文件系统**：Playwright profile、临时下载文件、批次状态。
4. **Wrangler 当前只是未提交探索**：工作区中的 `wrangler.jsonc` 和 wrangler devDependency 是早期探索残留，不纳入主线，不代表已决定使用 Cloudflare Workers 作为执行层。

## 触发正式 PoC 的前置条件

1. v0.3 小批量生产验证通过，确认 Playwright 路径稳定。
2. 出现多人协作需求或远程管理需求。
3. 定义 Agent 通信协议（任务格式、心跳、产物上传）。
4. 评估 VPS vs 本地 Agent 的成本和运维复杂度。
5. 确认对象存储方案（R2 / S3 / 本地 NAS）。

## 后果

- 当前不做任何云迁移代码提交。
- 架构设计文档先行，代码实施在 v1.0 milestone。
- Wrangler 探索代码保持在未提交状态或独立分支，不污染 main。
