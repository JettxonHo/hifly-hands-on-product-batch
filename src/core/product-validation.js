import fs from "node:fs";
import path from "node:path";
import { listPersonPoolFiles, normalizeCategory } from "../person-pool.js";
import { validateScriptStrategy } from "./script-strategy.js";

export const REQUIRED_PRODUCT_FIELDS = [
  "sku",
  "product_name",
  "selling_points",
  "category",
  "image_path",
  "status"
];

export function validateProducts({ products, config, batchPaths = {}, options = {} }) {
  if (!Array.isArray(products)) {
    throw new TypeError("products must be an array");
  }
  if (!config || typeof config !== "object") {
    throw new TypeError("config is required");
  }

  const errors = [];
  const warnings = [];
  const root = batchPaths.root || config.__rootDir || process.cwd();

  if (products.length === 0) {
    errors.push(issue("PRODUCTS_EMPTY", "products CSV is empty."));
  }

  products.forEach((product, index) => {
    const row = product.__rowNumber ?? index + 2;

    REQUIRED_PRODUCT_FIELDS.forEach((field) => {
      if (!(field in product)) {
        errors.push(issue(
          "MISSING_COLUMN",
          `missing column "${field}".`,
          { row, field, sku: product.sku || "" }
        ));
      }
    });

    requireValue(errors, product, "sku", "SKU_REQUIRED", row);
    requireValue(errors, product, "product_name", "PRODUCT_NAME_REQUIRED", row);
    requireValue(errors, product, "selling_points", "SELLING_POINTS_REQUIRED", row);
    requireValue(errors, product, "category", "CATEGORY_REQUIRED", row);
    requireValue(errors, product, "image_path", "IMAGE_PATH_REQUIRED", row);
    requireValue(errors, product, "status", "STATUS_REQUIRED", row);

    if (product.image_path && !fs.existsSync(resolvePath(root, product.image_path))) {
      errors.push(issue(
        "IMAGE_NOT_FOUND",
        `row ${row}: image not found: ${product.image_path}`,
        { row, field: "image_path", sku: product.sku || "", value: product.image_path }
      ));
    }

    if (product.person_image_path && !fs.existsSync(resolvePath(root, product.person_image_path))) {
      errors.push(issue(
        "PERSON_IMAGE_NOT_FOUND",
        `row ${row}: person image not found: ${product.person_image_path}`,
        { row, field: "person_image_path", sku: product.sku || "", value: product.person_image_path }
      ));
    }

    validatePersonFallback(errors, product, config, row);
    errors.push(...validateScriptStrategy(product, options.script_strategy || "mixed", row));

    if (product.resolved_person_source === "unresolved") {
      errors.push(issue(
        "PERSON_SOURCE_REQUIRED",
        `row ${row}: no person source is available.`,
        { row, field: "person_image_path", sku: product.sku || "" }
      ));
    }
  });

  return {
    valid: errors.length === 0,
    items: products,
    errors,
    warnings
  };
}

function requireValue(errors, product, field, code, row) {
  if (field in product && !String(product[field] ?? "").trim()) {
    errors.push(issue(
      code,
      `row ${row}: ${field} is required.`,
      { row, field, sku: product.sku || "" }
    ));
  }
}

function validatePersonFallback(errors, product, config, row) {
  if (product.person_image_path || !config.personPool?.enabled) return;

  const category = normalizeCategory(product.category, config);
  const defaultCategory = config.personPool?.defaultCategory || "default";
  const hasCategoryPool = listPersonPoolFiles(config, category).length > 0;
  const hasDefaultPool = listPersonPoolFiles(config, defaultCategory).length > 0;
  const canUseRecommended = config.personPool?.fallbackToRecommended !== false
    && config.behavior?.useRecommendedPersonWhenMissing !== false;

  if (!hasCategoryPool && !hasDefaultPool && !canUseRecommended) {
    errors.push(issue(
      "PERSON_IMAGE_UNAVAILABLE",
      `row ${row}: no person image, no person pool image for "${category}", and recommended fallback is disabled.`,
      { row, field: "person_image_path", sku: product.sku || "", category }
    ));
  }
}

function resolvePath(root, relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(root, relativeOrAbsolutePath);
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}
