export function createMemoryObjectStore() {
  const objects = new Map();
  return {
    async put({ key, body, contentType, metadata }) {
      if (objects.has(key)) throw Object.assign(new Error("OBJECT_ALREADY_EXISTS"), { code: "OBJECT_ALREADY_EXISTS" });
      objects.set(key, { body: Buffer.from(body), contentType, metadata: { ...metadata } });
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { size: object.body.length, contentType: object.contentType, metadata: { ...object.metadata } } : null;
    },
    async get(key) {
      const object = objects.get(key);
      return object ? Buffer.from(object.body) : null;
    },
    async remove(key) { objects.delete(key); },
    async replace(key, body) {
      const object = objects.get(key);
      if (!object) throw new Error("object missing");
      object.body = Buffer.from(body);
    },
    async setMetadata(key, metadata) {
      const object = objects.get(key);
      if (!object) throw new Error("object missing");
      object.metadata = { ...object.metadata, ...metadata };
    }
  };
}
