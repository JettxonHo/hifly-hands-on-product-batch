import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { loadConfig, resolveFromRoot } from "./config.js";
import { readCsv } from "./csv.js";
import { BatchLogger, timestampForFile } from "./logger.js";
import { HiflyHandsOnProductPage } from "./hifly-page.js";
import { assignPersonImages } from "./person-pool.js";

export async function main() {
  const config = loadConfig();
  const logger = new BatchLogger(config);
  const products = assignPersonImages(
    selectProducts(readCsv(resolveFromRoot(config, config.productsCsv)), config),
    config,
    logger
  );

  if (products.length === 0) {
    logger.info("no_products_to_process", { productsCsv: config.productsCsv });
    return { count: 0 };
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

  try {
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

    logger.info("batch_finished", { count: products.length });
    return { count: products.length };
  } finally {
    await context.close();
  }
}

if (isDirectExecution()) {
  await main();
}

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
    row: product.__rowNumber,
    category: product.category,
    personImagePath: product.__resolved_person_image_path || product.person_image_path || ""
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

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
