# Issue #208 通用商品外观保真门禁设计与能力审计

> 日期：2026-08-19
> 原始基线：`origin/main@8787b60c82f928a1277467b95868ae47d011ec64`
> 修复基线：`origin/main@bffb90b1f6f94024a907ad66b2c4cf0170a2e593`（含 PR #207 真实复验记录）
> 分支：`codex/product-appearance-fidelity-gate`
> 状态：Owner-approved direction；设计合同 acceptance pending；实现 blocked

## 1. 任务边界

本轮把真实运行中“蓝色斜切瓶盖被生成成钻石”的问题提升为所有商品通用的外观保真门禁。没有为安热沙、
防晒霜、瓶盖颜色或单张商品图添加专用提示词、禁词、条件或代码。

本轮只做仓库、Product/API 与 Provider 已有证据的只读审计，创建 Issue #208，并固化设计/能力合同。没有访问飞影、
点击付费动作、启动 Worker/Local Agent、创建或重试生产工单、修改生产数据、生成视频、消耗积分、SSH 或部署。

## 2. 审计证据

### Provider 与 Playwright

- `src/hifly-page.js` 的 `createHandsOnImage()` 在 `clickModalGenerate()` 后等待候选出现，随后立即执行
  `confirmGeneratedHandsOnImage()`；确认候选发生在外层 `submitVideo()` 之前。
- `inspectVisibleGeneratedModalState()` 可读当前弹窗图片来源，并以候选图片与“再次生成 / 重新编辑 / 确认”等状态判断
  生成完成；该信息当前仅用于页面自动化与诊断，没有进入业务存储。
- `src/rpa/capture/har-extractor.js` 证明手持商品图完成响应会产出 `gen_id`，后续视频提交使用该引用；现有脱敏证据没有
  证明候选图片 bytes、长期 URL、跨会话复用、有效期或 Provider 保真评分。
- 2026-08-19 的真实复验已经随 PR #207 进入新基线：原生 `small` 与技术闭环 PASS，但源图平滑斜切蓝盖被持续
  生成成宝石形，Work=`rework_required`，没有交付、重试或第二工单。该事实只来自已完成复验，本轮没有执行新的
  Provider 动作。

### 领域与生产链

- ProductRevision 只有商品事实、素材引用和实物尺寸；VideoPlan 只有上游快照、方案说明与原生呈现大小。
- ProductRevision 可包含多个 `asset_version_ids`，当前执行编译路径选择第一个商品图片引用；没有显式冻结
  `source_asset_version_id`，也没有执行证据证明某个版本的 bytes/checksum 与实际 Provider 上传输入完全一致。
- Production snapshot 与 handoff 会冻结上述输入，但没有 AppearanceCandidate、AppearanceCheck 或 AppearanceDecision。
- Cloud Executor 当前一次 `run()` 内完成 Playwright 生产；没有在候选图处释放 lease、持久化候选并等待人工的安全状态。
- manual execution candidate 角色只有最终 `primary_video` 和报告的 `supporting_output`；A12/Work/Works 面向最终视频，
  不能承担视频前候选批准。

## 3. Gate 结论

页面存在候选观察窗口，但候选 bytes/reference、生命周期、安全暂停/恢复与计费口径未证明；产品/API 没有可审计
门禁，自动比较能力也未选择或验证。当前实现状态是 Provider/Product/API `DESIGN_BLOCKER`。

本轮不编写 RED→GREEN 代码，因为没有获接受的公共 seam、状态所有者和 Provider bytes/reference 合同。伪造一个前端状态、
只保存截图路径、仅追加提示词或让 Worker 长时间等待，都会越过已批准的生产安全边界。正确下一步是先让本合同通过独立
Review，再完成 Fidelity-0 Provider capability gate；只有 Fidelity-0 证明候选与恢复能力后，才能决定并严格串行推进
Fidelity-A～E。

Fidelity-0 还必须冻结显式 `source_asset_version_id`（或经独立设计接受的等价字段），并证明其 bytes/checksum 是
实际上传给 Provider 且用于自动比较的同一源图，不能依赖多图数组顺序或事后推断。手持候选生成本身可能收费；任何
真实 capability probe、候选生成或后续验收都必须在当次取得明确单条积分授权。失败关闭只阻止后续视频提交，不能
声称候选失败零积分。

## 4. 文档范围

- `docs/product/PRODUCT_APPEARANCE_FIDELITY_GATE.md`
- `docs/product/README.md`
- `docs/product/DECISION_LOG.md`
- `docs/product/HIFLY_CAPABILITY_EVIDENCE.md`
- `docs/status/CURRENT.md`
- `docs/ROADMAP.md`
- `docs/status/sessions/2026-08-19-product-appearance-fidelity-gate.md`

没有修改 HTML、CSS、JavaScript 生产代码、测试、API、数据库、migration、依赖、部署或 Provider 配置。

## 5. 验证与后续门禁

本分支需通过：

- `npm run check`；
- `git diff --check origin/main...HEAD`；
- 七文件 docs-only allowlist；
- fixed-head GitHub CI。

合同合并只表示设计边界进入 `main`。Fidelity-0 必须先证明候选 bytes/reference、生命周期、安全暂停/恢复、精确源图
上传对应关系与计费边界；在此之前 Fidelity-A 不得实现。任何真实 capability probe、候选生成与 Fidelity-E 验收均需
当次单条积分授权。若纯生成模式无法达到身份一致性，受控抠图合成或产品锁定作为后续独立 gate，不得在 Issue #208
内静默扩展 Provider 或架构。
