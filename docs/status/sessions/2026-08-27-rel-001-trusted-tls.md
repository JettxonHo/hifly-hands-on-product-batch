# 2026-08-27 REL-001 可信 TLS 仓库门禁

## 范围与边界

- 固定 base：`4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`
- 工作分支：`codex/rel-001-trusted-tls`
- 本轮只触及 REL-001 allowlist：Nginx 模板、Production Compose、生产测试、systemd 每日备份候选、发布清单、当前状态、Roadmap 和本接力记录。
- 这是仓库候选，不是部署动作。Owner 后续允许域名以外的生产化工作，因此完成了一次严格只读 SSH 审计和隔离备份恢复演练；没有部署、重启或修改生产服务，没有访问 Hifly/Provider、创建任务或消耗积分（Hifly=0，points=0），没有启动 Cloud Executor、Worker 或 Local Agent。

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

当前部署仍是 IP + 自签证书的内部试运行；本轮没有替换其配置、证书或流量，也没有声称严格 CA、浏览器信任、正式域名 DNS 或 HTTP→HTTPS 已在公网运行。Owner 明确表示备案尚未完成，域名相关部署暂不执行；待备案、正式域名、DNS 与可信证书条件具备后，再按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 安排维护窗口和发布验收。
候选中的 HSTS 只能与正式可信证书在同一维护窗口部署；不得先部署到当前自签 IP 入口，也不得用关闭严格 CA 校验替代证书验收。

## 每日数据库备份仓库候选 RED → GREEN

固定 base 在加入备份 seam 后先运行：

```text
node --test test/production-deployment.test.js
6 pass / 1 fail
```

唯一失败为三个 systemd 候选文件尚不存在（`ENOENT deploy/systemd/hifly-pilot-backup.service`）。实现后：

```text
node --test test/production-deployment.test.js
8 pass / 0 fail
sh -n deploy/systemd/run-hifly-backup.sh
PASS
git diff --check
PASS
```

与既有生产启动门禁合并运行的 focused 结果为 `23 pass / 0 fail`。

行为测试使用临时 PATH fake `docker` 实际 spawn runner：backup 返回非零时只发生一次 app exec 且不会进入校验；校验返回非零时两次 app exec 后整体返回该错误；全绿时恰好两次固定 Compose `exec -T app`。临时 fake 文件在测试结束后清理，不接触生产容器或数据库。

Review 收紧 service 不拉起 Docker、取消静默 `ConditionPathExists`，并改为每轮 exact artifact 后，旧候选在同一测试 seam 为 `6 pass / 2 fail`；修复后回到 `8 pass / 0 fail`。

service 固定 `/opt/hifly-pilot`，仅在 Docker 排序之后运行（不由 timer 拉起 Docker），设置 `UMask=0077`、
`NoNewPrivileges=true` 和 `TimeoutStartSec=900s`；timer 使用 `OnCalendar=daily`、`Persistent=true`、
`RandomizedDelaySec=15m`。runner 每次生成唯一 `/var/backups/hifly/hifly-systemd-<UTC timestamp>-<pid>.dump`，
在既有 `app` 容器内显式 `umask 077` 后执行 `npm run db:backup -- --output <exact path>`，再在同一容器对该 exact
路径运行 `pg_restore --list`，不含删除/保留清理、上传、直接生产连接或自动重试。
容器内 `umask 077` 的目标是让新建 dump 按常规 `0666 & ~umask` 形成 `0600`，不改变既有 volume 或历史备份权限。

对当前生产 App 容器做的只读版本检查记录 `find (GNU findutils) 4.9.0` 与 `pg_restore (PostgreSQL) 15.18`；exact-path runner 不依赖目录扫描，
仅使用后者做归档校验；本次检查没有运行备份、读取数据库内容或修改服务。

本轮只做仓库候选和静态/语法验证；没有在服务器安装、enable、start 或运行该 timer，没有生成/恢复生产备份。
当前主机无该 timer/cron 的事实仍保持；正式域名、DNS、可信证书和严格 CA 仍 deferred。

2026-08-27 对当前公网入口 `8.163.60.0` 的无登录只读复核进一步确认：

- `http://8.163.60.0/healthz` 返回 200 且没有 HTTPS redirect；`https://8.163.60.0/healthz` 只有在跳过证书校验时返回 200，
  严格校验为 curl 60 / verify result 18。
- 证书 subject 与 issuer 均为 `CN=8.163.60.0`，有效期为 2026-08-09 至 2026-09-08，属于自签证书；公网响应没有 HSTS。
- 公网 `works.js`、`works.css`、`works.html`、`assets.js`、`assets.css`、`assets.html` 六个文件的字节 SHA-256
  逐项精确匹配 `8787b60c82f928a1277467b95868ae47d011ec64`，并逐项不同于当前
  `main@4ae506e2250d0b0e457ab4d10d3c8c8d11550b76`。`workspace.html`、`workspace.css` 与各 Stage workspace 脚本在公网均为 404，
  与旧提交中尚无单任务工作区资源一致。

这组公网证据只证明当前静态 Web bundle 与 `8787b60c` 一致，不能单独证明后端进程、数据库 migration、Worker、Profile 或 volume
的精确运行版本；但足以排除 `main@4ae506e` 和本 PR 已经部署的误判。该公网探针没有身份登录或生产写入；后续只读 SSH 证据见下节。

## Owner 授权的非域名只读 SSH 与恢复演练

Owner 在说明备案暂不可做后，明确允许继续域名以外的生产化工作。使用现有 `hifly-pilot` SSH 别名、BatchMode、严格 host-key
校验完成只读审计；没有读取或输出 secret、Cookie、Token、密码或私钥内容。

- `/opt/hifly-pilot` 为干净 `main@8787b60c82f928a1277467b95868ae47d011ec64`；运行中 App 镜像 OCI revision 也是该精确提交。
  App、PostgreSQL、Proxy 均为 healthy、restart count=0；Cloud Executor 容器不存在。
- 运行标志为 `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`。
  宿主机只监听 22/80/443；App 3000、PostgreSQL 5432 和任何 Executor/noVNC 端口均未发布。
- 当前 Nginx 仍是旧配置：公网 HTTP 使用 `$host` 301，公开 `/healthz` 覆盖为内部 Host，未启用 HSTS。证书仍是
  `CN=8.163.60.0` 自签，2026-09-08 到期；与前述公网严格 CA 失败一致。
- 生产数据库有 92 张 public tables、13 个 schema migration ledger；各 ledger 版本与当前部署代码一致。
- 受保护备份 volume 中最新文件为 `hifly-20260824T132240Z.dump`（620806 bytes），`pg_restore --list` 可读。
  服务器没有 Hifly backup systemd timer 或 cron 证据，因此目前仍是人工备份，且本轮没有证明异机/异地副本。
- 使用缓存的 `postgres:15-alpine`、`--network none`、独立临时容器和独立临时 volume 对该最新备份做完整恢复演练；恢复结果为
  92 张 public tables 和 13 个 migration ledger。演练后精确删除 `hifly-rel001-restore-verify-20260827` 容器及
  `hifly-rel001-restore-verify-data-20260827` volume，生产数据库与三项服务始终未停止且继续 healthy。
- 当前 App 回滚镜像与多代历史回滚镜像仍在本机；本轮没有切换镜像。主机 `ufw` 为 inactive，SSH 禁用密码但允许 root key login、
  X11 与 TCP forwarding；这些配置是否由云安全组充分补偿尚无 Provider 控制台证据，属于非域名生产 hardening 后续项。

## 既有 Work 登录鉴权下载复验

Owner 在 Chrome 的当前生产页手动完成登录后，只对既有 Work
`80958749-9f92-40e6-a30e-7c886b555ef6` 执行下载复验。没有读取或输出 Cookie、密码或会话存储；短时下载 token 在日志读取前脱敏，
没有写入文档。

- 作品库 exact URL 成功恢复 `iPad 平板电脑`，页面状态为“待检查”，交付记录为“尚无记录”。
- “加载预览”创建短时下载授权；Proxy 访问日志记录授权 POST 为 201。
- 同一 Work 的下载 GET 返回 200；完整响应发送 `43,425,097` bytes。浏览器工具没有暴露可持久校验的本地文件路径，因此没有把按钮触发或
  临时资产打包失败冒充客户端 SHA 证据。
- 对服务器只读输出卷的同大小源文件重新执行 `wc -c` 与 `sha256sum`，结果为 `43,425,097` bytes，SHA-256
  `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`，与页面授权元数据精确一致。
- 下载后页面仍为“待检查 / 尚无交付记录”；没有点击检查通过、返工、交付、创建、生成或重试，没有启动 Worker/Local Agent，
  没有访问 Hifly/Provider，积分消耗 0。唯一短时状态是下载授权，不是 Work/Inspection/Delivery 业务状态变更。

尚未完成的非域名项包括：把每日备份候选实际安装并验收、异机备份、监控/告警、主机防火墙及 SSH 最小权限收口。
它们不得用本次只读审计、隔离恢复演练或鉴权下载复验冒充已完成。
