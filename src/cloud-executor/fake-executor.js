const DEFAULT_OUTPUT = Buffer.from("cloud-executor-fake-output");

export function createFakeCloudExecutor({ output = DEFAULT_OUTPUT, failure = null } = {}) {
  return {
    kind: "fake",
    async run() {
      if (failure) return { ok: false, failureStage: failure.failureStage || "fake_execution" };
      return { body: Buffer.from(output), mediaType: "video/mp4", originalFilename: "cloud-executor-fake.mp4" };
    }
  };
}
