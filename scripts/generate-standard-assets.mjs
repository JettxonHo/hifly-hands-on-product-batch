import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig, resolveFromRoot } from "../src/config.js";
import { readCsv } from "../src/csv.js";
import { validateProducts } from "../src/core/product-validation.js";
import { generateStandardVideoAssets } from "../src/core/standard-video-assets.js";

export async function main() {
  const config = loadConfig();
  const products = readCsv(resolveFromRoot(config, config.productsCsv));
  const validation = validateProducts({
    products,
    config,
    batchPaths: { root: config.__rootDir }
  });

  if (!validation.valid) {
    console.error("Product validation failed:");
    validation.errors.forEach((error) => console.error(`- ${error.message}`));
    process.exitCode = 1;
    return validation;
  }

  const outputRoot = path.join(config.__rootDir, "outputs", "standard-video-assets");
  const result = await generateStandardVideoAssets({
    products: validation.items,
    outputRoot
  });

  console.log(`Prepared ${result.count} standard video asset set(s).`);
  console.log(`Output: ${path.relative(config.__rootDir, result.outputRoot)}`);
  console.log(`QC report: ${path.relative(config.__rootDir, result.qcReportPath)}`);
  return result;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await main();
