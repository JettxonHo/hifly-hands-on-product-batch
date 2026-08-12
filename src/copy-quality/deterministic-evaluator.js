const NUMERIC_CLAIM_PATTERN = /\d+(?:\.\d+)?\s*(?:%|％|万|亿|元|块|毫升|ml|升|l|克|kg|g|千克|斤|厘米|cm|毫米|mm|米|m|件|个|只|次|天|小时|分钟|片|颗|层|档|w)?/giu;
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

export const DEFAULT_PLATFORM_HARD_RULES = Object.freeze([]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeReferencePart(value, fallback) {
  const normalized = text(value).replace(/[^A-Za-z0-9_.:-]/g, "_");
  return normalized || fallback;
}

function normalizedMatchText(value) {
  return text(value).replace(/\s+/g, "");
}

function numericClaimKey(value) {
  const normalized = text(value).replace(/\s+/g, "").replace(/％/g, "%").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(.*)$/u);
  if (!match) return null;
  return `${match[1].replace(/^0+(?=\d)/, "")}${match[2]}`;
}

function numericClaims(value) {
  const source = text(value);
  return [...source.matchAll(NUMERIC_CLAIM_PATTERN)].map((match) => ({
    text: match[0].trim(),
    key: numericClaimKey(match[0]),
    index: match.index
  })).filter((claim) => claim.text && claim.key !== null);
}

function confirmedFacts(productRevision) {
  return (Array.isArray(productRevision?.selling_points) ? productRevision.selling_points : [])
    .map((point, index) => ({
      id: safeReferencePart(point?.id, String(index + 1)),
      text: text(point?.text),
      confirmed: point?.confirmed === true
    }))
    .filter((point) => point.confirmed && point.text);
}

function authoritativeFactTexts(productRevision, facts) {
  return [
    text(productRevision?.product_name),
    text(productRevision?.product_description || productRevision?.description),
    ...facts.map((fact) => fact.text)
  ].filter(Boolean);
}

function numericFinding(claim) {
  return {
    code: "FACT_NUMERIC_UNSUPPORTED",
    kind: "fact_gate",
    severity: "high",
    title: "数字事实缺少已确认依据",
    matched_text: claim.text,
    message: "文案中的数字表达未在已确认商品事实中找到直接依据",
    evidence_reference: "product_revision:confirmed_selling_points",
    rule_source: "confirmed_product_facts",
    suggestion: "删除该数字表达，或先补充并确认对应商品事实"
  };
}

function oppositeClaim(fact) {
  const normalized = normalizedMatchText(fact);
  if (normalized.startsWith("不含")) {
    const subject = normalized.slice("不含".length).trim();
    if (subject.length >= 1 && subject.length <= 40) return `含${subject}`;
  }
  if (normalized.startsWith("含")) {
    const subject = normalized.slice("含".length).trim();
    if (subject.length >= 1 && subject.length <= 40) return `不含${subject}`;
  }
  return null;
}

function findDirectClaim(body, claim) {
  const source = normalizedMatchText(body);
  const normalizedClaim = normalizedMatchText(claim);
  let searchIndex = 0;
  while (searchIndex <= source.length - normalizedClaim.length) {
    const index = source.indexOf(normalizedClaim, searchIndex);
    if (index < 0) return null;
    if (!(normalizedClaim.startsWith("含") && source[index - 1] === "不")) {
      return { text: normalizedClaim, index };
    }
    searchIndex = index + 1;
  }
  return null;
}

function contradictionFinding(fact, opposingClaim) {
  return {
    code: "FACT_CONTRADICTION",
    kind: "fact_gate",
    severity: "critical",
    title: "文案与已确认事实直接矛盾",
    matched_text: opposingClaim,
    message: "文案直接表达了与已确认商品事实相反的内容",
    evidence_reference: `product_revision:selling_point:${fact.id}`,
    rule_source: "confirmed_product_facts",
    suggestion: "删除矛盾表达，或返回商品事实重新核对"
  };
}

function normalizeRule(rule, index) {
  const source = typeof rule === "string" ? { pattern: rule } : rule;
  const pattern = source?.pattern ?? source?.match ?? source?.text;
  if (!(typeof pattern === "string" || pattern instanceof RegExp) ||
    (typeof pattern === "string" && !pattern.trim())) {
    throw failure("QUALITY_PLATFORM_RULES_INVALID");
  }
  const code = safeReferencePart(source.code || source.id, `PLATFORM_RULE_${index + 1}`).toUpperCase();
  const severity = SEVERITIES.has(source.severity) ? source.severity : "critical";
  return {
    code,
    pattern,
    title: text(source.title) || "平台规则命中",
    message: text(source.message) || "文案命中了配置的平台强制规则",
    suggestion: text(source.suggestion) || "删除或修改命中的表达",
    severity
  };
}

function findRuleMatch(body, pattern) {
  if (typeof pattern === "string") {
    const index = body.indexOf(pattern);
    return index < 0 ? null : { text: pattern, index };
  }
  const flags = pattern.flags.replace(/[gy]/g, "");
  const match = new RegExp(pattern.source, flags).exec(body);
  return match ? { text: match[0], index: match.index } : null;
}

function platformFinding(rule, match) {
  return {
    code: rule.code,
    kind: "hard_block",
    severity: rule.severity,
    title: rule.title,
    matched_text: match.text,
    message: rule.message,
    evidence_reference: `platform:${rule.code}`,
    rule_source: "platform_policy",
    suggestion: rule.suggestion
  };
}

function addFinding(findings, seenFindings, finding, occurrenceIndex) {
  const key = `${finding.code}\u0000${finding.matched_text}\u0000${occurrenceIndex}`;
  if (seenFindings.has(key)) return;
  seenFindings.add(key);
  findings.push(finding);
}

export function createDeterministicQualityEvaluator({ platformHardRules = DEFAULT_PLATFORM_HARD_RULES } = {}) {
  if (!Array.isArray(platformHardRules)) throw failure("QUALITY_PLATFORM_RULES_INVALID");
  const rules = platformHardRules.map(normalizeRule);

  return {
    kind: "deterministic_server_rules",
    async evaluate({ copyVersion, productRevision } = {}) {
      const body = text(copyVersion?.body);
      if (!body || !copyVersion || typeof copyVersion !== "object" || Array.isArray(copyVersion) ||
        !productRevision || typeof productRevision !== "object" || Array.isArray(productRevision)) {
        throw failure("QUALITY_EVALUATION_INVALID");
      }
      const facts = confirmedFacts(productRevision);
      if (facts.length === 0) throw failure("QUALITY_EVALUATION_INVALID");
      const factNumbers = authoritativeFactTexts(productRevision, facts)
        .flatMap((fact) => numericClaims(fact).map((claim) => claim.key));
      const findings = [];
      const seenFindings = new Set();

      for (const claim of numericClaims(body)) {
        if (!factNumbers.includes(claim.key)) {
          addFinding(findings, seenFindings, numericFinding(claim), claim.index);
        }
      }
      for (const fact of facts) {
        const opposingClaim = oppositeClaim(fact.text);
        const match = opposingClaim && findDirectClaim(body, opposingClaim);
        if (match) {
          addFinding(findings, seenFindings, contradictionFinding(fact, opposingClaim), match.index);
        }
      }
      for (const rule of rules) {
        const match = findRuleMatch(body, rule.pattern);
        if (match) addFinding(findings, seenFindings, platformFinding(rule, match), match.index);
      }

      return { checks_complete: true, findings };
    }
  };
}
