import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Settings come from apps/web-admin/.env (see .env.example).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { port: Number(env.PORT || 5174), proxy: { '/api': env.API_URL || 'http://localhost:4000' } },
  };
});
