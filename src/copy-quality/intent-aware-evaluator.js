import { createManualInputQualityEvaluator, MANUAL_INPUT_QUALITY_POLICY } from "./manual-input-evaluator.js";

export function createIntentAwareQualityEvaluator({ defaultEvaluator, manualInputEvaluator = createManualInputQualityEvaluator() } = {}) {
  if (!defaultEvaluator?.evaluate || !manualInputEvaluator?.evaluate) {
    throw new TypeError("defaultEvaluator and manualInputEvaluator are required");
  }
  return {
    // Preserve the configured evaluator identity for existing AI/controlled runs.
    kind: defaultEvaluator.kind || "unknown",
    manualInputPolicy: manualInputEvaluator.kind || MANUAL_INPUT_QUALITY_POLICY,
    async evaluate(input = {}) {
      return input.copyVersion?.intent === "manual_input"
        ? manualInputEvaluator.evaluate(input)
        : defaultEvaluator.evaluate(input);
    }
  };
}
