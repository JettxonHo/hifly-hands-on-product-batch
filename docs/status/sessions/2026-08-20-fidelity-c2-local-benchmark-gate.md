# 2026-08-20 Fidelity-C2 本地 Benchmark 数据门禁

## 任务与基线

- Issue：#220 `Fidelity-C2: gate local appearance benchmark on traceable data`
- 精确基线：`origin/main@8c9930f430738c381a6ed6cc67fd06a02c4f8391`
- 分支：`codex/fidelity-c2-local-benchmark-gate`
- 类型：read-only truth audit + docs-only blocker 持久化
- 生命周期：本分支只形成 gate proposal；合并后仅表示 blocker 审计进入 `main`

## 只读审计

1. `git ls-tree -r -l origin/main` 未发现 Git 跟踪的 PNG/JPEG/WebP/GIF/BMP/TIFF/MP4 样本。
2. 仓库没有 benchmark dataset、annotation manifest 或逐样本七维人工真值。
3. Fidelity-0 文档记录一组防晒霜 source/candidate checksum；本轮只读复核源图 exact bytes 与记录一致，但受控候选 bytes
   当前不存在。该单一 SKU 即使恢复候选 bytes，也不能覆盖多个商品、四类样本与 D-036 七维。
4. 2026-08-20 对旧本地 checkout 的 repo-relative ignored `batches/**` 范围做了一次性只读观察：按大小写不敏感的
   `.png`、`.jpg`、`.jpeg` 扩展名枚举普通文件并对 bytes 计算 SHA-256，得到 21 个图片文件、3 个唯一 SHA-256、
   0 个 annotation sidecar。ignored 二进制不随 Git 持久，未来不能仅凭本分支复现该数字；它也没有持久使用依据、
   source↔candidate 绑定或七维标签，因此没有纳入数据集，也没有复制或提交。
5. 现有 Fidelity-B test 使用 1×1 PNG/GIF fixture，只证明软件合同。
6. 当前 `/usr/bin/python3` 无 `cv2`、`paddleocr` 或 `paddle`；仓库 package/lock 也未锁定这些能力。数据 gate 已先阻断，
   因此没有安装依赖或下载权重。

## 结论

- `DATASET_BLOCKER`：没有合法/用途可证明、可追溯、覆盖多个商品与四类风险样本的 exact source/candidate 数据集。
- `ANNOTATION_BLOCKER`：没有独立逐样本、逐维 `supported | unsupported | unknown`、理由和 evidence reference。
- `BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持不变。
- 没有实现或运行 benchmark，没有生成准确率、错误率、unknown、P50/P95、CPU/内存或成本数字。

## 文件范围

严格 allowlist：

1. `docs/product/PRODUCT_APPEARANCE_CHECK_LOCAL_BENCHMARK_GATE.md`
2. `docs/product/README.md`
3. `docs/status/CURRENT.md`
4. `docs/ROADMAP.md`
5. `docs/status/sessions/2026-08-20-fidelity-c2-local-benchmark-gate.md`

## 验证

- `npm run check`：PASS，检查 237 个 JavaScript 文件。
- `git diff --check`：PASS。
- Markdown 相对链接：PASS，缺失链接为 0。
- stale/sensitive wording：PASS；没有写入临时绝对路径、凭据或已完成 benchmark/能力选择声明。
- 严格 allowlist：PASS，仅 5 份 docs。
- focused benchmark test 与 benchmark reproducibility：NOT APPLICABLE；数据与标注 gate 已在 harness 之前阻断，本轮没有
  benchmark 代码或运行结果可验证。fixed-head CI 只验证仓库文档合同，不证明真实 benchmark。
- GitHub CI：以 Draft PR fixed-head checks 与结果评论为准；session 不在提交正文中自引用最终 commit。

## 未执行边界

没有访问 Hifly、生产系统、外部模型/API 或控制台，没有上传图片、网络推理、付费、SSH、部署、Worker/Local Agent、
生产数据、工单、候选或视频动作。没有开始 Fidelity-C Run/Result/Review、Fidelity-D/E，也没有把 blocker 写成能力失败或
benchmark 结论。
