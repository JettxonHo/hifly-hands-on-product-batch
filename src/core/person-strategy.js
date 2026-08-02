import { listPoolImageFiles } from "./person-pool-files.js";

const PERSON_STRATEGIES = new Set(["auto_pool", "fixed_upload", "hifly_recommended"]);

export function normalizePersonStrategy(value) {
  return PERSON_STRATEGIES.has(value) ? value : "auto_pool";
}

export function resolvePersonStrategies(products, config = {}, batchOptions = {}, logger) {
  const strategy = normalizePersonStrategy(batchOptions.person_strategy);
  const counters = new Map();
  return products.map((product) => {
    if (product.person_image_path) {
      return withPerson(product, product.person_image_path, "explicit");
    }
    if (strategy === "fixed_upload" && batchOptions.fixed_person_image_path) {
      return withPerson(product, batchOptions.fixed_person_image_path, "fixed_upload");
    }
    if (strategy === "hifly_recommended") {
      return withRecommended(product, config);
    }
    const pooled = choosePoolImage(product.category, config, counters);
    if (pooled) return withPerson(product, pooled.path, pooled.source);
    logger?.info?.("person_pool_fallback_to_recommended", { sku: product.sku, category: product.category });
    return withRecommended(product, config);
  });
}

function withPerson(product, personPath, source) {
  return {
    ...product,
    __resolved_person_image_path: personPath,
    resolved_person_image_path: personPath,
    resolved_person_source: source
  };
}

function withRecommended(product, config) {
  const canUseRecommended = config.personPool?.fallbackToRecommended !== false
    && config.behavior?.useRecommendedPersonWhenMissing !== false;
  return {
    ...product,
    __resolved_person_image_path: undefined,
    resolved_person_image_path: "",
    resolved_person_source: canUseRecommended ? "hifly_recommended" : "unresolved"
  };
}

function choosePoolImage(category, config, counters) {
  if (!config.personPool?.enabled) return null;
  const categoryName = normalizePathSegment(category || config.personPool.defaultCategory || "default");
  const defaultCategory = normalizePathSegment(config.personPool.defaultCategory || "default");
  const categoryImages = listPoolImages(config, categoryName);
  if (categoryImages.length) {
    return { path: nextImage(categoryImages, categoryName, counters), source: "category_pool" };
  }
  const defaultImages = categoryName === defaultCategory ? [] : listPoolImages(config, defaultCategory);
  if (defaultImages.length) {
    return { path: nextImage(defaultImages, defaultCategory, counters), source: "default_pool" };
  }
  return null;
}

function nextImage(images, key, counters) {
  const index = counters.get(key) || 0;
  counters.set(key, index + 1);
  return images[index % images.length];
}

function listPoolImages(config, category) {
  // Shared with person-pool.js: lexical + canonical containment, regular-file
  // filtering, and project-root-relative POSIX path generation.
  return listPoolImageFiles(config, category);
}

function normalizePathSegment(value) {
  return String(value || "default")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
}
