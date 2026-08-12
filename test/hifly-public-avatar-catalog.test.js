import assert from "node:assert/strict";
import test from "node:test";

import { createHiflyPublicAvatarCatalog } from "../src/avatar-selection/hifly-public-avatar-catalog.js";

test("Hifly public avatar catalog collects multiple pages and keeps a provider-neutral shape", async () => {
  const calls = [];
  const catalog = createHiflyPublicAvatarCatalog({
    pageSize: 2,
    client: {
      async listPublicAvatars(params) {
        calls.push(params);
        if (params.page === 1) return { items: [
          { avatar: 101, kind: 2, title: "One" },
          { avatar: "102", kind: 2, title: "Two" }
        ], requestId: "private-1" };
        return { items: [{ avatar: "102", kind: 2, title: "Two Renamed" }], requestId: "private-2" };
      }
    }
  });

  assert.deepEqual(await catalog.list(), [
    { provider_key: "hifly-public:101", display_name: "One", source_type: "public" },
    { provider_key: "hifly-public:102", display_name: "Two Renamed", source_type: "public" }
  ]);
  assert.deepEqual(calls, [{ page: 1, size: 2 }, { page: 2, size: 2 }]);
});

test("Hifly public avatar catalog rejects malformed fake client pages without exposing provider details", async () => {
  const catalog = createHiflyPublicAvatarCatalog({
    client: { async listPublicAvatars() { return { items: [{ avatar: "a", kind: 2, title: "" }] }; } }
  });
  await assert.rejects(catalog.list(), (error) => {
    assert.equal(error.code, "HIFLY_API_RESPONSE_INVALID");
    assert.equal(error.message, "HIFLY_API_RESPONSE_INVALID");
    return true;
  });
});
