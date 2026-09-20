import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: Number(new URL(env.APP_ORIGIN || 'http://localhost:5173').port),
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${env.PORT || 3001}`, xfwd: true } },
    },
    build: { outDir: 'dist/client' },
  };
});
