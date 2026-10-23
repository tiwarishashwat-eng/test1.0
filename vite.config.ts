import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // The dev server otherwise serves any file under the project root over HTTP,
      // including .data/users.json (password hashes) and server source code.
      fs: {
        strict: true,
        allow: ['src', 'index.html', 'public', 'node_modules'],
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/src/server/**'],
      },
    },
  };
});
