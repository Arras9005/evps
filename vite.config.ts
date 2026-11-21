import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/** 开发时后端（npm run dev:server）的端口 */
const API = 'http://127.0.0.1:6790';

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
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        // 后端只接受来自它自己地址的改动请求；开发时页面在 5174 上，转发前把来源换成后端的地址
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', API);
          });
        },
      },
    },
  },
});
