# VSA-A01 企业身份与组织上下文

权威来源：Issue #57、D-024、D-026、D-028、D-030。

## 业务状态

- Member：`pending_activation → active → disabled`。
- A01 不提供 `disabled` 的重新启用命令。
- 管理员重置密码只会为非 disabled 成员追加新临时凭据、标记
  `requires_password_change` 并撤销现有会话；不会重新启用 disabled 成员。
- Role 位于 Membership，取值为 `admin` 或 `member`。

## 正式 HTTP 入口

| 方法与路径 | 权限 | 结果 |
|---|---|---|
| `GET /api/auth/intent` | 公开、精确 allowlist | 创建匿名登录 intent 和每会话 CSRF |
| `POST /api/auth/login` | intent + CSRF | 登录或进入受限的首次改密状态 |
| `POST /api/auth/change-password` | password_change intent + CSRF | 追加凭据并激活成员 |
| `GET /api/auth/me` | 已认证 | 返回服务端解析的 Member/Membership/Organization |
| `POST /api/auth/logout` | 有效会话 + CSRF | 撤销会话并清 Cookie |
| `GET /api/identity/members` | admin | 查看当前 Organization 成员状态 |
| `POST /api/identity/members` | admin + CSRF | 预创建成员；临时密码仅本次响应显示 |
| `POST /api/identity/members/:id/reset-password` | admin + CSRF | 追加临时凭据；需 `expected_revision` |
| `POST /api/identity/members/:id/disable` | admin + CSRF | 停用并撤销会话；需 `expected_revision` |

客户端提交的 `organization_id` 不参与授权或对象归属。所有成员命令都使用 session
解析的 Organization，并将跨 Organization 的 member id 当作不存在处理。

A01 只创建一个可进入的 Organization，也不提供创建第二个 Organization 或切换
Organization 的产品入口。原本地批次工作台保留为单 Organization 兼容数据；A01 不把
历史 batch/artifact JSON 改造成多租户模型。后续 VSA 业务对象必须从 session 继承
Organization 归属，并在各自 Issue 中交付跨 Organization 拒绝测试。

首次改密会话访问 `GET /api/auth/me` 时只返回 `password_change_required`，不返回
Organization 数据；登录页刷新后据此恢复“设置新密码”界面。其他 Organization API
继续返回 `PASSWORD_CHANGE_REQUIRED`，直到改密事务完成。

## 幂等与并发

- 登录和首次改密以服务器 session intent 为幂等边界。
- 相同 session + 相同请求返回原业务结果，不追加 session/audit；相同 session + 冲突请求返回 `AUTH_INTENT_CONFLICT`。
- 并发首次改密只接受一个密码；另一份不同密码的并发请求返回 `AUTH_INTENT_CONFLICT`，不会误报成功。
- Member 生命周期写入比较 `row_version`；旧版本返回 `MEMBER_VERSION_CONFLICT`。
- disabled 在每次受保护请求时通过 PostgreSQL 重新检查，不依赖前端状态。

## 数据与安全

- PostgreSQL 是唯一生产身份库。应用启动只校验 migration 版本，不自动执行生产 migration。
- 密码凭据和 AuditEvent 都是 append-only；数据库 trigger 拒绝 UPDATE/DELETE。
- session/CSRF 原始 token 只存在于浏览器 Cookie；数据库只存 SHA-256 digest。
- session Cookie 为 HttpOnly、SameSite=Strict，生产默认 Secure；CSRF Cookie 可由同源 JS 读取并通过 `x-identity-csrf` 回传。
- 身份模式要求显式可信 Host/Origin。身份关闭时继续使用原本的 loopback 本地工作台 guard。
- 未知邮箱仍执行固定 scrypt 校验；scrypt 参数有资源上限。
- 当前登录限流是单进程最小实现。多实例生产前必须补共享网关或数据库限流。

## 非目标

SSO、MFA、公开注册、多 Organization 切换、完整 RBAC、重新启用 disabled 成员、
Hifly、Local Agent、Playwright 与影刀集成都不属于 A01。
