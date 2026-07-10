import process from "node:process";
import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "./config.js";

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
await page.goto(config.hiflyWorkbenchUrl, { waitUntil: "domcontentloaded" });

console.log("Please log in to Hifly in the opened browser window.");
console.log("After the workbench is fully accessible, press Enter here to save the session.");

await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", resolve);
});

await context.close();
console.log(`Login session saved in ${config.browser.profileDir}.`);
