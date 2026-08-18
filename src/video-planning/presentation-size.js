const clean = (value) => typeof value === "string" ? value.trim() : "";

export const PRESENTATION_SIZE_CODES = Object.freeze([
  "smart_fit", "extra_large", "large", "medium", "small", "extra_small"
]);

export const PRESENTATION_SIZE_OPTIONS = Object.freeze([
  { code: "smart_fit", label: "智能适配" },
  { code: "extra_large", label: "超大" },
  { code: "large", label: "大" },
  { code: "medium", label: "中" },
  { code: "small", label: "小" },
  { code: "extra_small", label: "超小" }
]);

export const DEFAULT_PRESENTATION_SIZE_CODE = "smart_fit";

const supportedCodes = new Set(PRESENTATION_SIZE_CODES);
const failure = (code) => Object.assign(new Error(code), { code });

export function normalizePresentationSizeCode(value, { defaultCode = DEFAULT_PRESENTATION_SIZE_CODE } = {}) {
  const candidate = clean(value) || defaultCode;
  if (!supportedCodes.has(candidate)) throw failure("VIDEO_PLAN_PRESENTATION_SIZE_UNSUPPORTED");
  return candidate;
}

export function requirePresentationSizeCode(value) {
  if (!clean(value)) throw failure("VIDEO_PLAN_PRESENTATION_SIZE_REQUIRED");
  return normalizePresentationSizeCode(value, { defaultCode: null });
}
