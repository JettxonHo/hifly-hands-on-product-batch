# 2026-08-10 第三次真实 Local Agent 执行与商品上传扩展名修复

## 授权与执行边界

- Owner 明确授权最多执行 1 条真实飞影“手里有货”生成，接受积分扣除。
- 失败立即停止，不自动重试。
- 本轮只运行一次 real 双门禁命令；后续调查和修复均不访问飞影生成链路。

## 执行前准备

- 上一次 attempt 的失败报告为 `not_retryable`，公开 `reenter` 入口按设计不允许恢复；未改数据库或篡改历史报告。
- 通过正式生产 API，基于同一批准视频方案创建 reproduction 工单 `5e245a67-cdf8-4836-be66-6c5c58118990`。
- 新交接包 `d969bb14-3032-4592-81c8-6c5c277b4611` 为 `ready / v1`。
- 本机飞影无副作用预检返回 `ready / playwright`。
- 云端复核只有该工单为 `waiting_for_executor`。

## 唯一真实执行结果

- 唯一 real 命令完成 heartbeat、claim、start、交接包下载和租约心跳。
- 飞影已登录，成功打开“手持商品图”弹窗并进入人物、商品素材设置阶段。
- attempt：`cabb5e35-9691-429c-9b97-1a7902e6590c`。
- 失败报告：`f603334f-694c-4025-aeda-d4791cbad0b8`。
- 工单与 attempt 均收口为 `failed / not_retryable`，candidate 数为 0，没有视频产物。
- 本轮没有第二次 real 命令。

## 积分与页面证据

- `product-verify` 截图显示人物槽已有删除操作，但商品槽仍显示“上传商品”。
- 弹窗“立即生成 150积分”保持禁用，没有被点击；外层生成按钮也没有被点击。
- 页面积分显示 `56841`，与执行前无积分验证值相同。
- 因未进入生成动作，本轮没有触发飞影积分扣除；最终账单仍以飞影账户记录为准。
- 截图和 JSONL 仅保存在 Git 忽略目录，不提交仓库。

## 根因

- 交接包 manifest 中商品引用正确声明为 `image/png`，显示名为 `IPAD-CUSTOM-SCRIPT-001.png`。
- 交接包归档为保证稳定引用，把实际字节保存在 `assets/<asset-version-id>`，文件名没有扩展名。
- Local Agent 原先直接把该无扩展名路径传给 Playwright。浏览器创建出的 File 名称没有扩展名，`File.type` 为空。
- 飞影上传控件只接受 JPG/PNG，因此静默拒绝该文件，商品槽保持空白。

## 无积分 TDD 修复

- 回归边界为 `compilePackageToBatchItem`：manifest 声明 `image/png` 时，输出 `image_path` 必须以 `.png` 结尾，且文件字节与包内资产一致。
- 旧实现先稳定红测，实际返回无扩展名路径。
- 编译器现根据 `image/png` 或 `image/jpeg` 创建仅用于浏览器上传的 `.png` 或 `.jpg` 临时副本；归档原文件和完整性合同不变。
- Local Agent 定向测试通过，完整门禁以本轮 PR 为准。

## 下一步

1. 完成静态检查、全量测试、独立审查和 PR 合并。
2. 当前失败 attempt 为 `not_retryable`，不得直接恢复或再次运行 real 命令。
3. 如需继续真实验收，先创建新的 reproduction 工单与 ready 交接包，再做无副作用预检。
4. 必须重新取得 Owner 对 1 条真实生成的明确积分授权。
