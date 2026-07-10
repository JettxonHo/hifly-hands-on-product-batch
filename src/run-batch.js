import path from "node:path";
import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "./config.js";
import { readCsv } from "./csv.js";
import { BatchLogger, timestampForFile } from "./logger.js";
import { HiflyHandsOnProductPage } from "./hifly-page.js";

const config = loadConfig();
const logger = new BatchLogger(config);
const products = selectProducts(readCsv(resolveFromRoot(config, config.productsCsv)), config);

if (products.length === 0) {
  logger.info("no_products_to_process", { productsCsv: config.productsCsv });
  process.exit(0);
}

const context = await chromium.launchPersistentContext(
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
const hifly = new HiflyHandsOnProductPage(page, config, logger);

logger.info("batch_started", {
  count: products.length,
  configPath: config.__configPath
});

for (const product of products) {
  await processProduct(hifly, product, config, logger);
}

await context.close();
logger.info("batch_finished", { count: products.length });

function selectProducts(allProducts, currentConfig) {
  const pending = allProducts.filter((product) => {
    const status = String(product.status || "pending").toLowerCase();
    const retryCount = Number(product.retry_count || 0);
    return ["", "pending", "failed"].includes(status)
      && retryCount <= currentConfig.batch.retryLimit;
  });

  if (currentConfig.batch.maxItems > 0) {
    return pending.slice(0, currentConfig.batch.maxItems);
  }

  return pending;
}

async function processProduct(hifly, product, currentConfig, currentLogger) {
  currentLogger.info("product_started", {
    sku: product.sku,
    productName: product.product_name,
    row: product.__rowNumber
  });

  try {
    await hifly.openWorkbench();
    await hifly.enterHandsOnProductMode();
    await hifly.fillProduct(product);
    const outputPath = await hifly.submitAndDownload(product);

    currentLogger.info("product_downloaded", {
      sku: product.sku,
      outputPath
    });
  } catch (error) {
    const screenshotPath = path.join(
      currentConfig.screenshotDir,
      `${timestampForFile()}-${product.sku || "unknown"}-error.png`
    );

    await hifly.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    currentLogger.error("product_failed", {
      sku: product.sku,
      productName: product.product_name,
      message: error.message,
      screenshotPath
    });
  }
}
