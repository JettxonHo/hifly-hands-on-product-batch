import { chromium } from "playwright";

import { loadConfig, resolveFromRoot } from "../src/config.js";
import { BatchLogger } from "../src/logger.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

const remoteId = process.argv[2];

if (!remoteId) {
  console.error("Usage: node scripts/download-known-work.mjs <remote_id>");
  process.exitCode = 1;
} else {
  const config = loadConfig();
  const logger = new BatchLogger(config);
  let context;

  try {
    context = await chromium.launchPersistentContext(
      resolveFromRoot(config, config.browser.profileDir),
      {
        headless: config.browser.headless,
        slowMo: config.browser.slowMoMs,
        viewport: config.browser.viewport,
        acceptDownloads: true
      }
    );

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.batch.defaultTimeoutMs);

    const hiflyPage = new HiflyHandsOnProductPage(page, config, logger);
    await hiflyPage.openWorkbench();
    await hiflyPage.enterHandsOnProductMode();

    const artifact = await hiflyPage.downloadArtifact({
      evidence_source: "direct_submission",
      remote_id: remoteId,
      work_key: remoteId
    }, resolveFromRoot(config, config.downloadDir));

    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    await context?.close();
  }
}
