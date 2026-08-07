export function createControlledCopyProvider({ generate } = {}) {
  return {
    kind: "phase1_controlled_test_double",
    async generateCopy(input) {
      if (generate) return generate(input);
      const points = input.productRevision.selling_points.map((point) => point.text).join("，");
      return {
        body: `今天想和大家分享${input.productRevision.product_name}。${points}，${input.productRevision.product_description || "适合日常使用"}。`
      };
    }
  };
}
