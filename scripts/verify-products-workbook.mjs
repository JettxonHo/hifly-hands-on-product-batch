import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "products/商品信息表.xlsx";
const outputDir = "tmp/workbook-preview";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

await fs.mkdir(outputDir, { recursive: true });

for (const sheetName of ["商品信息", "填写说明"]) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png"
  });
  const bytes = new Uint8Array(await preview.arrayBuffer());
  const outputPath = `${outputDir}/${sheetName}.png`;
  await fs.writeFile(outputPath, bytes);
  console.log(`Rendered ${outputPath}`);
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan"
});
console.log(errors.ndjson || "No formula errors found.");
