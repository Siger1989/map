/** Small vector pictograms shared by the picker, map and collection rows. */
export const MARKER_ICONS = {
  pin: {
    name: '地点',
    path: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  },
  flag: { name: '旗帜', path: 'M5 22V3M5 4h14l-3 4 3 4H5' },
  star: { name: '重点', path: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z' },
  camp: { name: '营地', path: 'm3 21 9-18 9 18ZM8 21l4-8 4 8M12 3V1' },
  mountain: { name: '山峰', path: 'm1 21 8-17 6 11 3-5 5 11ZM6 10l3 3 3-3' },
  water: {
    name: '水源',
    path: 'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM9 15c0 2 1 3 3 3',
  },
  house: { name: '房屋', path: 'm2 11 10-9 10 9M5 9v13h14V9M9 22v-8h6v8' },
  cave: {
    name: '洞口',
    path: 'M2 22 5 6l7-4 7 4 3 16ZM8 22v-7a4 4 0 0 1 8 0v7',
  },
  danger: { name: '危险', path: 'm12 2 11 20H1ZM12 8v6M12 18v1' },
  parking: { name: '停车', path: 'M4 3h16v18H4ZM9 18V7h4a3 3 0 0 1 0 6H9' },
  bridge: {
    name: '桥梁',
    path: 'M2 21V4M22 21V4M2 6c6 11 14 11 20 0M1 18h22M7 12v6M12 14v4M17 12v6',
  },
  tree: { name: '树木', path: 'm12 2-6 8h3l-6 8h18l-6-8h3ZM12 18v5' },
  camera: {
    name: '拍照',
    path: 'M3 6h4l2-3h6l2 3h4v15H3ZM8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  },
  sample: { name: '采样', path: 'M8 2h8M9 2v9L3 21h18l-6-10V2M7 16h10' },
  drill: { name: '钻孔', path: 'M3 3h18M12 3v17M8 7l8 4-8 4 8 4M9 20l3 3 3-3' },
  hospital: { name: '救援', path: 'M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z' },
  food: {
    name: '餐饮',
    path: 'M4 2v6a3 3 0 0 0 6 0V2M7 2v20M18 2c-4 4-4 10 0 10V2ZM18 12v10',
  },
  gate: { name: '出入口', path: 'M4 22V3h16v19M9 3v19M11 13h12m-4-4 4 4-4 4' },
} as const;
export type MarkerIconId = keyof typeof MARKER_ICONS;
export const markerIcon = (id?: string) =>
  MARKER_ICONS[id as MarkerIconId] ?? MARKER_ICONS.pin;
export function markerIconElement(id?: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', markerIcon(id).path);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}
