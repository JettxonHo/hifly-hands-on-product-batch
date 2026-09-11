# HIFLY_GOODS_IN_HAND_API_COVERAGE_REPORT

日期：2026-09-09。调查基线：`4d98078b6c923d6839c134b30d242b40570ed170`。本报告为本次 Developer API Coverage Gate 的结论；既有网页流程证据直接复用，不重复抓取或验证。

## Stage Result

**PARTIAL：只读调查已完成，Developer API Coverage Gate 未通过。**

- Holding capability：`REQUIRES_PROVIDER_CONFIRMATION`。
- Architecture Decision：**D — `PROVIDER_CONFIRMATION_REQUIRED`**。
- 本轮带鉴权的业务API请求、生成任务、人物/商品上传、Generate点击、积分消费均为0；未访问或修改线上Secret，未部署、合并、修改执行器或生产架构。
- 仅读取公开资料、已有仓库证据并保存报告。未向飞影商务或客服发送询问；未因本报告启动API Spike。

## Evidence Sources

| 来源 | 本轮使用方式及证明边界 |
| --- | --- |
| S1：[飞影官方 API V2](https://api.lingverse.co/hifly.html) | 本轮无凭据GET读取完整文档，检查目录、端点与输入合同。未找到人物图＋商品图生成手持图的正式能力；这不证明厂商绝不提供其他授权接口。Web检索工具打开超时后，普通HTTPS读取成功，没有绕过证书。 |
| S2：[官方API接入介绍](https://hifly.cc/intro/api.html) | 页面指向S1并提供商务接入入口，没有对手持合成或当前套餐作具体承诺。商务/帮助链接本轮重定向登录页，未登录、提交表单或联系他人。 |
| S3：[官方套餐页](https://hifly.cc/membership)及Owner此前提供的该页截图 | 本轮文本读取为空。复用截图中的一般API权益说明：尊享/钻石列API调用，企业另列图片数字人API；未明确写出两图手持合成。截图账号由Owner确认并非真实付费账号，不用其余额或权益判断本次准入。 |
| S4：[官方积分说明](https://lingverse.feishu.cn/wiki/KW8AwmBY0iP0UFk6cLNcQJJKnsc) | 本轮未能重新读取，使用2026-09-08已有核验记录，仅作网页/通用价格参考。没有已核验的当前Developer API专项报价或套餐适用声明。 |
| S5：[既有能力证据台账](HIFLY_CAPABILITY_EVIDENCE.md)、[Golden Path Preflight](../experiments/GOLDEN_PATH_PREFLIGHT.md) | 复用已确认的网页CMS调用链、人物A/P1元数据、账号不一致及既有API客户端范围。不重新证明网页是组合流程，不把旧调用或Mock升为当前API证明。 |

本轮S1原文快照位于原GUI目录Git忽略的`outputs/golden-path-preflight-20260908/developer-api-coverage/public-api-v2.html`及同名txt。未保存Secret、Cookie、网页登录Token或受保护的Provider响应。

## Web Native Workflow

沿用已有证据：

`Person Image + Product Image → Holding Image Generation → Goods Video Generation`

既有网页调用包括`one_stop/goods_in_hand/goods_holding_image_generation`和`one_stop/goods_in_hand/videos`。它们属于网页登录客户端的调用证据，**不是Developer API开放合同**；本轮没有再次请求这些业务端点。

## Public API Workflow

S1文档已覆盖的后半段：

`Existing Holding Image → avatar/create_by_image → avatar/task → avatar → video/create_by_tts → video/task → Final Video`

音频驱动可使用`video/create_by_audio`。以上为文档合同可组合，不是本轮执行成功；它以已经存在且可用的手持图为前提。

## Holding Image API Availability

**Q1：`REQUIRES_PROVIDER_CONFIRMATION`。**

完整公开V2文档未记载接收独立人物图、商品图并返回手持合成图的合同。单图创建数字人接口以及网感视频模板接口均未公开提供这对输入。网页端点存在、文档搜索无结果、访问超时，都不足以确认Developer Key一定可调用或明确不可调用。

目前缺少官方“开放给该套餐”的正面证据，也缺少“明确不开放”的官方答复，因此不选择`CONFIRMED_AVAILABLE`或`CONFIRMED_NOT_AVAILABLE`。

## Authentication

**Q2：通用V2鉴权已知；Holding接口的鉴权与套餐范围未知。**

| 项目 | 已确认或未知 |
| --- | --- |
| 已公开V2的API base | `https://hfw-api.hifly.cc/api/v2/hifly/`；文档托管域`api.lingverse.co`不是请求base。 |
| 已公开V2的鉴权 | `Authorization: Bearer <Developer API Token>`，S1指向个人中心API明细；没有读取该页面中的真实Token。 |
| Holding Developer endpoint/base | **UNKNOWN**；不得借用网页CMS地址当作已确认的Developer endpoint。 |
| Holding可用Token类型/权限范围 | **UNKNOWN**；不能推定开发者Token与网页Session Token、智能体Token可互换。 |
| 当前付费套餐包含Holding能力 | **UNKNOWN / 待官方确认**。 |

本轮没有读取真实Key或执行存在性检查。此前“线上App未配置Token”的存在性记录只描述当时部署，不证明付费账号没有Developer Key，也不证明该Key有Holding权限。

## Input Contract

**Q3：Holding输入合同尚不成立，以下字段均需正式文档。**

| 必须确认的字段 | Holding Developer API状态 |
| --- | --- |
| 人物图输入：URL、file_id、二进制或Asset引用 | UNKNOWN |
| 商品图输入方式及与人物图的配对绑定 | UNKNOWN |
| 格式、像素尺寸、文件大小限制 | UNKNOWN；网页教程/本地上传限制不能替代API合同。 |
| 商品大小、比例、构图控制及默认值 | UNKNOWN；网页goods_size不能直接当作Developer参数。 |
| 是否必须先上传Asset、Asset作用域与有效期 | UNKNOWN；S1通用上传能力不证明它可供Holding使用。 |
| Person A / P1合同兼容性 | **NOT_CONFIRMED**；只有本地素材就绪证据。 |

已有输入：Person A为PNG、1122×1402、1,666,036 bytes；P1为PNG、448×770、203,769 bytes。没有上传两图，不因它们满足现有工作台限制就判定API接受。

S1的下游单图数字人接口允许`image_url`或`file_id`；这不能替代尚未确认的双图输入协议。

## Output / Receipt Contract

**Q4：Holding Developer API输出与关联合同均为UNKNOWN。**

| 项目 | 状态 |
| --- | --- |
| 同步结果或异步任务 | UNKNOWN |
| 稳定task_id / gen_id / creation_id或其他标识 | UNKNOWN |
| 结果图片URL / Asset ID、有效期、访问权限 | UNKNOWN |
| 按精确任务标识查询状态 | UNKNOWN |
| Callback/webhook、签名和投递语义 | UNKNOWN |
| 错误schema、失败/超时/重复提交语义 | UNKNOWN |

S1公开后半段使用task_id，支持状态查询及结果回调；鉴权失败为HTTP 401，其他业务错误需检查响应code/message。这些规则**不能自动套到未确认的Holding接口**。

既有网页gen_id及通用埋点候选字段仅为网页侧线索。当前不能证明`Workspace Job → Hifly Holding Task → Holding Image`具有正式、稳定且可机器追踪的关联合同；不以列表第一项、时间、名称或本地随机标记替代。

## Downstream Composition

**Q5：后半段文档可组合；完整组合未成立。**

如果Holding接口正式返回可由同一授权域读取的图片URL/file_id，理论上可输入S1图片数字人接口，再取得avatar标识并进行文字驱动生成，最后按task_id查询视频。

但当前尚未确认Holding输出类型、文件访问权、跨接口Asset兼容性、是否需要额外转换，以及是否适用当前人物/商品。不能直接把网页gen_id填入Developer file_id/头像标识，也不能把文档可组合写成真实已通过。

## Cost Model

**Q6：当前Developer API价格与数值hard cap均为UNKNOWN。**

| 收费项 | Developer API确认结果 | 已有参考的适用边界 |
| --- | --- | --- |
| 一次手持商品图生成 | UNKNOWN；单位/失败扣费未知 | 网页曾观察到150积分，不作为API报价。 |
| 图片数字人，如需要 | 文档说明会收费；单价/计费次数UNKNOWN | 网页曾观察到350积分，未证明API适用。 |
| 文字驱动Talking Video | 文档说明会收费；当前API费率/单位/舍入UNKNOWN | S4此前读到文本10积分/秒，仅作参考。 |
| 音频驱动Talking Video | 文档有独立接口；当前API费率/单位/舍入UNKNOWN | S4此前读到音频9积分/秒，仅作参考。 |
| 上传、转换等其他必需收费项 | 是否存在及费用UNKNOWN | 不自行记为免费。 |

S4的手持商品数字人定制总价500积分与历史网页分项相符，不能重复叠加为500＋150＋350，更不能直接移作本轮API价格。文本驱动与音频驱动是两种输入路径；P1使用原中文口播，不擅自新增一次付费TTS调用。

一条P1视频的worst-case公式只能暂记为：

`C_P1,max = H_API,max + A_API,max（如必需）+ V_text_API,max（完整P1口播）+ E_API,max（其他必需收费）`

只有官方确认按秒计费及计费时长上界后，视频项才可代入`r_text,max × billable_units(D_max)`，其中舍入规则也须确认。当前各API费用和D_max均未知，**不能算出可信数值上限**；字数、估计语速、余额、历史613扣费/1000额度及“最多两条”数量约定都不是本轮API预算。

## Native Equivalence

**Q7：`NATIVE_EQUIVALENCE_NOT_PROVEN`。**

未找到官方明确声明Developer Holding API与网页手里有货使用相同模型、服务配置和质量路径。既有前端请求只能说明网页编排，不能观察服务端内部复用；图片URL或视频格式相同也不证明效果相同。未来功能可用与内容可交付须分别验证。

## Current Paid Account API Entitlement

**未确认。** Owner已说明付费账号与当前Chrome账号不同。当前真实付费套餐的确切名称、有效权益、Developer Key能力清单，以及是否包含两图Holding API，均没有可核验的权益页面或官方答复。

一般套餐“支持API调用”不能代替这项具体能力的授权证明。本轮未登录付费账号、未读取其Secret、未调用账户/权限探测接口，也没有用错误账号的余额或45秒限制计算费用。

## Full API Golden Path Feasibility

**完整API Golden Path在contract level尚未成立。**

缺失前段正式合同、当前账号权益、输出衔接与完整费用；不能用后半段文档支持填补这些缺口。当前没有足够证据启动P1＋Person A Official API Spike。

## Remaining Unknowns

1. Holding Developer API是否正式存在、对该付费套餐开放，以及准确base/endpoint/Token范围。
2. 两图输入、尺寸/比例控制、上传Asset要求和当前A/P1适用性。
3. 稳定任务/结果关联、查询/回调及错误/超时/防重语义。
4. Holding结果能否正式接入公开图片数字人/口播接口。
5. 各阶段当前API费用、完整口播的可核验计费上界，以及原生等价性声明。

## Architecture Decision

**D — `PROVIDER_CONFIRMATION_REQUIRED`。**

没有证据选A（完整开放）。也未证实Holding“只能网页完成”，不能选B；公开材料未记载不等于官方明确不提供，不能把本次结果升级为C。保留现有Playwright baseline/fallback，本轮不增强、不删除、不迁移，也不自建另一套图片生成系统。

## Minimum Next Gate

先由飞影提供正式文档或明确答复；以下询问尚未发送：

> 我们购买了支持API调用的套餐，希望通过API实现网页端“手里有货”。请确认是否向该套餐的Developer API Key提供“人物图片＋商品图片→手持商品人物图片”的正式接口；若提供，请给出接口文档、base URL、鉴权方式、双图格式/大小与商品尺寸控制、上传要求，以及稳定任务ID、结果图片、查询/回调和错误合同。若仅网页可用，也请明确说明。

另需官方回答两项：

1. 结果是否可直接用于公开图片数字人/数字人口播API，是否与网页原生使用相同模型/服务/质量路径？
2. 手持图、必要图片数字人、文本/音频视频各如何计费，失败是否扣费，能否在提交前确定完整报价和计费时长上界？

付费套餐名称/账号标识由Owner向官方提供；无需在本报告或聊天中提交Secret。拿到信息后重新评估Coverage Gate；即使转为FULL_API_PATH_CONFIRMED，也必须再取得Owner独立bounded授权才能进行真实Spike。

**现在是否已经有足够证据，值得暂停继续增强Playwright，并进入P1＋Person A Official API Spike？NO。**

最小理由：关键Holding能力对Developer Key的开放合同和当前套餐权益尚未确认。NO表示不能进入API Spike，**不是恢复Playwright增强的授权**；本轮仍按指令停止，等待Provider确认。
