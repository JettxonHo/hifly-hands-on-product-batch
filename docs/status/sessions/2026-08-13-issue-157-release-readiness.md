# Issue #157 发布就绪：生产依赖与可信 TLS

## 范围与边界

- 固定基线：`origin/main@7f3e69bac71026b0a7ebd228985c255fb78dd338`。
- 只处理生产依赖 critical/high 风险和可信 TLS 的仓库侧操作合同。
- 未部署、未 SSH、未访问飞影、未启动 Worker、未修改生产数据，也未消耗积分。
- 当前服务器仍使用自签 IP 证书；本文不宣称可信 TLS 或公网生产已经完成。

## 生产依赖审计

使用官方 registry 运行：

```bash
npm audit --registry=https://registry.npmjs.org --omit=dev --json
```

初始结果为 `0 critical / 20 high / 1 moderate`。可达生产调用点包括：

- `@fastify/static`：由 `src/server/app.js` 注册并直接服务前端静态资源。
- `fastify`：生产 HTTP 服务框架；其 `find-my-way`、`fast-uri` 属实际请求路径。
- `sharp`：`src/server/upload-service.js` 用于上传图片解码和校验。
- `archiver`：`src/manual-handoff/manual-handoff-package-store.js` 用于生成交接 ZIP；同时也是 ExcelJS 的传递依赖。
- `exceljs`：`src/import/import-table.js` 读取用户上传的 XLSX；现有导入层在解析前限制文件大小、条目数量、
  路径、加密内容、外部链接和展开量。

采用逐项、固定版本升级，没有运行 `npm audit fix --force`：

| 依赖 | 原版本 | 当前版本 | 兼容性证据 |
|---|---:|---:|---|
| `@fastify/static` | 8.3.0 | 10.1.3 | 官方兼容表声明 8.x 及以上支持 Fastify 5；服务 API 回归通过 |
| `fastify` | 5.10.0 | 5.11.3 | 同一 major；服务 API 回归通过 |
| `sharp` | 0.34.5 | 0.35.3 | 项目 Node 22 满足 `>=20.9.0`；图片上传回归通过 |
| `archiver` | 5.3.2 | 8.0.0 | 官方 8.0 ESM 命名导入；交接 ZIP 公共路径回归通过 |
| `find-my-way` | 9.6.0 | 9.7.0 | 传递依赖更新到 advisory 修复版本 |
| `fast-uri` | 3.1.3 / 4.1.0 | 3.1.5 / 4.1.2 | 各传递依赖更新到对应 advisory 修复版本 |
| `brace-expansion` | 多个旧版本 | 1.1.18 / 2.1.4 / 5.0.9 | 各依赖树更新到对应 major 的修复版本 |

## TDD 与兼容性证据

- RED：升级到 Archiver 8 后，`src/manual-handoff/manual-handoff-package-store.js` 的默认导入在 Node ESM
  模块加载时失败：`does not provide an export named 'default'`。
- GREEN：按 Archiver 8 官方入口改为 `ZipArchive` 命名导入和构造；ZIP 生成、XLSX 导入、图片上传及服务 API
  聚焦回归共 `102/102` 通过。
- 该修改不改变 ZIP 内容合同、文件名、下载 API 或业务状态。

升级后的官方 registry 审计为 `0 critical / 0 high / 2 moderate`。两项 moderate 是 ExcelJS 聚合其
`uuid@8.3.2` 的同一 advisory（为 v3/v5/v6 提供 `buf` 时缺少边界检查）。仓库没有 UUID 调用，ExcelJS
当前也没有可安装的修复版本，因此保留 ExcelJS 并记录以下边界：

1. 只通过既有受限 XLSX 导入入口使用 ExcelJS，不暴露 UUID API。
2. 不新增对 ExcelJS 内部 UUID v3/v5/v6 buffer 接口的调用。
3. 在 ExcelJS 发布包含修复的版本、依赖锁发生变化，或最迟于 2026-09-13 时重新运行官方审计并复核。

## 可信 TLS

- 新增 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md`，明确正式域名/DNS/合规前置、仓库外证书挂载、
  严格 CA/浏览器/Host/Origin/鉴权下载验收以及续期和回滚。
- 当前没有正式域名，未签发或部署可信证书；自签入口继续只允许内部试运行。
- 后续真实证书、DNS、SSH 和部署均需要独立的生产变更门禁和验收记录。

## 验证

- `npm ci`：从更新后的 lockfile 干净安装成功。
- 聚焦公共回归：`102 passed / 0 failed`。
- `npm run check`：229 个 JavaScript 文件通过。
- `npm test`：1017 tests，971 passed、0 failed、46 skipped。
- `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high`：
  0 critical、0 high、2 moderate；高风险门禁通过。
- `git diff --check`：通过。
- CI 结果由固定 PR head 完成后写入审阅记录；以上均为本地仓库证据，不代表版本已经部署或被用户采用。
