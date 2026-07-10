# 运行环境打包说明

## 本地依赖

- Node.js 20+，推荐 22+
- npm
- Playwright Chromium
- 飞影账号，且账号可访问 `https://hifly.cc/goods`
- GitHub CLI `gh`，仅在需要推送 GitHub 或创建 PR 时使用
- 可选人物素材池：`assets/person_pool/<category>/`

## 首次安装

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
```

然后运行：

```bash
npm run login
```

在弹出的浏览器中登录飞影。确认能进入 `https://hifly.cc/goods` 后，回到终端按 Enter 保存登录态。

## 批量生产

```bash
npm run validate
npm run run
```

输出目录：

- `downloads/`：下载的视频样片或成片
- `logs/`：JSONL 运行日志
- `screenshots/`：失败截图
- `outputs/`：最终交付打包目录
- `assets/person_pool/`：按商品品类轮换的人物/背景图，建议入库目录结构，真实客户素材按项目合规要求处理。

## 不入库内容

以下内容涉及账号、环境或大文件，不提交到 Git：

- `config.local.json`
- `playwright/profile/`
- `playwright/.auth/`
- `downloads/`
- `logs/`
- `screenshots/`
- `outputs/`
- `node_modules/`

## GitHub 发布前检查

```bash
npm run check
npm run validate
```

GitHub CLI 需要重新认证：

```bash
gh auth login -h github.com
gh auth status
```
