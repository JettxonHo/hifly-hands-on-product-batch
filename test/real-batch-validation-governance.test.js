import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function normalizeCrlf(text) {
  return text.replace(/\r\n/g, "\n");
}

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const goalPath = "GOAL.md";
const agentsPath = "AGENTS.md";
const archivePath = "docs/status/archive/GOAL-cloud-executor-p0-complete-2026-08-13.md";
const decisionPath = "docs/product/DECISION_LOG.md";
const pilotPath = "docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md";
const productReadmePath = "docs/product/README.md";
const currentPath = "docs/status/CURRENT.md";
const roadmapPath = "docs/ROADMAP.md";
const collaborationPath = "docs/agent-collaboration.md";
const handoffPath = "docs/PROJECT_HANDOFF.md";
const sessionPath = "docs/status/sessions/2026-08-29-rbv-001-calibration-contract.md";
const exactBaseGoalSha256 = "a3d2fce8859d5cf36b76d481885fbba136c5937fbfd5ede35f89553edf57fafb";

test("RBV-001 establishes one current Goal and preserves the old Goal as an archive", () => {
  const goal = read(goalPath);
  const archive = read(archivePath);

  assert.match(goal, /RBV-GOAL-001/);
  assert.match(goal, /Stage 1/);
  assert.match(goal, /D-037/);
  assert.match(goal, /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);
  assert.doesNotMatch(goal, /^# 当前 Goal：P0 Cloud Executor 纯云端生产闭环/m);
  assert.match(archive, /^# 当前 Goal：P0 Cloud Executor 纯云端生产闭环/m);
  assert.match(archive, /GOAL_COMPLETE/);
  const archiveLfText = normalizeCrlf(archive);
  const archiveSha256 = sha256Text(archiveLfText);
  assert.equal(archiveSha256, exactBaseGoalSha256, "archived Goal must preserve exact-base bytes");

  const simulatedCrlfProjection = archiveLfText.replace(/\n/g, "\r\n");
  assert.match(simulatedCrlfProjection, /\r\n/, "CRLF projection must exercise the Windows newline path");
  const normalizedCrlfSha256 = sha256Text(normalizeCrlf(simulatedCrlfProjection));
  assert.equal(normalizedCrlfSha256, exactBaseGoalSha256, "normalizing a CRLF archive must preserve the fixed LF hash");
  assert.equal(normalizedCrlfSha256, archiveSha256, "LF and normalized-CRLF archive hashes must agree");
});

test("AGENTS current priority follows Readiness Freeze and keeps Stage 1 as completed history", () => {
  const agents = read(agentsPath);
  const prioritySection = agents.match(/## 当前最高优先级[\s\S]*?(?=## |$)/)?.[0] ?? "";
  const historicalSection = agents.match(/## 历史：Cloud Executor P0[\s\S]*?(?=## |$)/)?.[0] ?? "";

  assert.match(prioritySection, /RBV-GOAL-001/);
  assert.match(prioritySection, /D-037/);
  assert.match(prioritySection, /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);
  assert.match(prioritySection, /Readiness Freeze/);
  assert.match(prioritySection, /RBV_CALIBRATION_READINESS_FREEZE\.md/);
  assert.match(prioritySection, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.doesNotMatch(prioritySection, /当前正式交付目标[^。\n]*Cloud Executor/);
  assert.doesNotMatch(prioritySection, /D-034[^。\n]*(?:为准|当前)/);
  assert.match(prioritySection, /GUI[^\n]*(?:Deferred|Secondary)/i);
  assert.match(prioritySection, /真实 RBV[^\n]*(?:阻塞业务|blocks business)/i);

  assert.match(historicalSection, /Cloud Executor.*P0/i);
  assert.match(historicalSection, /D-034/);
  assert.match(historicalSection, /历史|非现行/i);
  assert.match(historicalSection, /已完成|completed/i);
});

test("the Goal → D-037 → Pilot Contract → status chain uses canonical identifiers and links", () => {
  const goal = read(goalPath);
  const decision = read(decisionPath);
  const pilot = read(pilotPath);
  const productReadme = read(productReadmePath);
  const current = read(currentPath);
  const roadmap = read(roadmapPath);
  const handoff = read(handoffPath);
  const session = read(sessionPath);
  const collaboration = read(collaborationPath);

  assert.match(goal, /RBV-GOAL-001/);
  assert.match(goal, /docs\/product\/DECISION_LOG\.md/);
  assert.match(goal, /docs\/product\/REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);
  assert.match(decision, /^## D-037 Real Batch Production Validation$/m);
  assert.doesNotMatch(decision, /^## D-037 Real Batch Production Validation.*RBV/m);
  assert.match(decision, /RBV-GOAL-001/);
  assert.match(decision, /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);
  assert.match(pilot, /RBV-GOAL-001/);
  assert.match(pilot, /D-037/);
  assert.match(pilot, /docs\/status\/CURRENT\.md/);
  assert.match(pilot, /docs\/ROADMAP\.md/);
  assert.match(pilot, /docs\/PROJECT_HANDOFF\.md/);
  assert.match(session, /RBV-GOAL-001/);
  assert.match(session, /D-037/);
  assert.match(session, /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);

  for (const [relativePath, content] of [
    [goalPath, goal],
    [pilotPath, pilot],
    [productReadmePath, productReadme],
    [currentPath, current],
    [roadmapPath, roadmap],
    [handoffPath, handoff],
    [sessionPath, session],
    [collaborationPath, collaboration],
  ]) {
    assert.match(
      content,
      /#d-037-real-batch-production-validation/,
      `${relativePath} must use the canonical D-037 heading anchor`,
    );
  }
});

test("the Pilot Contract locks calibration, repeatability, and business evidence gates", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /calibration_roster_count\s*\|\s*3[–-]5/);
  assert.match(pilot, /calibration_categories_min\s*\|\s*2/);
  assert.match(pilot, /calibration_manual_correction_min\s*\|\s*1/);
  assert.match(pilot, /success_rate_target\s*\|\s*(none|无|不预设)/i);
  assert.match(pilot, /repeatable_batch_min\s*\|\s*10/);
  assert.match(pilot, /non_author_operator_required\s*\|\s*(true|是)/i);
  assert.match(pilot, /real_video_delivery_or_use_required\s*\|\s*(true|是)/i);
  assert.match(pilot, /consecutive_jobs_without_production_code_changes\s*\|\s*5/);
  assert.match(pilot, /cost.*Owner Gate|Owner Gate.*cost/i);
  assert.match(pilot, /不得.*缩样|不.*自行.*缩样/);
  assert.match(pilot, /fake|fixture|mock|controlled provider|本地 demo/);
  assert.match(pilot, /工程证据/);
  assert.match(pilot, /真实业务证据/);
});

test("the Pilot Contract is fail-closed for provider, credential, cost, release, and destructive actions", () => {
  const pilot = read(pilotPath);

  for (const term of ["飞影", "Provider", "Secret", "积分", "客户素材", "公开发布", "生产部署"]) {
    assert.match(pilot, new RegExp(term));
  }
  assert.match(pilot, /fail[- ]closed|失败关闭/);
  assert.match(pilot, /Owner.*授权|授权.*Owner/);
  assert.match(pilot, /不得因.*文档.*测试.*代码.*宣布|不.*宣布.*MBL|不.*宣布.*RBV/);
  assert.match(pilot, /不得.*破坏性|破坏性.*禁止/);
});

test("Stage 1 acceptance requires independent approval, self-approval prohibition, and Owner Gate stop", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /Independent Reviewer|独立 Reviewer|独立审查/);
  assert.match(pilot, /APPROVED/);
  assert.match(pilot, /implementer.*(must not|不得)|实现 Agent.*不得.*批准|不得.*自.*批准/i);
  assert.match(pilot, /Draft PR.*(stop|停止)|停止.*Draft PR/);
  assert.match(pilot, /Owner Gate/);
  assert.match(pilot, /不合并|不得合并/);
  assert.match(pilot, /不.*开始.*Calibration|Calibration.*不.*激活/);
});

test("all active status documents point at the same RBV-001 contract", () => {
  const activeDocuments = [
    [productReadmePath, /D-037/],
    [currentPath, /RBV-GOAL-001/],
    [roadmapPath, /RBV-GOAL-001/],
    [handoffPath, /RBV-GOAL-001/],
    [sessionPath, /Stage 1/],
  ];

  for (const [relativePath, marker] of activeDocuments) {
    const content = read(relativePath);
    assert.match(content, marker, `${relativePath} is missing its RBV-001 marker`);
    assert.match(
      content,
      /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/,
      `${relativePath} is missing the canonical Pilot Contract link`,
    );
  }
});

test("the Pilot records current production truth as a baseline, never as RBV Calibration", () => {
  const pilot = read(pilotPath);

  for (const marker of [
    /current_production_truth\s*\|\s*historical_single_real_chain_baseline_only/i,
    /current_work_inspection\s*\|\s*rework_required/i,
    /current_delivery_records\s*\|\s*0/i,
    /delivery\s*\|\s*0/i,
    /current_video_plan\s*\|\s*v2\s+small\s+approved/i,
    /second_order\s*\|\s*none/i,
    /second_attempt\s*\|\s*none/i,
    /second_delivery\s*\|\s*none/i,
    /rbv_calibration_status\s*\|\s*not_started_pending_owner_gate/i,
  ]) {
    assert.match(pilot, marker);
  }
  assert.match(pilot, /历史单条真实链.*基线|historical single real chain.*baseline/i);
  assert.match(pilot, /绝不算.*RBV Calibration|not.*count.*as.*RBV Calibration/i);
});

test("the Pilot Gap Matrix names pending gates and existing engineering baselines", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /Gap Matrix/i);
  for (const gap of [
    "roster_rights",
    "non_author_operator",
    "login_readiness",
    "page_upload_submit_generate_download",
    "cost",
    "quality_delivery",
    "observability_recovery",
  ]) {
    assert.match(
      pilot,
      new RegExp(`\\|\\s*${gap}\\s*\\|\\s*(pending|existing_engineering_baseline)`, "i"),
      `${gap} must have a pending or existing-engineering status`,
    );
  }
  assert.match(pilot, /fake.*不能.*闭合|fake.*cannot.*close|fixture.*cannot.*close/i);
});

test("the Pilot locks per-product and per-order fields plus summary metrics without inventing values", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /per[- ]product|per_product|逐商品/i);
  assert.match(pilot, /per[- ]order|per_order|逐工单/i);
  for (const field of [
    "product_total",
    "order_completion_rate",
    "video_generation_success_rate",
    "qc_pass_rate",
    "avg_per_product_duration",
    "batch_duration",
    "manual_interventions",
    "retries",
    "unit_platform_cost",
    "failure_class",
    "recovery_method",
    "code_revision",
    "code_streak",
  ]) {
    assert.match(pilot, new RegExp(`\\|\\s*${field}\\s*\\|`, "i"), `${field} is not locked`);
  }
  for (const field of [
    "product_id",
    "sku",
    "category",
    "product_rights_ref",
    "input_image_dimensions",
    "input_composition",
    "product_name_length",
    "selling_point_count",
    "order_id",
    "attempt_id",
    "provider_task_ref",
    "operator_role",
    "login_state",
    "page_contract_match",
    "upload_result",
    "submit_result",
    "generation_result",
    "generation_confirmation_result",
    "download_result",
    "started_at",
    "finished_at",
    "queue_duration",
    "generation_duration",
    "status",
    "qc_result",
    "retry_count",
    "evidence_refs",
    "captcha_encountered",
    "page_change_detected",
    "timeout_stage",
    "points_insufficient",
    "platform_points_or_cost",
    "delivery_or_use_result",
    "delivery_or_use_evidence_ref",
  ]) {
    assert.match(pilot, new RegExp(`\\|\\s*${field}\\s*\\|`, "i"), `${field} is not tracked`);
  }
  for (const [field, record] of [
    ["input_image_dimensions", "per_product"],
    ["input_composition", "per_product"],
    ["product_name_length", "per_product"],
    ["selling_point_count", "per_product"],
    ["operator_role", "per_order"],
    ["login_state", "per_order"],
    ["page_contract_match", "per_order"],
    ["upload_result", "per_order"],
    ["submit_result", "per_order"],
    ["generation_result", "per_order"],
    ["generation_confirmation_result", "per_order"],
    ["download_result", "per_order"],
    ["queue_duration", "per_order"],
    ["generation_duration", "per_order"],
    ["captcha_encountered", "per_order"],
    ["page_change_detected", "per_order"],
    ["timeout_stage", "per_order"],
    ["points_insufficient", "per_order"],
    ["platform_points_or_cost", "per_order"],
    ["delivery_or_use_result", "per_order"],
    ["delivery_or_use_evidence_ref", "per_order"],
  ]) {
    assert.match(
      pilot,
      new RegExp(`\\|\\s*${field}\\s*\\|\\s*${record}\\s*\\|`, "i"),
      `${field} must be recorded ${record}`,
    );
  }
  assert.match(pilot, /not.*actual|pending|未填写|不.*结果|不.*伪造/i);
  assert.match(pilot, /只能.*真实.*采集|only.*real.*collected|真实.*来源/i);
  assert.match(pilot, /unknown.*pending|pending.*unknown|unknown.*未采集|未采集.*unknown/i);
});

test("the Pilot defines an Evidence Package and Git exclusion boundary", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /Evidence Package/i);
  for (const artifact of [
    "sanitized_report",
    "manifest",
    "item_metrics",
    "events",
    "hash_index",
    "demo_path",
    "architecture_diagram",
  ]) {
    assert.match(pilot, new RegExp(`\\|\\s*${artifact}\\s*\\|`, "i"), `${artifact} is missing`);
  }
  assert.match(pilot, /Git.*禁止|禁止.*Git|must not.*Git|not.*enter.*Git/i);
  for (const forbidden of ["Secret", "Profile", "Token", "customer materials", "raw downloaded video"]) {
    assert.match(pilot, new RegExp(forbidden, "i"), `${forbidden} exclusion is missing`);
  }
});

test("the Pilot keeps Stage 1 historical and activates only Readiness Freeze", () => {
  const pilot = read(pilotPath);
  const currentMap = pilot.match(/## 13\. Issue \/ Stage map（current）[\s\S]*?(?=### Stage 1 historical contract snapshot|## 14\.)/)?.[0] ?? "";
  const historicalStage = pilot.match(/### Stage 1 historical contract snapshot（not current）[\s\S]*?(?=## 14\.)/)?.[0] ?? "";

  assert.match(pilot, /Issue.*Stage map|Stage map.*Issue/i);
  assert.match(currentMap, /stage_readiness_freeze\s*\|\s*Readiness Freeze\s*\|\s*active/i);
  assert.match(currentMap, /stage_contract\s*\|[^\n]*\|\s*completed/i);
  assert.match(historicalStage, /Stage 1[^\n]*(?:已完成|completed|历史)/i);
  assert.doesNotMatch(pilot, /\|\s*stage_contract\s*\|[^\n]*\|\s*active\s*\|/i);
  for (const [stage, status] of [
    ["stage_contract", "completed"],
    ["stage_readiness_freeze", "active"],
    ["stage_calibration_run", "deferred"],
    ["stage_one_blocker_per_issue", "deferred"],
    ["stage_repeatable_readiness", "deferred"],
    ["stage_repeatable_run", "deferred"],
    ["stage_delivery_report", "deferred"],
  ]) {
    assert.match(
      currentMap,
      new RegExp(`\\|\\s*${stage}\\s*\\|[^\\n]*\\|\\s*${status}\\s*\\|\\s*[^|\\n]+`, "i"),
      `${stage} must have status ${status} and an observable outcome`,
    );
  }
  assert.match(pilot, /Contract\s*→\s*Readiness Freeze\s*→\s*Calibration Run/i);
  assert.match(pilot, /one blocker per Issue\s*→\s*Repeatable Readiness/i);
  assert.match(pilot, /Repeatable Run\s*→\s*Delivery\/?Report/i);
});

test("the Pilot bounds allowed fixes and explicit non-goals", () => {
  const pilot = read(pilotPath);

  assert.match(pilot, /Allowed fixes|允许修复/i);
  for (const allowedFix of [
    "real_blocker",
    "observability",
    "status",
    "safety",
    "idempotency",
    "manual_recovery",
    "minimal_ux",
  ]) {
    assert.match(pilot, new RegExp(`\\|\\s*${allowedFix}\\s*\\|`, "i"), `${allowedFix} is not allowed explicitly`);
  }
  assert.match(pilot, /Non-goals|Explicit non-goals|明确非目标|非目标/i);
  for (const nonGoal of [
    "Multi-Agent",
    "SaaS",
    "RBAC",
    "browser platform",
    "UI redesign",
    "parallel",
    "unbounded retry",
    "captcha bypass",
    "model router",
    "architecture rewrite",
  ]) {
    assert.match(pilot, new RegExp(nonGoal, "i"), `${nonGoal} non-goal is missing`);
  }
});

test("current status pointers name Issue #273 while retaining the blocked Readiness Freeze and historical P0 text", () => {
  const current = read(currentPath);
  const roadmap = read(roadmapPath);
  const authoritySection = current.match(/## 权威文档与恢复顺序[\s\S]*?(?=## |$)/)?.[0] ?? "";

  assert.match(current, /当前 Goal：RBV-GOAL-001；当前 bounded Stage：Issue #273/);
  assert.match(current, /Readiness Freeze/);
  assert.match(current, /RBV_CALIBRATION_READINESS_FREEZE\.md/);
  assert.match(current, /BLOCKED_PRE_REAL_RUN/);
  assert.doesNotMatch(current, /^## 下一步$/m, "legacy next-step heading must be historical");
  assert.match(current, /## 历史：下一步[^\n]*当前 Goal 之前/);
  assert.match(current, /历史[^\n]*P0\.5|P0\.5[^\n]*历史/i);
  assert.match(current, /历史[^\n]*CLOUD_EXECUTOR_P0\.md|CLOUD_EXECUTOR_P0\.md[^\n]*历史/i);
  assert.match(authoritySection, /^\s*2\..*Readiness Freeze.*Stage 1[^\n]*(?:历史|completed|已完成)/m);
  assert.match(authoritySection, /^\s*3\..*RBV_CALIBRATION_READINESS_FREEZE\.md.*BLOCKED_PRE_REAL_RUN/m);
  assert.match(authoritySection, /^\s*4\..*ROADMAP\.md[^\n]*Readiness Freeze/m);
  assert.doesNotMatch(authoritySection, /CLOUD_EXECUTOR_P0\.md[^\n]*当前/);
  assert.match(authoritySection, /Stage 1[^\n]*(?:历史|completed|已完成)/i);

  assert.match(roadmap, /当前状态：RBV-GOAL-001 下 Issue #273/);
  assert.match(roadmap, /RBV_CALIBRATION_READINESS_FREEZE\.md/);
  assert.match(roadmap, /BLOCKED_PRE_REAL_RUN/);
  assert.doesNotMatch(roadmap, /^## 2\. 当前升级顺序$/m, "legacy current-order heading must be historical");
  assert.doesNotMatch(roadmap, /P0\.5[^\n]*当前阶段/);
  assert.match(roadmap, /历史[^\n]*P0\.5|P0\.5[^\n]*历史/i);
});

test("ROADMAP demotes the legacy P0 sections and scope to historical non-current text", () => {
  const roadmap = read(roadmapPath);
  for (const heading of [
    /^## 3\. 下一阶段$/m,
    /^## 4\. 保留但不抢跑的工作$/m,
    /^## 5\. 每波次门禁$/m,
  ]) {
    assert.doesNotMatch(roadmap, heading, "legacy current roadmap heading must be historical");
  }
  for (const heading of [
    /^## 3\. 历史：下一阶段[^\n]*非当前/m,
    /^## 4\. 历史：保留但不抢跑的工作[^\n]*非当前/m,
    /^## 5\. 历史：每波次门禁[^\n]*非当前/m,
  ]) {
    assert.match(roadmap, heading, "legacy roadmap section needs an explicit historical marker");
  }

  const cloudExecutorLine = roadmap
    .split("\n")
    .find((line) => line.includes("Cloud Executor 的权威范围")) ?? "";
  assert.notEqual(cloudExecutorLine, "", "legacy Cloud Executor scope line must remain as history");
  assert.match(cloudExecutorLine, /历史|非现行/i);
  assert.match(cloudExecutorLine, /P0/);
  assert.doesNotMatch(cloudExecutorLine, /当前|下一阶段|保留但不抢跑|每波次门禁/);
});

test("agent-collaboration has the Issue #273 bounded allocation and retains the blocked Readiness Freeze plus Stage 1/CE-08 history", () => {
  const collaboration = read(collaborationPath);
  const currentSection = collaboration.match(/## 8\. 当前分配[\s\S]*?(?=###|$)/)?.[0] ?? "";
  const historicalSection = collaboration.match(/### 历史[\s\S]*$/)?.[0] ?? "";

  assert.match(currentSection, /RBV-GOAL-001/);
  assert.match(currentSection, /Issue #273/);
  assert.match(currentSection, /Readiness Record/);
  assert.match(currentSection, /RBV_CALIBRATION_READINESS_FREEZE\.md/);
  assert.match(currentSection, /BLOCKED_PRE_REAL_RUN/);
  assert.match(currentSection, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.match(currentSection, /REAL_BATCH_PRODUCTION_VALIDATION_PILOT\.md/);
  assert.doesNotMatch(currentSection, /当前 Goal：P0 Cloud Executor/);
  assert.match(historicalSection, /CE-08/);
  assert.match(historicalSection, /历史|非现行/);
});
