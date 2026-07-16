import { CAPTURE_PHASES, loadCaptureManifest, selectStepsByPhase } from "./manifest.js";
import { createMockHttpClient } from "./mock-http-client.js";

export async function runOfflineCaptureReplay({
  manifestPath,
  initialVariables = {
    product_image_path: "product-image.jpg",
    person_image_path: "person-image.jpg"
  }
} = {}) {
  if (!manifestPath) throw Object.assign(new Error("manifestPath is required"), { code: "CAPTURE_MANIFEST_MISSING" });
  const manifest = await loadCaptureManifest(manifestPath);
  const client = createMockHttpClient({ manifest });
  const variables = { ...initialVariables };
  const executed_steps = [];
  for (const phase of CAPTURE_PHASES) {
    for (const step of selectStepsByPhase(manifest, phase)) {
      const result = await client.request({ stepId: step.id, variables });
      Object.assign(variables, result.produced);
      executed_steps.push(step.id);
    }
  }
  return { variables, executed_steps };
}
