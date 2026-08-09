import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// A deterministic, tiny ISO-BMFF header is sufficient for the no-credit fixture.
// It is intentionally produced only in the temporary run directory.
export const MINIMAL_MP4_FIXTURE = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65
]);

export function createLocalAgentFakeExecutor({ fixture = MINIMAL_MP4_FIXTURE, remoteId = "local-agent-fake" } = {}) {
  const calls = [];
  const record = (method) => {
    calls.push(method);
  };
  return {
    calls,
    async createAsset(task) {
      record("createAsset");
      return { asset_id: `local-fake-asset-${task.task_id}` };
    },
    async submitVideo() {
      record("submitVideo");
      return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: remoteId } };
    },
    async querySubmission(remoteEvidence) {
      record("querySubmission");
      return { status: "ready", remoteEvidence };
    },
    async downloadArtifact(_remoteEvidence, destination) {
      record("downloadArtifact");
      const filename = `${remoteId}.mp4`;
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, filename), Buffer.from(fixture));
      return { artifact_id: remoteId, relative_path: `downloads/${filename}` };
    },
    async reconcileSubmission() {
      record("reconcileSubmission");
      return { candidates: [] };
    }
  };
}

export const createFakeLocalAgentExecutor = createLocalAgentFakeExecutor;
