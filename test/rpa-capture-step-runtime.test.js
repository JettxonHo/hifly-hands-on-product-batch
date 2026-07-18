import test from "node:test";
import assert from "node:assert/strict";

import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "../src/rpa/capture/step-runtime.js";

test("substituteCaptureValue replaces placeholders in nested values", () => {
  assert.deepEqual(
    substituteCaptureValue({
      url: "https://example.test/{{remote_id}}",
      body: { asset: "{{asset_id}}", keep: 123 },
      list: ["{{remote_id}}"]
    }, { remote_id: "work-1", asset_id: "asset-1" }),
    {
      url: "https://example.test/work-1",
      body: { asset: "asset-1", keep: 123 },
      list: ["work-1"]
    }
  );
});

test("assertStepPlaceholders rejects missing variables", () => {
  assert.throws(
    () => assertStepPlaceholders({ id: "submit", placeholders: ["{{asset_id}}"] }, {}),
    /Missing variable for step submit: asset_id/
  );
});

test("extractProducedVariables reads response body paths", () => {
  assert.deepEqual(
    extractProducedVariables(
      { remote_id: "$response.body.data.list.0.id" },
      { data: { list: [{ id: 634505 }] } }
    ),
    { remote_id: 634505 }
  );
});
