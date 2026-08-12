const DEFAULT_EXPRESSION_STYLE = "自然口语化种草";
const DEFAULT_ENDING_STYLE = "自然收尾";
const CONTENT_BRIEF_FIELDS = [
  "expression_style",
  "selling_angle",
  "expected_length",
  "ending_style",
  "additional_requirements"
];
const MODEL_FINDING_STRING_FIELDS = [
  "dimension",
  "finding_type",
  "severity_suggestion",
  "matched_excerpt",
  "claim_summary",
  "reason",
  "confidence",
  "remediation"
];
const SEMANTIC_RULE_SOURCE = "llm_semantic_qc";
const SAFE_SEVERITIES = new Set(["low", "medium", "high"]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireObject(value, code = "QUALITY_EVALUATION_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure(code);
  return value;
}

function requiredText(value) {
  const normalized = cleanText(value);
  if (!normalized) throw failure("QUALITY_EVALUATION_INVALID");
  return normalized;
}

function optionalText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw failure("QUALITY_EVALUATION_INVALID");
  return cleanText(value);
}

function normalizeIdentifier(value) {
  if (value === undefined || value === null) return null;
  return requiredText(value);
}

function normalizeContentBrief(value) {
  const brief = value === undefined || value === null ? {} : requireObject(value);
  const normalized = {
    expression_style: optionalText(brief.expression_style) || DEFAULT_EXPRESSION_STYLE,
    ending_style: optionalText(brief.ending_style) || DEFAULT_ENDING_STYLE
  };

  for (const field of CONTENT_BRIEF_FIELDS) {
    if (field === "expression_style" || field === "ending_style") continue;
    const candidate = optionalText(brief[field]);
    if (candidate) normalized[field] = candidate;
  }
  return normalized;
}

function projectInput({ copyVersion, productRevision, profileVersion, ruleVersion } = {}) {
  const copy = requireObject(copyVersion);
  const revision = requireObject(productRevision);
  const body = requiredText(copy.body);
  const productName = requiredText(revision.product_name);
  if (!Array.isArray(revision.selling_points)) throw failure("QUALITY_EVALUATION_INVALID");

  const confirmedSellingPoints = revision.selling_points
    .filter((point) => point && typeof point === "object" && !Array.isArray(point) && point.confirmed === true)
    .map((point) => optionalText(point.text))
    .filter(Boolean);
  if (confirmedSellingPoints.length === 0) throw failure("QUALITY_EVALUATION_INVALID");

  const productFacts = {
    product_name: productName,
    confirmed_selling_points: confirmedSellingPoints
  };
  const productDescription = optionalText(revision.product_description);
  const primaryCategory = optionalText(revision.primary_category);
  if (productDescription) productFacts.product_description = productDescription;
  if (primaryCategory) productFacts.primary_category = primaryCategory;

  const projected = {
    copy: { body },
    product_facts: productFacts,
    content_brief: normalizeContentBrief(revision.content_brief)
  };
  const normalizedProfileVersion = normalizeIdentifier(profileVersion);
  const normalizedRuleVersion = normalizeIdentifier(ruleVersion);
  if (normalizedProfileVersion) projected.profile_version = normalizedProfileVersion;
  if (normalizedRuleVersion) projected.rule_version = normalizedRuleVersion;
  return projected;
}

const SYSTEM_PROMPT = `You are a constrained semantic copy quality reviewer. Use only the supplied copy, confirmed product facts, normalized content brief, and quality profile identifiers. Do not invent facts, treat model output as approval, or return reasoning_content. Return only one valid JSON object in this exact shape: {"findings":[{"dimension":"string","finding_type":"string","severity_suggestion":"low|medium|high|critical","matched_excerpt":"string","claim_summary":"string","evidence_refs":["string"],"reason":"string","confidence":"string","remediation":"string"}]}. An empty findings array is valid. Keep reasons concise and auditable.`;

function requestFor(projected) {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(projected) }
    ]
  };
}

function structuralFailure() {
  return failure("QUALITY_EVALUATION_OUTPUT_INVALID");
}

function parseModelOutput(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw structuralFailure();

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw structuralFailure();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.findings)) {
    throw structuralFailure();
  }

  return parsed.findings.map((finding) => {
    requireObject(finding, "QUALITY_EVALUATION_OUTPUT_INVALID");
    const normalized = {};
    for (const field of MODEL_FINDING_STRING_FIELDS) normalized[field] = requiredModelText(finding[field]);
    if (!Array.isArray(finding.evidence_refs) ||
      finding.evidence_refs.some((reference) => typeof reference !== "string")) {
      throw structuralFailure();
    }
    normalized.evidence_refs = finding.evidence_refs.map((reference) => reference.trim());
    return normalized;
  });
}

function requiredModelText(value) {
  const normalized = cleanText(value);
  if (!normalized) throw structuralFailure();
  return normalized;
}

function selectedSeverity(suggestion) {
  const normalized = suggestion.toLowerCase();
  return SAFE_SEVERITIES.has(normalized) ? normalized : "medium";
}

function safeEvidenceReference(body, matchedExcerpt, semanticIndex) {
  const offset = body.indexOf(matchedExcerpt);
  return offset >= 0 ? `copy:text:${offset}` : `semantic:${semanticIndex}`;
}

function toPublicFinding(finding, body, semanticIndex) {
  return {
    code: `SEMANTIC_REVIEW_${semanticIndex}`,
    kind: "review",
    severity: selectedSeverity(finding.severity_suggestion),
    title: `${finding.dimension}: ${finding.claim_summary}`,
    matched_text: finding.matched_excerpt,
    message: finding.reason,
    evidence_reference: safeEvidenceReference(body, finding.matched_excerpt, semanticIndex),
    rule_source: SEMANTIC_RULE_SOURCE,
    suggestion: finding.remediation
  };
}

export function createDeepSeekQualityEvaluator({ client } = {}) {
  if (!client || typeof client.complete !== "function") throw new TypeError("client.complete is required");

  return {
    kind: "deepseek_semantic_qc",
    async evaluate(input = {}) {
      const projected = projectInput(input);
      const request = requestFor(projected);
      const body = projected.copy.body;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await client.complete(request);
        } catch {
          throw failure("QUALITY_EVALUATOR_TEMPORARY_FAILURE");
        }

        try {
          const modelFindings = parseModelOutput(response);
          return {
            checks_complete: true,
            findings: modelFindings.map((finding, index) => toPublicFinding(finding, body, index + 1))
          };
        } catch (error) {
          if (error?.code !== "QUALITY_EVALUATION_OUTPUT_INVALID" || attempt === 1) {
            throw failure("QUALITY_EVALUATION_INVALID");
          }
        }
      }

      throw failure("QUALITY_EVALUATION_INVALID");
    }
  };
}
