export const DEMO_MIGRATION_ORDER = Object.freeze([
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

export async function loadDemoMigrationSteps() {
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
    { runWorkDeliveryMigrations },
    { runWorkVerificationMigrations }
  ] = await Promise.all([
    import("../src/assets/postgres.js"),
    import("../src/avatar-selection/postgres.js"),
    import("../src/copy-generation/postgres.js"),
    import("../src/copy-quality/postgres.js"),
    import("../src/copy-review/postgres.js"),
    import("../src/identity/postgres.js"),
    import("../src/manual-execution/postgres.js"),
    import("../src/manual-handoff/postgres.js"),
    import("../src/production-orders/postgres.js"),
    import("../src/project-content/postgres.js"),
    import("../src/video-planning/postgres.js"),
    import("../src/work-delivery/postgres.js"),
    import("../src/work-verification/postgres.js")
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
    { name: "workDelivery", run: runWorkDeliveryMigrations }
  ];
}

export async function runDemoMigrations(pool, { steps = null, onStep = null } = {}) {
  if (!pool) throw new TypeError("demo migration pool is required");
  const selectedSteps = steps || await loadDemoMigrationSteps();
  const applied = [];
  for (const step of selectedSteps) {
    if (!step || typeof step.name !== "string" || typeof step.run !== "function") {
      throw new TypeError("demo migration steps must be named functions");
    }
    await step.run(pool);
    applied.push(step.name);
    await onStep?.(step.name);
  }
  return applied;
}
