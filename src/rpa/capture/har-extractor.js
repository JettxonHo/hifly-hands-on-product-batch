import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ALLOWED_HOSTS = new Set(["hifly.cc"]);
const STATIC_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".map",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2"
]);

function headerObject(headers = []) {
  const result = {};
  for (const header of headers) {
    if (typeof header?.name === "string") result[header.name.toLowerCase()] = String(header.value ?? "");
  }
  return result;
}

function isStaticRequest(url) {
  const extension = path.extname(url.pathname).toLowerCase();
  return STATIC_EXTENSIONS.has(extension);
}

function parseBody(content = {}) {
  const text = typeof content.text === "string" ? content.text : "";
  const mimeType = String(content.mimeType || "").toLowerCase();
  if (!text || !mimeType.includes("json") && !/^\s*[{[]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function candidateStep(entry, index) {
  const body = parseBody(entry.response?.content);
  if (body === null) return null;
  return {
    id: `candidate_${String(index + 1).padStart(3, "0")}`,
    phase: "unclassified",
    method: String(entry.request?.method || "GET").toUpperCase(),
    url_template: entry.request.url,
    request: { headers: headerObject(entry.request?.headers) },
    response: {
      status: Number(entry.response?.status || 0),
      headers: headerObject(entry.response?.headers),
      body
    }
  };
}

export async function extractRawStepsFromHar({
  harPath,
  outputPath = null,
  allowedHosts = [...DEFAULT_ALLOWED_HOSTS]
} = {}) {
  if (!harPath) throw Object.assign(new Error("harPath is required"), { code: "CAPTURE_HAR_MISSING" });
  const allowed = new Set(allowedHosts);
  const har = JSON.parse(await readFile(harPath, "utf8"));
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const steps = [];
  for (const entry of entries) {
    if (!entry?.request?.url) continue;
    let url;
    try {
      url = new URL(entry.request.url);
    } catch {
      continue;
    }
    if (!allowed.has(url.hostname) || isStaticRequest(url)) continue;
    const step = candidateStep(entry, steps.length);
    if (step) steps.push(step);
  }
  const raw = {
    source: "hifly_goods",
    captured_at: new Date().toISOString(),
    steps
  };
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    await writeFile(outputPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }
  return raw;
}
