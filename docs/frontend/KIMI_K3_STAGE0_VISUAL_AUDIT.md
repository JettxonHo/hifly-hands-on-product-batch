# Kimi K3 — Stage 0 视觉审计与设计方向(hifly-hands-on-product-batch)

> 依据:materials/ 全部真实源码 + shots/ 12 张真实运行截图(1440/390)。
> 性质:方案与静态证据,不含任何生产代码改动。
> 决策:Owner 已于 2026-08-06 批准“冷中性灰 + 品牌蓝 `#1769e0`”方向,并授权单独建立 Stage 1 Frontend Foundation Issue。

---

## 1. 当前视觉与交互问题清单(按影响排序)

1. **无全局应用壳层,页面互不相通**(全部页面 / 每次跨页操作)。projects/project/assets/members 各自只有孤立「返回工作台」链接;auth-gate.js 把「素材中心/项目/成员管理/退出」以 `.status-pill` 形式动态塞进 index 顶栏的 `.status-strip`——导航只存在于 index 一页,且与会话状态 pill 混排,窄屏换行混乱(workbench-narrow 实测)。
2. **四套互不一致的样式体系**(全部页面 / 所有读写操作)。styles.css 青 #0f766e + 深蓝渐变 tab + 46px 大标题 + 圆角 8/9/10/12/14/999px 混用;login.css 蓝 #1769e0 圆角 6-8;project-content.css 蓝 #1769e0 + 28px 标题;assets.css 又一套 shell 宽度(920px vs 1040px vs 980px vs 1180px)。同一产品四种字体栈、四种主色、四种圆角语言。
3. **状态语义没有统一体系**(assets/project/index / 高频核对状态操作)。四套状态样式(status-pill / .state / .badge / .notice)互不映射;素材状态 available 绿、verification_failed 红,但 waiting_for_executor、requires_action 这类业务状态没有归属色,极易被默认成失败红(语义红线)。
4. **遗留会话状态 pill 暴露给运营**(index / 进入工作台第一眼)。「会话失败」「批量生成:检测中」「抓包 HTTP:单条联调」在企业模式下无后端,toast 直接显示原始错误码「初始化失败:AUTH_REQUIRED」(workbench-desktop 实测),违反「界面不出现内部术语/错误码」合同。
5. **英文/技术原文直接面向运营**(project/assets/index / 状态判读)。快照状态显示原始 `draft · v1`;assets 状态列表列名与值为英文枚举;均未有中文业务文案层。
6. **创建表单常驻首屏,读写优先级颠倒**(projects/project/members / 每天几十次的状态核对)。「创建项目」整表单占首屏一半,项目列表被压到折叠线下;创建商品表单常驻;运营 80% 操作是查状态/改快照,创建是低频,却占据最优视觉位。
7. **商品列表是居中文本的按钮状行**(project / 选择商品)。`.secondary` 按钮直接当列表行,长中文商品名横向撑破行(截图实测「…SKU-HYDRA-2026-AUT-0001 · draft」溢出行宽);无状态列、无选中态、无截断策略。
8. **危险操作与中性操作视觉等价**(members / 停用成员)。「停用」(红)与「重置密码」(蓝)等宽并排,无确认层级差异,误触成本低。
9. **窄屏 390px 降级无标签**(members/index/projects / 移动端一切操作)。member-row 字段竖排堆叠无字段名;index 表格 display:block 后表头消失、单元格无语义;projects 的 `type=date` 在窄屏显示 yyyy/mm/dd 占位,无中文格式提示。
10. **空状态/加载/失败三态不分**(assets/projects/project / 首次使用与异常恢复)。assets 列表空时只有「正在加载...」,加载失败与真空无区分;上传报错红字直接挂在表单下无结构;project.js 保存失败/409 过期共用一条 notice,视觉无层级。
11. **键盘可访问性不一致**(login/projects/project/assets/members)。只有 styles.css 定义了 `:focus-visible`;其余四套 CSS 无任何焦点样式,键盘用户在蓝色系页面完全丢失焦点。
12. **装饰优先于信息**(index)。46px clamp 大标题、深蓝渐变 tab/toast、多层渐变面板、999px capsule pill——营销化视觉语言挤占状态与操作空间,违反「状态、阻断、失效和下一步必须比装饰更突出」。

---

## 2. 视觉系统

### 2.1 原则
- 状态 > 阻断 > 下一步 > 主操作 > 装饰;装饰只允许是中性灰阶 + 细线。
- 每页一个主操作(每屏仅一个实心品牌色按钮)。
- 中性灰承载 95% 界面,品牌蓝只给:主按钮、导航激活态、链接。
- 语义色只给状态,不给装饰;红只给「失败/危险确认」,绝不给「等待/待处理/阻断」。

### 2.2 色彩(具体 hex)
中性色阶(界面主体):
- N0 `#ffffff` 卡片/输入底;N50 `#f7f8fa` 页面底;N100 `#f2f4f7` 表头/标签底;N200 `#eaecf0` 分隔线;N300 `#d0d5dd` 输入边框;N400 `#98a2b3` 占位/禁用;N500 `#667085` 次要文字;N700 `#344054` 表头/强调文字;N900 `#18202b` 正文。

品牌强调(沿用现有蓝,收敛为一套):
- Primary `#1769e0`;hover `#1256b8`;pressed `#0f4694`;tint-bg `#eaf1fd`(选中行/激活导航底);tint-border `#b8cff7`。

语义色(text / bg / border):
- 成功 success:`#067647` / `#ecfdf3` / `#abefc6`
- 提醒 warning(待处理 requires_action、阻断 blocked):`#9a6700` / `#fffaeb` / `#f0b429`
- 失败 failure(verification_failed、操作失败、危险确认):`#b42318` / `#fef3f2` / `#fecdca`
- 失效 inactive(superseded、已停用、已被替代):`#667085` / `#f2f4f7` / `#eaecf0`(纯灰,无彩色)
- 进行中/等待 progress(核验中、waiting_for_executor):`#175cd3` / `#eff4ff` / `#b2ccff`(信息蓝,区别于品牌主按钮的实心用法,仅用于标签)

### 2.3 排版
- 字体栈:`-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`;编号/SKU/版本号:`ui-monospace, "SF Mono", Menlo, Consolas, monospace`。
- 字号阶:12(表头/辅助)/ 13(标签、状态标记)/ 14(正文、输入、表格——默认)/ 16(区块标题)/ 20(页标题,上限 24)。
- 行高:正文/表格 1.5;标题 1.35;状态标记 1.2。
- 字重:400 正文 / 500 输入值 / 600 标签、按钮、表头 / 700 仅页标题。

### 2.4 间距
4px 基网:4 / 8 / 12 / 16 / 20 / 24 / 32。输入内 padding 8×12;卡片 padding 16-20;区块间距 20;表单行距 12;表格单元格 8×12。

### 2.5 边框与圆角
- 卡片/面板:1px N200,圆角 8px(上限);输入/按钮:1px N300,圆角 6px;状态标记:圆角 4px 矩形标签(不用 999px 胶囊,与按钮明确区分)。
- 禁止渐变填充(tab、按钮、toast、面板全部改平色)。

### 2.6 阴影
仅两级:卡片 `0 1px 2px rgba(16,24,40,.06)`;对话框/抽屉 `0 8px 24px rgba(16,24,40,.12)`。hover 不加深阴影,只改边框色(N300→N400)。

### 2.7 信息密度
面向日均几十商品的高频操作:输入/按钮高 36px(紧凑型 32px);表格行高 40px;表单默认两列栅格(680px 以下单列);页标题区(含面包屑)总高 ≤ 64px,首屏必须露出列表/状态区前 3 行。

---

## 3. 全局应用壳层与 IA 方向

### 3.1 静态结构
```
┌────────────┬──────────────────────────────────────────────────┐
│ 飞影工作台  │ 上下文栏 48px:面包屑/项目名        组织名·姓名 退出 │
│            ├──────────────────────────────────────────────────┤
│ 首页(未上线)│                                                  │
│ 项目   ●    │            内容区 max-width 1120px                │
│ 素材中心 ●  │            padding 24                             │
│ 生产任务(未)│                                                  │
│ 作品库 (未) │                                                  │
│ 设置   ●    │                                                  │
│            │                                                  │
│ ────────── │                                                  │
│ 本地批量    │                                                  │
│ 工作台(遗留)│                                                  │
└────────────┴──────────────────────────────────────────────────┘
```
- 左侧导航固定 200px(窄屏收成顶部 48px 一行横滚导航);项目/素材中心/设置为**当前已实现入口**,正常可点;首页/生产任务/作品库为**未实现入口**,静态稿中灰显 + 「未上线」标签、不可点,且明确只存在于静态稿,不进代码。
- 顶部上下文栏只放当前位置(面包屑/项目名)与身份区(组织·姓名、退出);**不再用 status-pill 当导航**;遗留会话状态不进顶栏(见 3.2)。
- 设置 → 成员管理(admin 可见,与 auth-gate 的 `membership.role === "admin"` 一致)。

### 3.2 旧本地工作台 index.html 的位置
- 它是**遗留运维页面,不是一级导航项**,不占用 6 项 IA。
- 方向:不进左侧导航;通过直接 URL 访问,页面内套壳层但顶部加一条固定的「本地批量工作台(运维兜底,企业流程请走项目)」提示条(warning 色);遗留 pill(会话失败/检测中/抓包 HTTP)从顶栏移除,收进页面内「本地服务状态」区块,且 AUTH_REQUIRED 等原始错误码不直接 toast,改中文兜底文案。
- 窄屏:导航横向滚动,不换成 pill 堆叠。

---

## 4. 页面方向稿(文字 + ASCII 线框)

约定:【主】= 页内唯一主操作(实心品牌色);[次] = 次按钮;(状态) = 状态标记。

### 4.1 登录 + 首次强制改密(无壳层,居中卡片)
桌面/窄屏同构,卡片宽 360px,390px 视口下 `width: 100% - 32px`。
```
┌────────────────────────────┐
│ 飞影企业工作台              │  ← 品牌字标 16px/600,无 Hero
│ 登录(20px)                 │
│ 使用工作邮箱与密码登录。     │
│ 工作邮箱  [_______________] │
│ 密码      [_______________] │
│ [登录]                【主】│
│ (错误:inline 红字 role=alert)│
└────────────────────────────┘
```
- 首次改密:同一卡片原地切换(现有 enterPasswordChange 行为保留),标题变「设置新密码」,副标题说明临时密码已验证;主按钮文案「保存并进入工作台」。
- 主操作:登录(唯一)。状态区:卡片内 `#authError` inline,不用 toast。

### 4.2 项目列表(projects)
桌面 1440:
```
项目                                              【+ 创建项目】主
─────────────────────────────────────────────────────────────
(默认列表优先;创建表单收进对话框/抽屉,不再常驻)
名称                    交付日期      说明           操作
2026秋季新品种草项目     2026-09-30   云感保湿乳…    [打开]
─────────────────────────────────────────────────────────────
空状态(真空):「还没有项目」+ 【创建项目】引导按钮
加载失败:inline notice「项目加载失败」+ [重试]
```
窄屏 390:列表行变两行的行卡片(名称 14/600 一行截断 + 交付日期·说明 meta 行),「打开」整行可点;日期以 `2026-09-30` 文本显示,不用原生 date 占位符。
- 主操作:创建项目(收进 dialog,打开后焦点进名称输入)。

### 4.3 项目商品工作台(project,阶段:商品与目标)
桌面 1440(列表 + 编辑双栏,编辑为主区):
```
项目 / 2026秋季新品…项目                          【+ 创建商品】主
─────────────────────────────────────────────────────────────
┌─商品(280px 列表)────┬─商品快照 ──────────────────────────┐
│ 云感保湿乳 50ml 清爽型 │ 商品快照            (状态:草稿 v1) │
│   (草稿)              │ 名称[____] 品类[____]              │
│ 云感保湿乳 50ml 滋润… │ 说明[________]                     │
│   (草稿) 名称截断     │ 表达风格[__] 补充要求[__]           │
│                       │ 核心卖点                            │
│ 空:「还没有商品」      │ ┌ [卖点文本输入_______] [确认][次]│
│                       │ └ (待确认→amber 点 / 已确认→绿 标签)│
│                       │ 商品图片(仅列 status=available)   │
│                       │ ☐ 主图.jpg · 版本 1                │
│                       │ ───────────────────────────────── │
│                       │ [保存草稿][次] 【设为 Ready】主?   │
└───────────────────────┴─────────────────────────────────────┘
阻断条(amber,在操作行上方):「暂不能 Ready:填写商品名称、
确认至少一条卖点、选择至少一张可引用图片。」
```
说明:本页主操作随上下文唯一化——未选中商品时是「创建商品」;编辑快照时操作区唯一实心按钮是「设为 Ready」,「保存草稿」降为次按钮(两者同时存在时 Ready 为主,因为 Ready 是阶段推进动作;创建商品入口降为导航级次按钮或「+」入口)。商品列表行:左对齐、单行截断 + title,状态标签在名称下方,选中行 tint-bg + 左 3px 品牌边。
- 窄屏 390:列表/编辑上下堆叠,列表折叠为一行一个商品的横向滚动条或手风琴;卖点行 input + 确认按钮上下排;阻断条吸在操作按钮上方。
- 状态区:`#revisionState` 中文文案(草稿/已 Ready/已被替代 v3),用 §5 状态标签色。
- 空状态:无商品「还没有商品」;无可引用图片「没有可引用的商品图片 → 去素材中心上传」(链接到 /assets.html)。

### 4.4 素材中心(assets)
桌面 1440:
```
素材中心                                        【上传商品图】主
─────────────────────────────────────────────────────────────
上传区(默认收起为一行:选择文件 + 上传按钮;说明一句话)
商品图片                                        [刷新][次]
文件名                版本   状态        上传时间
主图.jpg              v1    (核验通过)   08-05 14:02
banner.png            v2    (核验失败)   08-05 13:40
new.png               v1    (核验中)     08-06 09:12
```
- 状态色:核验中=信息蓝(progress)、核验通过=绿、核验失败=红;失败行给 inline 原因位。
- 空状态三分类:真空「还没有商品图片,上传第一张」+ 主按钮;加载中=行级骨架;加载失败=「加载失败」+ [重试]。
- 窄屏 390:行变卡片(文件名截断一行,状态标签独立一行右对齐);上传表单单列。
- 主操作:上传并开始核验(唯一实心)。

### 4.5 成员管理(设置 → 成员管理,admin)
桌面 1440:
```
设置 / 成员管理                                  【+ 创建成员】主
─────────────────────────────────────────────────────────────
创建成员收进对话框:邮箱/姓名/角色 + 「创建并生成临时密码」
成功后对话框内展示临时密码(amber 提示条 + 复制按钮,role=status)
现有成员
邮箱             姓名     角色     状态      操作
a@corp.com      张三     管理员   (启用)   [重置密码][次] [停用][危险]
```
- 危险按钮不与次按钮等宽并排:操作列末位、固定顺序「次在前,危险在后」,危险按钮描边红(text #b42318 + border),点击后必经确认对话框(对话框主按钮才是实心红)。
- 窄屏 390:行卡片化且**带字段标签**(邮箱:/姓名:/角色:),操作按钮整行两枚。
- 空状态:真空「暂无成员」;加载失败 + 重试。

---

## 5. 组件目录

### 5.1 按钮
- 主按钮:实心 #1769e0,hover #1256b8,高 36px,padding 8×16,圆角 6,字重 600;每屏 ≤ 1 枚;disabled 用 N400 底、不改透明度(避免与加载态混淆),加载中左侧 14px spinner + 文案不变。
- 次按钮:白底 + N300 描边 + N900 字,hover 边框 N400。
- 危险按钮:默认白底红字红描边(#b42318);只有确认对话框内的最终确认用实心红。
- 图标按钮:表格行内 32px 方按钮,图标 + `aria-label`,不单独裸图标。
- 链接:品牌蓝,仅用于导航性跳转(打开/全部项目),不承载提交动作。

### 5.2 表单
- 输入/选择/文本域:高 36px(文本域 min 3 行),边框 N300,focus 边框 #1769e0 + 3px `rgba(23,105,224,.15)` 外晕;占位 N400;标签 13px/600 在输入框上方(禁止裸占位符当标签)。
- 文件输入:统一「选择文件 + 已选文件名」一行式,显示已选文件名与格式要求(jpg/png/webp),窄屏单列。
- 校验错误:inline 于字段下方,13px #b42318,输入框边框同步变红,`role=alert`;提交级错误汇总在表单操作行上方一条 inline error notice。

### 5.3 表格
行高 40px,表头 12px/600/N500 大写感(中文不 uppercase),斑马纹不用,行 hover N50;选中行 tint-bg + 左侧 3px 品牌边;长文本单行截断 + title;窄屏降级为带字段标签的行卡片,表头语义保留(visually-hidden)。

### 5.4 状态标记(语义色映射,矩形 4px 圆角标签)
| 业务状态 | 中文文案 | 语义 |
|---|---|---|
| 快照 draft | 草稿 | 中性灰 N500/N100 |
| 快照 ready | 已 Ready | 成功绿 |
| 快照 superseded | 已被替代 | 失效灰(纯灰) |
| 素材 available | 核验通过 | 成功绿 |
| 素材核验中/排队 | 核验中 | 信息蓝 progress |
| 素材 verification_failed | 核验失败 | 失败红 |
| waiting_for_executor | 等待执行 | **信息蓝,不得用红** |
| requires_action | 待处理 | **提醒 amber,不得用红** |
| 成员启用/停用 | 启用 / 已停用 | 绿 / 失效灰 |
| 会话/鉴权异常 | 需要重新登录 | 提醒 amber(非红) |

### 5.5 提示
- toast:右下,深色平色(N900,无渐变),4s 自动消失;只用于「保存成功/已确认」等轻反馈;错误不用 toast。
- inline notice:三段式 success/error/blocked(amber)条,位于相关表单/操作区上方,`role=status|alert`;409 过期类用 blocked:「页面内容已过期,请刷新后继续」+ [刷新]。
- 阻断条:Ready 阻断等,amber 左边框 3px + 条列缺失项,固定在操作按钮上方,比按钮更显眼。

### 5.6 空状态(三分类)
- 真空:一句话 + 一个引导主/次按钮(指向本页主操作)。
- 筛选无结果:「没有符合条件的记录」+ [清除筛选]。
- 加载失败:error notice + [重试],不显示「正在加载...」兜底。
- 加载中:骨架行(灰条),reduced-motion 下为静态灰条。

### 5.7 对话框
宽 480-560px,圆角 8,标题 16/600;危险确认对话框须写明对象名与后果,确认按钮实心红、文案为动作本身(「确认停用」);`method=dialog` 与 #confirmDialog 现有结构保留,仅换肤。

### 5.8 异步任务反馈
上传/核验/保存:按钮进入 loading(spinner + 禁用),列表行内状态标签实时为「核验中」信息蓝;离开再返回状态可查(服务端为准);长任务不在前台转圈阻塞,给 toast「已提交,后台核验中」。

---

## 6. 动效规范

- 时长:入场/状态变化 120-180ms;抽屉/对话框 200-240ms;全部 ease-out,标准曲线 `cubic-bezier(0.2, 0, 0.38, 1)`。
- 使用场景清单(仅此五类):
  1. 保存/确认成功:notice 淡入(opacity,150ms),不做位移弹跳;
  2. 上传:按钮 spinner 旋转(线性,仅 spinner);行状态标签换色 cross-fade 120ms;
  3. 异步任务:状态标签颜色过渡 120ms;骨架屏静态或单次淡入;
  4. 抽屉/对话框:opacity + translateY(8px→0),200ms;
  5. 状态变化(选中行、tab 切换):背景色/边框色 transition 120-150ms。
- prefers-reduced-motion:统一 media query 把 transition/animation 压到 0.01ms、关闭 transform 与 spinner 旋转(spinner 换静态「处理中…」文案)、骨架不闪烁。
- 明确禁止:渐变动画、弹簧/回弹缓动、视差、自动轮播、循环呼吸/脉冲、数字滚动、按钮按下 translateY 位移(现有 `:active translateY(1px)` 取消)、任何 > 240ms 的动效。

---

## 7. 必须保留的合同清单

### 7.1 不能动(JS/测试依赖)
- **login**: `#authForm` `#email` `#password` `#newPassword` `#submitButton` `#authError` `#authTitle` `#authSubtitle` `#emailField` `#passwordField` `#newPasswordField`;字段 name/类型/autocomplete;`/api/auth/intent|login|change-password|me`;`password_change_required` 流程;错误码文案表(login.js message())。
- **auth-gate**: `window.HiflyIdentity`;`.status-strip` 查询(index 上必须继续存在);`.status-pill` 与 `.identity-logout` 类名;`membership.role === "admin"` 判定;cookie `hifly_identity_csrf` / header `x-identity-csrf`;/api/runtime 的 `assetsEnabled` `projectContentEnabled` 开关语义。
- **index**: `#sessionStatus` `#batchStatus` `#runtimeBackendBadge` `#captureHttpBadge`;`.tabs[role=tablist]`、`.tab[role=tab][data-tab][aria-selected][aria-controls]`、`#panel-single|bulk|import|queue|records[role=tabpanel]`;表单 id `#singleForm #bulkForm #importForm` 及全部字段 name(sku, productName, sellingPoints, category, productImage, personImage, personStrategy, scriptStrategy, captureEnabled, script, tableFile, imageFiles, bulkFixedPersonImage, importFixedPersonImage);`#batchTable #batchDetail #startExecution #recordList #toast #confirmDialog #confirmTitle #confirmSummary #confirmItems #cancelConfirm #confirmExecution`;`.notice.success/.error`、`.badge`、`.state` 等类名(api.js/app.js 未在证据包内,按保守处理全部保留)。
- **projects**: `#projectForm`(name/delivery_date/description)`#projectList #formError #listError #refresh` `.empty`;错误文案「请填写项目名称。」「项目加载失败,请刷新重试。」「还没有项目」;POST /api/projects 的 idempotency-key 头。
- **project**: `#productForm(product_name) #productError #productList #editor #revisionForm(product_name, product_description, primary_category, expression_style, additional_requirements)` `#revisionState.state` `#pointList` `.point-row[data-id][data-confirmed]` `#addPoint #refreshRevision #readyRevision #saveDraft #editorNotice` `#assetOptions`;`.notice.success/.error/.blocked` 三类;`state.ready`/`state.superseded` 类;文案「请先保存草稿,再确认卖点。」「暂不能 Ready:…」「页面内容已过期,请刷新后继续。」;API:PATCH /api/product-revisions/:id(expected_revision)、confirm、ready、PRODUCT_REVISION_READY_BLOCKED 三 reason(PRODUCT_NAME_REQUIRED/SELLING_POINT_REQUIRED/IMAGE_REQUIRED);仅列 `version.status === "available"` 的素材。
- **assets**: `#uploadForm #assetFile #uploadStatus #assetError #assetList #refreshAssets`;`.asset-row` `.state` `.state.available` `.state.verification_failed`;accept 列表。
- **members**: `#createMemberForm #memberEmail #memberName #memberRole #temporaryPassword #membersError #memberList`;`.member-row` `.member-row button.danger`;角色枚举 member/admin;临时密码展示(role=status)。
- 全局:CSP 禁止内联 script(gui-smoke 断言);`[hidden]` 语义;aria-live/role 现有挂载点。

### 7.2 可以改
颜色/字号/间距/圆角/阴影/布局容器;新增包裹 div 与新增 class(纯增量);把 pill 导航渲染目标从 `.status-strip` 迁到壳层导航(须保留 auth-gate 的判定逻辑与原类名或提供等价 hook,并同步改测试);英文状态原文 → 中文文案的「显示层」映射(不改数据值);装饰性渐变移除;空状态文案补结构(在保留原文案子串的前提下扩展,避免断言失配);为窄屏行卡片新增字段标签(增量 DOM)。

---

## 8. 分阶段实施建议

### Stage 1(基础层:壳层 + 设计变量 + 基础控件 + A01-A03 页面套用)
文件范围(web/ 下):
- **新增**:`tokens.css`(§2 全部设计变量);`shell.css`(左侧导航 + 顶部上下文栏布局);`base.css`(按钮/表单/表格/状态标签/notice/dialog/toast 统一控件样式,引用 tokens);`shell.js`(读取 `window.HiflyIdentity` 渲染导航与身份区,外联脚本遵守 CSP)。
- **修改**:`login.html` `projects.html` `project.html` `assets.html` `members.html` —— 引入 tokens/base(/shell),套壳层结构,不动 §7.1 任何 hook 与字段;`auth-gate.js` —— 保留全部判定,导航/退出渲染目标改为壳层容器(`.status-strip` 路径对 index 保留兼容)。
- **合并后删除**:`login.css` `project-content.css` `assets.css` `members.css` → 其有效规则并入 `tokens.css`+`base.css`(members 依赖 login.css 级联的关系随合并自然消解)。
- **暂不动**:`styles.css` 与 `index.html`(遗留页,Stage 2 收口),仅允许把 :root 变量值对齐 tokens 的最小 patch;`login.js` `projects.js` `project.js` `members.js` `assets.js` 逻辑零改动(仅当显示层中文映射经测试确认后,允许纯文案常量替换)。
- 未实现入口(首页/生产任务/作品库)**不新增任何文件、不出现在导航代码**;静态稿标注仅存在于本文档。

回归风险:
1. gui-smoke/测试选择器断言(最高风险)——所有 hook 保留并先跑全量 gui-smoke;2. auth-gate 渲染目标变更导致导航缺失(admin 与非 admin 两角色都要回归);3. members 对 login.css 的级联依赖在合并时丢规则;4. `.notice` 三类(success/error/blocked)在四套 CSS 中结构不同,合并时类名语义漂移;5. CSP 禁内联脚本,shell.js 必须外联;6. project.js 用 `form.querySelector("button")` 取首个按钮,操作区按钮顺序不可调乱。

验收截图清单(页面 × 视口 × 状态):
- login × {1440, 390} × {登录态, 首次改密态, 错误态}
- projects × {1440, 390} × {空列表, 列表多条, 创建对话框, 创建失败 inline}
- project × {1440, 390} × {无商品空态, 长中文名列表, 草稿编辑, Ready 阻断条, 409 过期 blocked, 已 Ready}
- assets × {1440, 390} × {真空, 核验中/通过/失败三态行, 上传中, 加载失败重试}
- members × {1440, 390} × {成员列表, 创建对话框+临时密码展示, 停用确认对话框, 非 admin 无入口}
- index × {1440, 390} × {仅变量对齐后现状回归}
- 全部页面补:focus-visible 键盘焦点态截图一组;prefers-reduced-motion 开启下抽检一页。

### Stage 2(一句话)
遗留 index.html 收口:统一壳层与状态区改造,并评估其在「生产任务」IA 下的退役/迁移路径。

### Stage 3(一句话)
新 IA 入口(首页/生产任务/作品库)随后端能力落地时,基于 Stage 1 组件目录扩展页面,不再新增样式体系。
