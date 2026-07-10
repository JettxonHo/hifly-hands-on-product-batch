import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "../src/config.js";

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

const inputs = await page.locator("input[type='file']").evaluateAll((nodes) => {
  return nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    return {
      index,
      accept: node.getAttribute("accept"),
      name: node.getAttribute("name"),
      id: node.getAttribute("id"),
      className: node.getAttribute("class"),
      multiple: node.hasAttribute("multiple"),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      outerHTML: node.outerHTML.slice(0, 300)
    };
  });
});

console.log(JSON.stringify(inputs, null, 2));
await page.screenshot({ path: "screenshots/inspect-file-inputs.png", fullPage: true });
await context.close();
