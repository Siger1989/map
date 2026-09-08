import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  worker: { format: 'es' },
  define: {
    'process.env.NEXT_PUBLIC_TIANDITU_KEY': JSON.stringify(
      loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')
        .NEXT_PUBLIC_TIANDITU_KEY ?? '',
    ),
  },
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  // APK requests use LocalGateway. Browser-only mobile previews need the web API server.
  server: {
    proxy: {
      '/api': {
        target: process.env.SHANTU_DEV_API_URL || 'http://localhost:3108',
        changeOrigin: true,
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)) } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
  },
}));
