# Local Agent 最小生产执行器运行手册

> 历史兼容路径：自 D-034 起，本 Runbook 不再是 P0 生产部署或验收入口。当前 P0 以 `docs/product/CLOUD_EXECUTOR_P0.md` 为准；不得用 Local Agent Evidence 代替纯云端 Cloud Executor 验收。

## 当前边界

Local Agent 将云端生产工单交给保留飞影登录态的 macOS 执行。当前只支持单 Organization、单 Agent、单商品串行执行。默认运行 fake executor；真实飞影执行必须同时启用两个显式开关，并在执行前取得新的积分授权。

本手册进入仓库不代表云端端到端已经验收。首次真实验收仍需单独执行，失败后停止且不自动重试。

## 云端配置

在服务器 `.env` 中设置以下值，不要提交真实 Token：

```dotenv
LOCAL_AGENT_ENABLED=true
LOCAL_AGENT_ID=mac-agent-01
LOCAL_AGENT_ORGANIZATION_ID=<与生产工单相同的 organization id>
LOCAL_AGENT_TOKEN=<云端和 Mac 共享的高强度随机 token>
LOCAL_AGENT_LEASE_MS=30000
```

随后运行 production migration 并重启 app。未完整配置时服务保持关闭；现有 `PRODUCTION_EXECUTOR=fail_closed` 不需要改成 Playwright。

## Mac 配置

1. 安装与仓库一致的 Node 依赖，并先用现有 `npm run login` 保存飞影登录态。
2. 创建 Git 忽略的本地人物映射文件，例如 `config.local-agent.json`：

```json
{
  "avatar_asset_version_paths": {
    "<云端人物素材版本 id>": "/absolute/path/to/person.png"
  }
}
```

3. 设置本地环境变量：

```dotenv
LOCAL_AGENT_BASE_URL=https://<云端域名>
LOCAL_AGENT_TOKEN=<与云端一致>
LOCAL_AGENT_AVATAR_MAPPING_FILE=/absolute/path/to/config.local-agent.json
LOCAL_AGENT_HEARTBEAT_INTERVAL_MS=5000
LOCAL_AGENT_HIFLY_CONFIG_PATH=/absolute/path/to/config.local.json
```

人物映射也可以用仓库内 CLI 管理。命令只读写 Mac 本地 JSON，不调用云端、不上传 Mac 路径；配置仍兼容现有 `avatar_asset_version_paths`：

```bash
npm run local-agent:avatar-map -- set <avatar_asset_version_id> /absolute/path/to/person.png --config /absolute/path/to/config.local-agent.json
npm run local-agent:avatar-map -- list --config /absolute/path/to/config.local-agent.json
npm run local-agent:avatar-map -- remove <avatar_asset_version_id> --config /absolute/path/to/config.local-agent.json
```

`set` 要求人物文件已经存在且路径为绝对路径；省略 `--config` 时使用 `LOCAL_AGENT_AVATAR_MAPPING_FILE`，再回退到当前目录的 `config.local-agent.json`。映射 id 必须使用交接包 manifest 中的 `avatar_asset_version_id`，不要使用 provider key、上传 token 或 object key。

## 无积分检查

默认命令只上报 Agent 在线，不领取工单，也不访问飞影：

```bash
npm run local-agent:run-once
```

返回 `standby` 表示配对和 Bearer 认证可用。只有隔离测试环境需要 fake executor 时，才显式设置：

```bash
LOCAL_AGENT_FAKE_EXECUTION=true npm run local-agent:run-once
```

不要对生产数据运行 fake 模式。fake 模式会领取工单并回传测试 MP4。没有待执行工单时返回 `idle`；缺少人物映射时返回 `requires_action`，云端保留原工单和交接包，不需要重新录入商品。

## 真实执行门禁

只有取得本次积分授权后，才允许在 Mac 上同时设置环境变量并传入参数：

```bash
LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real
```

缺少任意一个门禁时仍使用 fake executor。真实验收只准备一个已批准的视频方案和一个生产工单，确认人物映射后执行一次；记录工单、attempt、飞影作品、候选产物、A12 和 Work 状态。任何失败立即停止，不自动重新生成。

## 状态判断

- `idle`：没有可领取工单。
- `standby`：认证和在线心跳正常，但未开启 fake 或 real 执行，不会领取工单。
- `completed`：候选视频已上传并提交云端，随后由 A12 核验；不等于 Work 已通过。
- `requires_action`：人物映射或交接包需要人工处理。
- `failed`：本地执行或云端通信失败；先看云端 attempt 状态，不要直接重跑。

租约续期失败后 Agent 会停止候选上传与终态报告，避免另一个执行器接管后出现重复结果。
