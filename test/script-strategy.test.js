import test from "node:test";
import assert from "node:assert/strict";
import { resolveScriptStrategies, validateScriptStrategy } from "../src/core/script-strategy.js";

test("hifly_ai ignores provided script and keeps AI mode", () => {
  const [item] = resolveScriptStrategies([
    { sku: "A", script: "请按品牌话术介绍。" }
  ], { script_strategy: "hifly_ai" });
  assert.equal(item.resolved_script_mode, "hifly_ai");
});

test("provided_script requires script and marks custom mode", () => {
  const [item] = resolveScriptStrategies([
    { sku: "A", script: "这是一条指定口播。" }
  ], { script_strategy: "provided_script" });
  assert.equal(item.resolved_script_mode, "custom");
  assert.deepEqual(validateScriptStrategy(item, "provided_script", 2), []);
  const errors = validateScriptStrategy({ sku: "B", script: "" }, "provided_script", 3);
  assert.equal(errors[0].code, "SCRIPT_REQUIRED");
  assert.equal(errors[0].row, 3);
});

test("mixed mode uses custom only when script exists", () => {
  const items = resolveScriptStrategies([
    { sku: "A", script: "指定口播。" },
    { sku: "B", script: "   " }
  ], { script_strategy: "mixed" });
  assert.equal(items[0].resolved_script_mode, "custom");
  assert.equal(items[1].resolved_script_mode, "hifly_ai");
});
