# 2026-08-17 运营工作台内部 UX 问题审计

## 会话合同

- Issue：#170
- 固定基线：`origin/main@48a4e92c61c0ace1c99e607528aedd16b70b1e80`
- 分支：`codex/operator-ux-internal-audit`
- 工作树：`/private/tmp/hifly-operator-ux-internal-audit`
- 性质：audit/doc-only；不是外部研究、设计、实现、部署或客户验收

## 审计方法

先读取 AGENTS、CURRENT、ROADMAP、运营任务流 UX V1、产品 IA/用户流程和当前页面公开合同，再以本地内存仓储、
假数据和 Chromium 运行现有公开 browser seams。审计按角色任务、频率、错误成本、权限/审计、安全门禁、中文环境和
三视口逐页记录问题，不从竞品页面或视觉风格反推本项目 IA。

公开浏览器证据命令：

```bash
SLICE_A_SCREENSHOTS_DIR=/private/tmp/hifly-ux-audit-screens/a \
SLICE_B_SCREENSHOTS_DIR=/private/tmp/hifly-ux-audit-screens/b \
A09_SCREENSHOT_DIR=/private/tmp/hifly-ux-audit-screens/p \
A14_SCREENSHOT_DIR=/private/tmp/hifly-ux-audit-screens/a14 \
node --test --test-concurrency=1 \
  test/operator-task-flow-slice-a-browser.test.js \
  test/copy-generation-browser.test.js \
  test/copy-quality-browser.test.js \
  test/avatar-selection-browser.test.js \
  test/video-planning-browser.test.js \
  test/production-order-browser.test.js \
  test/vsa-a14-acceptance-browser.test.js
```

结果为 11/11 pass、0 fail、0 skip。截图只在 `/private/tmp/hifly-ux-audit-screens/`，未提交 Git。核对的像素包括：

- Login：1440×900、768×900、390×844；
- Projects：1440×900、768×900、390×962；
- Project：1440×1064、768×1389、390×1823；
- Copy/Avatar/Plan：各 1440×900、768×900、390×844；
- Production：1440×1398、390×2195；
- Works：390×1969。

这些结果只证明本地公开 UI seam 可运行，不证明部署、真实 Provider、积分、客户采用或长期稳定性。

## 关键结论

- 本轮本地假数据审计未发现新的 P0；这不是对真实生产风险的替代证明。
- P1 集中在：全局 IA/导航不稳定、Production 技术状态抢占业务叙事、Works 已交付终态动作竞争、Assets 类型/用途/
  关联语义不足、英文内部术语暴露，以及移动端首屏仅做纵向堆叠。
- Slice A/B 的 dirty、冲突、历史、异步失败恢复和“自动检查不等于人工批准”是后续合同必须保留的正向基线。
- Assets/Members 的初始错误仍可能与 loading 并存，属于可 targeted 修复的状态问题。
- 原 Slice C 是否保留、rebase 或吸收仍待定，必须经过定向研究和设计合同 acceptance gate，不能由本审计直接决定。

完整逐页证据、根因分类、严重度、研究问题和后续 gate 见
`docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md`。

## 文件与边界

本会话严格只修改：

```text
docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md
docs/status/CURRENT.md
docs/ROADMAP.md
docs/status/sessions/2026-08-17-operator-ux-internal-audit.md
```

没有修改 HTML、CSS、JS、API、数据库、测试、依赖或部署文件；没有开始外部案例研究、Taste 实现、Slice C 或全局重构；
没有 SSH、访问 Hifly、启动 Worker、写生产数据、生成视频或消耗积分。

## 验证

提交前运行：

```bash
npm run check
git diff --check
```

并检查 Markdown 相对链接、动态阶段措辞和四文件 allowlist。固定 head 的 Ubuntu、Windows、identity-postgres CI
结果在 Draft PR 创建后记录；CI 通过只证明仓库检查，不改变上述产品与运行时边界。

## 下一步

主控独立审阅本审计 Draft PR。只有审计合并进入 `main` 后，才可另开独立 Issue 进行定向外部工作台研究；研究完成后
再形成设计合同。不得从本会话自动开始后续步骤。
