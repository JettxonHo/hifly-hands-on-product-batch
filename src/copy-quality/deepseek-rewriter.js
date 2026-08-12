const DEFAULT_EXPRESSION_STYLE = "自然口语化种草";
const DEFAULT_ENDING_STYLE = "自然收尾";
const CONTENT_BRIEF_FIELDS = [
  "expression_style",
  "selling_angle",
  "expected_length",
  "ending_style",
  "additional_requirements"
];
const FINDING_FIELDS = ["kind", "title", "matched_text", "message", "suggestion"];

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("COPY_REWRITE_INPUT_INVALID");
  return value;
}

function optionalText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw failure("COPY_REWRITE_INPUT_INVALID");
  const normalized = value.trim();
  return normalized || null;
}

function requiredText(value) {
  const normalized = optionalText(value);
  if (!normalized) throw failure("COPY_REWRITE_INPUT_INVALID");
  return normalized;
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

function projectFinding(value) {
  if (value === undefined || value === null) return null;
  const source = requireObject(value);
  const projected = {};
  for (const field of FINDING_FIELDS) {
    const candidate = optionalText(source[field]);
    if (candidate) projected[field] = candidate;
  }
  return Object.keys(projected).length > 0 ? projected : null;
}

function projectInput({ copyVersion, productRevision, finding, scope, instruction } = {}) {
  const copy = requireObject(copyVersion);
  const revision = requireObject(productRevision);
  const body = requiredText(copy.body);
  const productName = requiredText(revision.product_name);
  const normalizedScope = requiredText(scope);
  if (!["matched_text", "full"].includes(normalizedScope)) throw failure("COPY_REWRITE_INPUT_INVALID");
  const normalizedInstruction = requiredText(instruction);
  if (normalizedInstruction.length > 1000) throw failure("COPY_REWRITE_INPUT_INVALID");
  if (!Array.isArray(revision.selling_points)) throw failure("COPY_REWRITE_INPUT_INVALID");

  const confirmedSellingPoints = revision.selling_points
    .filter((point) => point && typeof point === "object" && !Array.isArray(point) && point.confirmed === true)
    .map((point) => optionalText(point.text))
    .filter(Boolean);
  if (confirmedSellingPoints.length === 0) throw failure("COPY_REWRITE_INPUT_INVALID");

  const productFacts = {
    product_name: productName,
    confirmed_selling_points: confirmedSellingPoints
  };
  const productDescription = optionalText(revision.product_description ?? revision.description);
  const primaryCategory = optionalText(revision.primary_category ?? revision.category);
  if (productDescription) productFacts.product_description = productDescription;
  if (primaryCategory) productFacts.primary_category = primaryCategory;
  const projectedFinding = projectFinding(finding);

  return {
    copy: { body },
    product_facts: productFacts,
    content_brief: normalizeContentBrief(revision.content_brief),
    scope: normalizedScope,
    instruction: normalizedInstruction,
    ...(projectedFinding ? { finding: projectedFinding } : {})
  };
}

const SYSTEM_PROMPT = `You rewrite product recommendation copy using only the supplied frozen source copy, confirmed product facts, normalized content brief, selected quality finding, scope, and instruction. Do not invent claims or facts. Return only one valid JSON object, not Markdown, with exactly this minimum shape: {"body":"string"}. The body is the rewritten draft copy. Do not return reasoning_content.`;

function requestFor(projected) {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(projected) }
    ]
  };
}

function parseBody(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw failure("COPY_REWRITE_OUTPUT_INVALID");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw failure("COPY_REWRITE_OUTPUT_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    typeof parsed.body !== "string" || !parsed.body.trim()) {
    throw failure("COPY_REWRITE_OUTPUT_INVALID");
  }
  return { body: parsed.body.trim() };
}

function structuralFailure(error) {
  return error?.code === "COPY_REWRITE_OUTPUT_INVALID" || error?.code === "DEEPSEEK_RESPONSE_INVALID";
}

export function createDeepSeekCopyRewriter({ client } = {}) {
  if (!client || typeof client.complete !== "function") throw new TypeError("client.complete is required");

  return {
    kind: "deepseek_official",
    async rewrite(input = {}) {
      const request = requestFor(projectInput(input));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await client.complete(request);
        } catch (error) {
          if (structuralFailure(error) && attempt === 0) continue;
          if (structuralFailure(error)) throw failure("COPY_REWRITE_OUTPUT_INVALID");
          throw failure("COPY_REWRITER_TEMPORARY_FAILURE");
        }

        try {
          return parseBody(response);
        } catch (error) {
          if (error?.code === "COPY_REWRITE_OUTPUT_INVALID" && attempt === 0) continue;
          throw failure("COPY_REWRITE_OUTPUT_INVALID");
        }
      }
      throw failure("COPY_REWRITE_OUTPUT_INVALID");
    }
  };
}
