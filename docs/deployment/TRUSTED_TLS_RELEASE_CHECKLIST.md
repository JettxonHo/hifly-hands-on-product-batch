# 可信 TLS 发布检查清单

本文用于把当前自签 IP 证书的内部试运行入口升级为浏览器默认信任的 HTTPS 入口。仓库当前没有正式域名，
因此本文只提供操作合同，不表示可信证书已经签发、部署或验证。

## 当前边界

- 当前公网 IP 使用自签证书，严格 CA 校验会失败，只允许受控内部试运行。
- 在域名、DNS 和可信证书完成前，不得对客户宣称公网生产就绪。
- 证书和私钥必须位于仓库外，由 `TLS_CERT_DIR` 只读挂载；不得进入 Git、镜像、日志或工单。
- 本次发布就绪工作不修改 Nginx 的既有证书文件合同：`fullchain.pem` 与 `privkey.pem`。

## REL-001 仓库候选（尚未部署）

当前分支只提供可审查的仓库候选，不改变正在运行的入口。候选的
`deploy/nginx/default.conf` 是官方 Nginx `templates` envsubst 模板，Compose 将它只读挂载到
`/etc/nginx/templates/default.conf.template`，并仅向 envsubst 暴露锚定变量过滤器
`NGINX_ENVSUBST_FILTER=^PUBLIC_HOST$`。因此 Nginx 的 `$host`、`$request_uri` 等运行时变量不会被
容器启动脚本误替换。

- 公网 HTTP 只为精确配置的 `PUBLIC_HOST` 提供 `308 https://${PUBLIC_HOST}$request_uri`；未知 Host
  命中 default server 并以 `444` 关闭连接，绝不把请求 Host 反射进重定向。
- `/healthz` 的容器健康检查只监听 Proxy 容器 loopback `127.0.0.1:8080`，Compose proxy
  healthcheck 也只访问该地址；8080 不发布到宿主机。公网 HTTPS（包括 `/healthz`）走普通 App proxy，
  不再覆盖 Host/Origin，由既有 trusted Host/Origin gate 决定是否放行。
- 精确 HTTPS server 仅增加 `Strict-Transport-Security: max-age=31536000`；本候选不启用
  `includeSubDomains` 或 `preload`。App 的 Secure Cookie 与身份逻辑保持原合同。

这组规则只有仓库测试与静态 Compose/Nginx 配置证据；没有在当前 IP 自签入口部署或做严格 CA 验收。
当前 IP 自签部署仍属于内部试运行状态。正式域名、DNS、可信证书和严格 CA/browser 验收完成前，不能把
该候选称为公网生产入口。
包含 HSTS 的 Nginx 候选必须与正式可信证书在同一维护窗口一次性部署；不得先把 HSTS 候选部署到当前
IP 自签入口，也不得以关闭严格 CA 校验来代替正式证书验收。

## 1. Owner 前置输入

开始签发前必须由 Owner 或部署负责人提供并确认：

1. 正式 HTTPS 域名，以及该域名允许用于当前业务。
2. DNS A/AAAA 记录指向目标入口；如适用，备案和其他合规手续已完成。
3. 云安全组和主机防火墙允许证书签发所需的验证流量以及正式 80/443 流量。
4. 选择可信证书来源与续期负责人；不得为了绕过信任问题继续沿用自签证书。
5. 明确维护窗口、数据库备份和应用/Proxy 回滚点。

## 2. 签发与安装

1. 通过云厂商证书服务或 ACME 客户端为正式域名签发证书；不要把示例域名写入生产配置。
2. 在仓库外准备独立证书目录，并安装：

   ```text
   fullchain.pem
   privkey.pem
   ```

3. 目录权限设为仅部署管理员可访问，私钥不得对普通用户可读。
4. `.env` 中设置真实 `PUBLIC_HOST`、`PUBLIC_ORIGIN=https://<正式域名>` 和
   `TLS_CERT_DIR=<仓库外证书目录>`；敏感值不提交 Git。
5. 在切换流量前运行 `docker compose -p hifly-pilot -f docker-compose.production.yml config`，确认
   Proxy 只读挂载正确目录，App/PostgreSQL 没有新增公网端口。

## 3. 无副作用验收

部署负责人完成实际证书安装后，至少验证：

1. `https://<正式域名>/healthz` 在不使用 `-k` 或自定义 CA 的情况下返回 200。
2. 常用桌面和移动浏览器不显示证书警告；证书域名、完整链和有效期正确。
3. HTTP 自动跳转到同一正式域名的 HTTPS；登录、退出和 Secure Cookie 正常。
4. Host/Origin 白名单只包含实际入口，错误 Host/Origin 继续被拒绝。
5. 登录后可查看项目与作品，并使用既有成功 Work 做一次不生成新视频的鉴权下载复验。
6. App、PostgreSQL、Proxy 健康，Cloud Executor 保持既定 disabled/fail-closed，未创建新 attempt。

验收记录应包含域名、证书颁发者、有效期、验证时间、部署版本和回滚点，但不得包含私钥、Cookie 或 Token。

## 4. 续期与回滚

- 在到期前设置续期提醒或自动续期，并安排一次续期后的严格 CA 验证；续期失败必须告警。
- 替换证书前保留上一份可用证书和 Proxy 配置回滚点，但两者都留在受保护的运维目录。
- 新证书导致 Proxy 或 HTTPS health 失败时，停止发布并恢复上一份证书；不要通过关闭 TLS 校验继续上线。
- 只有可信证书部署、严格 CA 校验和浏览器验收均完成后，才能关闭本清单中的 TLS 发布阻断。
