export function createCopyReviewInvalidationCoordinator() {
  let reviewService = null;

  return {
    attach(service) { reviewService = service; },
    async copyVersionChanged(input) {
      if (reviewService) await reviewService.reconcileCopyVersion(input);
    },
    async productRevisionChanged(input) {
      if (reviewService) await reviewService.reconcileProductRevision(input);
    }
  };
}
