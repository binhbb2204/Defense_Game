import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'watch-workspace-packages',
      configureServer(server) {
        server.watcher.add([
          path.resolve(__dirname, '../../packages/vfx'),
          path.resolve(__dirname, '../../packages/shared'),
        ]);
      },
    },
  ],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'three',
      'three-mesh-bvh',
      'zustand',
    ],
    exclude: ['@tactical-td/vfx', '@tactical-td/shared'],
  },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@enemies-assets': path.resolve(__dirname, '../../packages/shared/enemies'),
      '@towers-assets': path.resolve(__dirname, '../../packages/shared/towers'),
    },
  },
  assetsInclude: ['**/*.glb', '**/*.fbx'],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    fs: {
      // Allow serving single-source-of-truth assets directly from packages/shared/
      allow: [path.resolve(__dirname, '../..')],
    },
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three-mesh-bvh'],
          react: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
});
