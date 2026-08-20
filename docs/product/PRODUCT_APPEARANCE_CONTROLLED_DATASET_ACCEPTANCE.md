# 商品外观受控数据与人工真值准入合同

> 状态：Fidelity-C3 proposal；随本文件所在 PR 合并进入 `main` 后，仅表示准入合同与当前 blocker 审计被接受
> 关联：D-035、D-036、Issue #216、Issue #218、Issue #220、Issue #222
> 当前结论：`DATASET_BLOCKER` + `ANNOTATION_BLOCKER`
> 能力状态：`BLOCKED_CHECK_CAPABILITY_UNSELECTED`

## 1. 目的与证据边界

本合同定义本地商品外观 benchmark 开始前，仓库外 exact-byte 数据与独立七维人工真值必须满足的最低准入条件。它不选择
模型、规则、阈值或样本数量，不实现或运行 benchmark，也不把“文件存在”解释为有合法用途、可复现绑定或已完成标注。

新的 benchmark 数据二进制、原始商品名称和敏感来源信息保留在 Owner 批准的仓库外受控目录；Git 只新增脱敏 manifest、
合同和 acceptance 结果。仓库既有 4 张历史源图继续作为旧产品输入存在，但不因此自动成为 benchmark 数据。Provider URL、
Cookie、Token、Profile 路径、对象键和本机绝对路径不得进入 manifest、日志或公共结果。

## 2. 当前只读审计

| 来源 | 可复核事实 | 准入结论 |
|---|---|---|
| Git 跟踪树 | `products/images/` 有 4 张 PNG 源图，分别为 187061、785957、32172、29755 bytes，尺寸为 714x920 或 900x1200，并有 4 个唯一 SHA-256 | 只有 source；缺少 candidate exact bytes、不可变配对、benchmark use basis 与人工真值，不准入 |
| Fidelity-0 | 文档记录一组防晒霜 source/candidate checksum；本轮只读核对仍可读到 source exact bytes，未在准入范围找到 candidate exact bytes | 单一 SKU、配对不完整且用途依据未批准，不准入 |
| 旧 ignored `batches/**` | 2026-08-20 曾一次性观察到 21 个图片文件、3 个唯一 SHA-256 | 不随 Git 持久，当前分支不可重放，也没有用途依据、配对和标注，不准入 |
| 测试 fixture、截图与视频 | 可证明软件、流程或最终内容的局部事实 | 不能替代 source/candidate exact-byte 配对和七维人工真值 |

Git 跟踪源图的 exact SHA-256 为：

| 仓库相对路径 | SHA-256 |
|---|---|
| `products/images/IPAD-CUSTOM-SCRIPT-001.png` | `84d11e62378b113a454946cf0abf54f43852757fcc0c363b664cbac71bf9e550` |
| `products/images/SKU001.png` | `1e35381534f85a660e26653c02ace32f2a634a2c03be69617cdcc0bf81fd9bb7` |
| `products/images/SKU002.png` | `2c985c1f7367ad44a1ff116a82b39ba6d389f8d994534b6cea144fbbd7d5d0e4` |
| `products/images/SKU003.png` | `8a22325143c8ac2cdc8323bf0e9c8b73cf256f80e27836faf00800d908e055d8` |

这些 hash 只证明当前 Git bytes。历史提交或 CSV 中出现文件与商品名称，不等于来源、所有权或 benchmark 使用授权。

## 3. 仓库外数据集合同

每个受控数据集必须版本化、只读封存，并通过脱敏 manifest 记录：

- `schema_version`、`dataset_id`、`dataset_version`、`created_at`；
- 不暴露绝对路径的受控存储 alias、保留/删除/脱敏策略；
- provenance、来源责任方、取得方式和可用于本 benchmark 的 use basis；
- use basis 的批准人、批准时间和可复核 evidence reference；
- 每个样本的稳定 `sample_id`、匿名 `product_family_ref` 和样本类别；
- source 与 candidate 各自的受控相对引用、SHA-256、byte size、magic-byte 核验后的 media type、宽高；
- source 与 candidate 的不可变配对依据，以及生成或受控构造关系；
- 准入状态、阻断 reason 与复核记录。

样本类别至少覆盖：`allowed_variation`、`single_axis_change`、`ambiguous`、`combined_change`。必须包含多个商品；单一防晒霜
只能作为回归样本。此处只定义语义覆盖，不发明样本数量、准确率或通过阈值。

准入程序必须重新读取 exact bytes，拒绝缺失文件、符号链接逃逸、路径穿越、magic bytes 与 media 不符、尺寸读取失败、hash
漂移或 source/candidate 绑定不完整。数据版本一旦进入 acceptance 不得原地替换 bytes；任何变化形成新版本并重新复核。

## 4. 独立七维人工真值合同

每个样本必须由人工逐项标注，且每项只允许 `supported | unsupported | unknown`：

1. 瓶型/轮廓；非瓶类商品解释为商品形态与轮廓；
2. 盖体/泵头；非瓶类商品解释为关键部件、连接和开启结构；
3. 标签、Logo 与文字；
4. 颜色与材质；
5. 局部结构与装饰；
6. 比例与尺寸感，只判断商品内部比例；画面相对大小仍属于允许变化；
7. 明显伪影。

人工标注轴与 D-036 运行维度的映射为：

| 人工标注轴 | D-036 对应维度 |
|---|---|
| 瓶型/轮廓 | 轮廓与几何结构 |
| 盖体/泵头 | 部件数量与连接关系；包装形态和开启结构 |
| 标签、Logo 与文字 | Logo；标签文字 |
| 颜色与材质 | 主体与关键部件颜色；材质只作为解释证据，不新增运行维度 |
| 局部结构与装饰 | 轮廓与几何、部件、包装中实际受影响的维度 |
| 比例与尺寸感 | 长宽、部件与包装的相对比例 |
| 明显伪影 | 跨维风险轴；映射到实际受影响的 D-036 维度，无法归属时保留人工 `unknown` |

该映射不静默改变 D-036 的七个运行 API 维度。“明显伪影”只用于 benchmark 的跨维风险审阅，不形成第八个运行结果。
未来若要改变运行维度或聚合规则，必须另过 Product/API gate。

每项标注还必须记录 reason code、自然语言理由、可复核 evidence reference、可见性/遮挡上下文、annotation version 和时间。
姿势、视角、画面相对大小、光照与合理遮挡仍是允许变化；`presentation_size_code` 不等于外观保真结论。

标注者与复核者必须是不同的人：记录匿名 `annotator_id`、`reviewer_id`、复核结论与时间。复核可以 accepted 或
changes_requested；争议解决前样本不得准入。两者均不得看到待测模型输出后再倒推真值，Agent 或模型输出不能冒充人工标注。

## 5. 当前验收表

| 门禁 | 当前状态 | 证据 |
|---|---|---|
| 多商品 source/candidate exact-byte 配对 | 未通过 | 只有 4 张 Git source 和 1 张本地 Fidelity-0 source 可观察；候选配对未准入 |
| provenance 与 benchmark use basis | 未通过 | 没有逐对批准记录 |
| 四类样本覆盖 | 未通过 | 没有受控 manifest |
| 七维逐样本人工真值 | 未通过 | 没有 annotation pack |
| annotator/reviewer 分离 | 未通过 | 没有角色指派或复核记录 |
| 数据封存、保留和删除策略 | 未通过 | 没有批准的受控数据目录与策略 |

因此 Issue #222 只能收敛准入合同与 Owner 输入，不得锁模型环境、写 harness、运行 benchmark 或形成能力结论。

## 6. Owner 输入清单

解除 blocker 需要 Owner 或被授权的数据责任方提供并批准：

1. 仓库外受控数据根目录及其访问、保留、删除和脱敏规则；
2. 多商品 source/candidate exact-byte 配对，覆盖四类样本；
3. 每对样本的 provenance 和明确 benchmark use basis；
4. 匿名 sample/product-family 标识规则及可提交的脱敏 manifest；
5. 一名人工标注者和另一名独立复核者；
6. 完成的七维 annotation pack、争议处理与最终 acceptance 记录。

任何外部采集、许可确认、Provider 下载、图片上传或付费动作都不包含在本门禁授权内，必须另行获批。

## 7. 严格后续顺序

```text
Issue #222 合同与 blocker 审计进入 main
→ Owner 提供受控 bytes、用途依据、manifest 与独立人工角色
→ 独立数据/标注 acceptance
→ 锁定本地环境与可复现 harness
→ 运行本地 benchmark 并原样报告逐样本/逐维结果
→ Reviewer 复核 Evidence
→ Owner 决定 capability、policy/rule version 与阈值
→ 才可另开 Fidelity-C 产品实现 Issue
```

本文件合并不等于数据已准入、benchmark 已开始或失败、能力已选择、Fidelity-C 已实现、部署或 Provider 验收。
