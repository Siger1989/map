import type { Annotation } from '../annotations/data.ts';
import {
  surveyCoordinate,
  surveyHeight,
  surveyBasis,
  surveyStations,
  type SurveyLine,
  type SurveyTerrain,
  type SurveyPointData,
} from './surveyLine.ts';

export function surveyPointData(
  line: SurveyLine,
  id: string,
  label: string,
  markers: Annotation[],
): SurveyPointData {
  const marker = markers.find((m) => m.id === id);
  return marker
    ? { name: marker.name, note: marker.note }
    : (line.pointData?.[id] ?? { name: label, note: '' });
}
export type SurveyDrawingPage = { svg: string; width: number; height: number };
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
/** Bounded continuation sheets preserve every entered field on long exploration lines. */
export function surveyRecordPages(
  line: SurveyLine,
  data: SurveyTerrain,
  name: string,
  markers: Annotation[],
): SurveyDrawingPage[] {
  type Row = { text: string };
  const rows: Row[] = [];
  const add = (label: string, value: string) => {
    const chars = Array.from(label + '：' + (value || '—'));
    for (let i = 0; i < chars.length; i += 72)
      rows.push({ text: chars.slice(i, i + 72).join('') });
  };
  const info = line.info;
  for (const [label, value] of [
    ['项目', info?.project],
    ['图名', info?.title || name],
    ['图号', info?.number],
    ['编制', info?.author],
    ['审核', info?.reviewer],
    ['日期', info?.date],
    ['资料补充', info?.source],
    ['图纸备注', info?.note],
  ])
    add(label ?? '', value ?? '');
  add('地形来源', data.source);
  add('方向角 A→B', surveyBasis(line).bearing.toFixed(2) + '°（真北起顺时针）');
  add(
    '水平比例尺',
    line.printScale
      ? `1:${line.printScale}，按完整主图宽 420 mm 打印`
      : '自动铺满，数值见主图',
  );
  for (const station of surveyStations(line)) {
    const point = surveyPointData(line, station.id, station.label, markers),
      p = surveyCoordinate(line, station.distance),
      h = surveyHeight(data, station.distance);
    add('点 ' + station.label, point.name);
    add(
      '坐标/里程',
      p.map((v) => v.toFixed(6)).join(', ') +
        ' · ' +
        station.distance.toFixed(2) +
        ' m · 地面高程 ' +
        (h === null ? '未测' : h.toFixed(2) + ' m'),
    );
    if (point.note) add('点位备注', point.note);
    for (const marker of markers.filter(
      (m) => (m.sectionAnchor?.stationId ?? m.id) === station.id,
    )) {
      add('关联标记', marker.name);
      if (marker.borehole)
        add(
          '钻井深度',
          marker.borehole.depth === null
            ? '未填写'
            : marker.borehole.depth.toFixed(2) + ' m',
        );
    }
  }
  const pages: SurveyDrawingPage[] = [];
  for (let start = 0; start < rows.length; start += 30) {
    const page = rows.slice(start, start + 30),
      height = 180 + page.length * 38;
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="' +
      height +
      '" viewBox="0 0 1800 ' +
      height +
      '"><rect width="100%" height="100%" fill="white"/><g font-family="Microsoft YaHei,Noto Sans SC,sans-serif" fill="#16231c"><text x="55" y="55" font-size="28">勘探线资料附表 ' +
      (pages.length + 1) +
      '</text><text x="55" y="94" font-size="20">点位坐标为 WGS84；高程与剖面采用同一地形采样。</text>';
    page.forEach((r, i) => {
      const y = 130 + i * 38;
      svg +=
        '<text x="105" y="' +
        y +
        '" font-size="21">' +
        xml(r.text) +
        '</text><path d="M55 ' +
        (y + 12) +
        'H1745" stroke="#dde3df"/>';
    });
    pages.push({ svg: svg + '</g></svg>', width: 1800, height });
  }
  return pages;
}
