import { pathToFileURL } from "node:url";
import { loadConfig, resolveFromRoot } from "./config.js";
import { readCsv } from "./csv.js";
import { validateProducts } from "./core/product-validation.js";

export function main() {
  const config = loadConfig();
  const products = readCsv(resolveFromRoot(config, config.productsCsv));
  const result = validateProducts({
    products,
    config,
    batchPaths: { root: config.__rootDir }
  });

  if (!result.valid) {
    console.error("Product validation failed:");
    result.errors.forEach((error) => console.error(`- ${error.message}`));
    process.exitCode = 1;
    return result;
  }

  console.log(`Validated ${result.items.length} product row(s) from ${config.productsCsv}.`);
  return result;
}

if (isDirectExecution()) {
  main();
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
