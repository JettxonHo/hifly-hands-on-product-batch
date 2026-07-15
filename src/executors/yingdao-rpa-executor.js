export function createYingdaoRpaExecutor() {
  async function unavailable() {
    const error = new Error("Yingdao RPA executor is not implemented yet");
    error.code = "YINGDAO_RPA_NOT_IMPLEMENTED";
    throw error;
  }
  return {
    createAsset: unavailable,
    submitVideo: unavailable,
    querySubmission: unavailable,
    downloadArtifact: unavailable,
    reconcileSubmission: unavailable
  };
}
