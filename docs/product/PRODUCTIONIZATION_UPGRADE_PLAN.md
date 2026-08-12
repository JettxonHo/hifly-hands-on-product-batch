# 生产化核心能力升级计划

> 2026-08-12 架构纠偏：本计划的 P1/P2 已交付；原 P3/P5 中以 Local Agent 作为生产主路径的安排已由 D-034 与 `CLOUD_EXECUTOR_P0.md` 取代。Local Agent 保留为兼容路径，不再是当前 P0 验收路径。声音/场景等扩展继续延后。

> 状态：Accepted
> Owner：JettxonHo
> 日期：2026-08-12
> Decision：D-033

## 1. 目的

Vertical Slice A 已完成企业内容生产的业务闭环，单条真实 Local Agent / 飞影「手里有货」链路也已跑通。下一阶段不再补空页面，而是把仍为受控替身、单条证明或 Pending Evidence 的能力依次升级为可长期运营的小批量生产能力。

## 2. 不变边界

- 保留 Playwright 作为「手里有货」已验证生产执行器；官方 API 未开放该能力前不强行改成 API。
- Cloud Web 仍是权威业务控制面，Local Agent 只领取已批准工单，不在本地重建业务状态。
- `QC passed` 不等于人工 `approved`；模型输出只创建草稿，不能直接进入 VideoPlan。
- 人物推荐只提供建议和理由，最终人物选择必须由运营明确确认。
- 背景、场景、姿势、构图只公开 Evidence 已确认的参数；飞影自动决定的部分不伪装成系统可控。
- 真实 Hifly 生成、付费模型 smoke 与云资源部署分别执行门禁和记录成本。

## 3. 交付顺序

### P0：事实重基线

更新 Goal、Roadmap、CURRENT 和 Hifly Evidence，使“已实证单条闭环”与“未完成生产能力”清晰分开。

### P1：真实 DeepSeek 文案与语义质检

1. 建立 Provider-neutral LLM Adapter 与 DeepSeek 官方实现。
2. 使用服务端 Secret，默认模型 `deepseek-v4-flash`，显式 `thinking.type=disabled`，JSON Output。
3. 文案生成只发送已确认文字事实与规范化 ContentBrief，不发送图片、URL、路径或飞影凭据。
4. 输出结构失败最多一次同模型受控重试；无自动模型/Provider fallback。
5. 将真实生成、语义 QC 和改写分别接入既有 AsyncJob/CopyVersion/QualityRun 合同。
6. 先用 fake transport 完成 TDD 和 CI；真实模型 smoke 单独记录费用、输入边界和结果。

### P2：人物目录与品类选择

1. 先验证飞影公共/自有人物列表的账号权限、分页、稳定 ID 和预览字段。
2. 建立同步 Adapter 与内部 AvatarAsset 映射，不把 Provider ID 暴露给普通运营界面。
3. 支持运营上传/停用企业人物素材，以及本地执行器所需的私有映射。
4. 基于商品品类与人物标签给出可解释推荐；无匹配时回退通用人物池，不静默确认。

### P3：小批量生产验收

1. 以“一商品一 ProductionOrder”为单位串行调度，不并发抢占同一飞影 Profile。
2. 使用至少 3 个不同商品和 2 个人物，验证领取、执行、下载、回传、核验与 Work 登记。
3. 验证首失败即停、可恢复项续跑、幂等提交、租约恢复和不重复扣分。
4. 每次真实生成仍逐条满足运行门禁，并从 standing authorization 额度中记账。

### P4：声音与场景控制 Evidence

按声音目录/选择、手里有货背景来源、场景、姿势、构图顺序验证。支持的能力进入 VideoPlan/交接包/执行映射；不支持的能力只展示限制和运营素材建议。不得通过 DOM 猜测或未经验证的私有接口承诺能力。

### P5：常驻 Local Agent

提供 macOS 和 Windows 的安装、启动、停止、升级、日志诊断与卸载路径；保持默认 standby、真实执行双门禁、凭据本机保存和服务器租约语义。先完成 macOS 生产安装包，再补 Windows 验收。

### P6：生产基础设施

将媒体从应用本地盘迁移到对象存储，将试运行 PostgreSQL 升级到托管实例，配置可信域名/证书、结构化日志、监控告警、数据库备份与恢复演练。实际云资源规格由真实负载和预算 Evidence 决定。

## 4. Issue 与 PR 规则

- 每个波次先建立可验收 Issue；涉及共享状态机或 migration 的任务必须串行。
- 每个实现 PR 必须包含正常路径、失败路径、权限/Organization 隔离、幂等/并发中与本功能直接相关的测试。
- 实现者不得审批或合并自己的 PR；CI 通过和独立 Review 后再合并。
- 真实外部验证记录进入 `docs/status/sessions/`，当前结论同步到 `docs/status/CURRENT.md`。

## 5. 当前第一项

P1 的首个 Issue 只实现 Provider Adapter、配置和受控 fake transport 测试，不触发真实 DeepSeek 请求。真实 smoke 在适配器合并部署后单独执行。
