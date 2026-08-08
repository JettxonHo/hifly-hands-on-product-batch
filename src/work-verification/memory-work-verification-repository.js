const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

function scoped(values, organizationId, id) {
  const value = values.get(id);
  return value?.organization_id === organizationId ? value : null;
}

function transaction() {
  const rollback = [];
  const commit = [];
  return {
    onRollback(callback) { rollback.push(callback); },
    onCommit(callback) { commit.push(callback); },
    async rollback() { for (const callback of rollback.reverse()) await callback(); },
    async commit() { for (const callback of commit) await callback(); }
  };
}

export function createMemoryWorkVerificationRepository({ failureInjector = null } = {}) {
  const jobs = new Map();
  const works = new Map();
  const receipts = new Map();
  const audits = [];
  const ledger = [];

  function recordTransition(job, fromStatus, toStatus, { failureKind = null, reason = null, createdAt, transactionClient = null } = {}) {
    const entry = { id: `${job.id}:${ledger.length + 1}`, organization_id: job.organization_id, job_id: job.id,
      from_status: fromStatus, to_status: toStatus, failure_kind: failureKind, reason, created_at: createdAt || job.updated_at };
    ledger.push(entry);
    transactionClient?.onRollback?.(() => {
      const index = ledger.lastIndexOf(entry);
      if (index >= 0) ledger.splice(index, 1);
    });
  }

  function readReceipt(receiptKey, fingerprint) {
    const receipt = receipts.get(receiptKey);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(receipt);
  }

  function listScopedWorks(organizationId, productionOrderId = null) {
    return [...works.values()].filter((work) => work.organization_id === organizationId &&
      (!productionOrderId || work.production_order_id === productionOrderId));
  }

  function findNaturalJob(value) {
    return [...jobs.values()].find((job) => job.organization_id === value.organization_id &&
      job.production_order_id === value.production_order_id && job.execution_attempt_id === value.execution_attempt_id &&
      job.primary_output_checksum === value.primary_output_checksum) || null;
  }

  async function inject(stage, value = null) {
    if (typeof failureInjector === "function") await failureInjector(stage, value);
    else if (failureInjector?.[stage]) throw failure(`WORK_VERIFICATION_${stage.toUpperCase()}_INJECTED`);
  }

  function updateReceiptWork(jobId, workId, transactionClient = null) {
    const previous = [];
    for (const receipt of receipts.values()) if (receipt.job_id === jobId) {
      previous.push({ receipt, workId: receipt.work_id });
      receipt.work_id = workId;
    }
    transactionClient?.onRollback?.(() => previous.forEach(({ receipt, workId: previousWorkId }) => { receipt.work_id = previousWorkId; }));
  }

  return {
    async initialize() {},
    async close() {},

    async getReceipt(receiptKey, fingerprint) { return readReceipt(receiptKey, fingerprint); },

    async createVerificationRequest({ receiptKey, fingerprint, job }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { job: clone(jobs.get(replay.job_id)), work: clone(replay.work_id ? works.get(replay.work_id) : null), replayed: true };
      const existing = findNaturalJob(job);
      if (existing) {
        if (existing.report_id !== job.report_id || existing.candidate_id !== job.candidate_id) throw failure("WORK_VERIFICATION_CONFLICT");
        const work = existing.work_id ? works.get(existing.work_id) : null;
        receipts.set(receiptKey, { fingerprint, job_id: existing.id, work_id: work?.id || null });
        return { job: clone(existing), work: clone(work), replayed: true };
      }
      const conflicting = listScopedWorks(job.organization_id, job.production_order_id).find((work) => work.primary_output_checksum !== job.primary_output_checksum);
      if (conflicting) throw failure("WORK_VERIFICATION_PRIMARY_WORK_EXISTS");
      jobs.set(job.id, clone(job));
      receipts.set(receiptKey, { fingerprint, job_id: job.id, work_id: null });
      recordTransition(job, null, "queued", { createdAt: job.created_at });
      return { job: clone(job), work: null, replayed: false };
    },

    async claimNextVerificationJob({ now, leaseExpiresAt, leaseToken, onExpired = null }) {
      const expired = [...jobs.values()].find((job) => job.status === "running" && job.lease_expires_at && Date.parse(job.lease_expires_at) <= Date.parse(now));
      if (expired) {
        const previousExpired = clone(expired), previousLedgerLength = ledger.length;
        const tx = transaction();
        try {
          if (expired.attempts >= expired.max_attempts) {
            Object.assign(expired, { status: "failed", verification_status: "failed", failure_kind: "technical",
              failure_code: "WORK_VERIFICATION_RETRY_EXHAUSTED", failure_reason: "产物核验重试次数已用尽。", completed_at: now, lease_token: null, lease_expires_at: null, updated_at: now });
            recordTransition(expired, "running", "failed", { failureKind: "technical", reason: expired.failure_reason, createdAt: now, transactionClient: tx });
            if (onExpired) await onExpired(clone(expired), { failureKind: "technical", failureCode: expired.failure_code, now, transactionClient: tx });
          } else {
            Object.assign(expired, { status: "queued", verification_status: "queued", lease_token: null, lease_expires_at: null, updated_at: now });
            recordTransition(expired, "running", "queued", { createdAt: now, transactionClient: tx });
            if (onExpired) await onExpired(clone(expired), { failureKind: null, failureCode: null, now, transactionClient: tx });
          }
          await tx.commit();
        } catch (error) {
          await tx.rollback();
          Object.assign(expired, previousExpired);
          ledger.splice(previousLedgerLength);
          throw error;
        }
      }
      const job = [...jobs.values()].find((value) => value.status === "queued" && value.attempts < value.max_attempts);
      if (!job) return null;
      Object.assign(job, {
        status: "running", verification_status: "running", attempts: job.attempts + 1,
        lease_token: leaseToken, lease_expires_at: leaseExpiresAt, started_at: job.started_at || now, updated_at: now
      });
      recordTransition(job, "queued", "running", { createdAt: now });
      return clone(job);
    },

    async heartbeatVerificationJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw failure("WORK_VERIFICATION_LEASE_LOST");
      Object.assign(job, { heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(job);
    },

    async completeVerificationJob({ jobId, leaseToken, now, verificationStatus, failureKind = null, failureCode = null, failureReason = null,
      checks = [], work = null, assetRegistration = null, candidateProjection = null, transitionOrder = null, audit = null }) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw failure("WORK_VERIFICATION_LEASE_LOST");
      const previousJob = clone(job);
      const tx = transaction();
      try {
        if (verificationStatus === "passed") {
          const existing = listScopedWorks(job.organization_id, job.production_order_id).find((value) =>
            value.execution_attempt_id === job.execution_attempt_id && value.primary_output_checksum === job.primary_output_checksum);
          if (existing) {
            Object.assign(job, { status: "succeeded", verification_status: "passed", work_id: existing.id, completed_at: now,
              lease_token: null, lease_expires_at: null, updated_at: now, checks: clone(checks) });
            if (candidateProjection) await candidateProjection({ verificationStatus: "passed", failureKind: null, failureCode: null, now, transactionClient: tx });
            updateReceiptWork(job.id, existing.id, tx);
            recordTransition(job, "running", "passed", { createdAt: now, transactionClient: tx });
            await tx.commit();
            return { job: clone(job), work: clone(existing), replayed: true };
          }
          if (listScopedWorks(job.organization_id, job.production_order_id).length > 0) throw failure("WORK_VERIFICATION_PRIMARY_WORK_EXISTS");
          if (!assetRegistration || !work) throw failure("WORK_VERIFICATION_ASSET_VERSION_REQUIRED");
          const registered = assetRegistration ? await assetRegistration({ transactionClient: tx }) : null;
          if (!registered?.asset_version?.id) throw failure("WORK_VERIFICATION_ASSET_VERSION_REQUIRED");
          const finalWork = { ...clone(work), primary_asset_version_id: registered.asset_version.id };
          await inject("work_insert", finalWork);
          works.set(finalWork.id, clone(finalWork));
          tx.onRollback(() => works.delete(finalWork.id));
          if (candidateProjection) await candidateProjection({ verificationStatus: "passed", failureKind: null, failureCode: null, now, transactionClient: tx });
          await inject("order_transition", finalWork);
          if (transitionOrder && !(await transitionOrder({ transactionClient: tx }))) throw failure("PRODUCTION_ORDER_CONFLICT");
          if (audit) {
            const event = clone(audit);
            audits.push(event);
            tx.onRollback(() => {
              const index = audits.lastIndexOf(event);
              if (index >= 0) audits.splice(index, 1);
            });
          }
          Object.assign(job, { status: "succeeded", verification_status: "passed", work_id: finalWork.id, completed_at: now,
            lease_token: null, lease_expires_at: null, updated_at: now, checks: clone(checks), failure_kind: null, failure_code: null, failure_reason: null });
          updateReceiptWork(job.id, finalWork.id, tx);
          recordTransition(job, "running", "passed", { createdAt: now, transactionClient: tx });
          await tx.commit();
          return { job: clone(job), work: clone(finalWork), replayed: false };
        }
        if (!VERIFICATION_STATES.has(verificationStatus)) throw failure("WORK_VERIFICATION_STATE_INVALID");
        if (candidateProjection) await candidateProjection({ verificationStatus, failureKind, failureCode, now, transactionClient: tx });
        if (audit) {
          const event = clone(audit);
          audits.push(event);
          tx.onRollback(() => {
            const index = audits.lastIndexOf(event);
            if (index >= 0) audits.splice(index, 1);
          });
        }
        Object.assign(job, { status: "succeeded", verification_status: verificationStatus, failure_kind: failureKind,
          failure_code: failureCode, failure_reason: failureReason, completed_at: now, lease_token: null,
          lease_expires_at: null, updated_at: now, checks: clone(checks) });
        recordTransition(job, "running", verificationStatus, { failureKind, reason: failureReason, createdAt: now, transactionClient: tx });
        await tx.commit();
        return { job: clone(job), work: null, replayed: false };
      } catch (error) {
        await tx.rollback();
        Object.assign(job, previousJob);
        throw error;
      }
    },

    async failVerificationJob({ jobId, leaseToken, now, failureCode, failureReason, candidateProjection = null, audit = null }) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw failure("WORK_VERIFICATION_LEASE_LOST");
      const previous = clone(job);
      const tx = transaction();
      try {
        if (candidateProjection) await candidateProjection({ verificationStatus: "failed", failureKind: "technical", failureCode, now, transactionClient: tx });
        if (audit) {
          const event = clone(audit);
          audits.push(event);
          tx.onRollback(() => {
            const index = audits.lastIndexOf(event);
            if (index >= 0) audits.splice(index, 1);
          });
        }
        Object.assign(job, { status: "failed", verification_status: "failed", failure_kind: "technical", failure_code: failureCode,
          failure_reason: failureReason, completed_at: now, lease_token: null, lease_expires_at: null, updated_at: now });
        recordTransition(job, "running", "failed", { failureKind: "technical", reason: failureReason, createdAt: now, transactionClient: tx });
        await tx.commit();
        return { job: clone(job), work: null, replayed: false };
      } catch (error) {
        await tx.rollback();
        Object.assign(job, previous);
        throw error;
      }
    },

    async retryVerificationJob({ organizationId, jobId, receiptKey, fingerprint, now, candidateProjection = null, audit = null }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { job: clone(jobs.get(replay.job_id)), replayed: true };
      const job = scoped(jobs, organizationId, jobId);
      if (!job) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
      if (job.status !== "failed" || job.failure_kind !== "technical") throw failure("WORK_VERIFICATION_RETRY_BLOCKED");
      if (job.attempts >= job.max_attempts) throw failure("WORK_VERIFICATION_RETRY_EXHAUSTED");
      const previousJob = clone(job), previousReceipt = receipts.get(receiptKey) ? clone(receipts.get(receiptKey)) : undefined;
      const tx = transaction();
      try {
        Object.assign(job, { status: "queued", verification_status: "queued", failure_kind: null, failure_code: null, failure_reason: null,
          completed_at: null, lease_token: null, lease_expires_at: null, updated_at: now });
        if (candidateProjection) await candidateProjection({ verificationStatus: "queued", failureKind: null, failureCode: null, now, transactionClient: tx });
        if (audit) {
          const event = clone(audit);
          audits.push(event);
          tx.onRollback(() => {
            const index = audits.lastIndexOf(event);
            if (index >= 0) audits.splice(index, 1);
          });
        }
        recordTransition(job, "failed", "queued", { createdAt: now, transactionClient: tx });
        receipts.set(receiptKey, { fingerprint, job_id: job.id, work_id: job.work_id || null });
        tx.onRollback(() => {
          if (previousReceipt) receipts.set(receiptKey, previousReceipt);
          else receipts.delete(receiptKey);
        });
        await tx.commit();
        return { job: clone(job), replayed: false };
      } catch (error) {
        await tx.rollback();
        Object.assign(job, previousJob);
        throw error;
      }
    },

    async recoverVerificationJob({ organizationId, jobId, receiptKey, fingerprint, now, candidateProjection = null, audit = null }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { job: clone(jobs.get(replay.job_id)), replayed: true };
      const job = scoped(jobs, organizationId, jobId);
      if (!job) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
      if (job.status !== "succeeded" || job.verification_status !== "requires_action") throw failure("WORK_VERIFICATION_RECOVERY_BLOCKED");
      if (job.attempts >= job.max_attempts) throw failure("WORK_VERIFICATION_RETRY_EXHAUSTED");
      const previousJob = clone(job), previousReceipt = receipts.get(receiptKey) ? clone(receipts.get(receiptKey)) : undefined;
      const tx = transaction();
      try {
        Object.assign(job, { status: "queued", verification_status: "queued", failure_kind: null, failure_code: null, failure_reason: null,
          completed_at: null, lease_token: null, lease_expires_at: null, updated_at: now });
        if (candidateProjection) await candidateProjection({ verificationStatus: "queued", failureKind: null, failureCode: null, now, transactionClient: tx });
        if (audit) {
          const event = clone(audit);
          audits.push(event);
          tx.onRollback(() => {
            const index = audits.lastIndexOf(event);
            if (index >= 0) audits.splice(index, 1);
          });
        }
        recordTransition(job, "requires_action", "queued", { createdAt: now, transactionClient: tx });
        receipts.set(receiptKey, { fingerprint, job_id: job.id, work_id: null });
        tx.onRollback(() => {
          if (previousReceipt) receipts.set(receiptKey, previousReceipt);
          else receipts.delete(receiptKey);
        });
        await tx.commit();
        return { job: clone(job), replayed: false };
      } catch (error) {
        await tx.rollback();
        Object.assign(job, previousJob);
        throw error;
      }
    },

    async getVerificationJob(organizationId, jobId) { return clone(scoped(jobs, organizationId, jobId)); },
    async getLatestVerificationJob(organizationId, productionOrderId) {
      const values = [...jobs.values()].filter((job) => job.organization_id === organizationId && job.production_order_id === productionOrderId);
      return clone(values.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)).at(-1) || null);
    },
    async listVerificationJobs(organizationId, productionOrderId = null) {
      return clone([...jobs.values()].filter((job) => job.organization_id === organizationId && (!productionOrderId || job.production_order_id === productionOrderId)));
    },
    async listWorks(organizationId, productionOrderId = null) { return clone(listScopedWorks(organizationId, productionOrderId)); },
    async getWork(organizationId, workId) { return clone(scoped(works, organizationId, workId)); },
    async listAuditEvents(organizationId = null) { return clone(organizationId ? audits.filter((event) => event.organization_id === organizationId) : audits); },
    async listStatusTransitions(organizationId = null) { return clone(organizationId ? ledger.filter((event) => event.organization_id === organizationId) : ledger); },

    _records: { jobs, works, receipts, audits, ledger }
  };
}

const VERIFICATION_STATES = new Set(["queued", "running", "passed", "failed", "requires_action"]);
