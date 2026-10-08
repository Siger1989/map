import { useEffect, useState } from 'react';
import {
  BEIJING54_CRS,
  CGCS2000_CRS,
  WGS84_CRS,
  XIAN80_CRS,
  createCgcs2000Gauss3ByCentralMeridian,
  createCgcs2000Gauss3ByZone,
  createCgcs2000Gauss6ByZone,
  createUtmCrs,
  resolveCrs,
  type ProjectCrs,
} from './index.ts';
import './coordinates.css';

type Mode = 'wgs84' | 'cgcs' | 'gk3cm' | 'gk3zone' | 'gk6zone' | 'utm-n' | 'utm-s' | 'bj54' | 'xian80' | 'custom';
type Props = { value: ProjectCrs; onChange: (value: ProjectCrs) => void; label?: string; id?: string };

const modeOf = (value: ProjectCrs): Mode => {
  if (value.id === 'EPSG:4326') return 'wgs84';
  if (value.id === 'EPSG:4490') return 'cgcs';
  if (value.id === 'EPSG:4214') return 'bj54';
  if (value.id === 'EPSG:4610') return 'xian80';
  if (/^EPSG:326\d{2}$/.test(value.id)) return 'utm-n';
  if (/^EPSG:327\d{2}$/.test(value.id)) return 'utm-s';
  if (/^CGCS2000:GAUSS3:CM:/.test(value.id)) return 'gk3cm';
  if (/^CGCS2000:GAUSS3:ZONE:/.test(value.id)) return 'gk3zone';
  if (/^CGCS2000:GAUSS6:ZONE:/.test(value.id)) return 'gk6zone';
  if (/^EPSG:45(?:3[4-9]|4\d|5[0-4])$/.test(value.id)) return 'gk3cm';
  if (/^EPSG:(?:449[1-9]|450[01])$/.test(value.id)) return 'gk6zone';
  if (/^EPSG:45(?:1[3-9]|2\d|3[0-3])$/.test(value.id)) return 'gk3zone';
  return 'custom';
};

function numericPart(id: string, mode: Mode, fallback: number): string {
  if (mode === 'gk3cm') return id.startsWith('CGCS2000:') ? id.split(':').at(-1)! : String(75 + (Number(id.slice(5)) - 4534) * 3);
  if (mode === 'gk3zone') return id.startsWith('CGCS2000:') ? id.split(':').at(-1)! : String(Number(id.slice(5)) - 4488);
  if (mode === 'gk6zone') return id.startsWith('CGCS2000:') ? id.split(':').at(-1)! : String(Number(id.slice(5)) <= 4501 ? Number(id.slice(5)) - 4478 : 13 + Number(id.slice(5)) - 4502);
  if (mode === 'utm-n') return String(Number(id.slice(5)) - 32600);
  if (mode === 'utm-s') return String(Number(id.slice(5)) - 32700);
  return String(fallback);
}

export function CrsSelector({ value, onChange, label = '工程坐标系', id = 'project-crs' }: Props) {
  const [mode, setMode] = useState<Mode>(() => modeOf(value));
  const [centralMeridian, setCentralMeridian] = useState(() => numericPart(value.id, modeOf(value), 105));
  const [zone, setZone] = useState(() => numericPart(value.id, modeOf(value), 35));
  const [utmZone, setUtmZone] = useState(() => numericPart(value.id, modeOf(value), 48));
  const [hemisphere, setHemisphere] = useState<'N' | 'S'>(() => modeOf(value) === 'utm-s' ? 'S' : 'N');
  const [parameters, setParameters] = useState(() => value.datumParameters?.join(',') ?? '');
  const [definition, setDefinition] = useState(() => value.id === 'CUSTOM' || modeOf(value) === 'custom' ? value.definition ?? '' : '');
  const [error, setError] = useState('');

  useEffect(() => {
    const nextMode = modeOf(value);
    setMode(nextMode);
    setCentralMeridian(numericPart(value.id, nextMode, 105));
    setZone(numericPart(value.id, nextMode, 35));
    setUtmZone(numericPart(value.id, nextMode, 48));
    setHemisphere(nextMode === 'utm-s' ? 'S' : 'N');
    setParameters(value.datumParameters?.join(',') ?? '');
    setDefinition(nextMode === 'custom' ? value.definition ?? '' : '');
  }, [value]);

  const emit = (nextMode = mode, overrides: Record<string, string> = {}) => {
    const cm = overrides.centralMeridian ?? centralMeridian;
    const z = overrides.zone ?? zone;
    const uz = overrides.utmZone ?? utmZone;
    const hemi = (overrides.hemisphere ?? hemisphere) as 'N' | 'S';
    const def = overrides.definition ?? definition;
    const params = overrides.parameters ?? parameters;
    try {
      let next: ProjectCrs;
      if (nextMode === 'wgs84') next = WGS84_CRS;
      else if (nextMode === 'cgcs') next = CGCS2000_CRS;
      else if (nextMode === 'gk3cm') next = createCgcs2000Gauss3ByCentralMeridian(Number(cm));
      else if (nextMode === 'gk3zone') next = createCgcs2000Gauss3ByZone(Number(z));
      else if (nextMode === 'gk6zone') next = createCgcs2000Gauss6ByZone(Number(z));
      else if (nextMode === 'utm-n' || nextMode === 'utm-s') next = createUtmCrs(Number(uz), nextMode === 'utm-n' ? 'N' : 'S');
      else if (nextMode === 'bj54' || nextMode === 'xian80') {
        const base = nextMode === 'bj54' ? BEIJING54_CRS : XIAN80_CRS;
        const values = params.split(',').map((part) => Number(part.trim()));
        next = params.trim() ? resolveCrs({ ...base, datumParameters: values as unknown as ProjectCrs['datumParameters'] }) : base;
      } else {
        next = resolveCrs(def);
      }
      onChange(next);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '坐标系设置无效。');
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === 'gk3cm') { setCentralMeridian('105'); emit(next, { centralMeridian: '105' }); }
    else if (next === 'gk3zone') { setZone('35'); emit(next, { zone: '35' }); }
    else if (next === 'gk6zone') { setZone('18'); emit(next, { zone: '18' }); }
    else if (next === 'utm-n') { setUtmZone('48'); emit(next, { utmZone: '48' }); }
    else if (next === 'utm-s') { setUtmZone('56'); setHemisphere('S'); emit(next, { utmZone: '56', hemisphere: 'S' }); }
    else if (next === 'bj54' || next === 'xian80') { setParameters(''); emit(next, { parameters: '' }); }
    else if (next === 'custom') { setDefinition(''); setError('请粘贴显式 PROJ 或 WKT 定义。'); }
    else emit(next);
  };

  return <div className="crs-selector">
    <label className="crs-label" htmlFor={`${id}-mode`}>{label}</label>
    <select id={`${id}-mode`} value={mode} onChange={(event) => changeMode(event.target.value as Mode)}>
      <option value="wgs84">WGS 84（EPSG:4326）</option>
      <option value="cgcs">CGCS2000 地理坐标（EPSG:4490）</option>
      <option value="gk3cm">CGCS2000 高斯 3° 带：中央经线</option>
      <option value="gk3zone">CGCS2000 高斯 3° 带：带号（带前缀）</option>
      <option value="gk6zone">CGCS2000 高斯 6° 带：带号</option>
      <option value="utm-n">WGS 84 / UTM 北半球</option>
      <option value="utm-s">WGS 84 / UTM 南半球</option>
      <option value="bj54">北京54 地理坐标</option>
      <option value="xian80">西安80 地理坐标</option>
      <option value="custom">自定义 PROJ / WKT</option>
    </select>
    {mode === 'gk3cm' && <label className="crs-param">中央经线 °<input type="number" min="75" max="135" step="3" value={centralMeridian} onChange={(event) => { setCentralMeridian(event.target.value); emit(mode, { centralMeridian: event.target.value }); }} /></label>}
    {(mode === 'gk3zone' || mode === 'gk6zone') && <label className="crs-param">{mode === 'gk3zone' ? '3° 带号（25–45）' : '6° 带号（13–23）'}<input type="number" min={mode === 'gk3zone' ? 25 : 13} max={mode === 'gk3zone' ? 45 : 23} value={zone} onChange={(event) => { setZone(event.target.value); emit(mode, { zone: event.target.value }); }} /></label>}
    {(mode === 'utm-n' || mode === 'utm-s') && <label className="crs-param">UTM 带号（1–60）<input type="number" min="1" max="60" value={utmZone} onChange={(event) => { setUtmZone(event.target.value); emit(mode, { utmZone: event.target.value }); }} /></label>}
    {(mode === 'bj54' || mode === 'xian80') && <label className="crs-param">已核实 datum 参数（3 或 7 个，逗号分隔）<input value={parameters} placeholder="留空时禁止跨基准转换" onChange={(event) => { setParameters(event.target.value); emit(mode, { parameters: event.target.value }); }} /></label>}
    {mode === 'custom' && <label className="crs-param">显式 PROJ 或 WKT 定义<input value={definition} placeholder="+proj=… 或 PROJCS[…]" onChange={(event) => { setDefinition(event.target.value); emit(mode, { definition: event.target.value }); }} /></label>}
    {(mode === 'bj54' || mode === 'xian80') && <p className="crs-hint">未填经核实的 3/7 参数时，跨基准转换会拒绝执行；不会按 WGS 84 处理。</p>}
    {error && <p className="crs-error" role="alert">{error}</p>}
  </div>;
}
