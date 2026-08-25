const clone = (value) => value == null ? value : structuredClone(value);

function cloneState(state) {
  return {
    projects: new Map([...state.projects].map(([key, value]) => [key, clone(value)])),
    products: new Map([...state.products].map(([key, value]) => [key, clone(value)])),
    revisions: new Map([...state.revisions].map(([key, value]) => [key, clone(value)])),
    receipts: new Map([...state.receipts].map(([key, value]) => [key, clone(value)])),
    audits: clone(state.audits)
  };
}

function unitOfWork(state, onCommit, onRollback) {
  return {
    transactionClient: { onCommit, onRollback },
    async findReceipt(key) { return clone(state.receipts.get(key) || null); },
    async insertReceipt(key, receipt) { state.receipts.set(key, clone(receipt)); },
    async insertProject(project) { state.projects.set(project.id, clone(project)); },
    async findProject(organizationId, projectId) {
      const project = state.projects.get(projectId);
      return clone(project?.organization_id === organizationId ? project : null);
    },
    async listProjects(organizationId) {
      return [...state.projects.values()].filter((item) => item.organization_id === organizationId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at)).map(clone);
    },
    async insertProduct(product) { state.products.set(product.id, clone(product)); },
    async findProduct(organizationId, productId) {
      const product = state.products.get(productId);
      return clone(product?.organization_id === organizationId ? product : null);
    },
    async listProductsByProject(organizationId, projectId) {
      return [...state.products.values()].filter((item) => item.organization_id === organizationId && item.project_id === projectId).map(clone);
    },
    async insertRevision(revision) { state.revisions.set(revision.id, clone(revision)); },
    async updateRevision(revision) { state.revisions.set(revision.id, clone(revision)); },
    async findRevision(organizationId, revisionId) {
      const revision = state.revisions.get(revisionId);
      return clone(revision?.organization_id === organizationId ? revision : null);
    },
    async appendAudit(event) { state.audits.push(clone(event)); }
  };
}

export function createMemoryProjectContentRepository() {
  let state = { projects: new Map(), products: new Map(), revisions: new Map(), receipts: new Map(), audits: [] };
  let queue = Promise.resolve();

  return {
    async initialize() {},
    async close() {},
    async transaction(work) {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const staged = cloneState(state);
      const commitCallbacks = [];
      const rollbackCallbacks = [];
      try {
        let result;
        try {
          result = await work(unitOfWork(
            staged,
            (callback) => commitCallbacks.push(callback),
            (callback) => rollbackCallbacks.push(callback)
          ));
        } catch (error) {
          for (const callback of rollbackCallbacks.reverse()) await callback();
          throw error;
        }
        state = staged;
        for (const callback of commitCallbacks) await callback();
        return clone(result);
      } finally {
        release();
      }
    },
    async listAuditEvents() { return clone(state.audits); }
  };
}
