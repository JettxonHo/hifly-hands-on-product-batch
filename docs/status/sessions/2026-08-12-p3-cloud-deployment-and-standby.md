# 2026-08-12 P3 阿里云部署与 standby 验证

## 授权边界

Owner 授权部署当前 main、数据库备份、production migration、应用重建和无副作用 Local Agent standby。未授权本轮真实飞影生成，因此禁止领取生产工单、开启 real executor 或执行任何可能扣除飞影积分的动作。

## 部署证据

- 部署前提交：`cf1367913bd19bbc6c255288db94ad4c1950668e`
- 部署后提交：`d6e1f5093ee63cbfdb82e9d98eddca90874a5193`
- 数据库备份：`hifly-20260812T073732Z.dump`，444 KB，容器持久备份目录内文件非空。
- 回滚镜像：`hifly-pilot-app:rollback-cf13679`
- GitHub 直连在 `git pull` 阶段因 443 超时失败；该失败发生在代码更新、构建、migration 和重启之前，线上旧版本保持健康。随后由本机生成只包含目标提交范围的 Git bundle，经 SSH 传输并在服务器仓库执行 fast-forward。
- 仓库 Dockerfile 在提交范围内未变化；服务器专用 Dockerfile 仍只保留已记录的阿里云 Debian apt 镜像替换。
- 新应用镜像构建成功。构建期报告既有 npm 依赖审计告警，本轮未执行可能改变依赖合同的自动修复。
- production migration 顺序中的 13 个模块全部成功：identity、assets、projectContent、copyGeneration、copyQuality、copyReview、avatarSelection、videoPlanning、productionOrders、manualHandoff、manualExecution、artifactVerification、workDelivery。
- app、postgres、proxy 三个容器均为 healthy；服务器本机和公网 HTTPS `/healthz` 均返回 `{"status":"ok"}`；应用日志确认监听 `0.0.0.0:3000`。

## Standby 证据

Mac Local Agent 使用仓库外私有云端配置和人物映射执行默认 `npm run local-agent:run-once`：

```text
local_agent_http { operation: 'heartbeat', status: 200 }
local_agent_standby {}
```

命令未设置 fake/real executor 开关，也未传入 `--real`，因此没有 claim、handoff 下载或 Provider 调用。

## 外部影响与下一步

- 未访问 Hifly 或 DeepSeek。
- 未领取或修改生产工单。
- 飞影积分消耗 0；standing authorization 仍剩余 4 次。
- 下一步在已部署环境登记第 2 张合成人物候选，取得权威 AssetVersion ID 后写入 Mac 私有映射；随后为三个商品逐条完成批准链和串行真实验收。
