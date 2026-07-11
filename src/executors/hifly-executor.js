import { assertExecutorAdapter } from "../core/executor-adapter.js";

function pageFrom(config) {
  const page = config?.hiflyPage ?? config?.pageObject;
  if (!page || typeof page !== "object") {
    throw new TypeError("createHiflyExecutor requires config.hiflyPage");
  }
  return page;
}

export function createHiflyExecutor(config) {
  const hiflyPage = pageFrom(config);
  const executor = {
    async createAsset(task) {
      return hiflyPage.prepareAsset(task);
    },

    async submitVideo(task, asset, context) {
      return hiflyPage.submitVideo(task, { asset, checkpoint: context?.checkpoint });
    },

    async querySubmission(remoteEvidence) {
      return hiflyPage.querySubmission(remoteEvidence);
    },

    async downloadArtifact(remoteEvidence, destination) {
      return hiflyPage.downloadArtifact(remoteEvidence, destination);
    },

    async reconcileSubmission(task, checkpoint) {
      return hiflyPage.reconcileSubmission(task, checkpoint);
    }
  };

  return assertExecutorAdapter(executor);
}
