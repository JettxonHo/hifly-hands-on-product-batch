import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ALLOWED_HOSTS = new Set(["hifly.cc", "hiflyworks-api.lingverse.co"]);
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

function parseRequestBody(postData = {}) {
  const text = typeof postData.text === "string" ? postData.text : "";
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseData(body) {
  return body && typeof body === "object" && body.data && typeof body.data === "object" ? body.data : {};
}

function pathParts(entry) {
  let url;
  try {
    url = new URL(entry.request.url);
  } catch {
    return null;
  }
  return {
    host: url.hostname,
    path: url.pathname,
    method: String(entry.request?.method || "GET").toUpperCase(),
    url
  };
}

function hiflyworksStep(entry, body, context) {
  const parts = pathParts(entry);
  if (!parts || parts.host !== "hiflyworks-api.lingverse.co") return null;
  const { path: pathname, method } = parts;
  const data = responseData(body);

  if (pathname === "/api/app/v1/upload_url" && method === "POST" && typeof data.oss_key === "string") {
    context.uploadCount += 1;
    const variableName = context.uploadCount === 1 ? "goods_image_oss_key" : `upload_${context.uploadCount}_oss_key`;
    return {
      id: `upload_image_${String(context.uploadCount).padStart(3, "0")}`,
      phase: "asset_generation",
      produces: { [variableName]: "$response.body.data.oss_key" }
    };
  }

  if (pathname === "/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation") {
    if (method === "POST") {
      context.handsOnSubmitted = true;
      return {
        id: "create_hands_on_image",
        phase: "asset_generation"
      };
    }
    if (method === "GET" && context.handsOnSubmitted && !context.assetProduced && data.status === 3 && typeof data.gen_id === "string") {
      context.assetProduced = true;
      return {
        id: "poll_hands_on_image_ready",
        phase: "asset_generation",
        produces: { asset_id: "$response.body.data.gen_id" }
      };
    }
    return null;
  }

  if (pathname === "/api/app/v1/one_stop/goods_in_hand/videos") {
    if (method === "POST") {
      context.videoSubmitted = true;
      return {
        id: "submit_video",
        phase: "remote_submit",
        placeholders: ["{{asset_id}}"]
      };
    }
    if (method === "GET" && context.videoSubmitted) {
      const first = Array.isArray(data.list) ? data.list[0] : null;
      if (!first || typeof first !== "object") return null;
      if (first.status === 1 && !context.remoteIdProduced && first.id !== undefined && first.id !== null) {
        context.remoteIdProduced = true;
        return {
          id: "poll_video_submitted",
          phase: "remote_submit",
          produces: { remote_id: "$response.body.data.list.0.id" }
        };
      }
      if (first.status === 1 && context.remoteIdProduced && !context.remoteQueryAdded) {
        context.remoteQueryAdded = true;
        return {
          id: "poll_video_status",
          phase: "remote_query",
          placeholders: ["{{remote_id}}"]
        };
      }
      if (first.status === 2 && first.url && !context.downloadAdded) {
        context.downloadAdded = true;
        return {
          id: "download_video",
          phase: "download",
          placeholders: ["{{remote_id}}"],
          produces: { artifact_filename: "$response.body.data.list.0.title" }
        };
      }
    }
  }

  return null;
}

function legacyHiflyStep(entry) {
  const parts = pathParts(entry);
  if (!parts || parts.host !== "hifly.cc") return null;
  if (!parts.path.startsWith("/api/")) return null;
  return {
    id: null,
    phase: "unclassified"
  };
}

function candidateStep(entry, index, context) {
  const body = parseBody(entry.response?.content);
  if (body === null) return null;
  const classified = hiflyworksStep(entry, body, context) || legacyHiflyStep(entry);
  if (!classified) return null;
  const requestBody = parseRequestBody(entry.request?.postData);
  return {
    id: classified.id || `candidate_${String(index + 1).padStart(3, "0")}`,
    phase: classified.phase,
    method: String(entry.request?.method || "GET").toUpperCase(),
    url_template: entry.request.url,
    request: {
      headers: headerObject(entry.request?.headers),
      ...(requestBody ? { body: requestBody } : {})
    },
    response: {
      status: Number(entry.response?.status || 0),
      headers: headerObject(entry.response?.headers),
      body
    },
    ...(classified.placeholders ? { placeholders: classified.placeholders } : {}),
    ...(classified.produces ? { produces: classified.produces } : {})
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
  const context = {
    assetProduced: false,
    downloadAdded: false,
    handsOnSubmitted: false,
    remoteIdProduced: false,
    remoteQueryAdded: false,
    uploadCount: 0,
    videoSubmitted: false
  };
  for (const entry of entries) {
    if (!entry?.request?.url) continue;
    let url;
    try {
      url = new URL(entry.request.url);
    } catch {
      continue;
    }
    if (!allowed.has(url.hostname) || isStaticRequest(url)) continue;
    const step = candidateStep(entry, steps.length, context);
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
