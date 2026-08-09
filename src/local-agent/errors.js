export const EXIT_CODES = Object.freeze({
  success: 0,
  failed: 1,
  requiresAction: 2
});

export const LOCAL_AGENT_REPORT_CODES = Object.freeze([
  "AVATAR_MAPPING_REQUIRED",
  "PACKAGE_ITEM_COUNT_UNSUPPORTED",
  "LOCAL_EXECUTION_FAILED"
]);

export class LocalAgentError extends Error {
  constructor(code, { outcome = "failed", details = null } = {}) {
    super(code);
    this.name = "LocalAgentError";
    this.code = code;
    this.outcome = outcome;
    this.details = details;
  }
}

export function localAgentError(code, options = {}) {
  return new LocalAgentError(code, options);
}

export function isRequiresActionError(error) {
  return error?.outcome === "requires_action" || [
    "AVATAR_MAPPING_REQUIRED",
    "PACKAGE_ITEM_COUNT_UNSUPPORTED"
  ].includes(error?.code);
}
