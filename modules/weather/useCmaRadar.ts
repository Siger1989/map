'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRadarRequestUrl, type RadarDirectory, type RadarFrame } from './cmaRadar';

function validFrame(value: unknown): value is RadarFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<RadarFrame>;
  return typeof frame.id === 'string' && frame.id.length > 0 &&
    typeof frame.observedAt === 'string' && Number.isFinite(Date.parse(frame.observedAt)) &&
    typeof frame.imagePath === 'string' && frame.imagePath.length > 0;
}

function localImagePath(path: string) {
  const image = new URL(path, window.location.origin);
  if (image.origin !== window.location.origin || image.pathname !== '/api/radar')
    throw new Error('雷达图片地址不是本机同源服务');
  return `${image.pathname}${image.search}`;
}

export function formatRadarTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '观测时次无效';
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hour12: false,
  }).format(date)}（北京时间）`;
}

export function radarAgeMinutes(value: string | null, now = Date.now()) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 60_000)) : null;
}

export function useCmaRadar(enabled: boolean) {
  const [directory, setDirectory] = useState<RadarDirectory | null>(null);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [generation, setGeneration] = useState(0);
  const request = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const followLatest = useRef(true);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setGeneration(value => value + 1);
    setLoading(true);
    setError('');
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25_000);
    try {
      const response = await fetch(buildRadarRequestUrl(), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`雷达目录请求失败（HTTP ${response.status}）`);
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object') throw new Error('雷达目录返回格式无效');
      const payload = result as Partial<RadarDirectory>;
      if (!Array.isArray(payload.frames) || !payload.frames.every(validFrame))
        throw new Error('雷达目录缺少有效观测帧');
      if (!Object.hasOwn(payload, 'latestAt') || !(payload.latestAt === null ||
        (typeof payload.latestAt === 'string' && Number.isFinite(Date.parse(payload.latestAt)))))
        throw new Error('雷达目录最新时次无效');
      if (payload.source !== '国家气象数据网' || payload.product !== '全国雷达拼图 · 组合反射率' || payload.unit !== 'dBZ')
        throw new Error('雷达目录来源或产品单位不匹配');

      const sorted = [...payload.frames].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
      const now = Date.now();
      if (sorted.some(frame => Date.parse(frame.observedAt) > now))
        throw new Error('雷达目录包含未来观测时次');
      const maximumTime = sorted[0]?.observedAt ?? null;
      if (payload.latestAt !== maximumTime)
        throw new Error('雷达目录最新时次与观测帧不一致');
      const safeFrames = sorted.map(frame => ({ ...frame, imagePath: localImagePath(frame.imagePath) }));
      const next = payload as RadarDirectory;
      if (!controller.signal.aborted) {
        setDirectory(next);
        setFrames(safeFrames);
        const preserved = followLatest.current
          ? safeFrames[0]
          : safeFrames.find(frame => frame.id === selectedIdRef.current);
        const selected = preserved ?? safeFrames[0] ?? null;
        selectedIdRef.current = selected?.id ?? null;
        if (!preserved && selected) followLatest.current = true;
        setSelectedId(selected?.id ?? null);
      }
    } catch (cause) {
      if (!controller.signal.aborted || timedOut) {
        setDirectory(null);
        setFrames([]);
        selectedIdRef.current = null;
        setSelectedId(null);
        setError(timedOut || (cause instanceof Error && cause.name === 'TimeoutError')
          ? '雷达目录请求超时，请重试'
          : cause instanceof Error ? cause.message : '雷达服务请求失败');
      }
    } finally {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted || timedOut) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      request.current?.abort();
      setDirectory(null);
      setFrames([]);
      selectedIdRef.current = null;
      setSelectedId(null);
      setError('');
      setLoading(false);
      return;
    }
    void refresh();
    return () => request.current?.abort();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const selectedIndex = frames.findIndex(frame => frame.id === selectedId);
  return {
    directory,
    frames,
    selectedFrame: selectedIndex >= 0 ? frames[selectedIndex] : null,
    selectedIndex,
    loading,
    error,
    latestAgeMinutes: radarAgeMinutes(directory?.latestAt ?? null, clock),
    generation,
    refresh,
    select: (index: number) => {
      const frame = frames[index] ?? null;
      selectedIdRef.current = frame?.id ?? null;
      followLatest.current = index === 0;
      setSelectedId(frame?.id ?? null);
    },
  };
}
