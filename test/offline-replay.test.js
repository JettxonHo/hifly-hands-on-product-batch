import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOfflineCaptureReplay } from "../src/rpa/capture/offline-replay.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "..", "rpa", "capture", "fixtures", "hifly-goods-sample.json");

test("offline replay walks all capture phases and returns produced variables", async () => {
  const result = await runOfflineCaptureReplay({ manifestPath: FIXTURE });

  assert.equal(result.variables.asset_id, "asset-sample-001");
  assert.equal(result.variables.remote_id, "632410");
  assert.equal(result.variables.artifact_filename, "632410.mp4");
  assert.deepEqual(result.executed_steps, [
    "upload_product_image",
    "upload_person_image",
    "create_hands_on_image",
    "submit_video",
    "poll_video_status",
    "download_video"
  ]);
});
