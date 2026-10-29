import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.WARDEN_API ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
  },
});
