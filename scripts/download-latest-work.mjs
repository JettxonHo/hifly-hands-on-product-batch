import path from "node:path";
import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "../src/config.js";
import { timestampForFile } from "../src/logger.js";

const config = loadConfig();
const context = await chromium.launchPersistentContext(
  resolveFromRoot(config, config.browser.profileDir),
  {
    headless: false,
    slowMo: config.browser.slowMoMs,
    viewport: config.browser.viewport,
    acceptDownloads: true
  }
);

const page = context.pages()[0] || await context.newPage();
await page.goto(config.handsOnProductUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.getByText("最新作品", { exact: false }).first().waitFor({
  state: "visible",
  timeout: config.batch.defaultTimeoutMs
});

const buttons = page.locator(".auto-main-right button, button");
const candidates = await buttons.evaluateAll((nodes) => nodes.map((node, index) => {
  const rect = node.getBoundingClientRect();
  const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  return {
    index,
    text,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    className: node.getAttribute("class")
  };
}));
console.log(JSON.stringify(candidates, null, 2));

const latestPanel = page.locator(".auto-main-right").first();
const firstVisibleDownloadRowButtons = latestPanel.locator("button.download").filter({
  hasNotText: "立即生成"
});
await firstVisibleDownloadRowButtons.nth(1).click({ force: true }).catch(async () => {
  const box = await latestPanel.boundingBox();
  if (!box) throw new Error("Could not find latest panel.");
  await page.mouse.click(box.x + box.width - 72, box.y + 456);
});

const download = await page.waitForEvent("download", {
  timeout: config.batch.generationTimeoutMs
}).catch(() => null);

if (download) {
  const outputPath = path.join(config.downloadDir, `latest-${timestampForFile()}-${download.suggestedFilename()}`);
  await download.saveAs(outputPath);
  console.log(`Downloaded ${outputPath}`);
} else {
  await page.getByText(/下载中|下载成功|下载失败/, { exact: false }).waitFor({
    state: "hidden",
    timeout: config.batch.generationTimeoutMs
  }).catch(() => {});
  await page.screenshot({ path: "screenshots/download-latest-no-download.png", fullPage: true });
  console.log("No download event fired. Captured screenshots/download-latest-no-download.png");
}
await context.close();
