const SEMANTIC_RULE_SOURCE = "llm_semantic_qc";
const SAFE_SEVERITIES = new Set(["low", "medium", "high"]);
const STABLE_SEMANTIC_ERRORS = new Set([
  "QUALITY_EVALUATOR_TEMPORARY_FAILURE",
  "QUALITY_EVALUATION_INVALID"
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function selectedSeverity(value) {
  const normalized = cleanText(value)?.toLowerCase();
  return SAFE_SEVERITIES.has(normalized) ? normalized : "medium";
}

function safeEvidenceReference(body, matchedText, semanticIndex) {
  const offset = typeof body === "string" ? body.indexOf(matchedText) : -1;
  return offset >= 0 ? `copy:text:${offset}` : `semantic:${semanticIndex}`;
}

function remapSemanticFinding(finding, body, semanticIndex) {
  const matchedText = cleanText(finding?.matched_text) || cleanText(finding?.matched_excerpt) || "semantic review";
  const claimSummary = cleanText(finding?.claim_summary) || cleanText(finding?.title) || "Semantic review";
  const dimension = cleanText(finding?.dimension);
  const message = cleanText(finding?.reason) || cleanText(finding?.message) || "语义质检需要人工复核";
  const suggestion = cleanText(finding?.remediation) || cleanText(finding?.suggestion) || "请人工复核并按需修改文案";
  return {
    code: `SEMANTIC_REVIEW_${semanticIndex}`,
    kind: "review",
    severity: selectedSeverity(finding?.severity_suggestion || finding?.severity),
    title: dimension ? `${dimension}: ${claimSummary}` : claimSummary,
    matched_text: matchedText,
    message,
    evidence_reference: safeEvidenceReference(body, matchedText, semanticIndex),
    rule_source: SEMANTIC_RULE_SOURCE,
    suggestion
  };
}

function stableDeterministicError(error) {
  return failure(error?.code === "QUALITY_EVALUATION_INVALID" ? error.code : "QUALITY_EVALUATION_INVALID");
}

function stableSemanticError(error) {
  return failure(STABLE_SEMANTIC_ERRORS.has(error?.code)
    ? error.code
    : "QUALITY_EVALUATOR_TEMPORARY_FAILURE");
}

export function createHybridQualityEvaluator({ deterministicEvaluator, semanticEvaluator } = {}) {
  if (!deterministicEvaluator || typeof deterministicEvaluator.evaluate !== "function" ||
    !semanticEvaluator || typeof semanticEvaluator.evaluate !== "function") {
    throw new TypeError("deterministicEvaluator and semanticEvaluator are required");
  }

  return {
    kind: "hybrid_quality_qc",
    async evaluate(input = {}) {
      let deterministicResult;
      try {
        deterministicResult = await deterministicEvaluator.evaluate(input);
      } catch (error) {
        throw stableDeterministicError(error);
      }
      if (deterministicResult?.checks_complete !== true || !Array.isArray(deterministicResult.findings)) {
        throw failure("QUALITY_EVALUATION_INVALID");
      }

      let semanticResult;
      try {
        semanticResult = await semanticEvaluator.evaluate(input);
      } catch (error) {
        throw stableSemanticError(error);
      }
      if (semanticResult?.checks_complete !== true || !Array.isArray(semanticResult.findings)) {
        throw failure("QUALITY_EVALUATION_INVALID");
      }

      const body = cleanText(input?.copyVersion?.body) || "";
      const semanticFindings = semanticResult.findings.map((finding, index) =>
        remapSemanticFinding(finding, body, index + 1));
      return {
        checks_complete: true,
        findings: [...deterministicResult.findings, ...semanticFindings]
      };
    }
  };
}
