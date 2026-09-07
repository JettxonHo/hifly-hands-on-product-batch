import { assertExecutorAdapter } from "../core/executor-adapter.js";

function pageFrom(config) {
  const page = config?.hiflyPage ?? config?.pageObject;
  if (!page || typeof page !== "object") {
    throw new TypeError("createHiflyExecutor requires config.hiflyPage");
  }
  return page;
}

function assertPageOpen(hiflyPage) {
  if (typeof hiflyPage.assertPageOpen === "function") {
    hiflyPage.assertPageOpen();
    return;
  }

  const page = hiflyPage.page;
  if (typeof page?.isClosed !== "function") return;

  let closed;
  try {
    closed = page.isClosed();
  } catch {
    closed = true;
  }
  if (closed) {
    throw Object.assign(new Error("Hifly page is closed"), {
      code: "HIFLY_PAGE_CLOSED",
      outcome: "requires_action"
    });
  }
}

export function createHiflyExecutor(config) {
  const hiflyPage = pageFrom(config);
  const executor = {
    async preflight() {
      assertPageOpen(hiflyPage);
      return hiflyPage.preflight();
    },

    async createAsset(task, context) {
      assertPageOpen(hiflyPage);
      return hiflyPage.prepareAsset(task, { checkpoint: context?.checkpoint });
    },

    async submitVideo(task, asset, context) {
      assertPageOpen(hiflyPage);
      return hiflyPage.submitVideo(task, { asset, checkpoint: context?.checkpoint });
    },

    async querySubmission(remoteEvidence) {
      assertPageOpen(hiflyPage);
      return hiflyPage.querySubmission(remoteEvidence);
    },

    async downloadArtifact(remoteEvidence, destination, context) {
      assertPageOpen(hiflyPage);
      return hiflyPage.downloadArtifact(remoteEvidence, destination, context);
    },

    async reconcileSubmission(task, checkpoint) {
      assertPageOpen(hiflyPage);
      return hiflyPage.reconcileSubmission(task, checkpoint);
    }
  };

  return assertExecutorAdapter(executor);
}
