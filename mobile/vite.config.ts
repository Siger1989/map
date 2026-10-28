import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import mobileHasCompatibility from '../scripts/mobile-has-compat.mjs';
import mobileViewportCompatibility from '../scripts/mobile-css-compat.mjs';
import mobileWorkerCompatibility from '../scripts/mobile-worker-compat.mjs';
import layoutEditor from '../tools/layout-editor/plugin.mjs';
import { mapTileVitePlugin } from '../tools/map-tile-proxy.mjs';
import { apkPreviewSeeds } from '../tools/apk-preview-seeds.mjs';
import { createPreviewWatchIgnore } from '../tools/previewWatchIgnore.mjs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const privatePreview = mode === 'apk-preview' || mode === 'native-hybrid';
  const env: Record<string, string> = mode === 'public' ? {} : loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  return ({
  worker: { format: 'es' },
  define: {
    'process.env.NEXT_PUBLIC_SHANTU_APK_PREVIEW': JSON.stringify(privatePreview ? '1' : ''),
    'process.env.NEXT_PUBLIC_TIANDITU_KEY': JSON.stringify(
      env.NEXT_PUBLIC_TIANDITU_KEY ?? '',
    ),
  },
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  // APK requests use LocalGateway. Browser-only mobile previews need the web API server.
  server: {
    // Packaging output must not reload an in-progress map preview.
    watch: { ignored: createPreviewWatchIgnore(projectRoot) },
    proxy: {
      '/api': {
        target: process.env.SHANTU_DEV_API_URL || 'http://localhost:3108',
        changeOrigin: true,
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)) } },
  plugins: [
    ...(mode === 'native-hybrid' ? [{
      name: 'native-hybrid-local-document',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "frame-src 'none'; object-src 'none'; base-uri 'self'" }, injectTo: 'head' as const }],
    }] : []),
    apkPreviewSeeds({ enabled: privatePreview, privatePath: fileURLToPath(new URL('../.openai/default-map-sources-private.json', import.meta.url)) }), mapTileVitePlugin(), react(), mobileWorkerCompatibility(), layoutEditor()],
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        mobileViewportCompatibility(),
        mobileHasCompatibility(),
      ],
    },
  },
  build: {
    outDir: mode === 'native-hybrid' ? 'dist-hybrid' : 'dist',
    emptyOutDir: true,
    target: 'chrome99',
    cssTarget: 'chrome99',
    cssMinify: 'lightningcss',
    sourcemap: false,
  },
  });
});
