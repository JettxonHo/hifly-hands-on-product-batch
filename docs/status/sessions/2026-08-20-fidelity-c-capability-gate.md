# 2026-08-20 Fidelity-C 自动检查能力门禁

> 基线：`origin/main@c4abb79271c5ede127b8e3d51b3d10632a5d7336`
> Issue：#216
> 分支：`codex/fidelity-c-model-evidence-gate`
> 状态：docs-only acceptance gate；代码实现已失败关闭

## 任务结论

主控授权先执行 Product/API/检查能力 gate。只读审计证明 Fidelity-B 已进入 `main`，但仓库没有已接受的自动外观检查能力：

- `src/appearance-fidelity/` 只有 capture service、repository、migration、短任务 worker 和 disabled Provider Adapter；
- `src/` 没有 AppearanceCheckRun/Result、AppearanceReview 或视觉检查 Adapter；
- `package.json` 没有视觉/OCR模型依赖，`sharp` 不能代表商品身份判断能力；
- D-036 明确把模型、阈值、误判率和费用留给 Fidelity-C 前独立能力 gate。

因此本轮触发 `BLOCKED_CHECK_CAPABILITY_UNSELECTED`：不写 fake checker、固定 passed、Check/Review API、数据库、UI 或 Worker。

## 已固化内容

- 新增 `docs/product/PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md`；
- 把七个身份维度、允许变化、逐维 supported/unsupported/unknown 与严格聚合保持为 D-036 真值；
- 定义候选能力类别和直接否决条件，但不选择供应商或模型；
- 要求真实 benchmark 包含允许变化、单维身份变化、歧义/遮挡和组合变化，并具有独立人工标签；
- 要求分别测量严重误放行、误阻断、unknown、逐维覆盖、延迟、费用、版本与数据治理；
- 不机械发明百分比阈值。候选报告提出阈值后，必须由 Owner 在独立 gate 接受；
- 区分 deterministic fixture 与真实 capability Evidence：fixture 只能验证软件合同；
- 固定后续顺序为 gate → shortlist/官方证据 → 受控 benchmark → Owner acceptance → 新 Fidelity-C 实现 Issue。

本轮没有新增 D-037。D-035/D-036 已经决定外观门禁与检查状态合同，本轮只执行其中明确的实现前 stop condition；尚未产生
新的 Owner 模型选择或难以逆转的技术决定。

## 验证

- `npm run check`：237 个 JavaScript 文件通过；
- `git diff --check`：通过；
- 六份文档 Markdown 相对链接：通过；
- D-036 唯一性：1；未创建 speculative D-037：0；
- active CURRENT/ROADMAP 已把 #214/#215 更新为 merged repository truth，并把 #216 标为实现前 capability gate；
- strict allowlist：六份文档；
- fixed head `6d447446a3633f77db613748e0f32c54e691c778` 的 GitHub CI run `32348275656` 三组均为 SUCCESS：
  identity-postgres 45s、Ubuntu 59s、Windows 1m36s。

## 明确未执行

- 没有修改 `src/`、`web/`、`test/`、API、数据库、migration、依赖或部署文件；
- 没有访问 Hifly/真实视觉 Provider，没有上传图片、调用模型、生成候选/视频或消耗积分；
- 没有启动 Worker/Local Agent、SSH、部署或修改生产数据；
- 没有开始 Fidelity-C/D/E 实现，也没有 mark Ready、merge 或关闭 Issue #216。
