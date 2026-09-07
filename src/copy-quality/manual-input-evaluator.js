import { createDeterministicQualityEvaluator } from "./deterministic-evaluator.js";

export const MANUAL_INPUT_QUALITY_POLICY = "manual_input_local_rules";

const text = (value) => typeof value === "string" ? value.trim() : "";

function semanticReviewFinding(body) {
  const matchedText = [...body].slice(0, 80).join("");
  return {
    code: "MANUAL_SEMANTIC_REVIEW_REQUIRED",
    kind: "review",
    severity: "medium",
    title: "语义宣称需负责人复核",
    matched_text: matchedText,
    message: "本地规则未判断文案中的语义宣称，请由负责人复核文案是否有事实依据。",
    evidence_reference: "copy:text:0",
    rule_source: MANUAL_INPUT_QUALITY_POLICY,
    suggestion: "请根据已确认商品事实核对整段文案；完成复核后可附理由接受或修改。"
  };
}

export function createManualInputQualityEvaluator({ deterministicEvaluator = createDeterministicQualityEvaluator() } = {}) {
  if (!deterministicEvaluator?.evaluate) throw new TypeError("deterministicEvaluator is required");
  return {
    kind: MANUAL_INPUT_QUALITY_POLICY,
    async evaluate(input = {}) {
      const result = await deterministicEvaluator.evaluate(input);
      if (result?.checks_complete !== true || !Array.isArray(result.findings)) {
        throw Object.assign(new Error("QUALITY_EVALUATION_INVALID"), { code: "QUALITY_EVALUATION_INVALID" });
      }
      const body = text(input.copyVersion?.body);
      if (!body) throw Object.assign(new Error("QUALITY_EVALUATION_INVALID"), { code: "QUALITY_EVALUATION_INVALID" });
      return { ...result, findings: [...result.findings, semanticReviewFinding(body)] };
    }
  };
}
