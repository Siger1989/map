'use client';

import { useEffect, useRef, useState } from 'react';
import { Clipboard } from 'lucide-react';
import type { Coordinate } from '../navigation/types';
import { formatCoordinateQuery } from '../coordinates/coordinateQuery.ts';
import { writeClipboard } from '../platform/macNative';
import './annotationCoordinateInfo.css';

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

export type AnnotationCoordinateInfoProps = {
  annotationId: string;
  /** Internal WGS84 coordinate order: [longitude, latitude]. */
  coordinates: Coordinate;
  /** Ground elevation supplied by the caller's terrain sampler; null means unknown. */
  elevation: number | null;
  elevationStatus?: string;
  preview?: boolean;
};

function elevationMessage(elevation: number | null, status?: string): string {
  if (typeof elevation === 'number' && Number.isFinite(elevation)) return `海拔 ${elevation.toFixed(1)} m`;
  if (status && /loading|pending|sampling|查询中/i.test(status)) return '海拔采样中';
  return '海拔未取得';
}

export function AnnotationCoordinateInfo({
  annotationId,
  coordinates,
  elevation,
  elevationStatus,
  preview = false,
}: AnnotationCoordinateInfoProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const requestId = useRef(0);
  const mounted = useRef(false);
  const key = `${annotationId}\u0000${coordinates[0]}\u0000${coordinates[1]}`;
  const latestKey = useRef(key);
  latestKey.current = key;

  useEffect(() => {
    mounted.current = true;
    setCopyState('idle');
    requestId.current++;
    return () => {
      mounted.current = false;
      requestId.current++;
    };
  }, [key]);

  const copy = async () => {
    const currentKey = key;
    const currentRequest = ++requestId.current;
    setCopyState('copying');
    try {
      await writeClipboard(formatCoordinateQuery(coordinates));
      if (mounted.current && latestKey.current === currentKey && requestId.current === currentRequest) {
        setCopyState('copied');
      }
    } catch {
      if (mounted.current && latestKey.current === currentKey && requestId.current === currentRequest) {
        setCopyState('failed');
      }
    }
  };

  return (
    <section className="annotation-coordinate-info" aria-label="标记坐标信息" data-preview={preview || undefined}>
      <header>
        <strong>{preview ? '预览坐标 · WGS84' : '坐标 · WGS84'}</strong>
      </header>
      <div className="annotation-coordinate-info-values">
        <span>纬 {coordinates[1].toFixed(6)}°</span>
        <span>经 {coordinates[0].toFixed(6)}°</span>
        <button type="button" onClick={copy} disabled={copyState === 'copying'} aria-label="复制 Google Maps 格式坐标">
          <Clipboard size={13} aria-hidden="true" />
          <span>{copyState === 'copying' ? '复制中' : '复制坐标'}</span>
        </button>
      </div>
      <div className="annotation-coordinate-info-elevation">
        <span>{elevationMessage(elevation, elevationStatus)}</span>
      </div>
      <small role="status" aria-live="polite">
        {copyState === 'copied' ? '已复制，可粘贴到 Google Maps' :
          copyState === 'failed' ? '复制失败，请检查剪贴板权限' : ''}
      </small>
    </section>
  );
}
