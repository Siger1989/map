import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "output", "geology-generator-v1", "outputs", "standard-input-v2");
const previewDir = path.join(outDir, "previews");
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const sectionPath = path.join(root, "output", "geology-generator-v1", "generated", "pm01-canonical", "normalized.json");
const drillPath = path.join(root, "output", "geology-drill-demo", "zk0003-data.json");
const sectionData = JSON.parse(await fs.readFile(sectionPath, "utf8"));
const drillData = JSON.parse(await fs.readFile(drillPath, "utf8"));
const fontName = "Arial";

const sectionColumns = [
  "记录号", "导线段号", "层号", "起读数_m", "止读数_m", "斜距_m", "坡角_deg", "方位角_deg",
  "倾向_deg", "倾角_deg", "岩性名称", "岩性描述", "样品编号", "样品距测段起点_m",
  "原表平距_m", "原表高差_m", "原表累计高差_m", "原表累计北_m", "原表累计东_m", "实测真厚度_m",
];
const sectionProjectParameters = ["项目名称", "剖面编号", "剖面方位角_deg", "长度单位", "角度单位"];
const drillProjectParameters = [
  "模板类型", "模板版本", "项目名称", "钻孔编号", "长度单位", "孔深基准", "终孔深度_m", "Au单位", "Pb单位", "Zn单位",
];
const drillColumns = {
  "分层": ["层号", "顶深_m", "底深_m", "岩性名称", "岩性描述", "岩心长_m", "花纹代码"],
  "回次": ["回次号", "顶深_m", "底深_m", "岩心长_m"],
  "样品": ["样品编号", "顶深_m", "底深_m", "岩心长_m", "Au", "Pb", "Zn"],
  "孔径": ["孔深_m", "孔径_mm"],
};

const sectionGuidance = [
  ["工作表", "字段", "必需性", "类型/单位", "填写说明"],
  ["项目", "项目名称", "选填", "文本", "项目或调查区名称。"],
  ["项目", "剖面编号", "选填", "文本", "剖面或测线编号。"],
  ["项目", "剖面方位角_deg", "条件必填", "数值/deg", "从正北顺时针；端点重合时须填写，范围 0≤角度<360。"],
  ["项目", "长度单位", "必填", "固定文本 m", "本版只接受 m。"],
  ["项目", "角度单位", "必填", "固定文本 deg", "本版只接受 deg。"],
  ...sectionColumns.map((field, i) => {
    const textFields = [0, 1, 2, 10, 11, 12].includes(i);
    const required = [1, 2, 5, 6, 7].includes(i);
    const optionalPair = [8, 9].includes(i);
    const notes = {
      "记录号": "记录的标识；可留空由系统处理。",
      "导线段号": "必填；相邻测段的端点应能衔接。",
      "层号": "必填；连续同层记录归为同一层段。",
      "斜距_m": "必填且大于 0；单位 m。",
      "坡角_deg": "必填，范围 -90 至 90；正值向上。",
      "方位角_deg": "必填，从正北顺时针，范围 0≤角度<360。",
      "倾向_deg": "与倾角成对选填；单独填写不形成完整产状。",
      "倾角_deg": "与倾向成对选填，范围 0 至 90。",
      "岩性名称": "选填；未知名称保留原文并提示待配置。",
      "岩性描述": "选填；保留完整原始描述。",
      "样品编号": "选填；编号本身不表示已知位置。",
      "样品距测段起点_m": "选填；距离本行测段起点的距离，范围 0 至斜距。",
      "原表平距_m": "选填核对值，不代替几何计算。",
      "原表高差_m": "选填核对值，不代替几何计算。",
      "原表累计高差_m": "选填核对值，不代替几何计算。",
      "原表累计北_m": "选填核对值，不代替几何计算。",
      "原表累计东_m": "选填核对值，不代替几何计算。",
      "实测真厚度_m": "仅填有明确实测依据的值；不得由图形推算。",
      "起读数_m": "选填；保留源表读数。",
      "止读数_m": "选填；保留源表读数。",
    };
    return ["测段", field, required ? "必填" : optionalPair ? "成对选填" : "选填", textFields ? "文本" : "数值/" + (field.endsWith("_deg") ? "deg" : "m"), notes[field] ?? "保留空白表示未提供。"];
  }),
  ["说明", "派生几何", "系统计算", "m", "水平距和高差由斜距、坡角计算；表内缓存列只用于核对。"],
  ["说明", "图案", "系统模板", "—", "图案用于区分材料，不表示行业标准认证；未知岩性保留待配置。"],
];

const drillGuidance = [
  ["工作表", "字段", "必需性", "类型/单位", "填写说明"],
  ["项目", "模板类型", "必填", "文本", "固定值：钻孔柱状图。"],
  ["项目", "模板版本", "必填", "文本", "固定值：1.0。"],
  ["项目", "项目名称", "选填", "文本", "无资料时留空。"],
  ["项目", "钻孔编号", "必填", "文本", "按原编号填写，保留前导零。"],
  ["项目", "长度单位", "必填", "文本", "固定值：m。"],
  ["项目", "孔深基准", "必填", "文本", "只填原始沿孔深或校正沿孔深；不自动校正。"],
  ["项目", "终孔深度_m", "必填", "数值/m", "必须大于 0；分层应连续覆盖 0 至终孔深度。"],
  ...["Au单位", "Pb单位", "Zn单位"].map((f) => ["项目", f, "条件必填", "文本", "相应分析列有数值时必填；未测时留空。"]),
  ["分层", "层号", "必填", "文本或数值编号", "每层唯一。"],
  ["分层", "顶深_m / 底深_m", "必填", "数值/m", "顶深小于底深；按顺序无重叠、无缺段，覆盖全孔。"],
  ["分层", "岩性名称", "选填", "文本", "未知名称保留原文；系统精确匹配已配置名称。"],
  ["分层", "岩性描述", "选填", "文本", "保留源描述、问号、斜杠和标点。"],
  ["分层", "岩心长_m", "选填", "数值/m", "空白代表未提供，不按 0 处理。"],
  ["分层", "花纹代码", "选填", "文本", "仅填写已配置代码；无代码时按精确岩性名称匹配。"],
  ["回次", "回次号 / 顶深_m / 底深_m / 岩心长_m", "整表选填", "编号 / 数值/m", "填写后四列均须有效且区间连续；整表覆盖 0 至终孔深度。可整表留空。"],
  ["样品", "样品编号", "有样品时必填", "文本", "保留原始编号；按深度定位，不按编号推断位置。"],
  ["样品", "顶深_m / 底深_m", "有样品时必填", "数值/m", "须在孔深范围内；复样区间可重叠。"],
  ["样品", "岩心长_m / Au / Pb / Zn", "选填", "数值/m 或分析值", "未知留空，不填 0；分析值不得为负，填写分析值时需填写相应单位。"],
  ["孔径", "孔深_m / 孔径_mm", "整表选填", "数值/m、数值/mm", "仅记录实测点；单点不推断全孔孔径。可整表留空。"],
  ["说明", "公式单元格", "禁止", "粘贴数值", "数据单元格勿使用公式；请粘贴为数值，避免缓存值误读。"],
  ["说明", "空行与额外列", "可用", "—", "空行忽略；额外列可保留，必需表头不可缺失或重复。"],
  ["说明", "层段长度", "说明", "沿孔长度", "底深减顶深为沿孔长度，不代表真厚度。"],
  ["说明", "示例岩性名称", "原文摘录", "文本", "第1、4、5层的名称从对应完整描述原文复制；花纹代码仍留空，由导入器按精确名称匹配。"],
];

function styleHeader(range) {
  range.format.fill = "#334155";
  range.format.font = { name: fontName, size: 10, bold: true, color: "#FFFFFF" };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
  range.format.borders = { preset: "all", style: "thin", color: "#FFFFFF" };
}
function styleBody(range) {
  range.format.font = { name: fontName, size: 10, color: "#1F2937" };
  range.format.verticalAlignment = "center";
}
function styleGuide(sheet, rows, widths) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:E${rows.length}`).values = rows;
  styleHeader(sheet.getRange("A1:E1"));
  styleBody(sheet.getRange(`A2:E${rows.length}`));
  sheet.getRange(`A2:E${rows.length}`).format.wrapText = true;
  sheet.getRange(`A2:E${rows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E2E8F0" } };
  widths.forEach((w, i) => sheet.getRangeByIndexes(0, i, rows.length, 1).format.columnWidth = w);
  sheet.getRange(`A2:E${rows.length}`).format.rowHeight = 34;
  sheet.getRange("A1:E1").format.rowHeight = 28;
  sheet.freezePanes.freezeRows(1);
}
function baseBook() { return Workbook.create(); }

async function makeSection(example) {
  const wb = baseBook();
  const project = wb.worksheets.add("项目");
  const segment = wb.worksheets.add("测段");
  const guide = wb.worksheets.add("说明");
  const projectValues = [
    ["参数", "值"],
    ["项目名称", example ? sectionData.project?.name ?? null : null],
    ["剖面编号", example ? sectionData.project?.section_id ?? null : null],
    ["剖面方位角_deg", example ? sectionData.settings?.axis_azimuth_deg ?? null : null],
    ["长度单位", "m"], ["角度单位", "deg"],
  ];
  project.showGridLines = false;
  project.getRange("A1:B6").values = projectValues;
  styleHeader(project.getRange("A1:B1")); styleBody(project.getRange("A2:B6"));
  project.getRange("A2:A6").format.font = { name: fontName, size: 10, bold: true, color: "#334155" };
  project.getRange("B2:B4").format.fill = example ? "#F8FAFC" : "#FFF7D6";
  project.getRange("B5:B6").format.fill = "#E8F1FA";
  project.getRange("A1:B6").format.borders = { preset: "outside", style: "thin", color: "#94A3B8" };
  project.getRange("A1:A6").format.columnWidth = 25;
  project.getRange("B1:B6").format.columnWidth = 38;
  project.getRange("A1:B6").format.rowHeight = 23;
  project.getRange("B4").format.numberFormat = "0.000";
  project.getRange("B4").dataValidation = { rule: { type: "decimal", operator: "between", formula1: 0, formula2: 359.999999 } };
  project.getRange("B5").dataValidation = { rule: { type: "list", values: ["m"] } };
  project.getRange("B6").dataValidation = { rule: { type: "list", values: ["deg"] } };
  project.freezePanes.freezeRows(1);

  const rows = example ? sectionData.records.map((r) => {
    const raw = r.raw ?? {};
    const value = (field, fallback = null) => {
      const cell = r.source_cells?.[field];
      return cell && Object.prototype.hasOwnProperty.call(raw, cell) ? raw[cell] : fallback;
    };
    const sample = (sectionData.samples ?? []).find((s) => s.record_id === r.id);
    return [r.id ?? null, r.leg_id ?? null, r.layer_id ?? null, value("start_reading_m"), value("end_reading_m"), r.length_m ?? null,
      r.slope_deg ?? null, r.azimuth_deg ?? null, r.dip_direction_deg ?? null, r.dip_angle_deg ?? null,
      r.lithology_name ?? null, r.description ?? null, sample?.id ?? value("sample_id"), sample?.source_cells?.sample_offset_m ? raw[sample.source_cells.sample_offset_m] ?? null : null,
      value("cache_horizontal_m"), value("cache_vertical_m"), value("cache_cumulative_z_m"), value("cache_cumulative_north_m"), value("cache_cumulative_east_m"), r.true_thickness_m ?? null];
  }) : [];
  segment.showGridLines = false;
  segment.getRange("A1:T1").values = [sectionColumns];
  styleHeader(segment.getRange("A1:T1"));
  const last = rows.length + 1;
  if (rows.length) {
    segment.getRange(`A2:T${last}`).values = rows;
    styleBody(segment.getRange(`A2:T${last}`));
    segment.getRange(`A2:T${last}`).format.rowHeight = 42;
    segment.getRange(`L2:L${last}`).format.wrapText = true;
  }
  segment.getRange("A1:C300").format.columnWidth = 14;
  segment.getRange("D1:J300").format.columnWidth = 15;
  segment.getRange("K1:K300").format.columnWidth = 19;
  segment.getRange("L1:L300").format.columnWidth = 38;
  segment.getRange("M1:M300").format.columnWidth = 18;
  segment.getRange("N1:T300").format.columnWidth = 20;
  segment.getRange("A1:T1").format.rowHeight = 42;
  if (last > 1) {
    segment.getRange(`D2:F${last}`).format.numberFormat = "0.000";
    segment.getRange(`G2:J${last}`).format.numberFormat = "0.000";
    segment.getRange(`N2:T${last}`).format.numberFormat = "0.000";
  }
  segment.freezePanes.freezeRows(1);
  segment.freezePanes.freezeColumns(3);
  styleGuide(guide, sectionGuidance, [13, 29, 15, 21, 82]);
  return wb;
}

function drillProject(example) {
  return [
    ["参数", "值"],
    ["模板类型", "钻孔柱状图"], ["模板版本", "1.0"],
    ["项目名称", null], ["钻孔编号", example ? drillData.meta.hole_id : null],
    ["长度单位", "m"], ["孔深基准", example ? "原始沿孔深" : null],
    ["终孔深度_m", example ? drillData.meta.endpoint_m : null],
    ["Au单位", null], ["Pb单位", null], ["Zn单位", null],
  ];
}
async function makeDrill(example) {
  const wb = baseBook();
  const project = wb.worksheets.add("项目");
  project.showGridLines = false;
  project.getRange("A1:B11").values = drillProject(example);
  styleHeader(project.getRange("A1:B1")); styleBody(project.getRange("A2:B11"));
  project.getRange("A2:A11").format.font = { name: fontName, size: 10, bold: true, color: "#334155" };
  project.getRange("A1:A11").format.columnWidth = 25;
  project.getRange("B1:B11").format.columnWidth = 34;
  project.getRange("A1:B11").format.rowHeight = 23;
  project.getRange("B2:B3").format.fill = "#E8F1FA";
  project.getRange("B6").format.fill = "#E8F1FA";
  project.getRange("B4:B5").format.fill = example ? "#F8FAFC" : "#FFF7D6";
  project.getRange("B7:B11").format.fill = example ? "#F8FAFC" : "#FFF7D6";
  project.getRange("B8").format.numberFormat = "0.000";
  project.getRange("B7").dataValidation = { rule: { type: "list", values: ["原始沿孔深", "校正沿孔深"] } };
  project.freezePanes.freezeRows(1);

  const dataRows = {
    "分层": example ? drillData.layers.map((r) => {
      const exactNames = ["泥岩夹泥质粉砂岩", "泥岩、泥质粉砂岩。", "砂岩夹粉砂岩"];
      const lithologyName = exactNames.includes(r.description) ? r.description : null;
      return [r.id, r.top_m, r.bottom_m, lithologyName, r.description ?? null, r.core_m ?? null, null];
    }) : [],
    "回次": example ? drillData.turns.map((r) => [r.id, r.top_m, r.bottom_m, r.core_m ?? null]) : [],
    "样品": example ? drillData.samples.map((r) => [r.id, r.top_m, r.bottom_m, r.core_m ?? null, null, null, null]) : [],
    "孔径": example ? drillData.structures.map((r) => [r.depth_m, r.diameter_mm]) : [],
  };
  const widths = { "分层": [12, 14, 14, 23, 76, 16, 16], "回次": [14, 15, 15, 18], "样品": [18, 15, 15, 18, 14, 14, 14], "孔径": [16, 18] };
  for (const [name, headers] of Object.entries(drillColumns)) {
    const sheet = wb.worksheets.add(name);
    sheet.showGridLines = false;
    sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
    styleHeader(sheet.getRangeByIndexes(0, 0, 1, headers.length));
    const rows = dataRows[name];
    const last = rows.length + 1;
    if (rows.length) {
      sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
      styleBody(sheet.getRangeByIndexes(1, 0, rows.length, headers.length));
      sheet.getRange(`A2:${String.fromCharCode(64 + headers.length)}${last}`).format.rowHeight = name === "分层" ? 44 : 22;
      if (name === "分层") sheet.getRange(`E2:E${last}`).format.wrapText = true;
    }
    widths[name].forEach((w, i) => sheet.getRangeByIndexes(0, i, Math.max(last, 120), 1).format.columnWidth = w);
    sheet.getRangeByIndexes(0, 0, 1, headers.length).format.rowHeight = 38;
    if (last > 1) {
      for (const col of ["顶深_m", "底深_m", "岩心长_m", "孔深_m"]) {
        const ix = headers.indexOf(col);
        if (ix >= 0) sheet.getRangeByIndexes(1, ix, rows.length, 1).format.numberFormat = "0.000";
      }
      if (name === "孔径") sheet.getRange(`B2:B${last}`).format.numberFormat = "0.0";
    }
    sheet.freezePanes.freezeRows(1);
    if (headers.length > 2) sheet.freezePanes.freezeColumns(1);
  }
  const guide = wb.worksheets.add("说明");
  styleGuide(guide, drillGuidance, [13, 33, 17, 24, 84]);
  return wb;
}

async function saveWorkbook(wb, filename) {
  const file = path.join(outDir, filename);
  const xlsx = await SpreadsheetFile.exportXlsx(wb);
  await xlsx.save(file);
  const inspect = await wb.inspect({ kind: "workbook,sheet,table", maxChars: 4000, tableMaxRows: 4, tableMaxCols: 8 });
  const errorScan = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
  const sheets = wb.worksheets.items;
  const previewPaths = [];
  for (const sheet of sheets) {
    const image = await wb.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
    const safe = sheet.name.replace(/[\\/:*?"<>|]/g, "_");
    const p = path.join(previewDir, `${path.basename(filename, ".xlsx")}-${safe}.png`);
    await fs.writeFile(p, new Uint8Array(await image.arrayBuffer()));
    previewPaths.push(p);
  }
  const check = await wb.inspect({ kind: "table", range: `${sheets[0].name}!A1:B11`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 8, maxChars: 5000 });
  const log = { filename, sheetNames: sheets.map((s) => s.name), previewPaths, inspect: inspect.ndjson, keyRange: check.ndjson, errors: errorScan.ndjson };
  await fs.appendFile(path.join(outDir, "verification.log"), JSON.stringify(log) + "\n", "utf8");
  return { file, log };
}

async function saveFixture(wb, filename, fixtureDir) {
  const file = path.join(fixtureDir, filename);
  const xlsx = await SpreadsheetFile.exportXlsx(wb);
  await xlsx.save(file);
  const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "fixture error scan" });
  const previews = [];
  for (const sheet of wb.worksheets.items) {
    const image = await wb.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
    const preview = path.join(fixtureDir, "previews", `${path.basename(filename, ".xlsx")}-${sheet.name}.png`);
    await fs.mkdir(path.dirname(preview), { recursive: true });
    await fs.writeFile(preview, new Uint8Array(await image.arrayBuffer()));
    previews.push(preview);
  }
  const key = await wb.inspect({ kind: "workbook,sheet,table", maxChars: 2400, tableMaxRows: 4, tableMaxCols: 8 });
  await fs.appendFile(path.join(fixtureDir, "verification.log"), JSON.stringify({ file, sheets: wb.worksheets.items.map((s) => s.name), inspect: key.ndjson, errors: errors.ndjson, previews }) + "\n", "utf8");
  return { file, previews };
}

function newSectionFixture() {
  const wb = Workbook.create();
  const project = wb.worksheets.add("项目");
  const segment = wb.worksheets.add("测段");
  const values = [
    ["参数", "值"], ["项目名称", null], ["剖面编号", "TEST-SECTION-02"],
    ["剖面方位角_deg", 90], ["长度单位", "m"], ["角度单位", "deg"],
  ];
  project.showGridLines = false;
  project.getRange("A1:B6").values = values;
  styleHeader(project.getRange("A1:B1")); styleBody(project.getRange("A2:B6"));
  project.getRange("A1:A6").format.columnWidth = 25; project.getRange("B1:B6").format.columnWidth = 36;
  project.getRange("B4").format.numberFormat = "0.000";
  segment.showGridLines = false;
  segment.getRange("A1:T3").values = [
    sectionColumns,
    ["R1", "0-1", "L1", 0, 10, 10, 0, 90, 270, 20, "泥岩夹泥质粉砂岩", "泥岩夹泥质粉砂岩", "T1", 2, null, null, null, null, null, null],
    ["R2", "1-2", "L2", 0, 5, 5, 30, 90, 270, 30, "砂岩夹粉砂岩", "砂岩夹粉砂岩", null, null, null, null, null, null, null, null],
  ];
  styleHeader(segment.getRange("A1:T1")); styleBody(segment.getRange("A2:T3"));
  segment.getRange("A1:T1").format.rowHeight = 42;
  segment.getRange("L2:L3").format.wrapText = true;
  segment.getRange("A1:C20").format.columnWidth = 14; segment.getRange("D1:J20").format.columnWidth = 15;
  segment.getRange("K1:K20").format.columnWidth = 25; segment.getRange("L1:L20").format.columnWidth = 32;
  segment.getRange("M1:T20").format.columnWidth = 18;
  segment.getRange("A2:T3").format.rowHeight = 32;
  project.freezePanes.freezeRows(1); segment.freezePanes.freezeRows(1); segment.freezePanes.freezeColumns(3);
  return wb;
}

function newDrillFixture() {
  const wb = Workbook.create();
  const project = wb.worksheets.add("项目");
  project.showGridLines = false;
  project.getRange("A1:B11").values = [
    ["参数", "值"], ["模板类型", "钻孔柱状图"], ["模板版本", "1.0"], ["项目名称", null],
    ["钻孔编号", "ZK-TEST-02"], ["长度单位", "m"], ["孔深基准", "原始沿孔深"], ["终孔深度_m", 7],
    ["Au单位", "g/t"], ["Pb单位", null], ["Zn单位", null],
  ];
  styleHeader(project.getRange("A1:B1")); styleBody(project.getRange("A2:B11"));
  project.getRange("A1:A11").format.columnWidth = 25; project.getRange("B1:B11").format.columnWidth = 34;
  project.getRange("B8").format.numberFormat = "0.000";
  const sheets = {
    "分层": [drillColumns["分层"],
      ["A", 0, 1.5, "泥岩夹泥质粉砂岩", "泥岩夹泥质粉砂岩", 1.4, null],
      ["B", 1.5, 1.52, "砂岩夹粉砂岩", "砂岩夹粉砂岩", 0.015, null],
      ["C", 1.52, 7, "新岩性名称待定义", "新岩性名称待定义", null, null]],
    "回次": [drillColumns["回次"], [1, 0, 2, 1.8], [2, 2, 7, 4.4]],
    "样品": [drillColumns["样品"], ["S1", 0.5, 1, 0.4, 0.15, null, null], ["S2", 0.7, 1.2, 0.4, null, null, null], ["S3", 6.9, 7, 0.1, null, null, null]],
    "孔径": [drillColumns["孔径"], [7, 91]],
  };
  const widths = { "分层": [12, 14, 14, 26, 32, 16, 16], "回次": [14, 15, 15, 18], "样品": [18, 15, 15, 18, 14, 14, 14], "孔径": [16, 18] };
  for (const [name, matrix] of Object.entries(sheets)) {
    const sheet = wb.worksheets.add(name); sheet.showGridLines = false;
    sheet.getRangeByIndexes(0, 0, matrix.length, matrix[0].length).values = matrix;
    styleHeader(sheet.getRangeByIndexes(0, 0, 1, matrix[0].length));
    if (matrix.length > 1) styleBody(sheet.getRangeByIndexes(1, 0, matrix.length - 1, matrix[0].length));
    widths[name].forEach((w, i) => sheet.getRangeByIndexes(0, i, Math.max(matrix.length, 20), 1).format.columnWidth = w);
    sheet.getRangeByIndexes(0, 0, 1, matrix[0].length).format.rowHeight = 40;
    if (name === "分层") sheet.getRange("E2:E4").format.wrapText = true;
    if (name === "分层") sheet.getRange("B2:C4").format.numberFormat = "0.000";
    if (name === "回次") sheet.getRange("B2:D3").format.numberFormat = "0.000";
    if (name === "样品") sheet.getRange("B2:G4").format.numberFormat = "0.000";
    if (name === "孔径") sheet.getRange("A2:A2").format.numberFormat = "0.000";
    sheet.freezePanes.freezeRows(1); sheet.freezePanes.freezeColumns(1);
  }
  return wb;
}

const fixtureMode = process.argv.includes("--fixtures");
if (fixtureMode) {
  const fixtureDir = path.join(root, "output", "geology-generator-v1", "logs", "v2-fixtures");
  await fs.mkdir(fixtureDir, { recursive: true });
  const fixtures = [await saveFixture(newDrillFixture(), "drill_alt.xlsx", fixtureDir), await saveFixture(newSectionFixture(), "section_alt.xlsx", fixtureDir)];
  console.log(JSON.stringify({ fixtures, verificationLog: path.join(fixtureDir, "verification.log") }, null, 2));
} else {
  const outputs = [
    await saveWorkbook(await makeSection(false), "实测剖面-标准模板.xlsx"),
    await saveWorkbook(await makeSection(true), "实测剖面-填写示例.xlsx"),
    await saveWorkbook(await makeDrill(false), "钻孔柱状图-标准模板.xlsx"),
    await saveWorkbook(await makeDrill(true), "钻孔柱状图-填写示例.xlsx"),
  ];

  const note = `地质绘图标准 Excel 输入说明 v2\n\n文件\n- 实测剖面-标准模板.xlsx：项目参数和测段表头已建立，数据区为空。\n- 实测剖面-填写示例.xlsx：取自 PM01 规范数据，43 条记录、14 个样品位置来源；未测字段保留空白。\n- 钻孔柱状图-标准模板.xlsx：钻孔标准输入结构，数据表只有表头。\n- 钻孔柱状图-填写示例.xlsx：取自 ZK0003 未校正沿孔深底稿，终孔 382.79 m、23 层、131 回次、97 样品、1 个孔径点。\n\n导入时应使用对应图种的标准工作簿。剖面字段和项目参数与 importer.py 的 PROJECT_PARAMETERS、CANONICAL_COLUMNS 一致。钻孔模板遵循 drill-1.0 契约。字段类型、必填性和填写规则见各工作簿“说明”页。\n\n钻孔示例第1、4、5层的岩性名称分别从对应完整描述“泥岩夹泥质粉砂岩”“泥岩、泥质粉砂岩。”“砂岩夹粉砂岩”原文复制；花纹代码留空，由导入器按精确名称匹配。其他层只保留原描述，不臆造岩性名称。所有描述中的问号、斜杠和标点均保留。Au、Pb、Zn结果与单位未提供，保持空白。源分层表中的 G 列为空，因此不补造编码。项目名称未提供，留空。该示例采用原始沿孔深基准；源文件中其他终孔深度和比例记载存在冲突，本示例不做校正或比例推断。\n\n模板数据区不放置说明占位行或虚构记录。数值按数字单元格保存，编号按文本保存。空白不代表数值 0。层段长按底深减顶深解释为沿孔长度，不代表真厚度。\n`;
  await fs.writeFile(path.join(outDir, "标准模板说明.txt"), note, "utf8");
  console.log(JSON.stringify({ outputs: outputs.map((x) => x.file), previews: outputs.flatMap((x) => x.log.previewPaths), log: path.join(outDir, "verification.log") }, null, 2));
}
