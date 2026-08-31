import { createFetchTransport } from "./http-transport.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_DEFAULT_MAX_TOKENS = 512;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function validMaxTokens(value) {
  const selected = value ?? DEEPSEEK_DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(selected) || selected < 1 || selected > 16_384) throw failure("DEEPSEEK_MAX_TOKENS_INVALID");
  return selected;
}

export function createDeepSeekClient({
  apiKey,
  transport = createFetchTransport(),
  model = DEEPSEEK_DEFAULT_MODEL,
  maxTokens = DEEPSEEK_DEFAULT_MAX_TOKENS
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") throw failure("DEEPSEEK_API_KEY_REQUIRED");
  if (!transport || typeof transport.request !== "function") throw new TypeError("transport.request is required");
  if (typeof model !== "string" || model.trim() === "") throw failure("DEEPSEEK_MODEL_INVALID");
  const selectedMaxTokens = validMaxTokens(maxTokens);
  const bearerToken = apiKey.trim();

  async function complete({ messages = [] } = {}) {
    let result;
    try {
      result = await transport.request({
        url: `${DEEPSEEK_BASE_URL}/chat/completions`,
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json"
        },
        body: {
          model: model.trim(),
          messages: structuredClone(messages),
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: selectedMaxTokens
        }
      });
    } catch {
      throw failure("DEEPSEEK_UNAVAILABLE");
    }

    const status = Number(result?.status);
    if (status === 401) throw failure("DEEPSEEK_AUTH_INVALID");
    if (status === 429) throw failure("DEEPSEEK_RATE_LIMITED");
    if (status >= 500) throw failure("DEEPSEEK_UNAVAILABLE");
    if (!Number.isInteger(status) || status < 200 || status >= 300) throw failure("DEEPSEEK_REQUEST_FAILED");
    if (!result?.body || typeof result.body !== "object" || Array.isArray(result.body) ||
      !Array.isArray(result.body.choices) || !result.body.choices[0] ||
      !result.body.choices[0].message || typeof result.body.choices[0].message !== "object") {
      throw failure("DEEPSEEK_RESPONSE_INVALID");
    }
    return result.body;
  }

  return { kind: "deepseek_official", providerName: "DeepSeek", model: model.trim(), complete };
}
