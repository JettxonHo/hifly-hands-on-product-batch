# 商品外观检查本地 Benchmark 数据门禁

> 状态：Fidelity-C2 gate proposal；随本文件所在 PR 合并进入 `main` 后，仅表示 readiness 审计被接受
> 关联：D-035、D-036、Issue #216、Issue #218、Issue #220
> 结论：`DATASET_BLOCKER` + `ANNOTATION_BLOCKER`
> 能力状态：`BLOCKED_CHECK_CAPABILITY_UNSELECTED`

## 1. 本轮问题

本轮只回答：仓库和当前本地环境是否已有一组合法、可追溯、可复现的数据，足以运行 PaddleOCR 3.7.0 / PP-OCRv6 +
OpenCV 4.13.0 的七维商品身份 benchmark。

本轮不回答本地基线是否准确，不选择 capability、policy/rule version 或阈值，也不实现 Fidelity-C 的
AppearanceCheckRun/Result、AppearanceReview 或 UI。

## 2. 只读盘点

| 来源 | 可观察事实 | 本轮准入结论 |
|---|---|---|
| Git 跟踪树 | 图片与视频样本为 0；无 benchmark dataset 或七维 annotation manifest | 不具备输入 |
| Fidelity-0 Evidence | 有一组防晒霜源图与候选 checksum 记录；源图为 419685 bytes、PNG 656x952、SHA-256 `e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5`；候选记录为 275745 bytes、JPEG、SHA-256 `1778a04198280c4cf2d08f78ba544085da44611d76f69b0653004bffe483244b` | 当前只找到源图 exact bytes，未找到受控候选 bytes；单一 SKU 也不满足覆盖合同 |
| 本地忽略的历史批次上传 | 2026-08-20 对旧本地 checkout 的一次性只读观察：21 个图片文件、3 个唯一 SHA-256、格式为 PNG/JPEG；无 annotation sidecar | 缺少 benchmark 使用授权/来源说明、source↔candidate 绑定与七维真值，不准入；不是随 Git 持久的可复现数据资产 |
| 页面截图与历史视频 | 可用于证明 UI/流程或最终内容事实 | 不是 exact 候选图片 bytes，不能替代 source/candidate 配对或七维标注 |
| 现有 Fidelity-B 测试 | 使用 1×1 PNG/GIF fixture 验证 bytes、checksum、事务、组织隔离和 API 合同 | 只能证明软件合同，不能证明视觉能力 |
| 当前本地 Python 环境 | `cv2`、`paddleocr`、`paddle` 均未安装；仓库 package/lock 也未锁定这些依赖 | 环境尚未冻结，但数据门禁未通过前不安装、不实现 harness |

本表不把本地存在等同于合法 benchmark 使用。没有持久的来源、用途许可或 Owner 指定用途时，历史业务素材只记录为
“发现但未准入”，不得复制、提交或运行。

上述 `21/3` 仅来自 2026-08-20 对旧本地 checkout 中 repo-relative ignored `batches/**` 范围的一次性审计：按大小写不敏感的
`.png`、`.jpg`、`.jpeg` 扩展名枚举普通文件，统计文件数并对文件 bytes 计算 SHA-256 后去重。ignored 二进制没有随分支或 Git
持久，未来仅凭本仓库不能重放该观察；该数字不能作为 benchmark 输入的可复现性、用途许可或数据资产证明。

## 3. 阻断结论

### 3.1 `DATASET_BLOCKER`

当前没有一组同时满足以下条件的数据：

- exact source/candidate bytes 均可读，媒体类型、大小与 SHA-256 可复核；
- 每对样本有稳定 sample ID 与不可变 source↔candidate 关系；
- 有明确来源、用途许可、保留与删除边界；
- 覆盖多个商品，而不是只有单一防晒霜；
- 覆盖允许变化、单维身份变化、歧义和组合变化；
- 七个 D-036 维度均有可判定与不可判定场景。

### 3.2 `ANNOTATION_BLOCKER`

当前没有独立于 benchmark 实现的人工真值：

- 每个样本、每个维度的 `supported | unsupported | unknown`；
- 对应理由和可复核 evidence reference；
- 允许变化与身份变化的判定依据；
- 标注版本、标注者角色、复核状态与争议处理记录。

没有这些真值，无法计算逐维严重误放行、合法变化误阻断或 unknown，也无法证明聚合规则是否正确。

### 3.3 次级环境前置条件

PaddleOCR/OpenCV 尚未安装或锁定，但这不是先写 harness 的理由。只有数据与标注包通过独立审阅后，才可单独锁定：

- PaddleOCR、PaddlePaddle、PP-OCRv6 权重与 checksum；
- OpenCV 版本与构建信息；
- Python、操作系统、CPU/内存与线程配置；
- policy/rule version、预处理参数、随机种子与离线缓存边界。

## 4. 最小解阻包

下一次 gate 至少需要一个仓库外受控数据目录和一个可提交的脱敏 manifest/annotation 文档。二进制仍不得进入 Git。

manifest 最少记录：

- dataset/version、sample ID、商品族与样本类别；
- source/candidate 的媒体类型、大小、SHA-256 与受控相对引用；
- 来源、使用依据、保留/删除边界；
- source↔candidate 的生成或构造关系；
- 七维人工标签、理由、evidence reference、标注版本和复核状态。

覆盖门禁只规定语义覆盖，不在此发明样本数或通过线。数据包必须证明：多个商品、四类样本、D-036 七维均被覆盖；
具体样本数量、错误率阈值与能力 acceptance 仍由后续独立决策确定。

## 5. 后续顺序

```text
Issue #220 数据/标注 blocker 进入 main
→ Owner 提供或批准仓库外受控数据与使用依据
→ 独立数据/标注 acceptance gate
→ 锁定本地运行环境与 benchmark harness
→ 运行真实本地 benchmark 并原样报告逐样本/逐维结果
→ Reviewer 复核 Evidence
→ Owner 决定 capability、policy/rule version 与阈值
→ 才可另开 Fidelity-C 产品实现 Issue
```

任一阶段都不能用总相似度、fixture 绿测、单张截图或单一 SKU 代替七维 Evidence。

## 6. 本轮边界

本轮没有安装 PaddleOCR/OpenCV、没有编写或运行 benchmark harness、没有计算准确率/延迟/成本、没有选择阈值或能力。
没有访问 Hifly、生产系统或外部模型/API，没有上传图片、启动 Worker/Local Agent、创建工单/候选/视频、修改生产数据、
SSH、部署或产生费用。真实二进制、凭据、缓存、绝对路径和敏感结果均未提交 Git。
