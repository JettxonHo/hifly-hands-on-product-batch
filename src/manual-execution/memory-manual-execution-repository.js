const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

function scoped(map, organizationId, id) {
  const value = map.get(id);
  return value?.organization_id === organizationId ? value : null;
}

export function createMemoryManualExecutionRepository() {
  const attempts = new Map();
  const reports = new Map();
  const candidates = new Map();
  const receipts = new Map();
  const audits = [];
  const transitions = [];

  function readReceipt(receiptKey, fingerprint) {
    const receipt = receipts.get(receiptKey);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(receipt);
  }

  function activeAttempt(organizationId, productionOrderId) {
    return [...attempts.values()].find((attempt) => attempt.organization_id === organizationId &&
      attempt.production_order_id === productionOrderId && ["claimed", "running"].includes(attempt.status)) || null;
  }

  return {
    async initialize() {},
    async close() {},

    async getReceipt(receiptKey, fingerprint) {
      return readReceipt(receiptKey, fingerprint);
    },

    async claimAttempt({ receiptKey, fingerprint, attempt, transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      if (activeAttempt(attempt.organization_id, attempt.production_order_id)) throw failure("MANUAL_EXECUTION_ATTEMPT_ACTIVE");
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      attempts.set(attempt.id, clone(attempt));
      receipts.set(receiptKey, { fingerprint, attempt_id: attempt.id });
      transitions.push(...attempt.status_history.map((entry, index) => ({
        id: `${attempt.id}-transition-${index}`, organization_id: attempt.organization_id, attempt_id: attempt.id,
        from_status: index === 0 ? null : attempt.status_history[index - 1].status, to_status: entry.status,
        actor_member_id: attempt.operator_id, reason: entry.reason || null, created_at: entry.at
      })));
      audits.push(clone(audit));
      return { attempt: clone(attempt), replayed: false };
    },

    async startAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      const current = scoped(attempts, organizationId, attemptId);
      if (!current) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
      if (current.row_version !== expectedRevision || current.status !== "claimed") throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      Object.assign(current, clone(patch), { row_version: current.row_version + 1 });
      attempts.set(current.id, current);
      receipts.set(receiptKey, { fingerprint, attempt_id: current.id });
      transitions.push({ id: `${current.id}-transition-${current.row_version}`, organization_id: current.organization_id,
        attempt_id: current.id, from_status: "claimed", to_status: "running", actor_member_id: current.operator_id,
        reason: null, created_at: current.updated_at });
      audits.push(clone(audit));
      return { attempt: clone(current), replayed: false };
    },

    async createCandidateUpload({ receiptKey, fingerprint, candidate }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { candidate: clone(candidates.get(replay.candidate_id)), replayed: true };
      if (candidate.role === "primary_video" && [...candidates.values()].some((value) => value.organization_id === candidate.organization_id &&
        value.execution_attempt_id === candidate.execution_attempt_id && value.role === "primary_video" && value.status !== "removed")) {
        throw failure("MANUAL_EXECUTION_PRIMARY_OUTPUT_EXISTS");
      }
      candidates.set(candidate.id, clone(candidate));
      receipts.set(receiptKey, { fingerprint, candidate_id: candidate.id });
      audits.push(clone(candidate.audit));
      return { candidate: clone(candidate), replayed: false };
    },

    async getCandidate(organizationId, candidateId) { return clone(scoped(candidates, organizationId, candidateId)); },
    async findCandidateByTokenDigest(organizationId, tokenDigest) {
      return clone([...candidates.values()].find((candidate) => candidate.organization_id === organizationId && candidate.upload_token_digest === tokenDigest) || null);
    },
    async rotateCandidateUploadToken({ organizationId, candidateId, tokenDigest, now }) {
      const candidate = scoped(candidates, organizationId, candidateId);
      if (!candidate) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
      if (candidate.status === "upload_pending") {
        Object.assign(candidate, { upload_token_digest: tokenDigest, updated_at: now, row_version: candidate.row_version + 1 });
      }
      return clone(candidate);
    },
    async markCandidateUploaded({ organizationId, candidateId, now, receiptKey, fingerprint, audit }) {
      if (receiptKey) {
        const replay = readReceipt(receiptKey, fingerprint);
        if (replay) return { candidate: clone(candidates.get(replay.candidate_id)), replayed: true };
      }
      const candidate = scoped(candidates, organizationId, candidateId);
      if (!candidate) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
      if (candidate.status === "uploaded") {
        if (receiptKey) receipts.set(receiptKey, { fingerprint, candidate_id: candidate.id });
        return { candidate: clone(candidate), replayed: true };
      }
      if (candidate.status !== "upload_pending") throw failure("MANUAL_EXECUTION_CANDIDATE_CONFLICT");
      Object.assign(candidate, { status: "uploaded", uploaded_at: now, updated_at: now, row_version: candidate.row_version + 1 });
      if (receiptKey) receipts.set(receiptKey, { fingerprint, candidate_id: candidate.id });
      if (audit) audits.push(clone(audit));
      return { candidate: clone(candidate), replayed: false };
    },

    async saveReport({ receiptKey, fingerprint, report, attemptId, organizationId, expectedRevision, patchAttempt, candidatePatches = [], transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { report: clone(reports.get(replay.report_id)), attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      const attempt = scoped(attempts, organizationId, attemptId);
      if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
      if (attempt.row_version !== expectedRevision) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
      const existingReport = reports.get(report.id);
      if (existingReport && existingReport.organization_id !== organizationId) throw failure("MANUAL_EXECUTION_REPORT_CONFLICT");
      if (transitionOrder) {
        const order = await transitionOrder();
        if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      }
      Object.assign(attempt, clone(patchAttempt), { row_version: attempt.row_version + 1 });
      attempts.set(attempt.id, attempt);
      for (const patch of candidatePatches) {
        const candidate = scoped(candidates, organizationId, patch.id);
        if (candidate) Object.assign(candidate, clone(patch.values), { row_version: candidate.row_version + 1, updated_at: report.submitted_at });
      }
      reports.set(report.id, clone(report));
      receipts.set(receiptKey, { fingerprint, report_id: report.id, attempt_id: attempt.id });
      transitions.push({ id: `${attempt.id}-transition-${attempt.row_version}`, organization_id: attempt.organization_id,
        attempt_id: attempt.id, from_status: patchAttempt.previous_status, to_status: patchAttempt.status,
        actor_member_id: report.submitted_by, reason: null, created_at: report.submitted_at });
      audits.push(clone(audit));
      return { report: clone(report), attempt: clone(attempt), replayed: false };
    },

    async recoverAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      const attempt = scoped(attempts, organizationId, attemptId);
      if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
      if (attempt.row_version !== expectedRevision || attempt.status !== "requires_action") throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      Object.assign(attempt, clone(patch), { row_version: attempt.row_version + 1 });
      attempts.set(attempt.id, attempt);
      receipts.set(receiptKey, { fingerprint, attempt_id: attempt.id });
      transitions.push({ id: `${attempt.id}-transition-${attempt.row_version}`, organization_id: attempt.organization_id,
        attempt_id: attempt.id, from_status: "requires_action", to_status: "running", actor_member_id: attempt.operator_id,
        reason: null, created_at: attempt.updated_at });
      audits.push(clone(audit));
      return { attempt: clone(attempt), replayed: false };
    },

    async supersedeFailedAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      const attempt = scoped(attempts, organizationId, attemptId);
      if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
      if (attempt.row_version !== expectedRevision || attempt.status !== "failed") throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      Object.assign(attempt, clone(patch), { row_version: attempt.row_version + 1 });
      attempts.set(attempt.id, attempt);
      receipts.set(receiptKey, { fingerprint, attempt_id: attempt.id });
      transitions.push({ id: `${attempt.id}-transition-${attempt.row_version}`, organization_id: attempt.organization_id,
        attempt_id: attempt.id, from_status: "failed", to_status: "superseded", actor_member_id: attempt.operator_id,
        reason: null, created_at: attempt.updated_at });
      audits.push(clone(audit));
      return { attempt: clone(attempt), replayed: false };
    },

    async cancelAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, transitionOrder, audit }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { attempt: clone(attempts.get(replay.attempt_id)), replayed: true };
      const attempt = scoped(attempts, organizationId, attemptId);
      if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
      if (attempt.row_version !== expectedRevision || !["claimed", "running"].includes(attempt.status)) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      Object.assign(attempt, clone(patch), { row_version: attempt.row_version + 1 });
      attempts.set(attempt.id, attempt);
      receipts.set(receiptKey, { fingerprint, attempt_id: attempt.id });
      transitions.push({ id: `${attempt.id}-transition-${attempt.row_version}`, organization_id: attempt.organization_id,
        attempt_id: attempt.id, from_status: patch.previous_status, to_status: "cancel_requested", actor_member_id: attempt.operator_id,
        reason: null, created_at: attempt.updated_at });
      audits.push(clone(audit));
      return { attempt: clone(attempt), replayed: false };
    },

    async cancelWaitingOrder({ receiptKey, fingerprint, organizationId, orderId, transitionOrder, audit, now }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { order_id: replay.order_id, replayed: true };
      const order = await transitionOrder();
      if (!order) throw failure("PRODUCTION_ORDER_CONFLICT");
      receipts.set(receiptKey, { fingerprint, order_id: orderId });
      audits.push(clone(audit));
      return { order_id: orderId, replayed: false, order: clone(order) };
    },

    async getAttempt(organizationId, attemptId) { return clone(scoped(attempts, organizationId, attemptId)); },
    async getReport(organizationId, reportId) { return clone(scoped(reports, organizationId, reportId)); },
    async listAttempts(organizationId, productionOrderId) {
      return [...attempts.values()].filter((attempt) => attempt.organization_id === organizationId &&
        (!productionOrderId || attempt.production_order_id === productionOrderId))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)).map(clone);
    },
    async listReports(organizationId, attemptId) {
      return [...reports.values()].filter((report) => report.organization_id === organizationId && (!attemptId || report.execution_attempt_id === attemptId))
        .sort((left, right) => left.report_version - right.report_version || left.id.localeCompare(right.id)).map(clone);
    },
    async listCandidates(organizationId, attemptId) {
      return [...candidates.values()].filter((candidate) => candidate.organization_id === organizationId && (!attemptId || candidate.execution_attempt_id === attemptId))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)).map(clone);
    },
    async listAuditEvents(organizationId = null) { return clone(organizationId ? audits.filter((event) => event.organization_id === organizationId) : audits); },
    async listStatusTransitions(organizationId = null) { return clone(organizationId ? transitions.filter((event) => event.organization_id === organizationId) : transitions); },

    _records: { attempts, reports, candidates, receipts, audits, transitions }
  };
}
