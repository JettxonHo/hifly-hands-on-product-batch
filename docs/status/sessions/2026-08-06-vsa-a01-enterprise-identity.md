# 2026-08-06 VSA-A01 企业身份与组织上下文

## 本轮目标

- 开发 GitHub Issue #57（VSA-A01）。
- 使用独立 worktree `hifly-vsa-a01-identity-dse` 与分支 `feat/vsa-a01-enterprise-identity`。
- 完成实现与自检后交回主 Agent；本实施 Agent不 commit、不 push、不创建 PR，不关闭 Issue #57、不开始 A02。

## 完成内容

- 已核对 D-024、D-026、D-028、D-030 与 Issue #57。
- 已纠正原半成品 ADR 对 D-026 的错误解释：身份数据必须以 PostgreSQL 为权威存储，不能以 JSON 文件库作为 A01 最终实现。
- 已完成 PostgreSQL migration、正式 repository、显式 migration 命令和 identity-enabled fail-closed 启动。
- 已完成工作邮箱登录、服务器侧受限 session intent、首次强制改密、单 Organization 自动上下文和安全退出。
- 已完成管理员创建/查看/重置/停用成员，普通成员权限拒绝，Member optimistic concurrency，disabled 每请求失效。
- 已完成 append-only 密码凭据与 AuditEvent；一次性临时密码只在创建/重置命令响应显示。
- 已完成可信 Host/Origin、每会话 CSRF、生产默认 Secure Cookie；identity-disabled 旧本地 GUI 行为保持不变。
- 登录与首次改密按 session intent 幂等；会话绑定登录 credential id，不对普通业务 payload 增加哈希。
- 已完成外链登录/成员管理资源和真实浏览器登录→强制改密→退出 smoke。
- 已增加独立 Ubuntu PostgreSQL CI job；普通 Ubuntu/Windows Node 22 job 不依赖数据库。
- 独立 Review 发现并修复并发首次改密冲突：两个不同密码并发提交时只允许一个成功，另一个返回 `AUTH_INTENT_CONFLICT`；Memory 与 PostgreSQL 路径均有回归覆盖。
- 管理员成员列表改用公开成员投影，不再返回内部 `current_password_credential_id`。
- Organization 边界已明确：A01 的正式租户对象是 Organization/Member/Membership/Session/AuditEvent；旧 batch/artifact 是单 Organization 兼容数据，不在 #57 内扩成多租户模型，后续 VSA 对象须逐 Issue 落地归属检查。
- 首次改密页面支持刷新恢复；恢复接口只返回改密状态，不提前暴露 Organization 数据，浏览器 smoke 已覆盖刷新后继续改密并进入工作台。
- 首次改密会话直接访问成员管理页会返回登录/改密页，不再读取不存在的 membership；真实浏览器 smoke 已覆盖。
- 独立 Reviewer 最终结论为 `APPROVED`，并确认无剩余 blocker/important。
- 已创建 ready PR #71：https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/71 。GitHub Actions run `31072901893` 的 Ubuntu、Windows 与 PostgreSQL 三项检查全部通过。

## 长期工程约束

用户明确要求安全校验保持克制：

- 项目不是安全攻防论文，禁止过度防御。
- 除重大核心安全隐患外，不新增哈希或 SHA-256。
- 不为基本不可能出现的 case 反复堆叠防御。
- Rubric 和验收不得机械化过度。
- 密码不可明文存储、会话 Bearer Token 不可明文落库属于身份核心安全风险，允许使用标准密码哈希与 Token 摘要。

该约束已同步写入项目级 `AGENTS.md`。

## 飞影与积分

- 本轮不访问飞影，不运行真实 Hifly HTTP/Playwright 生产，不消耗积分。
- `MULTI-002` 保持 pending，未执行。

## 验证结果

```
node --test test/identity-*.test.js test/startup.test.js
  identity/auth/routes targeted tests passed

IDENTITY_BROWSER_SMOKE=1 node --test test/identity-browser.test.js
  1/1 passed（使用本机系统 Chrome；CI 使用 Playwright Chromium）

PostgreSQL 16 clean migration + test/identity-postgres.integration.test.js
  1/1 passed

npm run check
  Checked 80 JavaScript file(s)

IDENTITY_TEST_DATABASE_URL=... npm test
  581 total / 564 passed / 0 failed / 17 skipped

npm run validate
  Validated 3 product row(s)

git diff --check
  passed

high-confidence secret scan
  0 findings
```

`npm audit --omit=dev` 通过官方 registry 返回 5 high / 2 moderate 既有依赖告警。修复涉及
`@fastify/static`、`sharp` 等跨主要版本升级，需独立回归，未混入 A01。

## 残余风险与明确未做

- 登录限流是单进程最小实现；多实例部署前需由共享网关或数据库提供统一限流。
- 本轮不实现 SSO、MFA、公开注册、多 Organization 切换、完整 RBAC 或 disabled 重新启用。
- 旧本地 batch/artifact 数据未增加 Organization 字段；这是单 Organization 兼容边界，不得部署成多 Organization 共享数据面。A02/A03 起的新领域对象必须携带并校验 Organization 归属。
- 本轮不开发或调用 Hifly、Local Agent、Playwright 出片与影刀。
- PostgreSQL 集成和真实浏览器 smoke 已在本地通过；Ubuntu/Windows GitHub Actions 需由主 Agent 创建 PR 后确认。

## 下一步

1. 等待用户对 PR #71 的 merge 与 Issue #57 关闭给出单独授权。
2. 未获授权前不 merge、不关闭 Issue #57、不开始 VSA-A02。
