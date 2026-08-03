// Batch schema versioning and migration for batch.json documents.
//
// Pure module: no file I/O, no mutation of its input, safe to re-run. The
// storage layer (batch-store.js) persists migration results atomically.
// There is exactly one set of version detection and migration semantics.

export const CURRENT_BATCH_SCHEMA_VERSION = 1;

// Legacy documents (written before versioning existed) have NO schemaVersion
// field at all; internally they are treated as version 0. An EXPLICIT
// schemaVersion: 0 is invalid input, not a legacy marker — only a completely
// missing field (undefined) means legacy v0.
const LEGACY_VERSION = 0;

/**
 * Build a stable, redacted batch-schema error. Carries machine-readable
 * context (code, batchId when known, detectedVersion, currentVersion) and
 * never batch content, local absolute paths, uploads, scripts, remote
 * evidence, or credentials.
 *
 * @param {string} code - BATCH_SCHEMA_INVALID | BATCH_SCHEMA_UNSUPPORTED |
 *   BATCH_SCHEMA_MUTATION_NOT_ALLOWED
 */
export function batchSchemaError(code, { batchId, detectedVersion, message }) {
  const error = new Error(message);
  error.code = code;
  if (batchId !== undefined) error.batchId = batchId;
  error.detectedVersion = detectedVersion;
  error.currentVersion = CURRENT_BATCH_SCHEMA_VERSION;
  return error;
}

/**
 * Describe a detected schemaVersion value for error context without leaking
 * content: numbers are safe to echo verbatim; anything else is reduced to its
 * type name ("null", "array", "string", ...).
 */
export function describeDetectedVersion(value) {
  if (typeof value === "number") return value;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function detectVersion(batch, batchId) {
  if (batch === null || typeof batch !== "object" || Array.isArray(batch)) {
    throw batchSchemaError("BATCH_SCHEMA_INVALID", {
      batchId,
      detectedVersion: batch === null ? "null" : Array.isArray(batch) ? "array" : typeof batch,
      message: "Batch document must be a JSON object"
    });
  }
  const value = batch.schemaVersion;
  // Completely missing field → internal legacy v0.
  if (value === undefined) return LEGACY_VERSION;
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value === CURRENT_BATCH_SCHEMA_VERSION) return value;
    if (value > CURRENT_BATCH_SCHEMA_VERSION) {
      // Future versions are never silently downgraded or overwritten.
      throw batchSchemaError("BATCH_SCHEMA_UNSUPPORTED", {
        batchId,
        detectedVersion: value,
        message: `Batch schema version ${value} is newer than supported version ${CURRENT_BATCH_SCHEMA_VERSION}`
      });
    }
  }
  // Explicit 0, negatives, floats, strings ("1"), booleans, objects, arrays,
  // and null are all invalid — only the exact integer 1 is accepted.
  throw batchSchemaError("BATCH_SCHEMA_INVALID", {
    batchId,
    detectedVersion: describeDetectedVersion(value),
    message: `Batch schemaVersion must be exactly ${CURRENT_BATCH_SCHEMA_VERSION}`
  });
}

// Step-wise migrations: each step receives a document AT version N and returns
// the document at version N+1. The v0 → v1 step adds exactly one field —
// schemaVersion — and changes nothing else: no business defaults, no cleanup,
// no timestamp changes, unknown historical fields are preserved untouched.
const MIGRATION_STEPS = {
  [LEGACY_VERSION]: (document) => {
    document.schemaVersion = CURRENT_BATCH_SCHEMA_VERSION;
    return document;
  }
};

/**
 * Detect the schema version of a parsed batch document and migrate it to the
 * current version.
 *
 * Contract:
 * - Pure: performs no file I/O and never mutates the input object.
 * - Idempotent: a current-version document is returned unchanged
 *   (migrated=false) and is never rewritten by callers that honor the flag.
 * - Step-wise: versions are migrated one step at a time; a version with no
 *   migration path is rejected, never blindly overwritten with the current
 *   version.
 * - Fail-closed: invalid or future versions throw instead of degrading.
 *
 * @param {object} batch - Parsed batch.json document.
 * @param {{ batchId?: string }} [context] - Storage-layer context for errors.
 * @returns {{ batch: object, migrated: boolean, fromVersion: number, toVersion: number }}
 *   When migrated=false, `batch` is the input object itself; when
 *   migrated=true, `batch` is a deep copy of the input plus the migrations.
 */
export function migrateBatchDocument(batch, { batchId } = {}) {
  const fromVersion = detectVersion(batch, batchId);
  if (fromVersion === CURRENT_BATCH_SCHEMA_VERSION) {
    return { batch, migrated: false, fromVersion, toVersion: CURRENT_BATCH_SCHEMA_VERSION };
  }
  let document = structuredClone(batch);
  let version = fromVersion;
  while (version < CURRENT_BATCH_SCHEMA_VERSION) {
    const step = MIGRATION_STEPS[version];
    if (typeof step !== "function") {
      throw batchSchemaError("BATCH_SCHEMA_UNSUPPORTED", {
        batchId,
        detectedVersion: version,
        message: `No migration path from batch schema version ${version}`
      });
    }
    document = step(document);
    version += 1;
  }
  return { batch: document, migrated: true, fromVersion, toVersion: CURRENT_BATCH_SCHEMA_VERSION };
}
