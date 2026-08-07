const DEFAULT_PROFILE_VERSION = "commerce-cn-v1";
const DEFAULT_RULE_VERSION = "rules-2026-08";

function required(value, fallback, name) {
  const resolved = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!resolved) throw new TypeError(`${name} is required`);
  return resolved;
}

export function createStaticQualityProfileResolver({ profileVersion, ruleVersion } = {}) {
  const policy = {
    profileVersion: required(profileVersion, DEFAULT_PROFILE_VERSION, "profileVersion"),
    ruleVersion: required(ruleVersion, DEFAULT_RULE_VERSION, "ruleVersion")
  };
  return { kind: "static_server_policy", async resolve() { return { ...policy }; } };
}

export const defaultQualityProfilePolicy = Object.freeze({
  profileVersion: DEFAULT_PROFILE_VERSION,
  ruleVersion: DEFAULT_RULE_VERSION
});
