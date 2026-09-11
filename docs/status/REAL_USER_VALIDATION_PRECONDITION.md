# HIFLY_REAL_USER_VALIDATION_PRECONDITION_REPORT

Owner确认日期：2026-09-11。当前阶段：`REAL_USER_VALIDATION_PRECONDITION_GATE`。本文件同时记录本轮修订后的执行合同与A–M验收结果，CURRENT引用此处，不新增Roadmap。

## 本轮执行合同（按Owner确认修订）

1. 目标仍为P1＋人物A从正式工作台完成一条受控Golden Path；先补前置条件，随后单独申请一次Owner控制的真实任务，成功后才讨论非作者验证。本轮不运行真实用户测试或付费生成。
2. 核对实际repo/branch/HEAD、remote main、PR/Issue、未提交变更、正式入口与部署/runtime身份；Resume材料是待复核线索，不作为已验证事实。保留已有API Coverage结论，不重开无新证据的调查，不新建Official API Executor；围绕现有Web Golden Path候选处理必要缺口。
3. 只允许正式入口、Provider回执/归属、防重、费用上限、生产身份的必要修复。复用既有资产、Order/Attempt、Report/Work和执行核心；不扩UI设计、通用Provider层、Agent/RAG或测试平台。
4. Owner cap是消费授权，不自动构成技术保证。精确价格可未知，但保守上界必须有可核验依据并能在付费前执行；无法证明费用不超限时COST_BOUND仍BLOCKED。未知费用不填0、不用历史额度；付费重试/自动重放/换路默认0。
5. 内部防重与Provider幂等分别验证；未确认Provider支持就不宣称exactly-once。提交后受理不明持久停止，不自动重提。授权前冻结内部任务/输入/执行范围；Provider ID只能来自真实回执，不要求提前产生，也不以内部ID冒充。
6. 生成前由操作者确认输入、设置和费用；系统先保存产物和失败证据，生成后人工Review决定是否可交付，不以人工批准作为保存原片的前提。技术完成、作者受控验收和非作者验收分别记录。
7. 本轮授权隔离研发、无Provider测试、Git/GitHub与部署/身份的只读核对。实际飞影页面校准、素材上传、Provider调用/生成、非作者测试、Secret变更、合并与部署没有因此自动授权。需要外部证据或发布时完成其余独立工作后集中提出具体下一Gate。
8. 一个实现者处理有界修改，受影响检查与一次独立Review覆盖实际diff；保留Required CI。合并/部署仅在适用授权内执行，不把每个小修复变成一次发布。Career Track B只被动保存自然证据，不改产品收集字段，不新增埋点或评价系统。

### 必要内部回执接线合同

本輪P0诊断进一步区分：真实resolver/原始Provider schema仍缺外部证据；但页面已经定义且通过检查的`causal_submission_receipt`在Adapter→Report丢失，可独立修复。切片仅在现有Report.supporting_outputs保存Hifly专用条目：kind、固定evidence_source、本地receipt_id、远端remote_id、observed_at以及由服务端绑定的execution_attempt_id。只投影受控ID/时间，不保存URL、work_key、原始payload、header或任意扩展字段；字符限制不冒充来源验证。

A12明确验证Cloud报告来源、唯一条目、合法字段及同Attempt绑定，不将其当媒体、不减少原片/权限检查。新的正式执行缺有效规范化回执时不写completed/Work；已确认执行返回的原片继续按既有规则留存。URL-only形式暂不支持，不截掉签名参数后伪称同一身份。历史报告/手工/Local/fake兼容边界须在实现中明确，不倒改历史合同。无新表、迁移、Provider框架、真实resolver或外部调用；内部接线测试通过仍不使真实回执Gate自动PASS。

## A. Exact Current State

已验证（2026-09-11）：

| 对象 | 实际事实 |
| --- | --- |
| Repo / 工作目录 | JettxonHo/hifly-hands-on-product-batch；`/Users/ketchup/Documents/hifly-fast-mvp` |
| 分支 / 本轮起点 | `codex/hifly-fast-mvp` / `4d98078b6c923d6839c134b30d242b40570ed170` |
| 本轮实现提交 | `a4623e1f93271aad2f5718d1a94cb1d02d0483e2`；两个最小修复及报告归档，未合并/部署。最终文档检查点以PR当前头为准，不冒充被测生产版本。 |
| P0回执内部接线提交 | `060915ad4b25ddac7a77fcf935c2ceda9df0cae4`；规范化回执持久链及严格验证，未合并/部署。 |
| GitHub main | `2af015ab220ecc9d65de209ea690adb98cacc1c4`；正常GitHub API核验，不只读本地缓存。 |
| 本地main | `ca47ec90f8de157f607f6e453edfc6c81203ea02`，旧本地引用，不用作开发或部署基准。 |
| PR / Issue | [#285](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/285) OPEN/DRAFT、未合并；[#284](https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/284)记录当前合同；[#157](https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/157)仍跟踪TLS/公开发布缺口。#278等旧Issue未关闭，不代表其已合并代码不存在。 |
| 线上源码 / App / Worker | 三者均为`3e53bffdd2c59e401815148ccd317b669d32216b`；源码工作树干净，两容器running/healthy。Docker镜像revision标签分别核验，未凭main推断。 |
| main与线上差异 | 3e53bff→2af015a仅README及README图片。基础workspace.html和operator-workspace service已在main，线上容器也实际存在；不能说整个Workspace尚未合并。FAST-MVP增强及本轮入口/归档/回执修复仍在PR，未部署。 |
| 工作树 | 进入时有上一API Gate的3份未提交文档，全部保留；本轮新增必要代码/测试和报告修订，未reset/stash/覆盖无关工作。 |

Git/部分GitHub读取曾出现TLS传输错误或EOF；使用正常API重试核实，没有关闭证书校验或将失败当作仓库不存在。此前“只读API Gate结束即停止”是历史阶段状态，本轮Owner新授权已恢复必要前置修复；Resume报告中的缺口经本轮代码与runtime独立核验。

## B. Formal Entry Point Gate

**FORMAL_ENTRY_POINT = BLOCKED（候选入口修复已通过本地浏览器验证）。**

- 已配置正式origin为`https://8.163.60.0`。默认可信TLS校验GET根入口返回自签名`CERTIFICATE_VERIFY_FAILED`；未绕过。不能要求非开发者忽略证书警告。
- 正式企业入口设计为登录→`/projects.html`→项目工作区。修复前`web/projects.js`固定进入旧`project.html`，即使Workspace已开启也不能从普通项目导航进入新工作区。
- 本轮最小修复：Workspace开启时项目链接进入`workspace.html?project=...&stage=product_content`；空项目能在同一工作区创建商品并形成正常上下文；关闭时保留legacy兼容。缺product却带历史revision的含糊链接继续拒绝，避免首商品投影与另一商品内容错配；正常重开项目保持同一商品绑定。没有要求用户手工输入隐藏URL。
- 线上`OPERATOR_WORKSPACE_ENABLED`未设置，有效值false；企业身份/Project Content开启。线上App/Worker代码版本一致，没有证据宣称二者版本错配；但新候选尚未发布且新入口未启用。正式浏览器缓存一致性因TLS失败未进一步验证。
- 对旧审计措辞作纠正：基础Workspace并非完全缺失或未合并，而是已有基础实现未启用；未上线的是FAST-MVP增强与本轮修复。这两类状态分别记录。

## C. Provider Submission / Receipt Contract

**PROVIDER_RECEIPT_CONTRACT = BLOCKED。**

实际路径：ProductionOrder冻结输入→Handoff manifest/package→compiler解析人物/商品/口播→Cloud Playwright→`HiflyHandsOnProductPage.submitVideo`→batch→candidate→Report→A12→Work。

- Submit由`src/hifly-page.js`的网页操作发出，输入来自现有Order快照和已校验交接包，不从自由文本猜测素材路径。
- `submissionReceiptResolver`目前只有页面调用入口和测试注入；生产加载JSON配置没有真实解析器。当前正式V1在素材上传前失败关闭，不能把该停止写成成功提交。
- pre_submit的receipt_id是本地观察关联标记；真实Provider ID须来自post_submit。静态网页gen_id/埋点候选字段不足以确定当前返回schema或结果身份。
- 核验发现页面→batch已有remote_evidence，但Adapter成功返回和Cloud Report会丢失它。本轮进一步修复了确定的内部接线：Adapter白名单投影→Cloud绑定当前Attempt→现有Report JSONB保存→A12验证唯一Cloud来源/字段/Attempt→Work沿既有Report引用追踪。仅保存受控ID和时间，不保存URL/work_key/raw/header。
- 新版每次正式V1 Playwright执行，缺/无效规范化回执不允许completed/A12/Work；保存该Attempt实际收到的字节只作证据，不宣称Provider归属已经证明。原来failed/requires_action的结果仍不认领其bytes。历史存量报告不补写；fake/manual/Local没有新增强制回执要求，新版正式执行的支持范围明确收紧为安全opaque remote_id。
- 真实响应解析器及请求/查询归属合同仍缺证据；内部规范化接线通过测试，不代表真实Provider Gate通过。此前因原始schema未知而把所有内部接线延期的判断过宽，已通过此次有界修复纠正。

## D. Idempotency & Duplicate Risk

**内部防重已有代码/回归证据；Provider幂等未证明。**

Claim回执、行版本、事务及每订单一个活动attempt约束处理内部重复请求；工作台未决创建请求保留原幂等标识。手持图点击前持久化checkpoint；外层提交不明保存interrupted_unknown/requires_action，不自动重新点击。Cloud重启时未过期attempt保持busy，过期后转requires_action，不自动重领原订单。

这些机制不是Provider exactly-once。普通batch的只读对账也不是Cloud付费恢复授权。正式远端回执尚不完整，所以本Gate不声明重复扣费风险已经通过真实验证。

## E. Cost / Provider Call Bound

**COST_BOUND = BLOCKED。**

- 正式Adapter仍传`assetPointsPerItem=null`、`videoPointsEstimate=null`；snapshot正确记录known=false/total=null，但未知费用本身尚未成为正式执行链独立的可执行阻断。
- 页面包含手持图和视频两处付费提交。缺当前正确账号的完整报价、计费时长上界、逐阶段预留与Owner cap比较；历史网页参考价格不构成本次任务硬上限。
- Worker并发1、失败停机，但成功后可继续下一eligible order；并发1不等于一次授权只允许一个商品。正式单任务/阶段调用预算尚未冻结，也不能靠部署启用整个Worker来代替一次run grant。
- 本轮业务Provider调用与生成均0，积分消费0；未查询或假定账单/余额变化。人民币/USD成本未取得，不与飞影积分相加。
- 未来授权必须冻结一次手持图＋一次视频的最多提交数、必要固有费用、保守可执行上界及剩余预算；付费retry/replay/fallback默认0。不能以Owner填写cap、估计语速或历史1000积分放行。

## F. Production Identity

**PRODUCTION_IDENTITY = BLOCKED（内部运行绑定已核验，真实测试身份未冻结）。**

- App/Worker同版本3e53bff，组织及`CLOUD_EXECUTOR_ID`均存在且相互匹配；只输出匹配结果，没有公开真实身份值。此系统使用executor ID，不把不存在的MEMBER_ID环境变量当作身份缺失。
- 两端enabled=false、mode=fail_closed，生产执行停用；持久Profile路径已配置。没有启动浏览器或读取Cookie/Profile登录内容，不能据路径推断当前Provider登录有效。
- 人物A版本与注册材料本轮只读确认属于配置组织，available/valid/current_organization且materials_accessible=true。P1仍是已获输入的本地预检素材，尚未创建本轮正式Product/Order绑定。
- 声音/人物/商品在本次飞影账号下的实际能力与会话未冻结。此前Owner确认本机另一个账号不是H0；这是一条排除证据，不作为本轮当前会话认证。
- Secret来源为生产环境注入；只检查存在性/配置绑定。官方Hifly API Token为ABSENT；本轮不使用API路线。文案Provider配置为deepseek/质检deepseek_hybrid，但本轮没有调用，P1仍采用已提供的人工口播。
- 预定操作者为作者/Owner控制，真实测试operator、内部Task和被测发布版本须在run grant前冻结；Provider ID在提交后取得。非作者身份/反馈未产生，不伪造。

## G. Remaining Blockers

仅保留影响下一步的硬阻断：

1. 正式HTTPS证书、候选发布和Workspace启用尚未解决；不得绕过安全入口或假装已上线。
2. 真实提交响应/Provider identity解析器及精确查询合同缺失；内部已接通的规范化回执持久链不能代替这些真实证据。
3. 当前正确账号报价、可执行费用上界、每任务/阶段调用限制未冻结/接通。
4. 正确Provider会话、输入/能力绑定及一次受控运行身份尚未冻结。

API是否完整开放不是本轮重新调查的阻断；人物B/P3、UI美化、批量与Career字段均后置。

## H. Minimum Fixes Executed

已执行三个必要切片：

| 修复 | 具体行为 | 文件 |
| --- | --- | --- |
| 正式项目导航进入已有Workspace | 开启时走新入口；空项目可正常建商品并更新上下文；关闭时保留旧入口。 | web/projects.js、web/project.js及既有入口浏览器测试 |
| 原片先归档 | executor成功返回原始下载bytes后，先存一次supporting candidate，再进行交付处理；处理失败的Report仍引用原片，不创建Work/伪装可交付。原片存储失败不继续处理；不明归属结果携带bytes也不认领。 | src/cloud-executor/cloud-executor-service.js、test/cloud-executor.test.js |
| 规范化Hifly回执持久传递 | 不再丢弃已有内部回执；白名单投影、服务端Attempt绑定、Report保存、A12来源/唯一性/绑定校验，Work复用Report引用。缺件及URL-only安全停止；不能将形式校验当作真实来源证明。 | 既有Hifly evidence helper、Cloud Adapter/service、A12 service及对应测试 |

未实现真实Provider原始响应解析器，也未伪造回执/报价、增加官方API执行器、新状态机或新埋点。只扩展现有Report的Hifly专用元数据条目，没有数据库schema/migration变化。没有以normalizer回传的另一份bytes替代下载原片；失去租约时仍遵守原有禁止终态写入规则。

## I. Verification / CI / Merge / Deploy Truth

- 两个实现者依次写入，主控独立审查实际diff，未新增重复Review角色。审查覆盖正确性、权限/绑定、成功及失败原片信任边界、legacy入口和旧合同兼容；结论APPROVED。
- 实现者首轮：入口浏览器7/7＋Stage1浏览器2/2；Cloud Executor及持久媒体40/40；均无首次失败。
- 主控联合回归：Cloud Executor、持久媒体、正式入口、Stage1、两份治理测试共79/79，0fail/cancelled/skip；静态检查255 JS，diff check通过。仅本地受控数据和服务，非真实用户/Provider验证。重叠计数不相加。
- 独立Review要求在同一任务内补上缺product但带revision的拒绝，并补充重开项目绑定验证；随后又修正测试等待动态URL更新的同步点。没有降低断言或增加审查角色。产品修正后的联合回归仍79/79；最后仅测试同步改动，入口7/7通过。原联合日志与最终日志保留于原GUI目录outputs/precondition-20260911/，不覆盖历史失败证据。
- 实现提交a4623e1的[CI34586963425](https://github.com/JettxonHo/hifly-hands-on-product-batch/actions/runs/34586963425)与[Windows stress34586963422](https://github.com/JettxonHo/hifly-hands-on-product-batch/actions/runs/34586963422)均SUCCESS；不继承旧头结果。此次没有重复运行本地全量业务测试，Required CI已实际执行。后续仅文档检查点的Checks仍以PR当前头为准。
- 最后P0内部回执切片：实现者首轮75项为73pass/1fail/1skip，新增A12 fixture漏对象归属metadata；补齐fixture后通过，未放宽生产校验。最终实现者93项92pass/1个PG环境skip；主控联合复核130项129pass/0fail/1个PG环境skip，静态255JS与diff check通过，独立diff Review APPROVED。测试均注入数据；现有manual-execution-postgres集成测试已加入真实repository回执往返断言，必须由当前候选CI实际执行，本地skip不写为通过。相关首轮/修复/最终日志保留，不混加重叠测试计数。
- 060915a的[CI34590525025](https://github.com/JettxonHo/hifly-hands-on-product-batch/actions/runs/34590525025)（Ubuntu/Windows/identity-postgres）与[Windows stress34590525022](https://github.com/JettxonHo/hifly-hands-on-product-batch/actions/runs/34590525022)全部SUCCESS。CI日志明确显示A11/A12 PostgreSQL集成用例ok、skipped 0，新回执JSONB往返已实际执行；这仅为测试数据库证明，不是生产库迁移或真实Provider验证。
- 合并、镜像构建、部署、Workspace/Worker激活：NOT_EXECUTED；没有新授权。Exact merged main仍2af015a；本轮候选没有merged SHA。线上仍3e53bff。
- 回滚准备：本轮为入口条件导航和既有Report引用顺序修正，无migration；未来发布需要在适用授权下选择已验证构建回滚，保留原片、失败Report和历史任务，禁止重提付费任务。当前不执行回滚。
- 新Hifly回执kind对旧版A12不是前向兼容：旧版会拒绝该条目。未来发布须App/Worker协调到同一版本；回滚时暂停相关生产/验证并保留新报告，不能删掉回执强过旧校验，待支持该kind的版本恢复后处理。本轮没有执行这些生产操作。

## J. Golden Path Readiness

**GOLDEN_PATH_EXECUTION_READINESS = BLOCKED。** 本地修复/回归通过只证明对应候选行为。入口发布、安全访问、真实回执、费用上限和Provider身份仍缺失；本轮没有真实Golden Path结果，不提出空泛消费授权。

## K. Real User Validation Readiness

**REAL_USER_VALIDATION_READINESS = BLOCKED。** Owner受控Golden Path尚未完成，本轮没有招募或运行非作者测试；不能将开发者浏览器测试或历史H0混合样片当作非开发者独立成功。

## L. Career Evidence Track B Boundary Check

**PASS（范围边界）。** 只保存自然产生的开发diff、版本、检查结果和阻断结论；没有为Career Track新增字段、功能、RAG/Agent或埋点。实际操作者时长、求助、交付接受和用户反馈均NOT_EXECUTED，不能拿开发测试计数或CI时间填充。

## M. Recommended Next Gate

当前推荐下一步为**真实回执与成本合同的最小证据/接线Gate**，同时准备正式入口的受控发布事项；不是新的API开放研究或非作者测试。

- 需要取得同次提交的可信响应/任务身份及可精确查结果的合同，再把真实resolver接到本轮已完成的规范化持久链；如需新的Provider页面访问/素材准备，先列明正确账号、操作范围、次数与0生成边界，单独取得适用授权。没有可信回执机制前仍不付费；不能无限重复相同只读调查或靠Mock自证真实接口。
- 核实当前计费规则和可执行上界后，接通每任务/阶段调用及费用限制。未知金额不能借Owner cap变成技术PASS。
- 证书/合并/部署/Workspace启用按现有规则另行授权；本轮不把仍缺回执/费用的候选描述为“发布后即可生产”。

只有上述条件真实就绪，才提出`CONTROLLED_GOLDEN_PATH_RUN_GRANT`：一个商品、一次Owner控制的正式链、精确内部身份/版本/账号、可执行预算与调用上限、默认无付费重试/重放/换路、先保留原片再人工验收、下载/登记后停止。此后非作者验证仍需新阶段授权。
