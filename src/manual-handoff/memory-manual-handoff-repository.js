import { createHash, randomUUID } from "node:crypto";
import { MANUAL_HANDOFF_PACKAGE_STATES } from "./manual-handoff-package.js";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });
const tokenDigest = (value) => createHash("sha256").update(value).digest("hex");
const allowedTransitions = {
  generating: ["ready", "generation_failed", "superseded", "revoked"],
  ready: ["expired", "superseded", "revoked"],
  generation_failed: ["generating", "superseded", "revoked"],
  expired: ["ready", "superseded", "revoked"],
  superseded: [],
  revoked: []
};

export function createMemoryManualHandoffRepository() {
  const packages = new Map();
  const jobs = new Map();
  const receipts = new Map();
  const grants = new Map();
  const audits = [];
  const transitions = [];

  function scopedPackage(organizationId, packageId) {
    const value = packages.get(packageId);
    return value?.organization_id === organizationId ? value : null;
  }
  function recordTransition(value, fromStatus, toStatus, at, actorMemberId = null, reason = null) {
    if (fromStatus === toStatus) return;
    value.status = toStatus;
    value.row_version += 1;
    value.updated_at = at;
    value.status_history.push({ from_status: fromStatus, to_status: toStatus, at, actor_member_id: actorMemberId, reason });
    transitions.push({ id: randomUUID(), organization_id: value.organization_id, package_id: value.id, from_status: fromStatus, to_status: toStatus, reason, created_at: at });
  }
  function audit(event) { audits.push(clone(event)); }

  return {
    async initialize() {},
    async close() {},
    async getGenerationReceipt(receiptKey, fingerprint) {
      const receipt = receipts.get(receiptKey);
      if (!receipt) return null;
      if (receipt.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
      return clone(receipt);
    },
    async nextPackageVersion(organizationId, productionOrderId, contractVersion) {
      return Math.max(0, ...[...packages.values()].filter((value) => value.organization_id === organizationId && value.production_order_id === productionOrderId && value.contract_version === contractVersion).map((value) => value.package_version)) + 1;
    },
    async createGenerationRequest({ receiptKey, fingerprint, package: value, job, supersedePackageIds = [], audit: event }) {
      const existing = receipts.get(receiptKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
        return { package: clone(packages.get(existing.package_id)), job: clone(jobs.get(existing.job_id)), replayed: true };
      }
      const conflict = [...packages.values()].find((candidate) => candidate.organization_id === value.organization_id && candidate.production_order_id === value.production_order_id && candidate.contract_version === value.contract_version && candidate.package_version === value.package_version);
      if (conflict) throw failure("MANUAL_HANDOFF_PACKAGE_VERSION_CONFLICT");
      for (const packageId of supersedePackageIds) {
        const prior = scopedPackage(value.organization_id, packageId);
        if (prior && ["generating", "ready", "generation_failed", "expired"].includes(prior.status)) recordTransition(prior, prior.status, "superseded", value.created_at);
      }
      packages.set(value.id, clone(value));
      jobs.set(job.id, clone(job));
      receipts.set(receiptKey, { fingerprint, package_id: value.id, job_id: job.id });
      transitions.push({ id: randomUUID(), organization_id: value.organization_id, package_id: value.id, from_status: null, to_status: value.status, created_at: value.created_at });
      audit(event);
      return { package: clone(value), job: clone(job), replayed: false };
    },
    async getPackage(organizationId, packageId) { return clone(scopedPackage(organizationId, packageId)); },
    async listPackages(organizationId, productionOrderId) {
      return [...packages.values()].filter((value) => value.organization_id === organizationId && (!productionOrderId || value.production_order_id === productionOrderId)).sort((a, b) => b.package_version - a.package_version || b.created_at.localeCompare(a.created_at)).map(clone);
    },
    async getJob(organizationId, jobId) {
      const value = jobs.get(jobId);
      return clone(value?.organization_id === organizationId ? value : null);
    },
    async claimNextJob(now, leaseExpiresAt, leaseToken) {
      for (const value of jobs.values()) {
        if (value.status === "running" && value.lease_expires_at && Date.parse(value.lease_expires_at) <= Date.parse(now)) {
          if (value.attempts >= value.max_attempts) {
            Object.assign(value, { status: "failed", failure_reason: "交接包生成未完成，请稍后重试。", completed_at: now, lease_token: null, lease_expires_at: null, updated_at: now });
            const pkg = packages.get(value.package_id);
            if (pkg) recordTransition(pkg, pkg.status, "generation_failed", now, null, value.failure_reason);
          } else Object.assign(value, { status: "queued", lease_token: null, lease_expires_at: null, updated_at: now });
        }
      }
      const value = [...jobs.values()].find((candidate) => candidate.status === "queued" && candidate.attempts < candidate.max_attempts);
      if (!value) return null;
      Object.assign(value, { status: "running", attempts: value.attempts + 1, lease_token: leaseToken, lease_expires_at: leaseExpiresAt, started_at: value.started_at || now, heartbeat_at: now, updated_at: now });
      return clone(value);
    },
    async heartbeatJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const value = jobs.get(jobId);
      if (!value || value.status !== "running" || value.lease_token !== leaseToken) throw failure("MANUAL_HANDOFF_LEASE_LOST");
      Object.assign(value, { heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(value);
    },
    async completeJob({ jobId, leaseToken, manifest, readme, manifestHash, packageHash, storageKey, now, audit: event }) {
      const job = jobs.get(jobId);
      if (!job) throw failure("MANUAL_HANDOFF_JOB_NOT_FOUND");
      if (job.status === "succeeded") return clone(packages.get(job.package_id));
      if (job.status !== "running" || job.lease_token !== leaseToken) throw failure("MANUAL_HANDOFF_LEASE_LOST");
      const value = packages.get(job.package_id);
      Object.assign(value, { status: "ready", manifest: clone(manifest), readme, manifest_hash: manifestHash, package_hash: packageHash, storage_key: storageKey, failure_reason: null, updated_at: now, row_version: value.row_version + 1 });
      value.status_history.push({ from_status: "generating", to_status: "ready", at: now, actor_member_id: null, reason: null });
      transitions.push({ id: randomUUID(), organization_id: value.organization_id, package_id: value.id, from_status: "generating", to_status: "ready", created_at: now });
      Object.assign(job, { status: "succeeded", completed_at: now, lease_token: null, lease_expires_at: null, updated_at: now, failure_reason: null });
      audit(event);
      return clone(value);
    },
    async failJob({ jobId, leaseToken, failureReason, now, audit: event }) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw failure("MANUAL_HANDOFF_LEASE_LOST");
      Object.assign(job, { status: "failed", completed_at: now, lease_token: null, lease_expires_at: null, updated_at: now, failure_reason: failureReason });
      const value = packages.get(job.package_id);
      if (value) {
        value.failure_reason = failureReason;
        recordTransition(value, value.status, "generation_failed", now, null, failureReason);
      }
      audit(event);
      return clone(value);
    },
    async retryJob({ organizationId, packageId, receiptKey, fingerprint, now, audit: event }) {
      const existing = receipts.get(receiptKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
        return { package: clone(packages.get(existing.package_id)), job: clone(jobs.get(existing.job_id)), replayed: true };
      }
      const value = scopedPackage(organizationId, packageId);
      if (!value) return null;
      const job = jobs.get(value.generation_job_id);
      if (value.status !== "generation_failed" || !job || job.attempts >= job.max_attempts) throw failure("MANUAL_HANDOFF_RETRY_BLOCKED");
      Object.assign(value, { status: "generating", failure_reason: null, updated_at: now, row_version: value.row_version + 1 });
      value.status_history.push({ from_status: "generation_failed", to_status: "generating", at: now, actor_member_id: null, reason: null });
      Object.assign(job, { status: "queued", failure_reason: null, completed_at: null, updated_at: now });
      receipts.set(receiptKey, { fingerprint, package_id: value.id, job_id: job.id });
      audit(event);
      return { package: clone(value), job: clone(job), replayed: false };
    },
    async reconcileDownloadExpiry({ organizationId, packageId, now }) {
      const value = scopedPackage(organizationId, packageId);
      if (!value || value.status !== "ready") return clone(value);
      const latest = [...grants.values()].filter((grant) => grant.organization_id === organizationId && grant.package_id === packageId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (latest && Date.parse(latest.expires_at) <= Date.parse(now)) {
        if (latest.status === "active") latest.status = "expired";
        recordTransition(value, "ready", "expired", now, null, "下载授权已过期");
      }
      return clone(value);
    },
    async createDownloadGrant({ organizationId, packageId, memberId, token, expiresAt, now, audit: event }) {
      const value = scopedPackage(organizationId, packageId);
      if (!value) return null;
      const grant = { id: randomUUID(), organization_id: organizationId, package_id: packageId, member_id: memberId, token_digest: tokenDigest(token), status: "active", expires_at: expiresAt, created_at: now, consumed_at: null };
      grants.set(grant.id, grant);
      audit(event);
      return clone(grant);
    },
    async getDownloadGrant({ organizationId, packageId, memberId, token, now }) {
      const digest = tokenDigest(token);
      const grant = [...grants.values()].find((value) => value.organization_id === organizationId && value.package_id === packageId && value.member_id === memberId && value.token_digest === digest);
      if (!grant) return null;
      if (grant.status !== "active" || Date.parse(grant.expires_at) <= Date.parse(now)) {
        grant.status = "expired";
        return null;
      }
      return clone(grant);
    },
    async consumeDownloadGrant({ grantId, now }) {
      const grant = grants.get(grantId);
      if (grant) Object.assign(grant, { status: "consumed", consumed_at: now });
    },
    async appendAudit(event) { audit(event); },
    async transitionPackage({ organizationId, packageId, status, reason, actorMemberId, now }) {
      const value = scopedPackage(organizationId, packageId);
      if (!value) return null;
      if (!MANUAL_HANDOFF_PACKAGE_STATES.includes(status)) throw failure("MANUAL_HANDOFF_PACKAGE_STATE_INVALID");
      if (status !== value.status && !allowedTransitions[value.status]?.includes(status)) throw failure("MANUAL_HANDOFF_PACKAGE_TRANSITION_INVALID");
      if (status !== value.status) recordTransition(value, value.status, status, now, actorMemberId, reason || (status === "revoked" ? "包已停用" : null));
      return clone(value);
    },
    async listAuditEvents(organizationId = null) { return clone(organizationId ? audits.filter((event) => event.organization_id === organizationId) : audits); },
    async listStatusTransitions(organizationId = null) { return clone(organizationId ? transitions.filter((event) => event.organization_id === organizationId) : transitions); }
  };
}
