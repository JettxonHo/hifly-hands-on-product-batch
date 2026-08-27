# 2026-08-27 REL-001 可信 TLS 仓库门禁

## 范围与边界

- 固定 base：`4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`
- 工作分支：`codex/rel-001-trusted-tls`
- 本轮只触及 REL-001 allowlist：Nginx 模板、Production Compose、两组生产测试、发布清单、当前状态、Roadmap 和本接力记录。
- 这是仓库候选，不是部署动作。没有 SSH、没有部署、没有访问 Hifly/Provider、没有创建任务或消耗积分（Hifly=0，points=0）；没有启动 Cloud Executor、Worker 或 Local Agent。

## 合同实现

`deploy/nginx/default.conf` 现作为官方 Nginx `templates` envsubst 模板使用：

- Compose 只读挂载到 `/etc/nginx/templates/default.conf.template`，Proxy 传入 `PUBLIC_HOST`，并将
  `NGINX_ENVSUBST_FILTER` 锁为 `^PUBLIC_HOST$`，避免 `$host`、`$request_uri` 等 Nginx 运行时变量被替换。
- 公网 80 仅为精确 `${PUBLIC_HOST}` 提供 `308 https://${PUBLIC_HOST}$request_uri`；default server 对未知 Host
  以 `444` fail closed，不反射攻击者的 Host，也覆盖 `/healthz`。
- Proxy 健康监听为容器 loopback `127.0.0.1:8080`，Compose healthcheck 只访问该端口，8080 不发布到宿主机。
- 公网 HTTPS（包括 `/healthz`）走同一普通 App proxy，不覆盖 Host/Origin；既有 trusted Host/Origin gate 继续负责拒绝不可信请求。
- HTTPS 增加保守 HSTS `max-age=31536000`，没有 `includeSubDomains` 或 `preload`；身份与 Secure Cookie 合同未改动。

## RED → GREEN 证据

旧 head（固定 base）运行：

```text
node --test test/production-deployment.test.js
5 pass / 1 fail
```

失败为新增 TLS/Compose 合同（无 PUBLIC_HOST-only 模板、可信固定 Host 重定向、loopback health 等）。生产启动测试新增的 Secure Cookie、bad Host 和 bad Origin 断言在旧 head 已先行通过，证明身份逻辑本身无需改写。

实现后运行：

```text
node --test test/production-deployment.test.js test/production-start.test.js
21 pass / 0 fail

node --test test/production-deployment.test.js test/production-start.test.js \
  test/server-security.test.js test/identity-routes.test.js test/startup.test.js
45 pass / 0 fail

npm run check
Checked 248 JavaScript file(s).

git diff --check
PASS
```

Compose 使用 `POSTGRES_PASSWORD` 的一次性非敏感占位值和 `PUBLIC_HOST=pilot.example.test` 做静态渲染检查；实际 Proxy 容器环境确认 `NGINX_ENVSUBST_FILTER` 为 `<^PUBLIC_HOST$>`。该检查只验证模板/环境语义，不代表已启动正式服务或完成公网 TLS 验收。

另使用官方 `nginx:1.30.4-alpine` 镜像、一次性测试证书和测试域名实际执行容器入口的 envsubst 与
`nginx -t`，配置检查通过；测试证书与精确 Compose 测试资源随后均已删除。该证据只证明仓库模板可由目标镜像正确生成并加载，
不证明正式域名、可信证书或公网入口已经部署。固定 base 的干净依赖审计为 `0 critical / 0 high / 2 moderate`，剩余两项是
既有 ExcelJS → uuid 链路；本轮没有修改依赖。

## 运行时与发布边界

当前部署仍是 IP + 自签证书的内部试运行；本轮没有替换其配置、证书或流量，也没有声称严格 CA、浏览器信任、正式域名 DNS 或 HTTP→HTTPS 已在公网运行。正式域名、DNS、可信证书、维护窗口和 SSH/部署授权仍需由 Owner/部署负责人另行提供后，按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 验收。
候选中的 HSTS 只能与正式可信证书在同一维护窗口部署；不得先部署到当前自签 IP 入口，也不得用关闭严格 CA 校验替代证书验收。

2026-08-27 对当前公网入口 `8.163.60.0` 的无登录只读复核进一步确认：

- `http://8.163.60.0/healthz` 返回 200 且没有 HTTPS redirect；`https://8.163.60.0/healthz` 只有在跳过证书校验时返回 200，
  严格校验为 curl 60 / verify result 18。
- 证书 subject 与 issuer 均为 `CN=8.163.60.0`，有效期为 2026-08-09 至 2026-09-08，属于自签证书；公网响应没有 HSTS。
- 公网 `works.js`、`works.css`、`works.html`、`assets.js`、`assets.css`、`assets.html` 六个文件的字节 SHA-256
  逐项精确匹配 `8787b60c82f928a1277467b95868ae47d011ec64`，并逐项不同于当前
  `main@4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`。`workspace.html`、`workspace.css` 与各 Stage workspace 脚本在公网均为 404，
  与旧提交中尚无单任务工作区资源一致。

这组证据只证明当前公网静态 Web bundle 与 `8787b60c` 一致，不能单独证明后端进程、数据库 migration、Worker、Profile 或 volume
的精确运行版本；但足以排除 `main@4ae506e` 和本 PR 已经部署的误判。全程没有 SSH、身份登录或生产写入。
