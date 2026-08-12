# 2026-08-12 P3 小批量真实验收准备

## 目标

按 D-033 和 Issue #132 验证三个不同商品、至少两个人物的串行真实生产。每个商品对应独立 ProductionOrder；Local Agent 继续使用单一飞影 Profile，禁止并发领取或自动重试。

## 已确认输入

- 商品图：
  - `iPad`：`/Users/ketchup/Desktop/test demo/ipad.webp`
  - `吉伊卡哇玩偶`：`/Users/ketchup/Desktop/test demo/chiikawa.jpeg`
  - `熊玩偶`：`/Users/ketchup/Desktop/test demo/toybear.jpeg`
- 本机私有人物映射：1 个；映射文件、人物文件与 Token 均位于仓库外，本文不记录真实路径或值。
- 第 2 张人物候选：已在仓库外生成并保存，为站姿合成男性、冷灰电子场景，PNG 941x1672、约 1.76 MB；当前仅是候选图片，尚无企业 AvatarAsset/AssetVersion，也尚未加入本地映射。
- P2-02 企业人物登记与本地映射、P2-03 确定性品类推荐已合并至 `main@b0e47ab`。

## 当前缺口

1. 阿里云试运行环境尚未部署包含 P2 的当前 main，因此尚无生产 P2 migration、企业人物登记 UI 或品类推荐 UI。
2. 第 2 张人物候选仍需在云端登记为企业 AvatarAsset/AssetVersion，并在 Mac 私有配置中建立映射。
3. 三个商品仍需在部署后走权威 ProductRevision、文案生成/QC/人工批准、人物人工确认、VideoPlan 预检/人工批准、ProductionOrder 和 handoff package。

## 执行顺序

1. Owner 明确授权部署当前 main；部署前备份数据库与旧镜像，运行 production migration，验证 app/postgres/proxy 与 HTTPS health。
2. 仅做无副作用 standby 与飞影登录预检；不得领取工单。
3. 通过云端 GUI 登记第 2 个人物，配置分类标签和必要 Evidence；在 Mac 私有映射文件中设置其内部 avatar asset-version ID。
4. 准备三条独立批准链，逐条复核唯一可领取、zero-attempt、ready package 和人物映射。
5. 使用 standing authorization 串行执行，最多三次；每次完成 A12/Work 核验后才进入下一条。首个失败立即停止剩余任务。
6. 记录商品、人物、工单、attempt、飞影作品、候选、A12、Work 与授权计数；不记录 Secret、本地路径、浏览器 Profile 或对象存储内部 key。

## 当前外部影响

- 未部署阿里云。
- 未访问 Hifly 或 DeepSeek。
- 未创建/领取真实工单。
- 飞影积分消耗 0。
