import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    tsconfigPaths(),
  ],
  root: 'src/renderer',
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src/renderer'),
    },
  },
});