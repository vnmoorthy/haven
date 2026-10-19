import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = process.env.HAVEN_API ?? 'http://localhost:8787';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'pages' ? '/haven/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/lab': target,
      '/forensics': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
}));
