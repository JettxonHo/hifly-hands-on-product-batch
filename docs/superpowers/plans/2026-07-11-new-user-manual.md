# 飞影新人 HTML 使用手册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一份可离线打开、供客户与内部运营共同使用的飞影「手里有货」批量生产 HTML 手册。

**Architecture:** 在 `docs/` 中创建一个内嵌 CSS 和少量原生 JavaScript 的单文件手册。内容从现有 README、SOP 和环境文档抽取并校准，页面以“客户协作区”和“运营执行区”为主入口，通过锚点、FAQ、复制命令和打印样式辅助阅读。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、现有 Node.js/Playwright 项目文档。

## Global Constraints

- 手册文件必须是 `docs/新人培训使用手册.html`，直接双击可打开，不依赖外网、框架或构建步骤。
- 不得写入账号、密码、真实客户素材路径或 `config.local.json` 内容。
- 流程必须准确表达：上传人物和商品图 → 弹窗内立即生成 → 完成后点击确认 → 外层立即生成 → 最新作品下载。
- 必须说明人物图优先级，以及当前飞影页面未开放姿势参数的限制。
- 必须同时覆盖客户素材提交与内部运营执行，并适合 A4 打印。

---

### Task 1: 校准手册内容与信息结构

**Files:**
- Create: `docs/新人培训使用手册.html`
- Read: `README.md`
- Read: `docs/SOP.md`
- Read: `docs/ENVIRONMENT.md`
- Read: `assets/person_pool/README.md`

**Interfaces:**
- Consumes: 已跑通的飞影网页操作链路、`products/products.csv` 字段和人物素材池约定。
- Produces: 页面使用的固定文案、步骤编号、字段解释和 FAQ 问答。

- [ ] **Step 1: 列出需要与项目文档逐项一致的事实**

在草稿中确认以下不可改写的事实：

```text
目标页面：https://hifly.cc/goods
运行命令：npm install、npx playwright install chromium、npm run login、npm run validate、npm run run
人物图优先级：CSV 人物图 → 品类池 → default 池 → 飞影推荐人物
关键确认：弹窗生成完成后必须点击“确认”
```

- [ ] **Step 2: 写入客户协作区内容**

页面必须包含下列客户可执行的内容：

```text
客户需交付：商品图片、产品名称、核心卖点、商品品类；可选提供人物/背景图。
商品图片：JPG/PNG、10MB 内、主体清晰、尽量无严重遮挡。
人物/背景图：每个品类至少 3-5 张，需混合坐姿/站姿、远近景与场景，降低成片重复度。
验收：可播放、比例/时长符合约定、商品无明显变形、口型自然、字幕无错字、同批次不过度雷同。
```

- [ ] **Step 3: 写入运营执行区与风险处理内容**

页面步骤必须按下列顺序展示：

```text
1. 安装 Node.js、npm、Playwright Chromium。
2. 首次运行 npm run login，并在浏览器中登录飞影。
3. 填写 products/products.csv 或 商品信息表.xlsx。
4. 按 category 将人物图放入 assets/person_pool/<category>/。
5. 运行 npm run validate。
6. 运行 npm run run。
7. 核对下载、日志、截图目录并完成质检。
```

- [ ] **Step 4: 写入 FAQ 的准确答复**

FAQ 至少包含：登录过期、上传失败、无“立即生成”、生成结束仍卡弹窗、姿势单一、背景重复、下载失败。每条说明应指向具体的人工动作或配置位置。

- [ ] **Step 5: 人工复核内容顺序和敏感信息**

运行：

```bash
rg -n "确认|person_image_path|assets/person_pool|npm run login|npm run validate|npm run run|config.local|密码|账号" docs/新人培训使用手册.html
```

Expected: 必须能找到流程、人物池和三条运行命令；不得包含真实账号、密码或本地敏感配置内容。

- [ ] **Step 6: Commit**

```bash
git add docs/新人培训使用手册.html
git commit -m "docs: add new user manual content"
```

### Task 2: 制作可离线阅读与打印的 HTML 页面

**Files:**
- Modify: `docs/新人培训使用手册.html`

**Interfaces:**
- Consumes: Task 1 的客户、运营、FAQ 与附录文案。
- Produces: 完整 HTML 文档，提供锚点导航、FAQ、命令复制和打印操作。

- [ ] **Step 1: 建立语义化页面骨架**

创建 `<!doctype html>` 页面，采用下列稳定的内容区域和 ID：

```html
<header id="top">...</header>
<nav aria-label="手册目录">...</nav>
<main>
  <section id="overview">...</section>
  <section id="client">...</section>
  <section id="operations">...</section>
  <section id="troubleshooting">...</section>
  <section id="appendix">...</section>
</main>
```

- [ ] **Step 2: 添加内嵌样式和响应式规则**

在页面 `<style>` 内定义：最大内容宽度、移动端单列布局、紧凑表格的横向滚动、步骤编号、提示块、命令块与打印规则。打印规则必须隐藏导航和操作按钮，并让 `section` 尽量避免跨页截断：

```css
@media print {
  nav, .action-bar, .copy-button { display: none !important; }
  section, details { break-inside: avoid; }
}
```

- [ ] **Step 3: 添加原生可用性交互**

为打印按钮调用 `window.print()`；为命令复制按钮调用 `navigator.clipboard.writeText()`，并在 API 不可用时用临时文本区域复制。按钮需要含 `aria-label`，复制失败时展示“请手动复制命令”。FAQ 使用 `<details><summary>`，即使 JavaScript 不可用也可操作。

- [ ] **Step 4: 进行 HTML 静态检查**

运行：

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('docs/新人培训使用手册.html','utf8');for(const token of ['<!doctype html>','id=\"client\"','id=\"operations\"','id=\"troubleshooting\"','window.print()','navigator.clipboard']){if(!html.includes(token))throw new Error('Missing: '+token)}console.log('Manual structure check passed.')"
```

Expected: `Manual structure check passed.`

- [ ] **Step 5: Commit**

```bash
git add docs/新人培训使用手册.html
git commit -m "docs: build printable new user manual"
```

### Task 3: 链接入口并进行浏览器验证

**Files:**
- Modify: `README.md`
- Verify: `docs/新人培训使用手册.html`

**Interfaces:**
- Consumes: Task 2 的已完成手册。
- Produces: README 中可发现的手册入口和经过桌面/窄屏核验的页面。

- [ ] **Step 1: 在 README 的目录说明后添加手册入口**

加入下列 Markdown 链接，保持现有中文语气：

```markdown
- `docs/新人培训使用手册.html`：供客户和内部运营共同使用的离线新人培训手册。
```

- [ ] **Step 2: 直接在浏览器打开 HTML 并验证桌面端**

打开 `file:///Users/ketchup/Documents/Product%20Recommendation%20clip/docs/新人培训使用手册.html`，验证：目录跳转、FAQ 展开、命令复制按钮、打印按钮存在；检查文字与容器没有重叠。

- [ ] **Step 3: 验证窄屏与打印样式**

将浏览器视口调为 390px 宽，验证导航折行、表格可滚动、文本不溢出。使用浏览器打印预览验证导航与操作按钮隐藏，正文和关键流程可读。

- [ ] **Step 4: 运行最终一致性检查**

运行：

```bash
git diff --check
rg -n "新人培训使用手册|生成完成后.*确认|手里有货" README.md docs/新人培训使用手册.html
```

Expected: `git diff --check` 无输出；README 和手册均能找到入口、确认步骤和“手里有货”说明。

- [ ] **Step 5: Commit**

```bash
git add README.md docs/新人培训使用手册.html
git commit -m "docs: link and verify training manual"
```
