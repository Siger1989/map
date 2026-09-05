import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { LayerSettings } from '../map/types';
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
type Actions = {
  read: () => unknown;
  configure: (
    patch: Partial<LayerSettings>,
    pitch?: number,
    bearing?: number,
  ) => void;
};
export function useMapTools(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const booleans = [
      'terrain',
      'satellite',
      'contours',
      'roads',
      'labels',
      'clouds',
      'rain',
    ] as const;
    const tools: Tool[] = [
      {
        name: 'get_weather_view',
        title: '读取地图与天气视图',
        description:
          "Read the visible map's layer states, camera, selected point, timestamps and terrain readiness.",
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => latest.current.read(),
      },
      {
        name: 'configure_weather_view',
        title: '调整地图视角和图层',
        description:
          'Set visible layers, satellite mode and camera pitch/bearing in the current weather map.',
        inputSchema: {
          type: 'object',
          properties: {
            ...Object.fromEntries(
              booleans.map((k) => [k, { type: 'boolean' }]),
            ),
            imageryMode: { type: 'string', enum: ['detail', 'latest'] },
            pitch: { type: 'number', minimum: 0, maximum: 80 },
            bearing: { type: 'number', minimum: -180, maximum: 180 },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('Expected a view configuration object');
          const args = input as Record<string, unknown>;
          const patch: Partial<LayerSettings> = {};
          for (const key of Object.keys(args)) {
            if (![...booleans, 'imageryMode', 'pitch', 'bearing'].includes(key))
              throw new Error('Unknown view field: ' + key);
          }
          for (const key of booleans)
            if (key in args) {
              if (typeof args[key] !== 'boolean')
                throw new Error(key + ' must be boolean');
              patch[key] = args[key];
            }
          if ('imageryMode' in args) {
            if (args.imageryMode !== 'detail' && args.imageryMode !== 'latest')
              throw new Error('Invalid imagery mode');
            patch.imageryMode = args.imageryMode;
          }
          for (const [key, min, max] of [
            ['pitch', 0, 80],
            ['bearing', -180, 180],
          ] as const)
            if (
              key in args &&
              (typeof args[key] !== 'number' ||
                !Number.isFinite(args[key]) ||
                args[key] < min ||
                args[key] > max)
            )
              throw new Error('Invalid ' + key);
          if (typeof args.pitch === 'number' && args.pitch > 0)
            patch.terrain = true;
          flushSync(() =>
            latest.current.configure(
              patch,
              args.pitch as number | undefined,
              args.bearing as number | undefined,
            ),
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return latest.current.read();
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser capability. */
      }
    }
    return () => lifecycle.abort();
  }, []);
}
