function copyRecord(record) {
  return structuredClone(record);
}

function failure(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function commandReceiptKey({ operation, organizationId, actorMemberId, idempotencyKey }) {
  return JSON.stringify([operation, organizationId, actorMemberId, idempotencyKey]);
}

function hasActiveStatus(activeStatuses, status) {
  return activeStatuses instanceof Set
    ? activeStatuses.has(status)
    : Array.isArray(activeStatuses) && activeStatuses.includes(status);
}

export function createMemoryAppearanceFidelityRepository() {
  const records = [];
  const commandReceipts = new Map();
  const candidates = new Map();
  const candidateStates = new Map();
  const providerReferenceObservations = [];
  const events = [];
  const auditEvents = [];
  let nextId = 1;
  let nextEventId = 1;
  let nextAuditEventId = 1;

  function snapshotState() {
    return {
      records: records.map(copyRecord),
      candidates: new Map([...candidates.entries()].map(([key, value]) => [key, copyRecord(value)])),
      candidateStates: new Map([...candidateStates.entries()].map(([key, value]) => [key, copyRecord(value)])),
      providerReferenceObservations: providerReferenceObservations.map(copyRecord),
      events: events.map(copyRecord),
      auditEvents: auditEvents.map(copyRecord),
      nextEventId,
      nextAuditEventId,
    };
  }

  function restoreState(snapshot) {
    records.splice(0, records.length, ...snapshot.records.map(copyRecord));
    candidates.clear();
    for (const [key, value] of snapshot.candidates.entries()) candidates.set(key, copyRecord(value));
    candidateStates.clear();
    for (const [key, value] of snapshot.candidateStates.entries()) candidateStates.set(key, copyRecord(value));
    providerReferenceObservations.splice(
      0,
      providerReferenceObservations.length,
      ...snapshot.providerReferenceObservations.map(copyRecord),
    );
    events.splice(0, events.length, ...snapshot.events.map(copyRecord));
    auditEvents.splice(0, auditEvents.length, ...snapshot.auditEvents.map(copyRecord));
    nextEventId = snapshot.nextEventId;
    nextAuditEventId = snapshot.nextAuditEventId;
  }

  function atomically(work) {
    const before = snapshotState();
    try {
      return work();
    } catch (error) {
      restoreState(before);
      throw error;
    }
  }

  async function atomicallyAsync(work) {
    const before = snapshotState();
    const rollbackCallbacks = [];
    const transactionClient = {
      onRollback(callback) {
        if (typeof callback === 'function') rollbackCallbacks.push(callback);
      },
    };
    try {
      return await work(transactionClient);
    } catch (error) {
      restoreState(before);
      for (const callback of rollbackCallbacks.reverse()) await callback();
      throw error;
    }
  }

  function appendCaptureEvent({ eventType, organizationId, requestId, actorMemberId = null, actorSystemId = null, now, metadata = {} }) {
    events.push({
      id: `appearance-event-${nextEventId}`,
      organization_id: organizationId,
      capture_request_id: requestId,
      actor_member_id: actorMemberId,
      actor_system_id: actorSystemId,
      event_type: eventType,
      metadata: copyRecord(metadata),
      created_at: now,
    });
    nextEventId += 1;
    auditEvents.push({
      id: `appearance-audit-${nextAuditEventId}`,
      organization_id: organizationId,
      capture_request_id: requestId,
      actor_member_id: actorMemberId,
      actor_system_id: actorSystemId,
      event_type: eventType,
      metadata: copyRecord(metadata),
      created_at: now,
    });
    nextAuditEventId += 1;
  }

  function readCommandReceipt({ operation, organizationId, actorMemberId, idempotencyKey, fingerprint }) {
    const key = commandReceiptKey({ operation, organizationId, actorMemberId, idempotencyKey });
    const receipt = commandReceipts.get(key);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) {
      throw failure('IDEMPOTENCY_CONFLICT', 'idempotency key payload changed');
    }
    return {
      record: copyRecord(receipt.record),
      replayed: true,
    };
  }

  return {
    async initialize() {},
    async close() {},

    async findByIdempotencyKey({ organizationId, actorMemberId, idempotencyKey }) {
      const record = records.find(
        (candidate) => candidate.organization_id === organizationId &&
          candidate.requested_by_member_id === actorMemberId &&
          candidate.idempotency_key === idempotencyKey,
      );
      return record ? copyRecord(record) : null;
    },

    async findActiveCaptureRequest({ organizationId, upstreamFingerprint, activeStatuses }) {
      const record = records.find(
        (candidate) => candidate.organization_id === organizationId &&
          candidate.upstream_fingerprint === upstreamFingerprint &&
          hasActiveStatus(activeStatuses, candidate.status),
      );
      return record ? copyRecord(record) : null;
    },

    async createCaptureRequest(record) {
      const existingForKey = records.find(
        (candidate) => candidate.organization_id === record.organization_id &&
          candidate.requested_by_member_id === record.requested_by_member_id &&
          candidate.idempotency_key === record.idempotency_key,
      );
      if (existingForKey) {
        if (existingForKey.idempotency_payload !== record.idempotency_payload) {
          const error = new Error('idempotency key payload changed');
          error.code = 'IDEMPOTENCY_CONFLICT';
          throw error;
        }
        return copyRecord({ ...existingForKey, replayed: true });
      }

      const existingActive = records.find(
        (candidate) => candidate.organization_id === record.organization_id &&
          candidate.upstream_fingerprint === record.upstream_fingerprint &&
          hasActiveStatus(new Set(['awaiting_authorization', 'queued', 'running']), candidate.status),
      );
      if (existingActive) {
        const error = new Error('an active capture request already exists for the upstream binding');
        error.code = 'APPEARANCE_CAPTURE_CONFLICT';
        throw error;
      }

      const stored = copyRecord({
        ...record,
        id: `appearance-capture-${nextId}`,
      });
      nextId += 1;
      records.push(stored);
      appendCaptureEvent({
        eventType: 'appearance.capture_requested',
        organizationId: stored.organization_id,
        requestId: stored.id,
        actorMemberId: stored.requested_by_member_id,
        now: stored.created_at,
      });
      return copyRecord(stored);
    },

    async getCaptureRequest({ organizationId, requestId }) {
      const record = records.find((candidate) => candidate.organization_id === organizationId &&
        candidate.id === requestId);
      return record ? copyRecord(record) : null;
    },

    async listCaptureRequests({ organizationId, productId, status } = {}) {
      return records
        .filter((candidate) => (organizationId === undefined || candidate.organization_id === organizationId) &&
          (productId === undefined || candidate.product_id === productId) &&
          (status === undefined || candidate.status === status))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
        .map(copyRecord);
    },

    async claimNextCapture({ systemActorId = null, now }) {
      if (records.some((candidate) => candidate.status === 'running')) return null;
      const index = records.findIndex((candidate) => candidate.status === 'queued');
      if (index < 0) return null;

      return atomically(() => {
        const current = records[index];
        const nextRowVersion = current.row_version + 1;
        const next = {
          ...current,
          status: 'running',
          row_version: nextRowVersion,
          claimed_by_system_id: systemActorId,
          updated_at: now,
          status_history: [
            ...(Array.isArray(current.status_history) ? copyRecord(current.status_history) : []),
            { status: 'running', row_version: nextRowVersion, at: now },
          ],
        };
        records[index] = next;
        appendCaptureEvent({
          eventType: 'appearance.capture_claimed',
          organizationId: current.organization_id,
          requestId: current.id,
          actorSystemId: systemActorId,
          now,
        });
        return copyRecord(next);
      });
    },

    async completeCapture({
      organizationId,
      requestId,
      expectedRevision,
      candidate,
      candidateState,
      providerReferenceObservation,
      registerCandidateAsset,
      now,
      actorSystemId = null,
    }) {
      return atomicallyAsync(async (transactionClient) => {
        const index = records.findIndex((value) => value.organization_id === organizationId && value.id === requestId);
        if (index < 0) throw failure('APPEARANCE_CAPTURE_REQUEST_NOT_FOUND', 'capture request is not available');

        const current = records[index];
        if (current.row_version !== expectedRevision || current.status !== 'running') {
          throw failure('APPEARANCE_CAPTURE_CONFLICT', 'capture request revision or state changed');
        }
        if (!candidate || candidate.organization_id !== organizationId || candidate.capture_request_id !== requestId ||
            !candidate.id || candidates.has(candidate.id)) {
          throw failure('APPEARANCE_CAPTURE_COMPLETION_FAILED', 'candidate completion is invalid');
        }
        if (!candidateState || candidateState.organization_id !== organizationId ||
            candidateState.candidate_id !== candidate.id || candidateState.state !== 'available' ||
            candidateState.row_version !== 1) {
          throw failure('APPEARANCE_CAPTURE_COMPLETION_FAILED', 'candidate state completion is invalid');
        }
        if (!providerReferenceObservation ||
            !providerReferenceObservation.id ||
            providerReferenceObservation.organization_id !== organizationId ||
            providerReferenceObservation.candidate_id !== candidate.id ||
            providerReferenceObservation.status !== 'available' ||
            !providerReferenceObservation.reference_fingerprint ||
            !providerReferenceObservation.method ||
            providerReferenceObservation.valid_until !== providerReferenceObservation.observed_at) {
          throw failure('APPEARANCE_CAPTURE_COMPLETION_FAILED', 'provider observation completion is invalid');
        }
        if (typeof registerCandidateAsset !== 'function') {
          throw failure('APPEARANCE_CAPTURE_COMPLETION_FAILED', 'candidate asset registration is required');
        }
        const registered = await registerCandidateAsset(transactionClient);
        const completedCandidate = {
          ...candidate,
          candidate_asset_id: registered.asset.id,
          candidate_asset_version_id: registered.asset_version.id,
        };

        const nextRowVersion = current.row_version + 1;
        const next = {
          ...current,
          status: 'succeeded',
          row_version: nextRowVersion,
          appearance_candidate_id: completedCandidate.id,
          failure_code: null,
          updated_at: now,
          status_history: [
            ...(Array.isArray(current.status_history) ? copyRecord(current.status_history) : []),
            { status: 'succeeded', row_version: nextRowVersion, at: now },
          ],
        };
        records[index] = next;
        candidates.set(completedCandidate.id, copyRecord(completedCandidate));
        candidateStates.set(completedCandidate.id, copyRecord(candidateState));
        providerReferenceObservations.push(copyRecord(providerReferenceObservation));
        appendCaptureEvent({
          eventType: 'appearance.capture_succeeded',
          organizationId,
          requestId,
          actorSystemId,
          now,
          metadata: {
            candidate_id: completedCandidate.id,
            provider_reference_observation_id: providerReferenceObservation.id,
          },
        });
        return {
          record: copyRecord(next),
          candidate: copyRecord(completedCandidate),
          candidateState: copyRecord(candidateState),
          providerReferenceObservation: copyRecord(providerReferenceObservation),
        };
      });
    },

    async failCapture({ organizationId, requestId, expectedRevision, failureCode, now, actorSystemId = null }) {
      return atomically(() => {
        const index = records.findIndex((value) => value.organization_id === organizationId && value.id === requestId);
        if (index < 0) throw failure('APPEARANCE_CAPTURE_REQUEST_NOT_FOUND', 'capture request is not available');

        const current = records[index];
        if (current.row_version !== expectedRevision || current.status !== 'running') {
          throw failure('APPEARANCE_CAPTURE_CONFLICT', 'capture request revision or state changed');
        }
        const nextRowVersion = current.row_version + 1;
        const next = {
          ...current,
          status: 'failed',
          row_version: nextRowVersion,
          appearance_candidate_id: null,
          failure_code: failureCode,
          updated_at: now,
          status_history: [
            ...(Array.isArray(current.status_history) ? copyRecord(current.status_history) : []),
            { status: 'failed', row_version: nextRowVersion, at: now },
          ],
        };
        records[index] = next;
        appendCaptureEvent({
          eventType: 'appearance.capture_failed',
          organizationId,
          requestId,
          actorSystemId,
          now,
          metadata: { failure_code: failureCode },
        });
        return copyRecord(next);
      });
    },

    async getCandidate({ organizationId, candidateId }) {
      const candidate = candidates.get(candidateId);
      if (!candidate || candidate.organization_id !== organizationId) return null;
      const candidateState = candidateStates.get(candidateId);
      const providerReferenceObservation = providerReferenceObservations.filter(
        (observation) => observation.organization_id === organizationId && observation.candidate_id === candidateId,
      ).at(-1);
      if (!candidateState || !providerReferenceObservation) return null;
      return {
        candidate: copyRecord(candidate),
        candidateState: copyRecord(candidateState),
        providerReferenceObservation: copyRecord(providerReferenceObservation),
      };
    },

    async listCandidates({ organizationId, productId, state } = {}) {
      return [...candidates.values()]
        .filter((candidate) => candidate.organization_id === organizationId &&
          (productId === undefined || candidate.product_id === productId) &&
          (state === undefined || candidateStates.get(candidate.id)?.state === state))
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
        .map(copyRecord);
    },

    async listProviderReferenceObservations({ organizationId, candidateId } = {}) {
      return providerReferenceObservations
        .filter((observation) => (organizationId === undefined || observation.organization_id === organizationId) &&
          (candidateId === undefined || observation.candidate_id === candidateId))
        .map(copyRecord);
    },

    async listEvents(organizationId) {
      return events
        .filter((event) => organizationId === undefined || event.organization_id === organizationId)
        .map(copyRecord);
    },

    async listAuditEvents(organizationId) {
      return auditEvents
        .filter((event) => organizationId === undefined || event.organization_id === organizationId)
        .map(copyRecord);
    },

    async transitionCaptureRequest({
      operation,
      organizationId,
      actorMemberId,
      requestId,
      expectedRevision,
      idempotencyKey,
      fingerprint,
      maxCandidateGenerations,
      fromStatuses,
      status,
      patch = {},
    }) {
      const replay = readCommandReceipt({ operation, organizationId, actorMemberId, idempotencyKey, fingerprint });
      if (replay) return replay;

      if (operation === 'authorize' && maxCandidateGenerations !== 1) {
        throw failure(
          'APPEARANCE_CAPTURE_CONFLICT',
          'capture authorization permits exactly one candidate generation',
        );
      }

      const index = records.findIndex((candidate) => candidate.organization_id === organizationId &&
        candidate.id === requestId);
      if (index < 0) {
        throw failure('APPEARANCE_CAPTURE_REQUEST_NOT_FOUND', 'capture request is not available');
      }

      const current = records[index];
      if (current.row_version !== expectedRevision || !fromStatuses.includes(current.status)) {
        throw failure('APPEARANCE_CAPTURE_CONFLICT', 'capture request revision or state changed');
      }

      const nextRowVersion = current.row_version + 1;
      const at = patch.updated_at || current.updated_at;
      const next = {
        ...current,
        ...copyRecord(patch),
        status,
        row_version: nextRowVersion,
        updated_at: at,
        status_history: [
          ...(Array.isArray(current.status_history) ? copyRecord(current.status_history) : []),
          { status, row_version: nextRowVersion, at },
        ],
      };
      records[index] = next;
      appendCaptureEvent({
        eventType: operation === 'authorize' ? 'appearance.capture_authorized' : 'appearance.capture_cancelled',
        organizationId,
        requestId,
        actorMemberId,
        now: at,
      });
      commandReceipts.set(commandReceiptKey({ operation, organizationId, actorMemberId, idempotencyKey }), {
        fingerprint,
        record: copyRecord(next),
      });
      return { record: copyRecord(next), replayed: false };
    },
  };
}
