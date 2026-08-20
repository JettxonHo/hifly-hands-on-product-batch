export const PRODUCTION_MIGRATION_ORDER = Object.freeze([
  "identity",
  "assets",
  "projectContent",
  "copyGeneration",
  "copyQuality",
  "copyReview",
  "avatarSelection",
  "videoPlanning",
  "productionOrders",
  "manualHandoff",
  "manualExecution",
  "artifactVerification",
  "workDelivery"
]);

export async function loadProductionMigrationSteps() {
  const [
    { runAssetMigrations },
    { runAvatarSelectionMigrations },
    { runCopyGenerationMigrations },
    { runCopyQualityMigrations },
    { runCopyReviewMigrations },
    { runIdentityMigrations },
    { runManualExecutionMigrations },
    { runManualHandoffMigrations },
    { runProductionOrderMigrations },
    { runProjectContentMigrations },
    { runVideoPlanningMigrations },
    { runAppearanceFidelityMigrations },
    { runWorkDeliveryMigrations },
    { runWorkVerificationMigrations }
  ] = await Promise.all([
    import("../assets/postgres.js"),
    import("../avatar-selection/postgres.js"),
    import("../copy-generation/postgres.js"),
    import("../copy-quality/postgres.js"),
    import("../copy-review/postgres.js"),
    import("../identity/postgres.js"),
    import("../manual-execution/postgres.js"),
    import("../manual-handoff/postgres.js"),
    import("../production-orders/postgres.js"),
    import("../project-content/postgres.js"),
    import("../video-planning/postgres.js"),
    import("../appearance-fidelity/postgres.js"),
    import("../work-delivery/postgres.js"),
    import("../work-verification/postgres.js")
  ]);

  return [
    { name: "identity", run: runIdentityMigrations },
    { name: "assets", run: runAssetMigrations },
    { name: "projectContent", run: runProjectContentMigrations },
    { name: "copyGeneration", run: runCopyGenerationMigrations },
    { name: "copyQuality", run: runCopyQualityMigrations },
    { name: "copyReview", run: runCopyReviewMigrations },
    { name: "avatarSelection", run: runAvatarSelectionMigrations },
    { name: "videoPlanning", run: runVideoPlanningMigrations },
    { name: "productionOrders", run: runProductionOrderMigrations },
    { name: "manualHandoff", run: runManualHandoffMigrations },
    { name: "manualExecution", run: runManualExecutionMigrations },
    { name: "artifactVerification", run: runWorkVerificationMigrations },
    { name: "appearanceFidelity", run: runAppearanceFidelityMigrations },
    { name: "workDelivery", run: runWorkDeliveryMigrations }
  ];
}

export async function runProductionMigrations(pool, { steps = null, onStep = null } = {}) {
  if (!pool) throw new TypeError("production migration pool is required");
  const selectedSteps = steps || await loadProductionMigrationSteps();
  const applied = [];
  for (const step of selectedSteps) {
    if (!step || typeof step.name !== "string" || typeof step.run !== "function") {
      throw new TypeError("production migration steps must be named functions");
    }
    await step.run(pool);
    applied.push(step.name);
    await onStep?.(step.name);
  }
  return applied;
}
