import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertAppearanceFidelitySchemaCurrent } from "./postgres.js";

const CLAIM_LOCK_KEY = 570090015;
const one = (result) => result.rows[0] ?? null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const json = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const failure = (code, message = code) => Object.assign(new Error(message), { code });

function requestProjection(row) {
  if (!row) return null;
  return {
    ...row,
    row_version: Number(row.row_version),
    max_candidate_generations: Number(row.max_candidate_generations),
    workspace_revision: Number(row.workspace_revision),
    source_asset_size: Number(row.source_asset_size),
    status_history: json(row.status_history, []),
    authorized_at: iso(row.authorized_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

function candidateProjection(row) {
  if (!row) return null;
  return {
    ...row,
    source_asset_size: Number(row.source_asset_size),
    size: Number(row.size),
    created_at: iso(row.created_at)
  };
}

function candidateStateProjection(row) {
  if (!row) return null;
  return {
    ...row,
    row_version: Number(row.row_version),
    observed_at: iso(row.observed_at),
    updated_at: iso(row.updated_at)
  };
}

function observationProjection(row) {
  if (!row) return null;
  return {
    ...row,
    observed_at: iso(row.observed_at),
    valid_until: iso(row.valid_until),
    created_at: iso(row.created_at)
  };
}

function eventProjection(row) {
  if (!row) return null;
  return { ...row, metadata: json(row.metadata, {}), created_at: iso(row.created_at) };
}

function requestSelect(organizationId, requestId, lock = false) {
  return {
    text: `SELECT * FROM appearance_capture_requests WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    values: [organizationId, requestId]
  };
}

async function appendCaptureEvent(client, {
  organizationId,
  requestId,
  actorMemberId = null,
  actorSystemId = null,
  eventType,
  metadata = {},
  createdAt
}) {
  const values = [organizationId, requestId, actorMemberId, actorSystemId, eventType, JSON.stringify(metadata), createdAt];
  await client.query(
    `INSERT INTO appearance_capture_events(
       id, organization_id, capture_request_id, actor_member_id, actor_system_id, event_type, metadata, created_at
     ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
    values
  );
  await client.query(
    `INSERT INTO appearance_capture_audit_events(
       id, organization_id, capture_request_id, actor_member_id, actor_system_id, event_type, metadata, created_at
     ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
    values
  );
}

function receiptKey({ organizationId, actorMemberId, operation, idempotencyKey }) {
  return [organizationId, actorMemberId, operation, idempotencyKey];
}

async function readReceipt(client, input) {
  const receipt = one(await client.query(
    `SELECT * FROM appearance_capture_idempotency_receipts
      WHERE organization_id=$1 AND actor_member_id=$2 AND operation=$3 AND idempotency_key=$4
      FOR UPDATE`,
    receiptKey(input)
  ));
  if (!receipt) return null;
  if (receipt.payload_fingerprint !== input.fingerprint) throw failure("IDEMPOTENCY_CONFLICT", "idempotency key payload changed");
  return receipt;
}

function activeStatusValues(activeStatuses) {
  if (activeStatuses instanceof Set) return [...activeStatuses];
  if (Array.isArray(activeStatuses)) return activeStatuses;
  return ["awaiting_authorization", "queued", "running"];
}

function candidateBundle(row) {
  if (!row) return null;
  const candidate = { ...row };
  const state = candidateStateProjection({
    candidate_id: candidate.id,
    organization_id: candidate.organization_id,
    state: candidate.candidate_state_value,
    row_version: candidate.candidate_state_row_version,
    reason_code: candidate.candidate_state_reason_code,
    observed_at: candidate.candidate_state_observed_at,
    updated_at: candidate.candidate_state_updated_at,
    superseded_by_candidate_id: candidate.candidate_state_superseded_by_candidate_id
  });
  const observation = observationProjection({
    id: candidate.observation_id,
    organization_id: candidate.observation_organization_id,
    candidate_id: candidate.observation_candidate_id,
    reference_fingerprint: candidate.observation_reference_fingerprint,
    status: candidate.observation_status,
    method: candidate.observation_method,
    seam_version: candidate.observation_seam_version,
    policy_version: candidate.observation_policy_version,
    observed_at: candidate.observation_observed_at,
    valid_until: candidate.observation_valid_until,
    reason_code: candidate.observation_reason_code,
    created_at: candidate.observation_created_at
  });
  for (const key of [
    "candidate_id", "candidate_organization_id", "candidate_state_value", "candidate_state_row_version",
    "candidate_state_reason_code", "candidate_state_observed_at", "candidate_state_updated_at",
    "candidate_state_superseded_by_candidate_id", "observation_id", "observation_organization_id",
    "observation_candidate_id", "observation_reference_fingerprint", "observation_status",
    "observation_method", "observation_seam_version", "observation_policy_version",
    "observation_observed_at", "observation_valid_until", "observation_reason_code", "observation_created_at"
  ]) delete candidate[key];
  return { candidate: candidateProjection(candidate), candidateState: state, providerReferenceObservation: observation };
}

function validRegisteredCandidateAsset(registered, organizationId, candidate) {
  const asset = registered?.asset;
  const version = registered?.asset_version;
  return Boolean(
    asset && version &&
    asset.organization_id === organizationId &&
    asset.kind === "appearance_candidate_image" &&
    asset.status === "active" &&
    version.organization_id === organizationId &&
    version.asset_id === asset.id &&
    version.status === "available" &&
    version.verified_content_type === candidate.media_type &&
    Number(version.verified_size) === Number(candidate.size) &&
    version.verified_checksum_sha256 === candidate.checksum_sha256
  );
}

export function createPostgresAppearanceFidelityRepository({ pool, ownsPool = false } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");

  return {
    async initialize() { await assertAppearanceFidelitySchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },

    async findByIdempotencyKey({ organizationId, actorMemberId, idempotencyKey }) {
      return requestProjection(one(await pool.query(
        `SELECT * FROM appearance_capture_requests
          WHERE organization_id=$1 AND requested_by_member_id=$2 AND idempotency_key=$3`,
        [organizationId, actorMemberId, idempotencyKey]
      )));
    },

    async findActiveCaptureRequest({ organizationId, upstreamFingerprint, activeStatuses }) {
      return requestProjection(one(await pool.query(
        `SELECT * FROM appearance_capture_requests
          WHERE organization_id=$1 AND upstream_fingerprint=$2 AND status=ANY($3::text[])
          ORDER BY created_at, id LIMIT 1`,
        [organizationId, upstreamFingerprint, activeStatusValues(activeStatuses)]
      )));
    },

    async createCaptureRequest(record) {
      return withTransaction(pool, async (client) => {
        const actorMemberId = record.requested_by_member_id;
        const existingReceipt = await readReceipt(client, {
          organizationId: record.organization_id,
          actorMemberId,
          operation: "create",
          idempotencyKey: record.idempotency_key,
          fingerprint: record.idempotency_payload
        });
        if (existingReceipt) {
          const existing = one(await client.query(requestSelect(record.organization_id, existingReceipt.request_id)));
          return { ...requestProjection(existing), replayed: true };
        }

        const existing = one(await client.query(
          `SELECT * FROM appearance_capture_requests
            WHERE organization_id=$1 AND requested_by_member_id=$2 AND idempotency_key=$3
            FOR UPDATE`,
          [record.organization_id, actorMemberId, record.idempotency_key]
        ));
        if (existing) {
          if (existing.idempotency_payload !== record.idempotency_payload) throw failure("IDEMPOTENCY_CONFLICT", "idempotency key payload changed");
          return { ...requestProjection(existing), replayed: true };
        }

        const id = randomUUID();
        let inserted;
        try {
          inserted = one(await client.query(
            `INSERT INTO appearance_capture_requests(
               id, organization_id, requested_by_member_id, idempotency_key, idempotency_payload,
               upstream_fingerprint, upstream_snapshot, workspace_revision, status, row_version,
               status_history, max_candidate_generations, product_id, product_revision_id,
               source_asset_version_id, source_asset_kind, source_asset_status, source_asset_version_status,
               source_asset_media_type, source_asset_size, source_asset_checksum_sha256,
               copy_version_id, copy_review_id, avatar_selection_id, avatar_asset_version_id,
               video_plan_version_id, plan_review_id, preflight_result_id, presentation_size_code,
               created_at, updated_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
             ) RETURNING *`,
            [
              id, record.organization_id, record.requested_by_member_id, record.idempotency_key, record.idempotency_payload,
              record.upstream_fingerprint, JSON.stringify(record.upstream_snapshot), record.workspace_revision, record.status, record.row_version,
              JSON.stringify(record.status_history), record.max_candidate_generations, record.product_id, record.product_revision_id,
              record.source_asset_version_id, record.source_asset_kind, record.source_asset_status, record.source_asset_version_status,
              record.source_asset_media_type, record.source_asset_size, record.source_asset_checksum_sha256,
              record.copy_version_id, record.copy_review_id, record.avatar_selection_id, record.avatar_asset_version_id,
              record.video_plan_version_id, record.plan_review_id, record.preflight_result_id, record.presentation_size_code,
              record.created_at, record.updated_at
            ]
          ));
        } catch (error) {
          if (error?.code === "23505" && error?.constraint === "appearance_capture_active_upstream_unique") {
            throw failure("APPEARANCE_CAPTURE_CONFLICT", "an active capture request already exists for the upstream binding");
          }
          throw error;
        }
        await client.query(
          `INSERT INTO appearance_capture_idempotency_receipts(
             organization_id, actor_member_id, operation, idempotency_key, payload_fingerprint, request_id, created_at
           ) VALUES ($1,$2,'create',$3,$4,$5,$6)`,
          [record.organization_id, actorMemberId, record.idempotency_key, record.idempotency_payload, id, record.created_at]
        );
        await appendCaptureEvent(client, {
          organizationId: record.organization_id,
          requestId: id,
          actorMemberId,
          eventType: "appearance.capture_requested",
          createdAt: record.created_at
        });
        return requestProjection(inserted);
      });
    },

    async getCaptureRequest({ organizationId, requestId }) {
      return requestProjection(one(await pool.query(requestSelect(organizationId, requestId))));
    },

    async listCaptureRequests({ organizationId, productId, status } = {}) {
      const conditions = [];
      const values = [];
      if (organizationId !== undefined) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
      if (productId !== undefined) { values.push(productId); conditions.push(`product_id=$${values.length}`); }
      if (status !== undefined) { values.push(status); conditions.push(`status=$${values.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return (await pool.query(`SELECT * FROM appearance_capture_requests ${where} ORDER BY created_at, id`, values)).rows.map(requestProjection);
    },

    async claimNextCapture({ systemActorId = null, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [CLAIM_LOCK_KEY]);
        if ((await client.query("SELECT 1 FROM appearance_capture_requests WHERE status='running' LIMIT 1")).rowCount) return null;
        const current = one(await client.query(
          `SELECT * FROM appearance_capture_requests
            WHERE status='queued'
            ORDER BY created_at, id
            LIMIT 1 FOR UPDATE SKIP LOCKED`
        ));
        if (!current) return null;
        const nextRevision = Number(current.row_version) + 1;
        const updated = one(await client.query(
          `UPDATE appearance_capture_requests
              SET status='running', row_version=$3, claimed_by_system_id=$4, updated_at=$5,
                  status_history=status_history || jsonb_build_array(jsonb_build_object(
                    'status','running','row_version',$3::integer,'at',$5::timestamptz
                  ))
            WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status='queued'
            RETURNING *`,
          [current.organization_id, current.id, nextRevision, systemActorId, now, current.row_version]
        ));
        if (!updated) return null;
        await appendCaptureEvent(client, {
          organizationId: current.organization_id,
          requestId: current.id,
          actorSystemId: systemActorId,
          eventType: "appearance.capture_claimed",
          createdAt: now
        });
        return requestProjection(updated);
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
      actorSystemId = null
    }) {
      return withTransaction(pool, async (client) => {
        const current = requestProjection(one(await client.query(requestSelect(organizationId, requestId, true))));
        if (!current) throw failure("APPEARANCE_CAPTURE_REQUEST_NOT_FOUND", "capture request is not available");
        if (current.row_version !== Number(expectedRevision) || current.status !== "running") {
          throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        }
        if (!candidate || candidate.organization_id !== organizationId || candidate.capture_request_id !== requestId || !candidate.id) {
          throw failure("APPEARANCE_CAPTURE_COMPLETION_FAILED", "candidate completion is invalid");
        }
        if (!candidateState || candidateState.organization_id !== organizationId || candidateState.candidate_id !== candidate.id || candidateState.state !== "available" || Number(candidateState.row_version) !== 1) {
          throw failure("APPEARANCE_CAPTURE_COMPLETION_FAILED", "candidate state completion is invalid");
        }
        if (!providerReferenceObservation || !providerReferenceObservation.id || providerReferenceObservation.organization_id !== organizationId || providerReferenceObservation.candidate_id !== candidate.id || providerReferenceObservation.status !== "available" || !providerReferenceObservation.reference_fingerprint || providerReferenceObservation.valid_until !== providerReferenceObservation.observed_at) {
          throw failure("APPEARANCE_CAPTURE_COMPLETION_FAILED", "provider observation completion is invalid");
        }
        if (typeof registerCandidateAsset !== "function") throw failure("APPEARANCE_CAPTURE_COMPLETION_FAILED", "candidate asset registration is required");

        const registered = await registerCandidateAsset(client);
        if (!validRegisteredCandidateAsset(registered, organizationId, candidate)) {
          throw failure("CANDIDATE_ASSET_REGISTER_INVALID", "candidate asset registration returned invalid metadata");
        }
        const completedCandidate = {
          ...candidate,
          candidate_asset_id: registered.asset.id,
          candidate_asset_version_id: registered.asset_version.id
        };
        await client.query(
          `INSERT INTO appearance_candidates(
             id, organization_id, capture_request_id, product_id, product_revision_id, source_asset_version_id,
             source_asset_media_type, source_asset_size, source_asset_checksum_sha256, copy_version_id, copy_review_id,
             avatar_selection_id, avatar_asset_version_id, video_plan_version_id, plan_review_id, preflight_result_id,
             presentation_size_code, candidate_asset_id, candidate_asset_version_id, media_type, size, checksum_sha256,
             provider, provider_reference_type, provider_reference, generation_context_version, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
          [
            completedCandidate.id, organizationId, requestId, completedCandidate.product_id, completedCandidate.product_revision_id,
            completedCandidate.source_asset_version_id, completedCandidate.source_asset_media_type, completedCandidate.source_asset_size,
            completedCandidate.source_asset_checksum_sha256, completedCandidate.copy_version_id, completedCandidate.copy_review_id,
            completedCandidate.avatar_selection_id, completedCandidate.avatar_asset_version_id, completedCandidate.video_plan_version_id,
            completedCandidate.plan_review_id, completedCandidate.preflight_result_id, completedCandidate.presentation_size_code,
            completedCandidate.candidate_asset_id, completedCandidate.candidate_asset_version_id, completedCandidate.media_type,
            completedCandidate.size, completedCandidate.checksum_sha256, completedCandidate.provider, completedCandidate.provider_reference_type,
            JSON.stringify(completedCandidate.provider_reference), completedCandidate.generation_context_version, completedCandidate.created_at
          ]
        );
        await client.query(
          `INSERT INTO appearance_candidate_states(
             candidate_id, organization_id, state, row_version, reason_code, observed_at, updated_at, superseded_by_candidate_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [candidateState.candidate_id, organizationId, candidateState.state, candidateState.row_version, candidateState.reason_code, candidateState.observed_at, candidateState.updated_at, candidateState.superseded_by_candidate_id]
        );
        await client.query(
          `INSERT INTO appearance_provider_reference_observations(
             id, organization_id, candidate_id, reference_fingerprint, status, method, seam_version, policy_version,
             observed_at, valid_until, reason_code, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            providerReferenceObservation.id, organizationId, providerReferenceObservation.candidate_id,
            providerReferenceObservation.reference_fingerprint, providerReferenceObservation.status,
            providerReferenceObservation.method, providerReferenceObservation.seam_version, providerReferenceObservation.policy_version,
            providerReferenceObservation.observed_at, providerReferenceObservation.valid_until, providerReferenceObservation.reason_code,
            providerReferenceObservation.created_at
          ]
        );
        const nextRevision = current.row_version + 1;
        const updated = requestProjection(one(await client.query(
          `UPDATE appearance_capture_requests
              SET status='succeeded', row_version=$3, appearance_candidate_id=$4, failure_code=NULL, updated_at=$5,
                  status_history=status_history || jsonb_build_array(jsonb_build_object(
                    'status','succeeded','row_version',$3::integer,'at',$5::timestamptz
                  ))
            WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status='running'
            RETURNING *`,
          [organizationId, requestId, nextRevision, completedCandidate.id, now, current.row_version]
        )));
        if (!updated) throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        await appendCaptureEvent(client, {
          organizationId,
          requestId,
          actorSystemId,
          eventType: "appearance.capture_succeeded",
          metadata: {
            candidate_id: completedCandidate.id,
            provider_reference_observation_id: providerReferenceObservation.id
          },
          createdAt: now
        });
        return {
          record: updated,
          candidate: candidateProjection(completedCandidate),
          candidateState: candidateStateProjection(candidateState),
          providerReferenceObservation: observationProjection(providerReferenceObservation)
        };
      });
    },

    async failCapture({ organizationId, requestId, expectedRevision, failureCode, now, actorSystemId = null }) {
      return withTransaction(pool, async (client) => {
        const current = requestProjection(one(await client.query(requestSelect(organizationId, requestId, true))));
        if (!current) throw failure("APPEARANCE_CAPTURE_REQUEST_NOT_FOUND", "capture request is not available");
        if (current.row_version !== Number(expectedRevision) || current.status !== "running") throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        const nextRevision = current.row_version + 1;
        const updated = requestProjection(one(await client.query(
          `UPDATE appearance_capture_requests
              SET status='failed', row_version=$3, appearance_candidate_id=NULL, failure_code=$4, updated_at=$5,
                  status_history=status_history || jsonb_build_array(jsonb_build_object(
                    'status','failed','row_version',$3::integer,'at',$5::timestamptz
                  ))
            WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status='running'
            RETURNING *`,
          [organizationId, requestId, nextRevision, failureCode, now, current.row_version]
        )));
        if (!updated) throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        await appendCaptureEvent(client, {
          organizationId,
          requestId,
          actorSystemId,
          eventType: "appearance.capture_failed",
          metadata: { failure_code: failureCode },
          createdAt: now
        });
        return updated;
      });
    },

    async getCandidate({ organizationId, candidateId }) {
      const row = one(await pool.query(
        `SELECT c.*,
                s.organization_id AS candidate_organization_id, s.state AS candidate_state_value,
                s.row_version AS candidate_state_row_version, s.reason_code AS candidate_state_reason_code,
                s.observed_at AS candidate_state_observed_at, s.updated_at AS candidate_state_updated_at,
                s.superseded_by_candidate_id AS candidate_state_superseded_by_candidate_id,
                o.id AS observation_id, o.organization_id AS observation_organization_id,
                o.candidate_id AS observation_candidate_id, o.reference_fingerprint AS observation_reference_fingerprint,
                o.status AS observation_status, o.method AS observation_method, o.seam_version AS observation_seam_version,
                o.policy_version AS observation_policy_version, o.observed_at AS observation_observed_at,
                o.valid_until AS observation_valid_until, o.reason_code AS observation_reason_code,
                o.created_at AS observation_created_at
           FROM appearance_candidates c
           JOIN appearance_candidate_states s ON s.candidate_id=c.id AND s.organization_id=c.organization_id
           JOIN LATERAL (
             SELECT * FROM appearance_provider_reference_observations
              WHERE organization_id=c.organization_id AND candidate_id=c.id
              ORDER BY created_at DESC, id DESC LIMIT 1
           ) o ON true
          WHERE c.organization_id=$1 AND c.id=$2`,
        [organizationId, candidateId]
      ));
      return candidateBundle(row);
    },

    async listCandidates({ organizationId, productId, state } = {}) {
      const conditions = [];
      const values = [];
      if (organizationId !== undefined) { values.push(organizationId); conditions.push(`c.organization_id=$${values.length}`); }
      if (productId !== undefined) { values.push(productId); conditions.push(`c.product_id=$${values.length}`); }
      if (state !== undefined) { values.push(state); conditions.push(`s.state=$${values.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return (await pool.query(
        `SELECT c.* FROM appearance_candidates c JOIN appearance_candidate_states s ON s.candidate_id=c.id AND s.organization_id=c.organization_id ${where} ORDER BY c.created_at, c.id`,
        values
      )).rows.map(candidateProjection);
    },

    async listProviderReferenceObservations({ organizationId, candidateId } = {}) {
      const conditions = [];
      const values = [];
      if (organizationId !== undefined) { values.push(organizationId); conditions.push(`organization_id=$${values.length}`); }
      if (candidateId !== undefined) { values.push(candidateId); conditions.push(`candidate_id=$${values.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return (await pool.query(`SELECT * FROM appearance_provider_reference_observations ${where} ORDER BY created_at, id`, values)).rows.map(observationProjection);
    },

    async listEvents(organizationId) {
      const result = organizationId === undefined
        ? await pool.query("SELECT * FROM appearance_capture_events ORDER BY created_at, id")
        : await pool.query("SELECT * FROM appearance_capture_events WHERE organization_id=$1 ORDER BY created_at, id", [organizationId]);
      return result.rows.map(eventProjection);
    },

    async listAuditEvents(organizationId) {
      const result = organizationId === undefined
        ? await pool.query("SELECT * FROM appearance_capture_audit_events ORDER BY created_at, id")
        : await pool.query("SELECT * FROM appearance_capture_audit_events WHERE organization_id=$1 ORDER BY created_at, id", [organizationId]);
      return result.rows.map(eventProjection);
    },

    async transitionCaptureRequest({
      operation,
      organizationId,
      requestId,
      expectedRevision,
      idempotencyKey,
      fingerprint,
      maxCandidateGenerations,
      fromStatuses,
      status,
      patch = {},
      actorMemberId = null
    }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`appearance-command:${organizationId}:${operation}:${idempotencyKey}`]);
        const actor = actorMemberId || (await client.query(requestSelect(organizationId, requestId))).rows[0]?.requested_by_member_id || null;
        const replay = await readReceipt(client, {
          organizationId,
          actorMemberId: actor,
          operation,
          idempotencyKey,
          fingerprint
        });
        if (replay) {
          return { record: requestProjection(one(await client.query(requestSelect(organizationId, replay.request_id)))), replayed: true };
        }
        if (operation === "authorize" && Number(maxCandidateGenerations) !== 1) throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture authorization permits exactly one candidate generation");
        const current = requestProjection(one(await client.query(requestSelect(organizationId, requestId, true))));
        if (!current) throw failure("APPEARANCE_CAPTURE_REQUEST_NOT_FOUND", "capture request is not available");
        if (current.row_version !== Number(expectedRevision) || !fromStatuses.includes(current.status)) throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        const at = patch.updated_at || current.updated_at;
        const nextRevision = current.row_version + 1;
        const nextAuthorizedBy = operation === "authorize" ? patch.authorized_by_member_id : current.authorized_by_member_id;
        const nextAuthorizedAt = operation === "authorize" ? patch.authorized_at : current.authorized_at;
        const updated = requestProjection(one(await client.query(
          `UPDATE appearance_capture_requests
              SET status=$3, row_version=$4, authorized_by_member_id=$5, authorized_at=$6, updated_at=$7,
                  status_history=status_history || jsonb_build_array(jsonb_build_object(
                    'status',$3::text,'row_version',$4::integer,'at',$7::timestamptz
                  ))
            WHERE organization_id=$1 AND id=$2 AND row_version=$8
            RETURNING *`,
          [organizationId, requestId, status, nextRevision, nextAuthorizedBy, nextAuthorizedAt, at, current.row_version]
        )));
        if (!updated) throw failure("APPEARANCE_CAPTURE_CONFLICT", "capture request revision or state changed");
        await client.query(
          `INSERT INTO appearance_capture_idempotency_receipts(
             organization_id, actor_member_id, operation, idempotency_key, payload_fingerprint, request_id, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [organizationId, actor, operation, idempotencyKey, fingerprint, requestId, at]
        );
        await appendCaptureEvent(client, {
          organizationId,
          requestId,
          actorMemberId: actor,
          eventType: operation === "authorize" ? "appearance.capture_authorized" : "appearance.capture_cancelled",
          createdAt: at
        });
        return { record: updated, replayed: false };
      });
    }
  };
}
