export const SCRIPT_STRATEGIES = new Set(["hifly_ai", "provided_script", "mixed"]);

export function normalizeScriptStrategy(value) {
  return SCRIPT_STRATEGIES.has(value) ? value : "mixed";
}

export function resolveScriptStrategies(products, batchOptions = {}) {
  const scriptStrategy = normalizeScriptStrategy(batchOptions.script_strategy);
  return products.map((product) => ({
    ...product,
    resolved_script_mode: resolveScriptMode(product, scriptStrategy)
  }));
}

export function resolveScriptMode(product, scriptStrategy) {
  if (scriptStrategy === "hifly_ai") return "hifly_ai";
  if (scriptStrategy === "provided_script") return "custom";
  return String(product.script || "").trim() ? "custom" : "hifly_ai";
}

export function validateScriptStrategy(product, scriptStrategy, row) {
  const normalized = normalizeScriptStrategy(scriptStrategy);
  if (normalized !== "provided_script") return [];
  if (String(product.script || "").trim()) return [];
  return [{
    code: "SCRIPT_REQUIRED",
    message: `row ${row}: script is required when script_strategy is provided_script.`,
    row,
    field: "script",
    sku: product.sku || ""
  }];
}
