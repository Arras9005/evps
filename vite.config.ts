import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { entryFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:6790' } },
});
