import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NEXT_PUBLIC_TIANDITU_KEY': JSON.stringify(
      loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')
        .NEXT_PUBLIC_TIANDITU_KEY ?? '',
    ),
  },
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
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
