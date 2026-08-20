# 2026-08-20 Fidelity-C1 capability shortlist

## 任务与基线

- Issue：#218 `Fidelity-C1: research an official-source appearance-check capability shortlist`
- 精确基线：`origin/main@0df2991ba5e0189837692265c37f3c05ae3b3472`
- 分支：`codex/fidelity-c1-capability-shortlist`
- 任务类型：只读官方资料研究与 docs-only 持久化
- 生命周期：本分支完成 proposal；只有其 Draft PR 经独立审阅并合并后，才计 shortlist 研究进入 `main`

## 完成内容

1. 复核 D-036 七维身份合同与 Issue #216 的 `BLOCKED_CHECK_CAPABILITY_UNSELECTED` stop condition。
2. 仅使用官方/一手公开资料比较：
   - PaddleOCR 3.7.0 / PP-OCRv6 + OpenCV 4.13.0 本地基线；
   - OpenAI GPT-5.4 固定 snapshot 与 Structured Outputs；
   - Google Vertex AI Gemini 图像、response schema、版本生命周期、数据治理、价格与错误边界；
   - 本地确定性事实与固定 schema 多模态结合的混合方案。
3. 证据分级后仅保留本地基线为当前可执行 benchmark 候选；OpenAI 固定 snapshot 因官方 Logo 输入要求保持
   reserve/blocked，Google 因版本锁定与迁移语义待复核保持 reserve，混合方案保持 deferred composition。
4. 将每项官方能力与 D-036 七维 Evidence 形成能力映射，同时把准确率、严重误放行、误阻断、unknown、延迟、并发和
   真实费用保持为 `UNVERIFIED`。
5. 给出不含虚构阈值的 benchmark 数据类别、必报指标、预算公式、费用授权和 stop conditions。

## 证据边界

- 核对日期为 2026-08-20；所有时效性事实均链接到官方仓库、官方产品文档或官方价格/数据政策。
- 本轮没有登录 Hifly 或供应商控制台，没有调用 Provider/API，没有上传 source/candidate bytes，没有运行 benchmark，
  没有启动 Worker/Local Agent，没有创建候选、检查、工单或视频，没有 SSH、部署、修改生产数据或产生费用。
- 供应商对语言、结构化输出或图像能力的公开说明只证明功能入口存在，不证明本项目七维检查效果。
- OpenAI Vision guide 明确要求输入图片不得含 watermark 或 logo，与 D-036 的真实包装 Logo 检查冲突；没有用真实上传或
  API probe 自行试探，只有官方书面澄清或另一条官方支持的 Logo 商品图路线才能解除 reserve/blocked。
- Google `GenerateContentResponse.modelVersion` 有直接官方来源；旧 Vertex lifecycle URL 本次已重定向，当前模型锁定、迁移
  语义与区域配置继续保持 `UNKNOWN`，没有据此提升候选。

## 文件范围

严格 allowlist：

1. `docs/product/PRODUCT_APPEARANCE_CHECK_CAPABILITY_SHORTLIST.md`
2. `docs/product/PRODUCT_APPEARANCE_CHECK_CAPABILITY_GATE.md`
3. `docs/product/README.md`
4. `docs/status/CURRENT.md`
5. `docs/ROADMAP.md`
6. `docs/status/sessions/2026-08-20-fidelity-c1-capability-shortlist.md`

## 验证

- `npm run check`：PASS，检查 237 个 JavaScript 文件。
- `git diff --check`：PASS。
- Markdown 相对链接：PASS，六文档范围内缺失链接为 0。
- 官方来源链接：共 23 条；2026-08-20 使用 `curl -L` 复核得到 19 条 HTTP 200、3 条 OpenCV 官方文档 HTTP 403、
  1 条 OpenCV 官方文档超时。新增 Google `GenerateContentResponse.modelVersion` 直接官方来源；旧 Vertex lifecycle URL
  重定向至 Gemini Enterprise Agent Platform，未把旧页面语义当作当前模型锁定证明。
- stale wording：PASS；没有把 shortlist、benchmark、模型选择、实现或部署写成同一事实。
- 严格 allowlist：提交前与 Draft PR fixed head 再核对。
- GitHub CI：以 Draft PR 的 fixed-head run 与结果评论为准；session 不在提交正文中自引用最终 head。

## 下一门

本轮合并后仍不能开始 Fidelity-C 实现。下一步至多是独立授权的本地 baseline 受控 benchmark：先冻结数据集、人工真值、
rule/policy version、预算和运行边界，再测逐维严重误放行、误阻断、unknown、失败、延迟与成本。OpenAI/Google 外部路线与
混合方案不具备当前执行资格。只有 Reviewer 复核 Evidence 且 Owner 接受 capability、版本和阈值后，才允许另开 Fidelity-C
实现 Issue。
