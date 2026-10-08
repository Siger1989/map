import { collectData, syncData } from './storage.ts';
import { validateTransfer } from './validation.ts';
import type { Transfer } from './types.ts';
import { readPhotos, snapshotPhotos, syncPhotos, restorePhotoSnapshot, validPhoto, type TripPhoto } from '../photos/storage.ts';
import { listMaps, readMap, snapshotMapSources, syncMapSources, restoreMapSourceSnapshot } from '../mapSources/storage.ts';
import { MAX_FILE_BYTES, MAX_STORAGE_BYTES, validateStoredMap, type StoredMap } from '../mapSources/types.ts';
import { syncCollections } from '../collections/transfer.ts';
import { resolveCrs } from '../coordinates/index.ts';
import { LAYER_PREFERENCES_KEY, parseLayerPreferences } from '../map/layerPreferences.ts';
import { parseLastView } from '../map/lastView.ts';
import { STORAGE_KEY as UI_LAYOUT_KEY } from '../uiLayout/session.mjs';
import { validateLayout as validateUiLayout } from '../uiLayout/model.mjs';
import { ATTRIBUTE_TEMPLATE_KEY, readAttributeTemplate } from '../annotations/attributes.ts';
import { AREA_DISPLAY_UNIT_STORAGE_KEY, AREA_DISPLAY_UNITS } from '../areas/areaDisplayUnits.ts';
import { CONTOUR_INTERVAL_KEY, CONTOUR_INTERVALS } from '../terrain/contourInterval.ts';
import { COMPARISON_SOURCE_GROUP_VISIBILITY_KEY, COMPARISON_SOURCE_GROUP_ORDER } from '../mapComparison/comparisonSourceGroups.ts';
import { THEME_KEY } from '../appearance/theme.ts';
import { ROUTE_DISPLAY_KEY } from '../routeDisplay/preferences.ts';
import { ROUTING_MODE_KEY } from '../offlineRouting/preferences.ts';
import { MAP_SOURCE_FAVORITES_STORAGE_KEY } from '../mapSources/favorites.ts';
import { COORDINATES_KEY } from '../mapSources/coordinates.ts';
import { LAST_VIEW_KEY } from '../map/lastView.ts';
import { TRACK_STYLE_STORAGE } from '../tracks/style.ts';
import { TRACK_STORAGE } from '../tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../annotations/data.ts';
import { FAVORITES_STORAGE } from '../navigation/favorites.ts';
import { COLLECTION_STORAGE } from '../collections/data.ts';
import { SECTION_OBJECTS_KEY } from '../section/sectionObjects.ts';
import { SAVED_SECTION_KEY } from '../section/savedSection.ts';
import { PROFILE_NOTES_KEY } from '../section/profileNotes.ts';
import { REGION_STORAGE } from '../collections/regions.ts';
import { AREA_STORAGE } from '../areas/data.ts';
import { SAVED_MEASUREMENTS_KEY } from '../measurement/saved.ts';
import { RECORDING_ACCURACY_KEY } from '../outdoor/recordingPreferences.ts';
import { readCadDocuments as readCadDocumentsFromStore, syncCadDocuments, validateCadDocuments, replaceCadDocuments } from '../cad/storage.ts';
import { readIndustryProjects, syncIndustryProjects, replaceIndustryProjects, validateIndustryProjects, type IndustryProject } from '../industry/projectStorage.ts';

export const WORKSPACE_FORMAT = 'shantu-workspace';
export const WORKSPACE_VERSION = 2;
export const WORKSPACE_MAX_BYTES = 100 * 1024 * 1024;
const PHOTO_MAX_BYTES = 40 * 1024 * 1024;
const PROJECT_CRS_KEY = 'shantu.project-crs.v1';
const SELECTED_MAP_KEY = 'shantu-selected-map';
const SETTINGS_KEYS = [
  LAYER_PREFERENCES_KEY, ROUTE_DISPLAY_KEY, ROUTING_MODE_KEY, THEME_KEY,
  MAP_SOURCE_FAVORITES_STORAGE_KEY, COORDINATES_KEY, PROJECT_CRS_KEY, SELECTED_MAP_KEY,
  UI_LAYOUT_KEY, LAST_VIEW_KEY, TRACK_STYLE_STORAGE, ATTRIBUTE_TEMPLATE_KEY,
  AREA_DISPLAY_UNIT_STORAGE_KEY, CONTOUR_INTERVAL_KEY, COMPARISON_SOURCE_GROUP_VISIBILITY_KEY, RECORDING_ACCURACY_KEY,
] as const;
type PhotoFile = Omit<TripPhoto, 'preview' | 'detail'> & { previewBase64: string; mime: 'image/jpeg'; detailBase64?: string };
type MapFile = Omit<StoredMap, 'blob'> & { blobBase64?: string; blobMime?: string };
export type WorkspaceBackup = {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  core: Transfer;
  photos: PhotoFile[];
  settings: Record<string, string>;
  mapSources: MapFile[];
  cadDocuments: unknown[];
  industryProjects?: IndustryProject[];
  limitations: string[];
};
export type WorkspaceCadAdapter = {
  readCadDocuments: typeof readCadDocumentsFromStore;
  syncCadDocuments: typeof syncCadDocuments;
  validateCadDocuments: typeof validateCadDocuments;
  replaceCadDocuments: typeof replaceCadDocuments;
};
export type WorkspaceIndustryAdapter = {
  readIndustryProjects: typeof readIndustryProjects;
  syncIndustryProjects: typeof syncIndustryProjects;
  replaceIndustryProjects: typeof replaceIndustryProjects;
  validateIndustryProjects: typeof validateIndustryProjects;
};
const defaultCadAdapter: WorkspaceCadAdapter = { readCadDocuments: readCadDocumentsFromStore, syncCadDocuments, validateCadDocuments, replaceCadDocuments };
const defaultIndustryAdapter: WorkspaceIndustryAdapter = { readIndustryProjects, syncIndustryProjects, replaceIndustryProjects, validateIndustryProjects };

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}
function bytesOfBase64(value: string): number {
  // Validate in one pass: large offline map files can produce tens of MB of
  // Base64, for which a repeated-group regex can overflow the JS stack.
  if (value.length % 4 !== 0) throw new Error('二进制文件 Base64 编码无效');
  let dataChars = 0;
  let padding = 0;
  let lastSextet = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 61) {
      padding++;
      if (padding > 2 || i < value.length - 2) throw new Error('二进制文件 Base64 编码无效');
      continue;
    }
    if (padding !== 0) throw new Error('二进制文件 Base64 编码无效');
    let sextet: number;
    if (code >= 65 && code <= 90) sextet = code - 65;
    else if (code >= 97 && code <= 122) sextet = code - 97 + 26;
    else if (code >= 48 && code <= 57) sextet = code - 48 + 52;
    else if (code === 43) sextet = 62;
    else if (code === 47) sextet = 63;
    else throw new Error('二进制文件 Base64 编码无效');
    lastSextet = sextet;
    dataChars++;
  }
  if ((padding === 2 && (dataChars % 4 !== 2 || (lastSextet & 15) !== 0)) ||
      (padding === 1 && (dataChars % 4 !== 3 || (lastSextet & 3) !== 0)) ||
      (padding === 0 && dataChars % 4 !== 0)) throw new Error('二进制文件 Base64 编码无效');
  return value.length / 4 * 3 - padding;
}
function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取照片失败'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
function decodeBase64(value: string, mime: string): Blob {
  bytesOfBase64(value);
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function exportPhotos(): Promise<PhotoFile[]> {
  const photos = await readPhotos();
  const result: PhotoFile[] = [];
  for (const photo of photos) {
    const { preview, detail, ...metadata } = photo;
    result.push({ ...metadata, mime: 'image/jpeg', previewBase64: await blobBase64(preview), ...(detail ? { detailBase64: await blobBase64(detail) } : {}) });
  }
  return result;
}
function currentSettings(storage: Storage = localStorage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}
function validateSettings(settings: Record<string,string>) {
  for(const [key,raw] of Object.entries(settings)) {
    if(!(SETTINGS_KEYS as readonly string[]).includes(key)||typeof raw!=='string'||raw.length>2_000_000) throw new Error('备份包含不允许的设置项');
    if(key===ROUTING_MODE_KEY) { if(!['auto','online','offline'].includes(raw)) throw new Error(`偏好设置“${key}”格式无效，未导入`); continue; }
    if(key===SELECTED_MAP_KEY) { if(raw.length>250) throw new Error(`偏好设置“${key}”格式无效，未导入`); continue; }
    if(key===AREA_DISPLAY_UNIT_STORAGE_KEY) { if(!AREA_DISPLAY_UNITS.some((unit)=>unit.id===raw)) throw new Error(`偏好设置“${key}”格式无效，未导入`); continue; }
    if(key===RECORDING_ACCURACY_KEY) { const accuracy=JSON.parse(raw); if(!Number.isInteger(accuracy)||accuracy<5||accuracy>80) throw new Error(`偏好设置“${key}”格式无效，未导入`); continue; }
    try {
      const value=JSON.parse(raw);
      if(key==='shantu.map.layer-preferences.v1' && !parseLayerPreferences(raw)) throw new Error();
      if(key===ROUTE_DISPLAY_KEY && (!value||!['original','solid','elevation','speed','slope'].includes(value.mode)||!['legend','statistics','profile','steep','coordinates'].every((k)=>typeof value[k]==='boolean'))) throw new Error();
      if(key===THEME_KEY && (!value||!['light','dark','system'].includes(value.mode)||![value.light,value.dark].every((p)=>p&&/^#[\da-f]{6}$/i.test(p.accent)&&/^#[\da-f]{6}$/i.test(p.background)&&/^#[\da-f]{6}$/i.test(p.foreground)&&Number.isFinite(p.contrast)&&p.contrast>=0&&p.contrast<=100&&(p.button===undefined||/^#[\da-f]{6}$/i.test(p.button))))) throw new Error();
      if(key===MAP_SOURCE_FAVORITES_STORAGE_KEY && (!Array.isArray(value)||value.length>500||value.some((x)=>typeof x!=='string'||!x||x.length>256))) throw new Error();
      if(key===COORDINATES_KEY && (!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!k||k.length>100||!['wgs84','gcj02','bd09'].includes(String(v))))) throw new Error();
      if(key===PROJECT_CRS_KEY) resolveCrs(value);
      if(key===UI_LAYOUT_KEY) validateUiLayout(value);
      if(key===LAST_VIEW_KEY && !parseLastView(raw)) throw new Error();
      if(key===TRACK_STYLE_STORAGE && (!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some((k)=>!['color','width','pointSize','opacity','travelMode','colorMode'].includes(k))||typeof value.color!=='string'||!/^#[\da-f]{6}$/i.test(value.color)||typeof value.width!=='number'||value.width<.5||value.width>5||!Number.isFinite(value.width)||(value.pointSize!==undefined&&(!Number.isInteger(value.pointSize)||value.pointSize<4||value.pointSize>16))||(value.opacity!==undefined&&(typeof value.opacity!=='number'||value.opacity<.1||value.opacity>1))||(value.colorMode!==undefined&&!['solid','speed','slope','elevation'].includes(value.colorMode)))) throw new Error();
      if(key===ATTRIBUTE_TEMPLATE_KEY) readAttributeTemplate(raw);
      if(key===CONTOUR_INTERVAL_KEY && !CONTOUR_INTERVALS.some((interval)=>interval===Number(raw))) throw new Error();
      if(key===COMPARISON_SOURCE_GROUP_VISIBILITY_KEY && (!Array.isArray(value)||value.some((group)=>!COMPARISON_SOURCE_GROUP_ORDER.includes(group)))) throw new Error();
    } catch { throw new Error(`偏好设置“${key}”格式无效，未导入`); }
  }
}

export async function exportWorkspace(): Promise<WorkspaceBackup> {
  const [photos, mapSources, cadDocuments, industryProjects] = await Promise.all([
    exportPhotos(), listMaps(), readCadDocumentsFromStore(), readIndustryProjects(),
  ]);
  const maps: MapFile[] = [];
  for (const map of mapSources) {
    const full = await readMap(map.id);
    if (full) {
      const { blob, ...metadata } = full;
      maps.push({ ...metadata, ...(blob ? { blobBase64: await blobBase64(blob), blobMime: blob.type } : {}) });
    }
  }
  const backup: WorkspaceBackup = {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, core: collectData(), photos,
    settings: currentSettings(), mapSources: maps, cadDocuments, industryProjects,
    limitations: ['不含可再生瓦片及 HTTP 缓存', '不含 GPS/定位瞬态、正在进行的任务状态、令牌、环境变量或私钥', '照片使用本机当前保存的 JPEG 预览和可选 JPEG 清晰副本，不包含未保存的原片', '包含行业工具原始 Excel 表，接收端可继续编辑并重新生成图件；生成图件缓存不导出', '用户自定义图源地址可能含用户自行填写的 Key；本机 .env 和环境变量不导出'],
  };
  if (new TextEncoder().encode(JSON.stringify(backup)).byteLength > WORKSPACE_MAX_BYTES) throw new Error('工作区备份超过100MB，请分批移除大文件后重试');
  return backup;
}

export function validateWorkspace(value: unknown): WorkspaceBackup {
  const v = asRecord(value, '工作区备份');
  if (v.format !== WORKSPACE_FORMAT || v.version !== WORKSPACE_VERSION) throw new Error('工作区备份版本或格式不支持');
  const core = validateTransfer(v.core);
  if (!Array.isArray(v.photos) || v.photos.length > 200) throw new Error('照片清单无效或超过200张');
  let previewBytes = 0, detailBytes = 0;
  const ids = new Set<string>();
  const photos = v.photos.map((item) => {
    const file = asRecord(item, '照片');
    if (file.mime !== 'image/jpeg' || typeof file.previewBase64 !== 'string' || typeof file.id !== 'string' || ids.has(file.id)) throw new Error('照片清单含无效或重复编号');
    ids.add(file.id);
    previewBytes += bytesOfBase64(file.previewBase64);
    if (file.detailBase64 !== undefined) {
      if (typeof file.detailBase64 !== 'string') throw new Error('照片清晰副本无效');
      detailBytes += bytesOfBase64(file.detailBase64);
    }
    if (previewBytes > PHOTO_MAX_BYTES || detailBytes + previewBytes > 200 * 1024 * 1024) throw new Error('备份照片超过预览40MB / 含清晰副本200MB限制');
    const { previewBase64, detailBase64, mime: _mime, ...meta } = file;
    const photo = { ...meta, preview: decodeBase64(previewBase64, 'image/jpeg'), ...(detailBase64 ? { detail: decodeBase64(detailBase64, 'image/jpeg') } : {}) } as TripPhoto;
    if (!validPhoto(photo)) throw new Error('备份含无效照片或编辑数据');
    return { ...file } as PhotoFile;
  });
  const settings = asRecord(v.settings, '偏好设置') as Record<string, string>;
  validateSettings(settings);
  if (!Array.isArray(v.mapSources) || v.mapSources.length > 100) throw new Error('用户图源清单无效');
  let mapBytes = 0;
  const mapIds = new Set<string>();
  const mapSources = v.mapSources.map((item) => {
    const map = asRecord(item, '用户图源') as MapFile;
    if (typeof map.id !== 'string' || mapIds.has(map.id) || typeof map.name !== 'string' || typeof map.bytes !== 'number' || map.bytes < 0) throw new Error('用户图源数据无效');
    mapIds.add(map.id); mapBytes += map.bytes;
    if (map.blobBase64 !== undefined) {
      if (typeof map.blobBase64 !== 'string' || typeof map.blobMime !== 'string' || map.blobMime.length > 100) throw new Error('图源文件数据无效');
      const blobBytes = bytesOfBase64(map.blobBase64);
      if (blobBytes > MAX_FILE_BYTES) throw new Error('单个图源文件超过64MB');
      // map.bytes already accounts for the binary payload (enforced by
      // validateStoredMap); do not count that same blob twice.
    }
    if (mapBytes > MAX_STORAGE_BYTES) throw new Error('用户图源数据超过本机图源库容量');
    const { blobBase64, blobMime, ...metadata } = map;
    validateStoredMap({ ...metadata, ...(blobBase64 ? { blob: decodeBase64(blobBase64, blobMime!) } : {}) });
    return map;
  });
  if (!Array.isArray(v.cadDocuments) || v.cadDocuments.length > 5000) throw new Error('CAD 文档清单无效');
  const industryProjects = v.industryProjects === undefined ? undefined : validateIndustryProjects(v.industryProjects);
  if (new TextEncoder().encode(JSON.stringify(v)).byteLength > WORKSPACE_MAX_BYTES) throw new Error('工作区文件超过100MB');
  return { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, core, photos, settings, mapSources: mapSources as MapFile[], cadDocuments: v.cadDocuments, ...(industryProjects === undefined ? {} : { industryProjects }), limitations: Array.isArray(v.limitations) ? v.limitations.filter((s): s is string => typeof s === 'string').slice(0, 20) : [] };
}

function toTripPhotos(files: PhotoFile[]): TripPhoto[] {
  return files.map((file) => {
    const { previewBase64, detailBase64, mime: _mime, ...meta } = file;
    return { ...meta, preview: decodeBase64(previewBase64, 'image/jpeg'), ...(detailBase64 ? { detail: decodeBase64(detailBase64, 'image/jpeg') } : {}) } as TripPhoto;
  });
}
export function mergeWorkspaceCore(current: Transfer, incoming: Transfer): Transfer {
  const merge = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
    const map = new Map(a.map((item) => [item.id, item])); for (const item of b) map.set(item.id, item); return [...map.values()];
  };
  const next: Transfer = { ...current, ...incoming,
    tracks: merge(current.tracks, incoming.tracks), annotations: merge(current.annotations, incoming.annotations), favorites: merge(current.favorites, incoming.favorites),
    ...(current.areas || incoming.areas ? { areas: merge(current.areas, incoming.areas) } : {}),
    ...(current.measurements || incoming.measurements ? { measurements: merge(current.measurements, incoming.measurements) } : {}),
    ...(current.sections || incoming.sections ? { sections: merge(current.sections, incoming.sections) } : {}),
    ...((current.collections || incoming.collections) ? { collections: syncCollections(current.collections, incoming.collections, workspaceIncomingKeys(incoming)) } : {}),
  };
  if (current.regions || incoming.regions) next.regions = { ...current.regions, ...incoming.regions };
  if (current.sectionNotes || incoming.sectionNotes) next.sectionNotes = mergeNotes(current.sectionNotes ?? [], incoming.sectionNotes ?? []);
  return validateTransfer(next);
}
function workspaceIncomingKeys(data: Transfer) {
  const keys = new Set<string>();
  for (const t of data.tracks) keys.add(`track:${t.id}`);
  for (const f of data.favorites) keys.add(`route:${f.id}`);
  for (const a of data.annotations) keys.add(`annotation:${a.id}`);
  for (const a of data.areas ?? []) keys.add(`area:${a.id}`);
  for (const m of data.measurements ?? []) keys.add(`measurement:${m.id}`);
  for (const s of data.sections ?? []) keys.add(`section:${s.id}`);
  return keys;
}
function mergeNotes<T extends { settings: { objectId?: string }; notes: { id: string }[] }>(a: T[], b: T[]): T[] {
  const key = (x: T) => x.settings.objectId ?? JSON.stringify(x.settings);
  const out = new Map(a.map((x) => [key(x), x]));
  for (const item of b) { const old = out.get(key(item)); out.set(key(item), old ? { ...item, notes: mergeNotesById(old.notes, item.notes) } : item); }
  return [...out.values()];
}
function mergeNotesById<T extends { id: string }>(a: T[], b: T[]): T[] { const out = new Map(a.map((x)=>[x.id,x])); for(const x of b) out.set(x.id,x); return [...out.values()]; }

export async function importWorkspace(value: unknown, cad: WorkspaceCadAdapter = defaultCadAdapter, industry: WorkspaceIndustryAdapter = defaultIndustryAdapter): Promise<Transfer> {
  const backup = validateWorkspace(value);
  const local = localStorage;
  const currentCore = collectData(local);
  const nextCore = mergeWorkspaceCore(currentCore, backup.core);
  const beforeSettings = currentSettings(local);
  const [beforePhotos, beforePhotoSnapshot, beforeMaps] = await Promise.all([readPhotos(), snapshotPhotos(), snapshotMapSources()]);
  const validatedCad = cad.validateCadDocuments(backup.cadDocuments);
  const beforeCad = await cad.readCadDocuments();
  const validatedIndustry = industry.validateIndustryProjects(backup.industryProjects ?? []);
  const beforeIndustry = await industry.readIndustryProjects();
  const incomingPhotos = toTripPhotos(backup.photos);
  const mergedPhotos = new Map(beforePhotos.map((p) => [p.id, p])); for (const photo of incomingPhotos) mergedPhotos.set(photo.id, photo);
  const nextPhotos = [...mergedPhotos.values()];
  if (nextPhotos.length > 200 || nextPhotos.reduce((n,p)=>n+p.preview.size,0)>PHOTO_MAX_BYTES) throw new Error('同步后照片超过200张或预览40MB限制');
  const settingsEntries = Object.entries(backup.settings);
  const keys = [...new Set([...Object.keys(beforeSettings), ...settingsEntries.map(([k])=>k)])].filter((k)=>(SETTINGS_KEYS as readonly string[]).includes(k));
  const settingsSnapshot = new Map(keys.map((k)=>[k,local.getItem(k)]));
  const coreSnapshot = new Map<string,string|null>();
  const coreKeys = [TRACK_STORAGE, ANNOTATION_STORAGE, FAVORITES_STORAGE, COLLECTION_STORAGE, SECTION_OBJECTS_KEY, SAVED_SECTION_KEY, PROFILE_NOTES_KEY, REGION_STORAGE, AREA_STORAGE, SAVED_MEASUREMENTS_KEY];
  for (const key of coreKeys) coreSnapshot.set(key,local.getItem(key));
  let coreAttempted = false, settingsAttempted = false, photosAttempted = false, mapsAttempted = false, cadAttempted = false, industryAttempted = false;
  try {
    coreAttempted = true; syncData(nextCore, local, false);
    settingsAttempted = true;
    for (const [key, raw] of settingsEntries) local.setItem(key, raw);
    photosAttempted = true; await syncPhotos(incomingPhotos);
    mapsAttempted = true;
    await syncMapSources(backup.mapSources.map((map) => {
      const { blobBase64, blobMime, ...metadata } = map;
      return { ...metadata, ...(blobBase64 ? { blob: decodeBase64(blobBase64, blobMime ?? 'application/octet-stream') } : {}) };
    }));
    cadAttempted = validatedCad.length > 0;
    if (cadAttempted) await cad.syncCadDocuments(validatedCad);
    industryAttempted = validatedIndustry.length > 0;
    if (industryAttempted) await industry.syncIndustryProjects(validatedIndustry);
  } catch (error) {
    const rollbackErrors: string[] = [];
    const attempt = async (name: string, action: () => Promise<unknown> | unknown) => { try { await action(); } catch { rollbackErrors.push(name); } };
    if (industryAttempted) await attempt('行业项目',()=>industry.replaceIndustryProjects(beforeIndustry));
    if (cadAttempted) await attempt('CAD',()=>cad.replaceCadDocuments(beforeCad));
    if (mapsAttempted) await attempt('图源',()=>restoreMapSourceSnapshot(beforeMaps));
    if (photosAttempted) await attempt('照片',()=>restorePhotoSnapshot(beforePhotoSnapshot));
    if (settingsAttempted) await attempt('设置',()=>{ for(const [key,raw] of settingsSnapshot) raw===null?local.removeItem(key):local.setItem(key,raw); });
    if (coreAttempted) await attempt('业务数据',()=>{ for(const [key,raw] of coreSnapshot) raw===null?local.removeItem(key):local.setItem(key,raw); });
    throw new Error(`工作区导入失败，已尝试回滚。${rollbackErrors.length ? `回滚失败：${rollbackErrors.join('、')}` : ''} ${error instanceof Error ? error.message : ''}`);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('guanyun-data-changed'));
  return nextCore;
}

export function summarizeWorkspace(value: unknown) {
  const backup = validateWorkspace(value);
  return { routes: backup.core.tracks.length, pins: backup.core.annotations.length, favorites: backup.core.favorites.length, photos: backup.photos.length, maps: backup.mapSources.length, cadDocuments: backup.cadDocuments.length, industryProjects: backup.industryProjects?.length ?? 0, sections: backup.core.sections?.length ?? 0, areas: backup.core.areas?.length ?? 0 };
}
