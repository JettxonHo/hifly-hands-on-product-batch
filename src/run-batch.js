import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

import { loadConfig, resolveFromRoot } from "./config.js";
import { createBatchStore } from "./core/batch-store.js";
import { acquireExecutionLock } from "./core/execution-lock.js";
import { createExecutionSnapshot } from "./core/execution-snapshot.js";
import { runBatch } from "./core/batch-runner.js";
import { createHiflyExecutor } from "./executors/hifly-executor.js";
import { HiflyHandsOnProductPage } from "./hifly-page.js";
import { readCsv } from "./csv.js";
import { BatchLogger, timestampForFile } from "./logger.js";
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

  const confirmedAt = new Date().toISOString();
  const tasks = products.map((product, index) => ({
    ...product,
    task_id: product.task_id ?? `${product.sku || "product"}-${index + 1}`,
    resolved_person_image_path: product.__resolved_person_image_path ?? product.person_image_path ?? null,
    status: "confirmed",
    confirmed_at: confirmedAt
  }));
  const execution = {
    ...(config.execution ?? {}),
    projectRoot: config.__rootDir,
    confirmedAt
  };
  const snapshot = await createExecutionSnapshot(tasks, execution);
  const confirmedTasks = tasks.map((task) => ({ ...task, execution_key: snapshot.executionKey }));
  const batchId = `cli-${timestampForFile()}`;
  const batchRoot = path.join(config.__rootDir, "batches");
  const store = createBatchStore(batchRoot);
  await store.create({
    batch_id: batchId,
    items: confirmedTasks,
    estimated_points: snapshot.estimate,
    execution_snapshot: snapshot
  });

  const lock = await acquireExecutionLock({
    root: batchRoot,
    batchId,
    instanceId: `cli-${process.pid}-${Date.now()}`
  });
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
    const result = await runBatch({
      batchId,
      items: confirmedTasks,
      config: { ...config, execution },
      paths: {
        projectRoot: config.__rootDir,
        downloadDir: resolveFromRoot(config, config.downloadDir)
      },
      executor: createHiflyExecutor({ hiflyPage }),
      store,
      lock,
      onEvent: (event) => logger.info("execution_event", event)
    });
    logger.info("batch_finished", { batchId, status: result.status, count: result.items.length });
    return result;
  } finally {
    await context?.close();
    await lock.release();
  }
}

function selectProducts(allProducts, currentConfig) {
  const pending = allProducts.filter((product) => {
    const status = String(product.status || "pending").toLowerCase();
    const retryCount = Number(product.retry_count || 0);
    return ["", "pending", "failed"].includes(status) && retryCount <= currentConfig.batch.retryLimit;
  });
  return currentConfig.batch.maxItems > 0 ? pending.slice(0, currentConfig.batch.maxItems) : pending;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await main();
