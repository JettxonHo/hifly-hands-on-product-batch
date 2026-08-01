# Session: 2026-08-01 Windows CI Path Contract Fix

## 基本信息

- **日期**：2026-08-01 ~ 2026-08-02
- **执行者/工具**：Claude Fable 5 (Claude Code)
- **基线 commit**：`4349a47` (docs: update CURRENT.md and session doc after Phase 7 completion)

## 目标

修复 GitHub Actions CI 在 windows-latest 上的 10 个测试失败，建立跨平台路径契约。

## 10 个失败分类

| # | 测试 | 根因分类 |
|---|------|---------|
| 1 | downloadArtifact prefixes repeated suggested filenames | 路径分隔符：`path.relative` 产出 `\` |
| 2 | capture_http real_live writes transport artifact bytes | 路径分隔符：同上 |
| 3 | auto_pool rotates category images and falls back to default | 路径分隔符：`path.join` 产出 `\` |
| 4 | auto_pool resolves mixed-case categories against a relative pool root | 路径分隔符：同上 |
| 5 | copies external person images into batch-local rpa inputs | realpath 大小写：async vs sync realpath 在 Windows temp 目录大小写不一致 |
| 6 | capture queue-run API completes three fake items | 路径分隔符：artifact relative_path |
| 7 | capture queue-run API completes static captured responses | 路径分隔符：同上 |
| 8 | capture queue-run API resumes failed and interrupted items | 路径分隔符：同上 |
| 9 | real-live run API executes one capture item | 路径分隔符：同上 |
| 10 | createAsset surfaces failed_remote without waiting for its timeout | 竞态：固定 setTimeout(20ms) 在 Windows 不足以等待 RPA state 文件创建 |

## 路径契约决策

- **本机文件系统路径**：OS 原生格式（用于 fs 操作、path.resolve 等）
- **持久化和接口相对路径**：统一 POSIX `/` 分隔符（用于 batch.json、artifact registry、API JSON、RPA package）
- 实现：`src/core/portable-path.js` 提供 `toPortableRelativePath`、`relativePortablePath`、`fromPortablePath`、`assertSafeRelative`
- 禁止 `value.replaceAll("\\", "/")` 作为唯一安全处理
- 必须先验证安全性（非绝对、无 `..`、无空段），再转换格式

## 修改文件

### 生产代码
- `src/core/portable-path.js`（新建）
- `src/person-pool.js`：pool 文件相对路径用 `toPortableRelativePath`
- `src/core/person-strategy.js`：resolved person image 相对路径用 `toPortableRelativePath`
- `src/executors/capture-http-executor.js`：artifact `relative_path` 用 `toPortableRelativePath`
- `src/hifly-page.js`：download artifact `relative_path` 用 `toPortableRelativePath`

### 测试修复
- `test/yingdao-rpa-executor.test.js`：`waitForRpaState` 轮询替代固定 setTimeout
- `test/rpa-task-package.test.js`：`realpathSync` 替代 `await realpath` 保证一致

### 回归测试
- `test/portable-path.test.js`（新建，15 个测试）

### CI
- `.github/workflows/ci.yml`：actions/checkout@v5 + setup-node@v5

## 验证命令

```
npm run check: 66 JavaScript file(s) ✓
npm test: 404 pass / 16 skipped / 0 fail ✓
npm run validate: 3 product rows ✓
git diff --check: clean ✓
```

## Git / PR / Issue

- 分支：`fix/windows-path-contract`
- PR：待创建
- Issue #18：待 CI 全绿后关闭

## 真实飞影访问情况

- 是否访问飞影：**否**
- 是否消耗积分：**否**

## CI 历史纠正

PR #16 成功建立 CI，但其 Windows job 当时失败。此前"Ubuntu + Windows 全绿"的中途汇报不准确。Issue #18 用于修复该事实上的红色门禁。

## GitHub Actions 最终结果

- PR #29 CI: ubuntu ✓ windows ✓ (run 30707990471)
- PR #29 merged → main push CI: ✓ (run 30708054279)
- PR #30 CI (flaky test fix): ubuntu ✓ windows ✓ (run 30708321168)
- PR #15 CI (rebased on fixed main): ubuntu ✓ windows ✓ (run 30708383373)

## PR / Issue 状态

- PR #29: merged (squash) → `15cc68e`
- PR #30: merged (squash) → `e3c3355`
- PR #15: Open, CI green, body updated, 等待人工视觉确认
- Issue #18: closed (completed)

## 未完成项

- PR #15 待人工视觉确认后合并（不自动合并）

## 下一步

- CI 全绿后 squash merge
- 更新 PR #15 分支到最新 main
- 关闭 Issue #18
