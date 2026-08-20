# 2026-08-20 Fidelity-C3 受控数据与人工真值准入

## 任务

- Issue：#222
- 固定基线：`origin/main@b46ec21f15e9cbdf784ec554d065c4b21ae54771`
- 工作范围：只读数据证据审计与 docs-only 准入合同
- 结论：`DATASET_BLOCKER` + `ANNOTATION_BLOCKER`；`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持不变

## 只读事实

1. exact main 已包含 Issue #220 / PR #221 的 Fidelity-C2 readiness blocker 审计。
2. 纠正 C2 的一个事实：Git 跟踪树不是“媒体为 0”，而是 `products/images/` 有 4 张 PNG source、4 个唯一 SHA-256。
3. 这 4 张图只有 source bytes；没有 candidate exact bytes、不可变 source/candidate 配对、benchmark use basis 或独立七维真值，
   因此不能进入 benchmark。
4. Fidelity-0 已记录 source/candidate checksum，但本轮准入审计只找到 source exact bytes；候选 bytes 未进入受控准入范围。
5. 旧 ignored `batches/**` 的 21 文件/3 hash 是 2026-08-20 对旧本地 checkout 的一次性只读观察，不随 Git 持久，当前分支
   无法仅靠仓库重放，也没有用途依据和标注，因此没有纳入。
6. 仓库中没有已分离的人工 annotator/reviewer、七维 annotation pack 或数据 acceptance 记录。

## 合同结果

新增 `docs/product/PRODUCT_APPEARANCE_CONTROLLED_DATASET_ACCEPTANCE.md`，定义：

- 仓库外只读 exact-byte 数据版本、脱敏 manifest、provenance 与 benchmark use basis；
- 多商品及 allowed variation / single-axis / ambiguous / combined 四类覆盖；
- 七维 `supported | unsupported | unknown` 人工真值、理由和 evidence reference；
- annotator 与 reviewer 必须不同，争议在准入前解决；
- Owner 所需输入及“数据 acceptance → 环境/harness → benchmark → capability acceptance”的严格顺序。

七个人工标注轴映射 D-036 的身份维度，但“明显伪影”只作为 benchmark 跨维风险轴；本轮没有修改运行 API schema。

## 验证

- Git source exact bytes：4 个普通 PNG、4 个唯一 SHA-256；media/dimensions 通过本地只读解析。
- `npm run check`：237 个 JavaScript 文件通过。
- `git diff --check`：通过。
- Markdown 相对链接：7 份 allowlist 文档无缺失相对链接。
- 陈旧措辞、敏感绝对路径、二进制产物与严格 7-doc allowlist：通过。
- GitHub fixed-head CI：完成后记录在 PR 元数据/结果评论；本 session 不在提交正文中自引用最终 head。

## 未执行边界

没有安装 PaddleOCR/OpenCV，没有编写或运行 benchmark harness，没有选择模型、规则或阈值。没有访问 Hifly/Provider、上传图片、
调用外部 API、启动 Worker/Local Agent、SSH、部署、读取或修改生产数据、创建/重试工单、生成候选或视频，也没有消耗积分。
二进制、绝对路径、凭据和模型缓存均未提交。

本 PR 合并只表示准入合同和当前 blocker 审计被接受，不表示数据已准入、benchmark 已开始或失败、能力已选择、Fidelity-C 已实现、
部署或 Provider 验收。
