import path from "node:path";
import { chromium } from "playwright";

import { loadConfig, resolveFromRoot } from "../src/config.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";
import { timestampForFile } from "../src/logger.js";

const config = loadConfig();
const logger = {
  info(event, payload = {}) {
    console.log(JSON.stringify({ event, ...payload }));
  }
};

const context = await chromium.launchPersistentContext(
  resolveFromRoot(config, config.browser.profileDir),
  {
    headless: false,
    slowMo: config.browser.slowMoMs,
    viewport: config.browser.viewport,
    acceptDownloads: true
  }
);

try {
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.batch.defaultTimeoutMs);

  if (page.url() === "about:blank") {
    await page.goto(config.handsOnProductUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", {
      timeout: config.batch.defaultTimeoutMs
    }).catch(() => {});
  }

  const hiflyPage = new HiflyHandsOnProductPage(page, config, logger);
  const dialog = hiflyPage.dialogLocator();
  const hasDialog = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
  const generatedReady = hasDialog && await hiflyPage.hasGeneratedImageReady();

  if (!generatedReady) {
    const screenshotPath = await capture(page, "probe-confirm-no-ready-modal");
    console.log(JSON.stringify({
      status: "no_ready_modal",
      page_url: page.url(),
      has_dialog: hasDialog,
      screenshot_path: screenshotPath
    }, null, 2));
    process.exitCode = 2;
  } else {
    await hiflyPage.clickModalConfirm(config.batch.defaultTimeoutMs);
    const stillVisible = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    const screenshotPath = await capture(page, stillVisible
      ? "probe-confirm-still-visible"
      : "probe-confirm-closed");
    console.log(JSON.stringify({
      status: stillVisible ? "confirm_failed" : "confirm_closed",
      page_url: page.url(),
      screenshot_path: screenshotPath
    }, null, 2));
    process.exitCode = stillVisible ? 1 : 0;
  }
} finally {
  await context.close();
}

async function capture(page, step) {
  const screenshotPath = path.join(
    config.screenshotDir,
    `${timestampForFile()}-${step}.png`
  );
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return screenshotPath;
}
