export function createVerifiedOutputAssetPort({ repository } = {}) {
  if (!repository?.registerVerifiedOutput) throw new TypeError("canonical asset repository is required");
  return {
    registerVerifiedOutput(input) { return repository.registerVerifiedOutput(input); }
  };
}
