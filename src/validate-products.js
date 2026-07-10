import fs from "node:fs";
import { loadConfig, resolveFromRoot } from "./config.js";
import { readCsv } from "./csv.js";

const REQUIRED_FIELDS = ["sku", "product_name", "selling_points", "image_path", "status"];

const config = loadConfig();
const products = readCsv(resolveFromRoot(config, config.productsCsv));
const errors = [];

if (products.length === 0) {
  errors.push("products CSV is empty.");
}

products.forEach((product) => {
  REQUIRED_FIELDS.forEach((field) => {
    if (!(field in product)) {
      errors.push(`missing column "${field}".`);
    }
  });

  if (!product.sku) errors.push(`row ${product.__rowNumber}: sku is required.`);
  if (!product.product_name) errors.push(`row ${product.__rowNumber}: product_name is required.`);
  if (!product.selling_points) errors.push(`row ${product.__rowNumber}: selling_points is required.`);
  if (!product.image_path) errors.push(`row ${product.__rowNumber}: image_path is required.`);

  const imagePath = resolveFromRoot(config, product.image_path);
  if (product.image_path && !fs.existsSync(imagePath)) {
    errors.push(`row ${product.__rowNumber}: image not found: ${product.image_path}`);
  }

  const personImagePath = resolveFromRoot(config, product.person_image_path);
  if (product.person_image_path && !fs.existsSync(personImagePath)) {
    errors.push(`row ${product.__rowNumber}: person image not found: ${product.person_image_path}`);
  }
});

if (errors.length > 0) {
  console.error("Product validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${products.length} product row(s) from ${config.productsCsv}.`);
