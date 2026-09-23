import { coordinate, type Coordinate } from '../navigation/types.ts';
import { newAnnotation, MAX_PINS } from '../annotations/data.ts';
import { closeBoundary, MAX_AREAS } from '../areas/data.ts';
import { MAX_SAVED_TRACKS, MAX_TRACK_POINTS } from '../tracks/drawing.ts';
import { validateTransfer } from './validation.ts';
import type { Transfer } from './types.ts';

export type ImportPoint = { coordinates: Coordinate; altitude: number | null; time: number | null };
export function importNumber(value: unknown, label: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)))
    throw new Error(`${label}缺失或无效`);
  return Number(value);
}
export function importPoint(lng: unknown, lat: unknown, alt?: unknown, time?: unknown): ImportPoint {
  const p: Coordinate = [importNumber(lng, '经度'), importNumber(lat, '纬度')];
  if (!coordinate(p)) throw new Error('坐标超出地图范围，请核对坐标系');
  const altitude = alt === undefined || alt === null || alt === '' ? null : importNumber(alt, '海拔');
  const timestamp = time === undefined || time === null || time === '' ? null
    : time instanceof Date ? time.getTime() : typeof time === 'number' ? time : Date.parse(String(time));
  if (timestamp !== null && (!Number.isFinite(timestamp) || Math.abs(timestamp)>8640000000000000)) throw new Error('时间无效');
  return { coordinates:p, altitude, time:timestamp };
}
export class RouteBuilder {
  readonly data: Transfer = {format:'guanyun-backup',version:1,tracks:[],annotations:[],favorites:[]};
  readonly fallback: string;
  readonly fallbackFormat: string;
  constructor(filename: string) {
    this.fallback=filename.replace(/\.[^.]+$/, '').slice(0,60)||'导入路线';
    const extension=filename.split('.').at(-1)?.toUpperCase()||'';
    this.fallbackFormat=/^[A-Z0-9]{1,12}$/.test(extension)?extension:'FILE';
  }
  label(name: unknown) { return (typeof name==='string' && name.trim() ? name.trim() : this.fallback).slice(0,60); }
  pin(name: unknown, p: ImportPoint, note = '') {
    if (this.data.annotations.length>=MAX_PINS) throw new Error(`标记超过${MAX_PINS}个`);
    this.data.annotations.push({...newAnnotation('pin',p.coordinates,p.altitude,crypto.randomUUID()),name:this.label(name),note:note.slice(0,500)});
  }
  track(name: unknown, parts: ImportPoint[][]) {
    if (!parts.length || parts.some(p=>!p.length)) throw new Error('路线没有有效分段');
    if (parts.reduce((n,p)=>n+p.length,0)>MAX_TRACK_POINTS || parts.length>100) throw new Error('路线超过6000点或100个分段，请先拆分');
    // Isolated fixes remain visible without joining across missing GPS or pauses.
    const lines = parts.filter(p=>p.length>=2);
    for (const part of parts.filter(p=>p.length===1)) this.pin(name,part[0]);
    if (!lines.length) return;
    if (this.data.tracks.length>=MAX_SAVED_TRACKS) throw new Error('轨迹数量超过100条');
    this.data.tracks.push({id:crypto.randomUUID(),name:this.label(name),createdAt:Date.now(),source:'shared',
      importFormat:this.fallbackFormat,
      segments:lines.map(line=>line.map(p=>p.coordinates)),
      ...(lines.some(line=>line.some(p=>p.time!==null||p.altitude!==null))?{samples:lines.map(line=>line.map(({time,altitude})=>({time,altitude})))}:{})});
  }
  area(name: unknown, points: ImportPoint[], note = '') {
    const areas=this.data.areas??=[];
    if (areas.length>=MAX_AREAS) throw new Error('区域数量超过40个');
    areas.push({id:crypto.randomUUID(),name:this.label(name),note:note.slice(0,500),color:'#3388ff',visible:true,
      boundary:closeBoundary(points.map(p=>p.coordinates)),createdAt:Date.now()});
    this.data.areas=areas;
  }
  finish() {
    if (!this.data.tracks.length&&!this.data.annotations.length&&!this.data.areas?.length) throw new Error('文件没有可导入的路线、标记或区域');
    return validateTransfer(this.data);
  }
}
