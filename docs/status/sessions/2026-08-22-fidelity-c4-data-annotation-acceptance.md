# 2026-08-22 Fidelity-C4 数据与人工真值准入

## 任务边界

- 基线：`origin/main@f8d63e7c387a02c2b41f0695f71cb2e305529828`。
- 跟踪：Issue #224；对应 Draft PR 是仓库侧 acceptance gate。
- 本会话只读取仓库外受控包并更新 7 份文档，不提交图片、dataset bytes、annotation/review JSON 正文、真人身份、本机绝对路径、
  prototype 或 Provider 敏感信息。
- 未安装 PaddleOCR/OpenCV，未编写或运行 benchmark harness，未调用模型/API，未访问 Hifly/Provider，未启动
  Worker/Local Agent，未 SSH/部署、修改生产数据、创建工单/候选/视频或消耗积分。

## 受控 Evidence

受控存储只以 alias `HIFLY_APPEARANCE_BENCHMARK_V1` 标识。仓库侧复核了以下 artifact 元数据：

| Artifact | 相对路径 | Bytes | SHA-256 |
|---|---|---:|---|
| annotation | `annotations/ground-truth.v1.ANT-01.json` | 9355 | `bb7672120ada5a8204527950ad9bd3e9098461826959af87e193a5fe8635f4c5` |
| review | `reviews/ground-truth-review.v1.RV-01.json` | 13231 | `d3a315519a921f266ef84dcba85547c97deb18be883912aeebe8203affe1ea4d` |

- 数据集：4 个 exact source/candidate 配对，覆盖 4 个商品族和四类样本；manifest 持有 source/candidate SHA-256、media、
  dimensions、不可变绑定、provenance 与 benchmark use basis。
- 人工真值：`ANT-01` 完成 4 samples x 7 axes = 28 项；不同角色 `RV-01` 完成独立盲审，二者
  `model_output_was_hidden=true`。
- review 精确绑定 annotation SHA-256；`accepted_at=2026-08-22T08:59:15.866Z`，review accepted，
  0 changes requested、0 unresolved、0 cross-pack status mismatch。
- 保留：Owner 已批准 12 个月，到期日 2027-08-21，最迟 2027-07-22 复审且不自动续期；责任角色为 Hifly project Owner /
  dataset custodian，并有提前删除与到期删除规则。

## 本地验收

从受控 alias 根目录运行 validator，实际结果为：

```text
DATASET_INTEGRITY_PASS: 4 exact pairs / 4 categories / 4 product families
HUMAN_GROUND_TRUTH_PASS: 4 samples / 28 axes / distinct blind review / exact SHA-256 binding
DATASET_ACCEPTANCE_PASS
```

validator 已检查相对路径包含、普通文件/非 symlink、精确 bytes/SHA-256、schema/status/dataset/role/blind、必需维度、
review decision/note 与跨包状态绑定。`zsh -n`、`--integrity-only`、pack-copy identity 和敏感值扫描也通过。

负向证据：篡改 review 状态后 validator 以 exit 1 和 `EVIDENCE_SHA_MISMATCH` 拒绝；恢复旧 blocked manifest 后以 exit 2 和
`DATASET_ACCEPTANCE_BLOCKED` 停止。负向结果只证明 Evidence gate 失败关闭，不证明任何模型效果。

## 结论与下一步

Owner 已接受外部受控包，Issue #224 / 对应 PR 合并进入 `main` 后，仓库才把 Fidelity-C4 记为数据与独立人工真值 accepted。
这只解除 C2 的 `DATASET_BLOCKER` 与 `ANNOTATION_BLOCKER`，允许进入独立环境与 harness 设计/锁定 gate。

`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持。没有 benchmark 结果、逐维误放行/误阻断/unknown、延迟、资源或费用证据；没有
能力、policy/rule version 或阈值决定，也没有 Fidelity-C 实现、部署、Provider 或生产验收。

严格顺序为：环境与 harness gate → 另行授权的本地 benchmark → Reviewer Evidence 复核 → Owner capability/policy/阈值
acceptance → Fidelity-C 产品实现 gate。
