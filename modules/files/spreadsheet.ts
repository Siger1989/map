import { zipSync, strToU8 } from 'fflate';
export type SpreadsheetSheet = {
  name: string;
  rows: (string | number | null)[][];
};
const xml = (v: string) =>
  v
    .replace(/_x[0-9a-f]{4}_/gi, (s) => '_x005F_' + s.slice(1))
    .replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
      (c) => `_x${c.charCodeAt(0).toString(16).padStart(4, '0')}_`,
    )
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[c]!,
    );
const column = (n: number): string =>
  n < 26
    ? String.fromCharCode(65 + n)
    : column(Math.floor(n / 26) - 1) + column(n % 26);

/** Native XLSX cells: user text stays text (IDs, leading zeroes, formula-looking values). */
export function spreadsheetBytes(sheets: SpreadsheetSheet[]) {
  if (!sheets.length || sheets.length > 16) throw new Error('工作表数量无效');
  const files: Record<string, Uint8Array> = {};
  const strings: string[] = [],
    stringIds = new Map<string, number>();
  let stringCount = 0;
  const stringId = (value: string) => {
    stringCount++;
    let id = stringIds.get(value);
    if (id === undefined) {
      id = strings.length;
      strings.push(value);
      stringIds.set(value, id);
    }
    return id;
  };
  const put = (name: string, text: string) => {
    files[name] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text,
    );
  };
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  put(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  put(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  put(
    'xl/workbook.xml',
    `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    if (
      !s.rows.length ||
      s.rows.length > 1048576 ||
      s.rows.some((r) => r.length > 16384)
    )
      throw new Error('表格超过 Excel 行列限制，请分批导出');
    const cols = s.rows.reduce((n, r) => Math.max(n, r.length), 0);
    const ref = `A1:${column(Math.max(0, cols - 1))}${s.rows.length}`;
    put(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${ns}"><dimension ref="${ref}"/><sheetViews><sheetView workbookViewId="0" topLeftCell="A1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="${Math.max(1, cols)}" width="20" customWidth="1"/></cols><sheetData>${s.rows
        .map(
          (row, y) =>
            `<row r="${y + 1}">${row
              .map((v, x) => {
                const pos = `${column(x)}${y + 1}`;
                if (typeof v === 'number' && Number.isFinite(v))
                  return `<c r="${pos}" s="${y === 0 ? 1 : 0}" t="n"><v>${v}</v></c>`;
                const text = v === null ? '' : String(v);
                if (text.length > 32767)
                  throw new Error('单格文字过长，请缩短后导出');
                return `<c r="${pos}" s="${y === 0 ? 1 : 0}" t="s"><v>${stringId(text)}</v></c>`;
              })
              .join('')}</row>`,
        )
        .join('')}</sheetData><autoFilter ref="${ref}"/></worksheet>`,
    );
  });
  // Shared strings are also understood by mobile spreadsheet previewers that omit inlineStr cells.
  put(
    'xl/sharedStrings.xml',
    `<sst xmlns="${ns}" count="${stringCount}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')}</sst>`,
  );
  put(
    'xl/styles.xml',
    `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245C66"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  const extend = (file: string, end: string, text: string) => {
    files[file] = strToU8(
      new TextDecoder().decode(files[file]).replace(end, text + end),
    );
  };
  extend(
    '[Content_Types].xml',
    '</Types>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  );
  extend(
    'xl/_rels/workbook.xml.rels',
    '</Relationships>',
    '<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  );
  return zipSync(files, { level: 6 });
}
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
