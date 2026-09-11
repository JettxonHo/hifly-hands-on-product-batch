# 当前目标：HIFLY FAST-MVP

> 状态：R0 PASS；R1 PARTIAL；R2 BLOCKED（清单未冻结）。真实付费测试未授权。
> Owner 决定：2026-09-07；[D-038](docs/product/DECISION_LOG.md#d-038-hifly-fast-mvp)。
> 唯一执行路线图：[docs/ROADMAP.md](docs/ROADMAP.md)。

通过工作台，用可执行的人物素材、商品图和直接输入的中文口播，完成飞影「手里有货」生成、结果获取、播放、下载和追踪。复用已有核心，优先正确性、减少持续人工介入、连续生产，再扩人物来源与高级治理。

当前授权 R0/R1 本地研发、零 Provider 测试、独立 Review、必要 Issue/Draft PR 和 R2 准备。新上传、付费模型/飞影生成、merge、部署、权限变更和重大架构选择没有自动授权。Owner 是唯一产品、预算和阶段决策者；代码审查不新增人工业务审批人。

2026-09-08 首次 30 分钟、0 积分校准已结束。Owner 随后确认具体设置/比例交付政策及第二次最多 30 分钟、0 积分校准；当前执行记录见 session，政策见 D-038。该有限访问授权不代表上传、生成或六条实验获批；普通离线研发继续在原范围内推进。

Owner 最新收口：先冻结 P1＋人物 A 的 Golden Path；预算准备最多两条完整视频，每条包含全部固有收费阶段，首次真实Run仍需独立授权。当前仅输入核对与零积分/零生成校准；P1具体素材、口播/时长、完整报价、hard cap和可靠提交回执未齐备前禁止生成。人物B/P3、三种来源及三组配对降为成功后的Repeatability/Experiment Matrix。R0–R6仍只维护在主Roadmap，原配对设计保留为后置材料，不成为第一条的Gate。

2026-09-11 Owner确认进入[REAL_USER_VALIDATION_PRECONDITION_GATE](docs/status/REAL_USER_VALIDATION_PRECONDITION.md)：先核对正式入口/部署、回执、防重、可执行费用上限和生产身份，再修必要缺口。完成本轮后停止；只有条件就绪才申请一次Owner受控Golden Path，之后才可另行进入非作者验证。Career Track B仅被动保存自然证据，不改变产品优先级或增加埋点。API只读Gate结论保留，不自动启用API或新Provider。

当前验收入口：[Golden Path Preflight Report](docs/experiments/GOLDEN_PATH_PREFLIGHT.md)。全部PASS后只申请一次独立、bounded的真实付费Golden Path授权；最多两条是预算准备范围，不是当前生成许可，也不是自动重试许可。

H0 为 Playwright+Computer Use 混合校准；不是正式 A/B，也不证明当前工作台已完整通过。Mock/测试不能替代真实成功。

旧 [RBV Goal](docs/status/archive/GOAL-rbv-readiness-before-fast-mvp-2026-09-07.md) 归档为历史，结论仍 BLOCKED_PRE_REAL_RUN，未被宣布完成。旧试验合同、失败记录和安全能力保留；本轮执行顺序以 Owner 最新 D-038 为准，不暗中继承旧预算或增加非作者人工审批门槛。
