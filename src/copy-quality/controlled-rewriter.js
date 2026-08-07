export function createControlledCopyRewriter({ rewrite } = {}) {
  return {
    kind: "controlled_test_double",
    async rewrite(input) {
      if (rewrite) return rewrite(input);
      const suffix = input.finding?.title ? `\n已根据“${input.finding.title}”完成改写。` : "\n已根据质检建议完成改写。";
      return { body: `${input.copyVersion.body}${suffix}` };
    }
  };
}
