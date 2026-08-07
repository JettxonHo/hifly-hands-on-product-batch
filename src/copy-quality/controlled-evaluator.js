export function createControlledQualityEvaluator({ evaluate } = {}) {
  return {
    kind: "controlled_test_double",
    async evaluate(input) {
      if (evaluate) return evaluate(input);
      return { checks_complete: true, findings: [] };
    }
  };
}
