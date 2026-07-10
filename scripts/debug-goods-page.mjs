import path from "node:path";
import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "../src/config.js";
import { readCsv } from "../src/csv.js";
import { timestampForFile } from "../src/logger.js";

const config = loadConfig();
const products = readCsv(resolveFromRoot(config, config.productsCsv));
const product = products[0];

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
page.setDefaultTimeout(config.batch.defaultTimeoutMs);
await page.goto(config.handsOnProductUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.mouse.click(106 + 458, 76 + 96).catch(() => {});
await page.waitForTimeout(500);

const imagePath = resolveFromRoot(config, product.image_path);
const chooserPromise = page.waitForEvent("filechooser");
await page.getByRole("button", { name: /上传人物\+产品图/ }).first().click();
const chooser = await chooserPromise;
await chooser.setFiles(imagePath);

await page.waitForTimeout(3000);
await capture(page, config, "debug-after-upload");

const elements = await page.locator("button, [role='button'], .ant-btn, div").evaluateAll((nodes) => {
  return nodes
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      return {
        tag: node.tagName,
        text: text.slice(0, 120),
        className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })
    .filter((item) => item.text || item.tag === "BUTTON")
    .filter((item) => item.width > 0 && item.height > 0)
    .slice(0, 120);
});

console.log(JSON.stringify(elements, null, 2));

const generateTargets = elements.filter((item) => item.text.includes("生成"));
console.log("Generate targets:", JSON.stringify(generateTargets, null, 2));

const mainButton = page.locator("button, [role='button'], .ant-btn").filter({
  hasText: config.hiflyUi.submitText
}).last();

if (await mainButton.count()) {
  await mainButton.click({ force: true });
  await page.waitForTimeout(2000);
  const visibleMessages = await page.locator("body *").evaluateAll((nodes) => {
    return nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        const style = window.getComputedStyle(node);
        return {
          text,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter((item) => item.text)
      .filter((item) => item.display !== "none" && item.visibility !== "hidden" && item.opacity !== "0")
      .filter((item) => /请|失败|上传|积分|生成|创作|消耗|成功|错误|异常/.test(item.text))
      .slice(0, 80);
  });
  console.log("Visible messages after click:", JSON.stringify(visibleMessages, null, 2));
  await capture(page, config, "debug-after-main-click");
} else {
  console.log("No main button found with text", config.hiflyUi.submitText);
}

await context.close();

async function capture(currentPage, currentConfig, step) {
  const screenshotPath = path.join(
    currentConfig.screenshotDir,
    `${timestampForFile()}-${step}.png`
  );
  await currentPage.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Captured ${screenshotPath}`);
}
