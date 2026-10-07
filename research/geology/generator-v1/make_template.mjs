import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliArgs = process.argv.slice(2);
const dataArgIndex = cliArgs.indexOf("--data");
const dataPath = dataArgIndex >= 0 ? path.resolve(process.cwd(), cliArgs[dataArgIndex + 1] ?? "") : null;
if (dataArgIndex >= 0 && !cliArgs[dataArgIndex + 1]) throw new Error("--data requires a normalized JSON path");
const sourceData = dataPath ? JSON.parse(await fs.readFile(dataPath, "utf8")) : null;
const outputDir = path.join(scriptDir, "outputs", "geology-template-v1");
const outputName = sourceData ? "PM01规范输入.xlsx" : "实测剖面输入模板.xlsx";
const previewDir = path.join(scriptDir, ".verification", "geology-template-v1", sourceData ? "pm01" : "blank");
const xlsxPath = path.join(outputDir, outputName);
const notePath = path.join(outputDir, "规范说明.txt");
const fontName = "Arial";
const materialLibrary = JSON.parse(await fs.readFile(path.join(scriptDir, "templates", "materials.json"), "utf8"));
const materialNames = Object.keys(materialLibrary.materials ?? {});

const projectRows = [
  ["参数", "值"],
  ["项目名称", sourceData?.project?.name ?? null],
  ["剖面编号", sourceData?.project?.section_id ?? null],
  ["剖面方位角_deg", sourceData?.settings?.axis_azimuth_deg ?? null],
  ["长度单位", "m"],
  ["角度单位", "deg"],
];

const segmentHeaders = [
  "记录号", "导线段号", "层号", "起读数_m", "止读数_m", "斜距_m", "坡角_deg", "方位角_deg",
  "倾向_deg", "倾角_deg", "岩性名称", "岩性描述", "样品编号", "样品距测段起点_m",
  "原表平距_m", "原表高差_m", "原表累计高差_m", "原表累计北_m", "原表累计东_m", "实测真厚度_m",
];

function firstPresent(object, keys) {
  if (!object || typeof object !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== "") return object[key];
  }
  return null;
}

function rawValue(record, keys) {
  const raw = record?.raw;
  if (!raw) return null;
  if (!Array.isArray(raw)) return firstPresent(raw, keys);
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const label = entry.header ?? entry.name ?? entry.field ?? entry.key;
      if (keys.includes(label)) return entry.value ?? entry.raw_value ?? null;
    }
  }
  return null;
}

function sourceValue(record, sourceKey) {
  const ref = record?.source_cells?.[sourceKey];
  if (!ref || !record?.raw || Array.isArray(record.raw)) return null;
  return record.raw[ref] ?? null;
}

const samplesByRecord = new Map();
for (const sample of sourceData?.samples ?? []) {
  if (!samplesByRecord.has(sample.record_id)) samplesByRecord.set(sample.record_id, sample);
}

const segmentRows = (sourceData?.records ?? []).map((record) => {
  const sample = samplesByRecord.get(record.id);
  const sampleOffset = firstPresent(sample, ["distance_from_record_start_m", "slant_offset_m", "position_in_record_m"])
    ?? (sample?.source_cells?.sample_offset_m && record.raw?.[sample.source_cells.sample_offset_m])
    ?? sourceValue(record, "sample_offset_m")
    ?? rawValue(record, ["样品距测段起点_m", "样品距测段起点", "sample_offset_m"]);
  return [
    record.id ?? null,
    record.leg_id ?? null,
    record.layer_id ?? null,
    sourceValue(record, "start_reading_m") ?? rawValue(record, ["起读数_m", "起读数", "start_reading_m"]),
    sourceValue(record, "end_reading_m") ?? rawValue(record, ["止读数_m", "止读数", "end_reading_m"]),
    record.length_m ?? null,
    record.slope_deg ?? null,
    record.azimuth_deg ?? null,
    record.dip_direction_deg ?? null,
    record.dip_angle_deg ?? null,
    record.lithology_name ?? null,
    record.description ?? null,
    sample?.id ?? sourceValue(record, "sample_id") ?? rawValue(record, ["样品编号", "sample_id"]),
    sampleOffset,
    sourceValue(record, "cache_horizontal_m") ?? rawValue(record, ["原表平距_m", "平距", "horizontal_m"]),
    sourceValue(record, "cache_vertical_m") ?? rawValue(record, ["原表高差_m", "高差", "vertical_m"]),
    sourceValue(record, "cache_cumulative_z_m") ?? rawValue(record, ["原表累计高差_m", "累计高差", "cumulative_vertical_m"]),
    sourceValue(record, "cache_cumulative_north_m") ?? rawValue(record, ["原表累计北_m", "累计北", "cumulative_north_m"]),
    sourceValue(record, "cache_cumulative_east_m") ?? rawValue(record, ["原表累计东_m", "累计东", "cumulative_east_m"]),
    record.true_thickness_m ?? sourceValue(record, "true_thickness_m") ?? rawValue(record, ["实测真厚度_m", "实测真厚度", "true_thickness_m"]),
  ];
});

const guidanceRows = [
  ["工作表", "字段", "必需性", "类型/单位", "缺失处理", "来源类别", "说明"],
  ["项目", "项目名称", "建议填写", "文本", "可留空", "源输入", "项目名称，不参与几何计算。"],
  ["项目", "剖面编号", "建议填写", "文本", "可留空", "源输入", "剖面或测线编号。"],
  ["项目", "剖面方位角_deg", "条件必需", "数值/deg", "空白时由首末点连线计算；端点重合时必须明确填写", "明示设置或计算", "从正北起顺时针，范围 [0,360)。"],
  ["项目", "长度单位", "必需", "固定文本", "不得缺失", "明示设置", "本版只接受 m。"],
  ["项目", "角度单位", "必需", "固定文本", "不得缺失", "明示设置", "本版只接受 deg。"],
  ["测段", "记录号", "建议填写", "文本", "可自动编号并警告", "源输入", "每一测量记录的唯一标识。"],
  ["测段", "导线段号", "必需", "文本", "缺失时几何无效", "源输入", "应能拆分为相接的起点-终点；不能拆分时系统明确自动编号并警告。"],
  ["测段", "层号", "必需", "文本", "缺失时记录无效", "源输入", "连续同层记录组成一个层段；同编号非连续出现不自动合并。"],
  ["测段", "起读数_m", "可选", "数值/m", "保留空白", "源输入", "原始读数，不代替斜距。"],
  ["测段", "止读数_m", "可选", "数值/m", "保留空白", "源输入", "原始读数，不代替斜距。"],
  ["测段", "斜距_m", "必需", "数值/m", "缺失或不大于 0 时阻止绘制", "源输入", "测段斜距 D，必须 D>0。"],
  ["测段", "坡角_deg", "必需", "数值/deg", "缺失时阻止绘制", "源输入", "范围 [-90,90]；正值向上，负值向下。"],
  ["测段", "方位角_deg", "必需", "数值/deg", "缺失时阻止绘制", "源输入", "从正北起顺时针，范围 [0,360)。"],
  ["测段", "倾向_deg", "成对可选", "数值/deg", "与倾角任一缺失时不形成完整产状并提示", "源输入", "从正北起顺时针，范围 [0,360)。关联位置为本行起点，不代表独立实测坐标。"],
  ["测段", "倾角_deg", "成对可选", "数值/deg", "与倾向任一缺失时不形成完整产状并提示", "源输入", "范围 [0,90]。"],
  ["测段", "岩性名称", "建议填写", "文本", "未知名称保留待配置", "源输入", "须与项目材料模板的精确名称一致；相似名称不模糊匹配。"],
  ["测段", "岩性描述", "可选", "文本", "可留空", "源输入", "完整描述；名称可单独填写。"],
  ["测段", "样品编号", "可选", "文本", "可留空", "源输入", "填写编号不等于已有图上位置。"],
  ["测段", "样品距测段起点_m", "样品定位可选", "数值/m", "缺失时样品只入清单并标记定位缺失，不上图", "源输入", "仅在本行测段内，范围 0 到本行斜距 D；不得按全剖面累计距填写。"],
  ["测段", "原表平距_m", "可选核对", "数值/m", "保留空白", "源输入/核对", "缓存值只用于与独立计算比较，不覆盖源值。"],
  ["测段", "原表高差_m", "可选核对", "数值/m", "保留空白", "源输入/核对", "缓存值只用于残差核对。"],
  ["测段", "原表累计高差_m", "可选核对", "数值/m", "保留空白", "源输入/核对", "缓存累计值，不作为缺失几何的替代。"],
  ["测段", "原表累计北_m", "可选核对", "数值/m", "保留空白", "源输入/核对", "缓存累计值，不作为缺失几何的替代。"],
  ["测段", "原表累计东_m", "可选核对", "数值/m", "保留空白", "源输入/核对", "缓存累计值，不作为缺失几何的替代。"],
  ["测段", "实测真厚度_m", "可选", "数值/m", "没有明确实测数据时保持空白", "源输入", "不得由图宽、纹理厚度、其他列或几何外观推断。"],
  ["说明", "派生几何", "系统计算", "m", "必需源字段缺失时不计算", "计算", "水平距 G=D*cos(坡角)，高差 H=D*sin(坡角)，东分量 dE=G*sin(方位角)，北分量 dN=G*cos(方位角)。使用未舍入数值。"],
  ["说明", "图面排版", "系统处理", "—", "不用于补全源数据", "排版", "标签和引线可为避让移动；文字位置不表示新的地质测点。"],
  ["说明", "材料图案", "系统模板", "—", "未知名称显示待配置", "排版", "图案是本项目符号库，用于区分材料；不表示国家、行业或机构标准认证。岩性编码带带宽不表示厚度。"],
  ["说明", "已支持岩性名称", "精确匹配", "文本", "名单外名称保留待配置", "项目模板", materialNames.join("、")],
  ["说明", "参考信息", "参考", "—", "—", "外部参考", "MT/T 1043—2007 附录 B.3： https://www.chinamine-safety.gov.cn/zfxxgk/fdzdgknr/zcfg/hybz_01/mkanj/202004/P020200422403006584531.pdf#page=16 。仅作信息类别参考，不构成合规保证。"],
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
  range.format.verticalAlignment = "top";
}

const workbook = Workbook.create();
const projectSheet = workbook.worksheets.add("项目");
const segmentSheet = workbook.worksheets.add("测段");
const guidanceSheet = workbook.worksheets.add("说明");
const provenanceSheet = sourceData ? workbook.worksheets.add("来源") : null;

projectSheet.showGridLines = false;
projectSheet.getRange("A1:B6").values = projectRows;
styleHeader(projectSheet.getRange("A1:B1"));
styleBody(projectSheet.getRange("A2:B6"));
projectSheet.getRange("A2:A6").format.font = { name: fontName, size: 10, bold: true, color: "#334155" };
projectSheet.getRange("B2:B4").format.fill = "#FFF7D6";
projectSheet.getRange("B5:B6").format.fill = "#E8F1FA";
projectSheet.getRange("A1:B6").format.borders = { preset: "outside", style: "thin", color: "#94A3B8" };
projectSheet.getRange("A1:A6").format.columnWidth = 24;
projectSheet.getRange("B1:B6").format.columnWidth = 34;
projectSheet.getRange("A1:B6").format.rowHeight = 23;
projectSheet.getRange("B4").format.numberFormat = "0.000";
projectSheet.getRange("B4").dataValidation = { rule: { type: "decimal", operator: "between", formula1: 0, formula2: 359.999999 } };
projectSheet.getRange("B5").dataValidation = { rule: { type: "list", values: ["m"] } };
projectSheet.getRange("B6").dataValidation = { rule: { type: "list", values: ["deg"] } };
projectSheet.freezePanes.freezeRows(1);

segmentSheet.showGridLines = false;
segmentSheet.getRange("A1:T1").values = [segmentHeaders];
if (segmentRows.length) segmentSheet.getRangeByIndexes(1, 0, segmentRows.length, segmentHeaders.length).values = segmentRows;
styleHeader(segmentSheet.getRange("A1:T1"));
segmentSheet.getRange("A1:T1").format.rowHeight = 42;
const inputLastRow = Math.max(201, segmentRows.length + 1);
const inputRange = segmentSheet.getRange(`A2:T${inputLastRow}`);
styleBody(inputRange);
inputRange.format.fill = "#FFFDF3";
inputRange.format.borders = { insideHorizontal: { style: "dotted", color: "#E2E8F0" }, bottom: { style: "thin", color: "#CBD5E1" } };
inputRange.format.rowHeight = 21;
if (segmentRows.length) segmentSheet.getRange(`A2:T${segmentRows.length + 1}`).format.rowHeight = 78;
segmentSheet.getRange(`A2:C${inputLastRow}`).format.numberFormat = "@";
segmentSheet.getRange(`K2:M${inputLastRow}`).format.numberFormat = "@";
segmentSheet.getRange(`D2:J${inputLastRow}`).format.numberFormat = "0.000";
segmentSheet.getRange(`N2:T${inputLastRow}`).format.numberFormat = "0.000";
segmentSheet.getRange(`F2:F${inputLastRow}`).dataValidation = { rule: { type: "decimal", operator: "greaterThan", formula1: 0 } };
segmentSheet.getRange(`G2:G${inputLastRow}`).dataValidation = { rule: { type: "decimal", operator: "between", formula1: -90, formula2: 90 } };
segmentSheet.getRange(`H2:I${inputLastRow}`).dataValidation = { rule: { type: "decimal", operator: "between", formula1: 0, formula2: 359.999999 } };
segmentSheet.getRange(`J2:J${inputLastRow}`).dataValidation = { rule: { type: "decimal", operator: "between", formula1: 0, formula2: 90 } };
segmentSheet.getRange(`A1:T${inputLastRow}`).format.verticalAlignment = "center";
segmentSheet.getRange(`L2:L${inputLastRow}`).format.wrapText = true;
segmentSheet.getRange(`A1:C${inputLastRow}`).format.columnWidth = 14;
segmentSheet.getRange(`D1:J${inputLastRow}`).format.columnWidth = 14;
segmentSheet.getRange(`K1:K${inputLastRow}`).format.columnWidth = 18;
segmentSheet.getRange(`L1:L${inputLastRow}`).format.columnWidth = 34;
segmentSheet.getRange(`M1:M${inputLastRow}`).format.columnWidth = 16;
segmentSheet.getRange(`N1:T${inputLastRow}`).format.columnWidth = 18;
segmentSheet.freezePanes.freezeRows(1);
segmentSheet.freezePanes.freezeColumns(3);

guidanceSheet.showGridLines = false;
guidanceSheet.getRange(`A1:G${guidanceRows.length}`).values = guidanceRows;
styleHeader(guidanceSheet.getRange("A1:G1"));
styleBody(guidanceSheet.getRange(`A2:G${guidanceRows.length}`));
guidanceSheet.getRange(`A2:G${guidanceRows.length}`).format.wrapText = true;
guidanceSheet.getRange(`A2:G${guidanceRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E2E8F0" } };
guidanceSheet.getRange("A1:A30").format.columnWidth = 12;
guidanceSheet.getRange("B1:B30").format.columnWidth = 25;
guidanceSheet.getRange("C1:C30").format.columnWidth = 16;
guidanceSheet.getRange("D1:D30").format.columnWidth = 18;
guidanceSheet.getRange("E1:E30").format.columnWidth = 38;
guidanceSheet.getRange("F1:F30").format.columnWidth = 18;
guidanceSheet.getRange("G1:G30").format.columnWidth = 76;
guidanceSheet.getRange(`A2:G${guidanceRows.length}`).format.rowHeight = 46;
guidanceSheet.getRange("A1:G1").format.rowHeight = 28;
guidanceSheet.freezePanes.freezeRows(1);

if (provenanceSheet) {
  const provenanceHeaders = ["记录号", "源文件", "源工作表", "源单元格映射_json", "原始记录_json"];
  const provenanceRows = (sourceData.records ?? []).map((record) => [
    record.id ?? null,
    sourceData.source?.filename ?? null,
    sourceData.source?.sheet ?? null,
    JSON.stringify(record.source_cells ?? {}, null, 0),
    JSON.stringify(record.raw ?? {}, null, 0),
  ]);
  provenanceSheet.showGridLines = false;
  provenanceSheet.getRange("A1:E1").values = [provenanceHeaders];
  if (provenanceRows.length) provenanceSheet.getRangeByIndexes(1, 0, provenanceRows.length, provenanceHeaders.length).values = provenanceRows;
  styleHeader(provenanceSheet.getRange("A1:E1"));
  const provenanceLastRow = Math.max(2, provenanceRows.length + 1);
  styleBody(provenanceSheet.getRange(`A2:E${provenanceLastRow}`));
  provenanceSheet.getRange(`A2:C${provenanceLastRow}`).format.wrapText = true;
  provenanceSheet.getRange(`D2:E${provenanceLastRow}`).format.wrapText = false;
  provenanceSheet.getRange("A1:A2").format.columnWidth = 16;
  provenanceSheet.getRange("B1:B2").format.columnWidth = 34;
  provenanceSheet.getRange("C1:C2").format.columnWidth = 22;
  provenanceSheet.getRange("D1:E2").format.columnWidth = 72;
  provenanceSheet.getRange(`A2:E${provenanceLastRow}`).format.rowHeight = 24;
  provenanceSheet.freezePanes.freezeRows(1);
}

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const previewSheets = [["项目", "A1:B6"], ["测段", `A1:T${Math.min(inputLastRow, 15)}`], ["说明", `A1:G${guidanceRows.length}`]];
if (provenanceSheet) previewSheets.push(["来源", `A1:E${Math.min((sourceData.records?.length ?? 0) + 1, 12)}`]);
for (const [sheetName, range] of previewSheets) {
  const inspection = await workbook.inspect({ kind: "table", range: `${sheetName}!${range}`, include: "values,formulas", tableMaxRows: 35, tableMaxCols: 20, maxChars: 12000 });
  await fs.writeFile(path.join(previewDir, `${sheetName}-inspect.ndjson`), inspection.ndjson, "utf8");
  const preview = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
await fs.writeFile(path.join(previewDir, "formula-errors.ndjson"), errors.ndjson, "utf8");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);

const notes = `实测剖面输入模板 v1 使用说明

1. 工作表与结构
- “项目”表：A1 为“参数”，B1 为“值”。不要改参数名称。项目名称和剖面编号可按实际填写。
- “测段”表：第 1 行列名是导入接口。可以调整列顺序，但不要修改列名。每行填写一条连续测量记录。
- “说明”表：列出字段必需性、单位、缺失处理以及源输入、计算、排版的区别。

2. 必需几何输入
- 每条有效记录必须有导线段号、层号、斜距_m、坡角_deg、方位角_deg。
- 斜距必须大于 0；坡角范围为 [-90,90]；方位角和倾向范围为 [0,360)；倾角范围为 [0,90]。
- 必需字段缺失、非法数值、NaN 或无穷值不能用 0 替代，将阻止绘制或产生明确问题记录。
- 长度单位固定为 m，角度单位固定为 deg。方位角和倾向均从正北起顺时针。

3. 位置、产状和厚度
- 样品距测段起点_m 是本行测段内的斜距偏移，必须在 0 到本行斜距 D 之间。没有这个距离时，样品只进入清单并标记“定位缺失”，不会放到图上。
- 倾向与倾角应成对填写。产状与本行起点关联，不能把该关联说成独立测得的产状点坐标。
- 没有明确实测真厚度时，实测真厚度_m 必须留空。不得从图形宽度、纹理、原表其他列或视觉效果推断。

4. 源输入、计算与排版
- 源输入：用户在工作簿中填写的观测、标识和原表缓存值，导入后保留来源。
- 计算：程序由斜距、坡角和方位角计算水平距、高差、东分量、北分量和投影距离；计算使用未舍入数值。
- 排版：图上标签、引线、图案和编码带的位置或宽度只用于可读性，不补全或改变源数据。
- 原表平距、高差和累计坐标列仅用于与独立计算核对。差异保留原值与残差，不覆盖原数据。

5. 岩性与材料图案
- 岩性名称按项目材料模板精确匹配。未知、含糊或仅相似的名称保留为待配置，不进行模糊合并。
- 图案是本项目符号库，用于区分材料，不表示国家、行业或机构的标准认证。
- 岩性编码带宽不表示厚度，分隔线不表示深部接触面。
- 当前已支持的精确名称：${materialNames.join("、")}。

6. 参考
MT/T 1043—2007 附录 B.3：
https://www.chinamine-safety.gov.cn/zfxxgk/fdzdgknr/zcfg/hybz_01/mkanj/202004/P020200422403006584531.pdf#page=16
该链接仅作信息类别参考，不构成合规保证。
`;
await fs.writeFile(notePath, notes, "utf8");

console.log(JSON.stringify({ xlsxPath, notePath, previewDir, sheets: previewSheets.map(([name]) => name), records: segmentRows.length }, null, 2));
