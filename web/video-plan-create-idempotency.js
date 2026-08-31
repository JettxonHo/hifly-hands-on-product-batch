(() => {
  const root = typeof window === "object" ? window : globalThis;
  const INVALID_KEY = "VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID";

  function validate(value) {
    if (typeof value !== "string" || value.length > 128 || !value.trim()) throw new TypeError(INVALID_KEY);
    let roundtrip;
    try {
      roundtrip = new root.Headers({ "idempotency-key": value }).get("idempotency-key");
    } catch (_error) {
      throw new TypeError(INVALID_KEY);
    }
    if (roundtrip !== value) throw new TypeError(INVALID_KEY);
    return value;
  }

  function resolve(value) {
    if (value === undefined || value === null || value === "") return validate(root.crypto.randomUUID());
    return validate(value);
  }

  root.HiflyVideoPlanCreateIdempotency = Object.freeze({ resolve });
})();
