import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section ${start}`);
  const remainder = content.slice(startIndex + start.length);
  const endIndex = end ? remainder.indexOf(end) : -1;
  return endIndex === -1 ? remainder : remainder.slice(0, endIndex);
}

const agentsPath = "AGENTS.md";
const goalPath = "GOAL.md";
const collaborationPath = "docs/agent-collaboration.md";
const pilotPath = "docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md";
const readinessPath = "docs/status/RBV_CALIBRATION_READINESS_FREEZE.md";
const currentPath = "docs/status/CURRENT.md";
const roadmapPath = "docs/ROADMAP.md";
const sessionPath = "docs/status/sessions/2026-08-29-rbv-calibration-readiness-freeze.md";

const skuRecords = [
  {
    sku: "SKU-CAL-001",
    sourceName: "Lean 450mL 不锈钢随行保温杯",
    fixtureName: "随行杯",
    category: "日用品",
    sourcePage: "allprint.io/products/roostevabast-terasest-joogipudel-lean-1",
    materialCount: "1",
    format: "JPEG",
    dimensions: "1800x2400",
    composition: "portrait",
    manualTarget: "source identity and claims",
  },
  {
    sku: "SKU-CAL-002",
    sourceName: "四麦 ENC 真无线入耳式蓝牙耳机",
    fixtureName: "轻听蓝牙耳机",
    category: "数码",
    sourcePage: "globalsources.com/TWS-earbud/quad-mic-ENC-TWS-Earbuds-1212089959p.htm",
    materialCount: "1",
    format: "PNG",
    dimensions: "3000x3000",
    composition: "square",
    manualTarget: "source identity and claims",
  },
  {
    sku: "SKU-CAL-003",
    sourceName: "Ducky One 3 Aura 全尺寸热插拔 RGB 机械键盘",
    fixtureName: "曜石全尺寸热插拔RGB机械键盘",
    category: "数码",
    sourcePage: "mechanicalkeyboards.com/products/Ducky-One-3-Aura-Black",
    materialCount: "1",
    format: "JPEG",
    dimensions: "2400x1600",
    composition: "landscape",
    manualTarget: "source identity and claims",
  },
  {
    sku: "SKU-CAL-004",
    sourceName: "LastObject 可重复使用洁面分装瓶",
    fixtureName: "森氧净澈洁面乳",
    category: "个护",
    sourcePage: "lastobject.co.uk/products/facial-cleanser-bottle",
    materialCount: "1",
    format: "JPEG",
    dimensions: "1728x2160",
    composition: "portrait",
    manualTarget: "source object correction",
  },
  {
    sku: "SKU-CAL-005",
    sourceName: "Highland Tactical Meadow XL 户外徒步背包（黑色）",
    fixtureName: "拓野大容量轻量防撕裂户外徒步露营双肩背包",
    category: "户外",
    sourcePage: "hltactical.com/products/meadow-xl-hiking-backpack",
    materialCount: "5",
    format: "JPEG",
    dimensions: "2000x2000",
    composition: "multi-angle",
    manualTarget: "name and claim review",
  },
];

const requiredSkuFields = [
  "source_aligned_candidate_name",
  "manifest_fixture_name",
  "category",
  "fact_source",
  "identity_status",
  "facts_status",
  "material_count",
  "material_formats",
  "material_dimensions",
  "material_composition",
  "material_status",
  "rights_status",
  "internal_permission_status",
  "manual_review_target",
  "candidate_person",
  "person_status",
  "provider_input_status",
  "max_points",
  "evidence_alias",
  "evidence_ref",
  "status",
  "gate_status",
  "blockers",
];

test("RBV-CAL-001 readiness record activates Readiness Freeze and has one blocked verdict", () => {
  const readiness = read(readinessPath);

  assert.match(readiness, /^# RBV-CAL-001 Calibration Readiness Freeze/m);
  assert.match(readiness, /^\|\s*active_stage\s*\|\s*Readiness Freeze\s*\|/m);
  assert.match(readiness, /Stage 1[^\n]*(?:completed|已完成)[^\n]*historical|Stage 1[^\n]*历史[^\n]*完成/i);
  assert.match(readiness, /^\|\s*verdict\s*\|\s*BLOCKED_PRE_REAL_RUN\s*\|/m);
  assert.doesNotMatch(readiness, /READY_FOR_REAL_RUN_GATE/);
  assert.doesNotMatch(readiness, /^\|\s*(?:status|gate_status)\s*\|\s*READY_FOR_REAL_RUN_GATE\s*\|/m);
});

test("Issue #275 closeout pointers preserve the underlying Readiness Freeze gate and Stage 1 history", () => {
  const agents = read(agentsPath);
  const goal = read(goalPath);
  const collaboration = read(collaborationPath);
  const pilot = read(pilotPath);
  const current = read(currentPath);
  const roadmap = read(roadmapPath);

  const activePriority = agents.match(/## 当前最高优先级[\s\S]*?(?=## |$)/)?.[0] ?? "";
  const currentAllocation = collaboration.match(/## 8\. 当前分配[\s\S]*?(?=###|$)/)?.[0] ?? "";
  const currentSnapshot = sectionBetween(current, "# 项目当前状态", "## Issue #275");
  const currentRoadmap = sectionBetween(roadmap, "# 项目 Roadmap", "## Issue #275");
  const authorityRecovery = sectionBetween(current, "## 权威文档与恢复顺序", "## 历史：里程碑状态（P0）");

  for (const [label, content] of [
    ["AGENTS current priority", activePriority],
    ["agent allocation", currentAllocation],
    ["CURRENT snapshot", currentSnapshot],
    ["ROADMAP snapshot", currentRoadmap],
  ]) {
    assert.match(content, /RBV-GOAL-001/, `${label} must name the current Goal`);
    assert.match(content, /Issue #275/, `${label} must retain the closed engineering Stage reference`);
    assert.match(content, /COMPLETE\/MERGED\/DEPLOYED/, `${label} must record engineering closeout`);
    assert.doesNotMatch(content, /当前唯一 active bounded engineering Stage\s*是\s*Issue #275/i,
      `${label} must not retain Issue #275 as active engineering`);
    assert.doesNotMatch(content, /当前 bounded Stage：Issue #275/i,
      `${label} must not retain Issue #275 as active engineering`);
  }

  for (const [label, content] of [
    ["AGENTS", agents],
    ["GOAL", goal],
    ["agent allocation", collaboration],
    ["Pilot", pilot],
    ["CURRENT", current],
    ["ROADMAP", roadmap],
  ]) {
    assert.match(content, /RBV_CALIBRATION_READINESS_FREEZE\.md/, `${label} must link the readiness record`);
    assert.match(content, /BLOCKED_PRE_REAL_RUN/, `${label} must preserve the blocked readiness verdict`);
  }

  assert.match(activePriority, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.match(currentAllocation, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.match(currentSnapshot, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.match(roadmap, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.match(goal, /Stage 1[^\n]*(?:历史|completed|已完成)/i);

  assert.match(authorityRecovery, /Readiness Freeze/);
  assert.match(authorityRecovery, /RBV_CALIBRATION_READINESS_FREEZE\.md/);
  assert.match(authorityRecovery, /ROADMAP\.md[^\n]*Readiness Freeze/);
  assert.match(authorityRecovery, /Stage 1[^\n]*(?:历史|completed|已完成)/i);
  assert.doesNotMatch(authorityRecovery, /CLOUD_EXECUTOR_P0\.md[^\n]*当前/);
  assert.doesNotMatch(authorityRecovery, /Stage 1[^\n]*当前合同/);
  const readinessIndex = authorityRecovery.indexOf("RBV_CALIBRATION_READINESS_FREEZE.md");
  const roadmapIndex = authorityRecovery.indexOf("ROADMAP.md");
  assert.ok(readinessIndex >= 0 && roadmapIndex > readinessIndex, "readiness record must precede current roadmap in recovery order");
  assert.match(current, /## Issue #273[\s\S]*历史/);
  assert.match(roadmap, /## Issue #273[\s\S]*历史/);
});

test("Issue #275 closeout records the create-only seam without changing the RBV gate", () => {
  const agents = read(agentsPath);
  const collaboration = read(collaborationPath);
  const current = read(currentPath);
  const roadmap = read(roadmapPath);

  for (const [label, content] of [["AGENTS", agents], ["agent allocation", collaboration], ["CURRENT", current], ["ROADMAP", roadmap]]) {
    assert.match(content, /Issue #275/, `${label} must identify Issue #275`);
    assert.match(content, /VIDEOPLAN_CREATE_IDEMPOTENCY_SEAM|VideoPlan Create Idempotency-Key Seam/i,
      `${label} must name the Issue #275 seam`);
  }
  assert.match(current, /video-plan-create-idempotency\.js/);
  assert.match(current, /crypto\.randomUUID/);
  assert.match(current, /逐字节相同才原样返回/);
  assert.match(current, /Issue #273[\s\S]*已完成.*历史/);
  assert.match(current, /BLOCKED_PRE_REAL_RUN/);
  assert.match(current, /现有组织\/成员\/命令作用域的幂等 receipt 持久化 exact caller key 供审计/);
  assert.doesNotMatch(current, /不记录 key/);
  assert.match(current, /PR #276 squash merge 至 `main@fbc722ee40054045d8883f0a7e20beb1a11e4221`/);
  assert.match(current, /GitHub Issue #275 已 CLOSED/);
  assert.doesNotMatch(current, /GitHub Issue #275 仍 OPEN/);
  assert.match(current, /exact-head CI run `33418338737`/);
  assert.match(current, /Ubuntu[^\n]*SUCCESS/);
  assert.match(current, /Windows[^\n]*SUCCESS/);
  assert.match(current, /identity-postgres[^\n]*SUCCESS/);
  assert.match(current, /COMPLETE\/MERGED\/DEPLOYED/);
  assert.match(current, /OWNER_AUTHORIZATION_REQUIRED_FOR_ONE_REAL_VIDEOPLAN_V1_CREATE/);
  assert.match(roadmap, /exact-head CI run `33418338737`/);
  assert.match(roadmap, /零业务变更部署/);
  assert.match(current, /GitHub Issue #273 仍保持 OPEN/);
  assert.match(roadmap, /PR #276 squash merge 至 `main@fbc722ee40054045d8883f0a7e20beb1a11e4221`/);
  assert.match(roadmap, /GitHub Issue #275 已 CLOSED/);
  assert.doesNotMatch(roadmap, /GitHub Issue #275 仍 OPEN/);
  assert.match(roadmap, /exact-head CI run `33418338737`/);
  assert.match(roadmap, /Ubuntu[^\n]*SUCCESS/);
  assert.match(roadmap, /Windows[^\n]*SUCCESS/);
  assert.match(roadmap, /identity-postgres[^\n]*SUCCESS/);
  assert.match(roadmap, /GitHub Issue #273 仍 OPEN/);
});

test("Pilot current Issue/Stage map has one active Readiness Freeze stage", () => {
  const pilot = read(pilotPath);
  const currentMap = sectionBetween(pilot, "## 13. Issue / Stage map（current）", "### Stage 1 historical contract snapshot");

  assert.match(currentMap, /stage_readiness_freeze\s*\|\s*Readiness Freeze\s*\|\s*active/i);
  assert.match(currentMap, /stage_contract\s*\|[^\n]*\|\s*completed/i);
  assert.match(currentMap, /stage_readiness_freeze\s*\|[^\n]*\|\s*active/i);
  for (const stage of ["stage_calibration_run", "stage_one_blocker_per_issue", "stage_repeatable_readiness", "stage_repeatable_run", "stage_delivery_report"]) {
    assert.match(currentMap, new RegExp(`\\|\\s*${stage}\\s*\\|[^\\n]*\\|\\s*deferred\\s*\\|`, "i"));
  }
  assert.equal((currentMap.match(/\|\s*(?:active|当前)\s*\|/gi) ?? []).length, 1, "only Readiness Freeze may be active");
});

test("readiness record has exactly five machine-checkable SKU sections", () => {
  const readiness = read(readinessPath);

  assert.match(readiness, /^\|\s*roster_count\s*\|\s*5\s*\|/m);
  for (const { sku } of skuRecords) {
    assert.equal((readiness.match(new RegExp(`^### ${sku}\\b`, "gm")) ?? []).length, 1, `${sku} must appear once`);
    const record = sectionBetween(readiness, `### ${sku}`, "### ");
    for (const field of requiredSkuFields) {
      assert.match(record, new RegExp(`^\\|\\s*${field}\\s*\\|`, "mi"), `${sku} missing ${field}`);
    }
  }
});

test("each SKU keeps source-aligned identity separate from test-fixture facts", () => {
  const readiness = read(readinessPath);

  for (const entry of skuRecords) {
    const record = sectionBetween(readiness, `### ${entry.sku}`, "### ");
    assert.match(record, new RegExp(entry.sourcePage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(record, new RegExp(entry.sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(record, new RegExp(entry.fixtureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(record, new RegExp(`^\\|\\s*category\\s*\\|\\s*${entry.category}\\s*\\|`, "mi"));
    assert.match(record, /^\|\s*fact_source\s*\|\s*RBV_PRODUCT_INPUT_SAMPLES\//mi);
    assert.match(record, /^\|\s*source_page_ref\s*\|\s*https?:\/\//mi);
    assert.match(record, new RegExp(`^\\|\\s*evidence_ref\\s*\\|\\s*calibration/RBV-CAL-001/inputs/${entry.sku}\\s*\\|`, "mi"));
    assert.match(record, /source[-_ ]aligned|来源对齐|非权威/i);
  }

  const cleanser = sectionBetween(readiness, "### SKU-CAL-004", "### ");
  assert.match(cleanser, /Facial Cleanser Bottle/i);
  assert.match(cleanser, /非洁面乳|not.*洁面乳|not.*facial cleanser product/i);
  const backpack = sectionBetween(readiness, "### SKU-CAL-005", "### ");
  assert.match(backpack, /Meadow XL/i);
  assert.match(backpack, /revision[^\n]*(?:fixture|预制)|预制.*revision/i);
});

test("each SKU records material counts, formats, dimensions and composition", () => {
  const readiness = read(readinessPath);

  for (const entry of skuRecords) {
    const record = sectionBetween(readiness, `### ${entry.sku}`, "### ");
    assert.match(record, new RegExp(`^\\|\\s*material_count\\s*\\|\\s*${entry.materialCount}\\s*\\|`, "mi"));
    assert.match(record, new RegExp(`^\\|\\s*material_formats\\s*\\|[^\\n]*${entry.format}`, "mi"));
    assert.match(record, new RegExp(`^\\|\\s*material_dimensions\\s*\\|[^\\n]*${entry.dimensions}`, "mi"));
    assert.match(record, new RegExp(`^\\|\\s*material_composition\\s*\\|[^\\n]*${entry.composition}`, "mi"));
    assert.match(record, /material_status[^\n]*(?:verified_metadata|metadata_only|仅元数据|待权利核验)/i);
    assert.match(record, /^\|\s*max_points\s*\|\s*1200\s*\|/mi);
    assert.match(record, /^\|\s*status\s*\|\s*BLOCKED\s*\|/mi);
    assert.match(record, /^\|\s*facts_status\s*\|\s*BLOCKED[^\n]*\|/mi);
    assert.match(record, /^\|\s*internal_permission_status\s*\|\s*BLOCKED[^\n]*\|/mi);
  }
});

test("rights, manual targets and gate status remain blocked for all five SKUs", () => {
  const readiness = read(readinessPath);

  for (const entry of skuRecords) {
    const record = sectionBetween(readiness, `### ${entry.sku}`, "### ");
    assert.match(record, /^\|\s*rights_status\s*\|\s*BLOCKED_RIGHTS_UNVERIFIED\s*\|/mi);
    assert.match(record, new RegExp(`^\\|\\s*manual_review_target\\s*\\|[^\\n]*${entry.manualTarget}`, "mi"));
    assert.match(record, /^\|\s*gate_status\s*\|\s*BLOCKED\s*\|/mi);
    assert.match(record, /WEB_IMAGE_LICENSE_UNVERIFIED|网页图片许可未核验/i);
    assert.match(record, /FIXTURE_NAME|卖点|test fixture|测试构造/i);
    assert.doesNotMatch(record, /rights_status[^\n]*(?:APPROVED|READY|authorized)/i);
  }
  assert.match(readiness, /manual_revision[^\n]*(?:fixture|预制)|预制.*人工修正/i);
  assert.match(readiness, /不.*真实.*人工证据|not.*real.*manual evidence/i);
});

test("candidate person is precisely identified but remains unauthorized and outside Git", () => {
  const readiness = read(readinessPath);
  const absoluteUnixMarker = ["/", "Users", "/"].join("");

  assert.match(readiness, /^\|\s*person_alias\s*\|\s*RBV_PRIVATE_EVIDENCE_ROOT\s*\|/m);
  assert.match(readiness, /avatar\/rbv-avatar-placeholder-frontend-v1\.png/);
  assert.match(readiness, /^\|\s*person_format\s*\|\s*PNG\s*\|/m);
  assert.match(readiness, /^\|\s*person_dimensions\s*\|\s*1122x1402\s*\|/m);
  assert.match(readiness, /^\|\s*person_bytes\s*\|\s*1666036\s*\|/m);
  assert.match(readiness, /^\|\s*person_mode\s*\|\s*0600\s*\|/m);
  assert.match(readiness, /^\|\s*person_sha256\s*\|\s*0887c7e4748caf2f9735e7d7d1afd6788d2f3b6e4d3a9a53a9c88f1767093b10\s*\|/m);
  assert.match(readiness, /^\|\s*person_git_boundary\s*\|\s*outside_git\s*\|/m);
  assert.match(readiness, /Owner nominated|Owner 已提名/);
  assert.match(readiness, /internal.*permission|内部.*许可/);
  assert.match(readiness, /live upload.*unauthorized|实时上传.*未授权/);
  assert.doesNotMatch(readiness, new RegExp(absoluteUnixMarker));
  assert.doesNotMatch(readiness, /(^|\s)~\//);

  for (const { sku } of skuRecords) {
    const record = sectionBetween(readiness, `### ${sku}`, "### ");
    assert.match(record, /^\|\s*candidate_person\s*\|[^\n]*RBV_PRIVATE_EVIDENCE_ROOT[^\n]*avatar\//mi);
    assert.match(record, /^\|\s*person_status\s*\|\s*BLOCKED[^\n]*\|/mi);
    assert.match(record, /^\|\s*provider_input_status\s*\|\s*BLOCKED[^\n]*\|/mi);
  }
});

test("budget, window, evidence aliases and no-real-evidence boundary are frozen", () => {
  const readiness = read(readinessPath);

  for (const [field, value] of [
    ["batch_hard_cap_points", "6000"],
    ["per_sku_max_points", "1200"],
    ["concurrency", "1"],
    ["automatic_retry", "false"],
    ["operator_id", "OP-CAL-001"],
    ["run_date", "2026-08-29"],
    ["timezone", "Asia/Shanghai"],
    ["run_window", "Owner confirmation"],
  ]) {
    assert.match(readiness, new RegExp(`^\\|\\s*${field}\\s*\\|[^\\n]*${value}`, "mi"), `${field} must be locked`);
  }
  assert.match(readiness, /23:59:59\+08:00/);
  assert.match(readiness, /max exposure[^\n]*(?:not|不是).*spend authorization|最大暴露[^\n]*不是.*消费授权/i);
  assert.match(readiness, /^\|\s*non_author_operator\s*\|\s*pending\s*\|/mi);
  assert.match(readiness, /does not block Calibration readiness|不阻塞 Calibration readiness/i);
  assert.match(readiness, /blocks Repeatable|阻塞 Repeatable/i);
  assert.match(readiness, /^\|\s*evidence_alias\s*\|\s*RBV_PRIVATE_EVIDENCE_ROOT\s*\|/m);
  assert.match(readiness, /calibration\/RBV-CAL-001\/(?:inputs|provider|runtime|outputs|cost|qc|delivery)/);
  assert.match(readiness, /mode\s*0700|0700/);
  assert.match(readiness, /no real evidence|无真实证据/);
});

test("current real run is fail-closed for readiness, authorization and upstream gates", () => {
  const readiness = read(readinessPath);

  for (const blocker of [
    "LOGIN_RUNTIME_UNVERIFIED",
    "UPSTREAM_PRODUCT_FACTS_UNVERIFIED",
    "UPSTREAM_COPY_NOT_VERIFIED",
    "AVATAR_SELECTION_NOT_VERIFIED",
    "VIDEO_PLAN_NOT_VERIFIED",
    "ORDER_READINESS_NOT_VERIFIED",
    "PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED",
    "PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED",
    "POINTS_SPEND_UNAUTHORIZED",
  ]) {
    assert.match(readiness, new RegExp(blocker), `${blocker} must block a real run`);
  }
  for (const action of ["login", "upload", "generation", "Provider", "points", "deploy"]) {
    assert.match(readiness, new RegExp(`${action}[^\\n]*(?:unauthorized|未授权|fail[- ]closed|失败关闭)|(?:unauthorized|未授权|fail[- ]closed|失败关闭)[^\\n]*${action}`, "i"));
  }
  assert.match(readiness, /no.*ProductionOrder|不.*创建 ProductionOrder/i);
  assert.match(readiness, /no.*attempt|不.*attempt/i);
  assert.match(readiness, /no.*real.*action|未执行.*真实动作/i);
});

test("session records luna-worker configuration and honest runtime model status", () => {
  const session = read(sessionPath);

  assert.match(session, /custom agent[^\n]*luna-worker/i);
  assert.match(session, /gpt-5\.6-luna/);
  assert.match(session, /Max/);
  assert.match(session, /CONFIG_VERIFIED/);
  assert.match(session, /UNVERIFIED_RUNTIME_MODEL/);
  assert.match(session, /BLOCKED_PRE_REAL_RUN/);
  assert.match(session, /RED/);
  assert.match(session, /GREEN/);
  assert.match(session, /积分.*0|points.*0/i);
  assert.match(session, /no.*Provider|未.*Provider/i);
});

test("all closeout pointers retain Issue #275 and preserve the unique blocked readiness verdict", () => {
  for (const relativePath of [agentsPath, goalPath, collaborationPath, pilotPath, currentPath, roadmapPath, readinessPath, sessionPath]) {
    const content = read(relativePath);
    assert.match(content, /RBV-GOAL-001|RBV-CAL-001|RBV-002/);
    assert.match(content, /BLOCKED_PRE_REAL_RUN/);
  }
  for (const relativePath of [agentsPath, collaborationPath, currentPath, roadmapPath]) {
    assert.match(read(relativePath), /Issue #275/);
    assert.doesNotMatch(read(relativePath), /(?:当前唯一 active bounded engineering Stage|当前 bounded Stage)\s*(?:是|：|:)\s*Issue #275/i);
  }
});
