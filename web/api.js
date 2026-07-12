(function () {
  let session = null;

  async function parseResponse(response) {
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const code = typeof payload === "object" && payload ? payload.error : response.statusText;
      const error = new Error(code || "REQUEST_FAILED");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function ensureSession() {
    if (session) return session;
    const payload = await parseResponse(await fetch("/api/session", { credentials: "same-origin" }));
    session = { token: payload.token, headerName: payload.headerName };
    return session;
  }

  async function request(path, options) {
    const current = await ensureSession();
    const headers = new Headers(options?.headers || {});
    if (options?.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes((options?.method || "GET").toUpperCase())) {
      headers.set(current.headerName, current.token);
    }
    return parseResponse(await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin"
    }));
  }

  window.HiflyApi = {
    ensureSession,
    getBatches: () => request("/api/batches"),
    createBatch: (batchId) => request("/api/batches", {
      method: "POST",
      body: JSON.stringify(batchId ? { batchId } : {})
    }),
    importBatch: (formData) => request("/api/imports", {
      method: "POST",
      body: formData
    }),
    startExecution: ({ batchId, idempotencyKey }) => request("/api/executions", {
      method: "POST",
      body: JSON.stringify({ batchId, idempotencyKey, confirm: true })
    })
  };
}());
