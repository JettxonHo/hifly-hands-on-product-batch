import fs from "node:fs/promises";
import path from "node:path";

const SCENES_BY_CATEGORY = Object.freeze({
  fresh_food: "明亮温室、菜市场、厨房或餐桌旁",
  beauty: "明亮洗手台、梳妆台或浴室干区",
  snacks: "办公桌、客厅茶几或便利店感货架",
  household: "整洁厨房、客厅或收纳柜旁",
  mother_baby: "明亮家庭空间、儿童房或客厅",
  sports: "健身房、户外步道或运动装备区",
  default: "真实干净的生活场景"
});

const QC_HEADERS = [
  "sku",
  "product_name",
  "video_path",
  "duration",
  "product_ok",
  "script_ok",
  "subtitle_ok",
  "final_status",
  "notes"
];

export async function generateStandardVideoAssets({
  products,
  outputRoot,
  includeStatuses = ["", "pending", "failed"]
}) {
  if (!Array.isArray(products)) throw new TypeError("products must be an array");
  if (!outputRoot) throw new TypeError("outputRoot is required");

  const selected = products.filter((product) => includeStatuses.includes(normalizeStatus(product.status)));
  const directories = {
    root: outputRoot,
    scripts: path.join(outputRoot, "scripts"),
    prompts: path.join(outputRoot, "prompts"),
    qc: path.join(outputRoot, "qc")
  };

  await Promise.all(Object.values(directories).map((dir) => fs.mkdir(dir, { recursive: true })));

  const qcRows = [QC_HEADERS];
  const assets = [];

  for (const product of selected) {
    const baseName = assetBaseName(product);
    const script = buildScript(product);
    const prompt = buildPrompt(product);
    const scriptPath = path.join(directories.scripts, `${baseName}_script.txt`);
    const promptPath = path.join(directories.prompts, `${baseName}_prompt.txt`);

    await fs.writeFile(scriptPath, `${script}\n`, "utf8");
    await fs.writeFile(promptPath, `${prompt}\n`, "utf8");

    qcRows.push([
      product.sku || "",
      product.product_name || "",
      "",
      product.duration_seconds || "",
      "",
      "",
      "",
      "pending_qc",
      ""
    ]);

    assets.push({
      sku: product.sku || "",
      product_name: product.product_name || "",
      scriptPath,
      promptPath,
      script,
      prompt
    });
  }

  const qcReportPath = path.join(directories.qc, "qc_report.csv");
  await fs.writeFile(qcReportPath, `${toCsv(qcRows)}\n`, "utf8");

  return { count: selected.length, outputRoot, qcReportPath, assets };
}

export function buildScript(product) {
  const provided = String(product.script || "").trim();
  if (provided) return provided;

  const name = clean(product.product_name) || "这款产品";
  const points = parseSellingPoints(product.selling_points);
  const [point1, point2, point3] = fillPoints(points);
  const scenePain = scenePainFor(product.category);
  const useScene = useSceneFor(product.category);
  const benefit = benefitFrom(point1);

  return [
    `最近${scenePain}的人，可以看看这个${name}。`,
    `它${point1}，比较适合${useScene}，${point2}用起来更省心。`,
    `如果你平时在意${benefit}，${point3}这一点会很加分。`,
    "日常使用很顺手，想要省心一点的，可以先收藏看看。"
  ].join("");
}

export function buildPrompt(product) {
  const name = clean(product.product_name) || "产品";
  const points = parseSellingPoints(product.selling_points);
  const scene = sceneFor(product.category);
  const pointText = points.length > 0 ? points.join("、") : "产品核心卖点";

  return [
    "竖屏9:16电商种草短视频，左右分屏构图，中间白色竖向分隔线。",
    `左侧是一位亲和自然的年轻女性数字人，在真实场景里面对镜头口播，场景参考：${scene}，表情自然，动作轻微，穿着干净简洁。`,
    `右侧是手持${name}的近景展示，商品主体清晰完整，尽量保持商品包装和外观与参考图一致，手部自然，真实光线，轻微镜头晃动。`,
    "整体风格真实、干净、自然光、电商产品推荐视频，不夸张，不卡通，不科幻。",
    `口播内容围绕：${pointText}。`,
    "负面提示词：不要生成卡通风格，不要过度美颜，不要夸张表演，不要让商品变形，不要改变包装文字，不要多手指，不要手指穿过商品，不要模糊商品，不要遮挡商品主体，不要出现无关品牌，不要出现医疗功效暗示。"
  ].join("\n");
}

export function parseSellingPoints(value) {
  return String(value || "")
    .split(/[;；,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function fillPoints(points) {
  const fallback = ["细节扎实", "日常使用方便", "体验更省心"];
  return [0, 1, 2].map((index) => points[index] || fallback[index]);
}

function sceneFor(category) {
  return SCENES_BY_CATEGORY[normalizeCategory(category)] || SCENES_BY_CATEGORY.default;
}

function scenePainFor(category) {
  const key = normalizeCategory(category);
  if (key === "fresh_food") return "买菜怕不新鲜";
  if (key === "beauty") return "换季护肤怕黏腻";
  if (key === "snacks") return "下午想找点轻松加餐";
  if (key === "household") return "家里收拾起来嫌麻烦";
  if (key === "mother_baby") return "给家里孩子选东西怕踩雷";
  if (key === "sports") return "运动装备想买得更省心";
  return "想买得更省心";
}

function useSceneFor(category) {
  const key = normalizeCategory(category);
  if (key === "fresh_food") return "家里做饭";
  if (key === "beauty") return "日常护肤";
  if (key === "snacks") return "办公室或居家加餐";
  if (key === "household") return "家庭日用";
  if (key === "mother_baby") return "日常照护";
  if (key === "sports") return "日常运动";
  return "日常使用";
}

function benefitFrom(point) {
  if (!point) return "实际体验";
  return point.replace(/[。.!！?？,，;；]$/u, "");
}

function normalizeCategory(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function assetBaseName(product) {
  const sku = sanitizeFilePart(product.sku || "SKU");
  const name = sanitizeFilePart(product.product_name || "product");
  return `${sku}_${name}_standard`;
}

function sanitizeFilePart(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "item";
}

function clean(value) {
  return String(value || "").trim();
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}
