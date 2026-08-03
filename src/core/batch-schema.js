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

// Step-wise migration chain. Every step declares an explicit fromVersion →
// toVersion, and each step's target version is HARD-CODED in the step itself:
// the v0 → v1 step writes schemaVersion 1 forever, regardless of any future
// CURRENT_BATCH_SCHEMA_VERSION change (later versions ADD steps; they never
// rewrite the meaning of historical ones). Steps are pure: they do not mutate
// their input and never return the input object. The chain is private to this
// module — the only production entry point is migrateBatchDocument, and no
// caller (including BatchStore) can inject or mutate migrations.
const MIGRATION_STEPS = new Map([
  [0, {
    fromVersion: 0,
    toVersion: 1,
    migrate(document) {
      // v0 → v1 adds exactly one field and nothing else: no business
      // defaults, no cleanup, no timestamp changes.
      return { ...document, schemaVersion: 1 };
    }
  }]
]);

/**
 * Pure migration runner over a READ-ONLY step chain.
 *
 * Internal entry point: production code must use migrateBatchDocument (which
 * binds the private chain); tests exercise the runner invariants through this
 * function with synthetic read-only steps. BatchStore callers can never
 * inject migrations.
 *
 * Fail-closed invariants — violations throw BATCH_SCHEMA_MIGRATION_INVALID
 * (redacted: code/batchId/detectedVersion/currentVersion only):
 * - for each version N from fromVersion to toVersion, a step must exist with
 *   step.fromVersion === N and step.toVersion === N + 1 (no missing steps,
 *   no version skipping);
 * - step.migrate must return a plain object, distinct from its input, whose
 *   schemaVersion equals step.toVersion;
 * - after the loop, the result's schemaVersion must equal toVersion.
 *
 * @param {object} document - Deep copy owned by the caller (not mutated).
 * @param {Map<number, {fromVersion, toVersion, migrate}>} steps - Read-only.
 * @param {{ batchId?: string, fromVersion: number, toVersion: number }} context
 * @returns {object} The migrated document at `toVersion`.
 */
export function applyMigrationChain(document, steps, { batchId, fromVersion, toVersion }) {
  const invalid = (detectedVersion, message) =>
    batchSchemaError("BATCH_SCHEMA_MIGRATION_INVALID", { batchId, detectedVersion, message });
  let version = fromVersion;
  let current = document;
  while (version < toVersion) {
    const step = steps instanceof Map ? steps.get(version) : steps[version];
    if (!step || step.fromVersion !== version || step.toVersion !== version + 1 || typeof step.migrate !== "function") {
      throw invalid(version, `No valid migration step from batch schema version ${version} to ${version + 1}`);
    }
    const input = current;
    const result = step.migrate(input);
    if (result === input) {
      throw invalid(version, `Migration step from batch schema version ${version} must not return its input object`);
    }
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw invalid(version, `Migration step from batch schema version ${version} must return a plain object`);
    }
    if (result.schemaVersion !== step.toVersion) {
      throw invalid(version, `Migration step from batch schema version ${version} produced the wrong schema version`);
    }
    current = result;
    version = step.toVersion;
  }
  if (current.schemaVersion !== toVersion) {
    throw invalid(version, "Migration chain did not reach the target batch schema version");
  }
  return current;
}

/**
 * Detect the schema version of a parsed batch document and migrate it to the
 * current version.
 *
 * Contract:
 * - Pure: performs no file I/O and never mutates the input object.
 * - Idempotent: a current-version document is returned unchanged
 *   (migrated=false) and is never rewritten by callers that honor the flag.
 * - Step-wise: versions are migrated one step at a time through
 *   applyMigrationChain; missing or skipping steps fail closed, never blindly
 *   overwritten with the current version.
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
  const migrated = applyMigrationChain(structuredClone(batch), MIGRATION_STEPS, {
    batchId,
    fromVersion,
    toVersion: CURRENT_BATCH_SCHEMA_VERSION
  });
  return { batch: migrated, migrated: true, fromVersion, toVersion: CURRENT_BATCH_SCHEMA_VERSION };
}
