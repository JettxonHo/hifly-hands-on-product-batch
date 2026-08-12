const DEFAULT_EXPRESSION_STYLE = "自然口语化种草";
const DEFAULT_ENDING_STYLE = "自然收尾";
const CONTENT_BRIEF_FIELDS = [
  "expression_style",
  "selling_angle",
  "expected_length",
  "ending_style",
  "additional_requirements"
];

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function safeText(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw failure("COPY_PROVIDER_INPUT_INVALID");
    return null;
  }
  if (typeof value !== "string") throw failure("COPY_PROVIDER_INPUT_INVALID");
  const normalized = value.trim();
  if (required && !normalized) throw failure("COPY_PROVIDER_INPUT_INVALID");
  return normalized || null;
}

function normalizeContentBrief(value) {
  const brief = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {
    expression_style: safeText(brief.expression_style) || DEFAULT_EXPRESSION_STYLE,
    ending_style: safeText(brief.ending_style) || DEFAULT_ENDING_STYLE
  };
  for (const field of CONTENT_BRIEF_FIELDS.slice(1, -1)) {
    const candidate = brief[field];
    if (candidate === undefined || candidate === null || candidate === "") continue;
    if (typeof candidate !== "string") throw failure("COPY_PROVIDER_INPUT_INVALID");
    const clean = safeText(candidate);
    if (clean) normalized[field] = clean;
  }
  const requirements = brief.additional_requirements;
  if (requirements !== undefined && requirements !== null && requirements !== "") {
    if (typeof requirements !== "string") throw failure("COPY_PROVIDER_INPUT_INVALID");
    const clean = safeText(requirements);
    if (clean) normalized.additional_requirements = clean;
  }
  return normalized;
}

function buildPromptInput(productRevision) {
  if (!productRevision || typeof productRevision !== "object" || Array.isArray(productRevision)) {
    throw failure("COPY_PROVIDER_INPUT_INVALID");
  }
  const productName = safeText(productRevision.product_name, { required: true });
  const sellingPoints = Array.isArray(productRevision.selling_points)
    ? productRevision.selling_points
      .filter((point) => point?.confirmed === true)
      .map((point) => safeText(point.text))
      .filter(Boolean)
    : [];
  if (sellingPoints.length === 0) throw failure("COPY_PROVIDER_INPUT_INVALID");

  return {
    product_facts: {
      product_name: productName,
      ...(safeText(productRevision.product_description) ? { product_description: safeText(productRevision.product_description) } : {}),
      ...(safeText(productRevision.primary_category) ? { primary_category: safeText(productRevision.primary_category) } : {}),
      confirmed_selling_points: sellingPoints
    },
    content_brief: normalizeContentBrief(productRevision.content_brief)
  };
}

const SYSTEM_PROMPT = `You write a product recommendation script using only the supplied confirmed facts and content brief. Do not invent claims. Return only one valid JSON object, not Markdown, with exactly this minimum shape: {"body":"string"}. The body is the draft copy text. Keep the output in JSON format.`;

function requestFor(promptInput) {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(promptInput) }
    ]
  };
}

function parseBody(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw failure("COPY_PROVIDER_OUTPUT_INVALID");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw failure("COPY_PROVIDER_OUTPUT_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.body !== "string" || !parsed.body.trim()) {
    throw failure("COPY_PROVIDER_OUTPUT_INVALID");
  }
  return { body: parsed.body.trim() };
}

export function createDeepSeekCopyProvider({ client } = {}) {
  if (!client || typeof client.complete !== "function") throw new TypeError("client.complete is required");

  return {
    kind: "deepseek_official",
    async generateCopy({ productRevision } = {}) {
      const request = requestFor(buildPromptInput(productRevision));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return parseBody(await client.complete(request));
        } catch (error) {
          const outputFailure = error?.code === "COPY_PROVIDER_OUTPUT_INVALID" || error?.code === "DEEPSEEK_RESPONSE_INVALID";
          if (!outputFailure || attempt === 1) {
            if (outputFailure) throw failure("COPY_PROVIDER_OUTPUT_INVALID");
            throw failure("COPY_PROVIDER_FAILED");
          }
        }
      }
      throw failure("COPY_PROVIDER_OUTPUT_INVALID");
    }
  };
}
