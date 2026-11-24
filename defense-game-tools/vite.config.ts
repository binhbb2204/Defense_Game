import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_ROOT = path.resolve(__dirname, '../packages/shared');

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sanitizeId(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeFileName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const base = path.basename(raw.trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizePreviewRole(raw: unknown): 'normal' | 'spawn' | 'base' {
  return raw === 'spawn' || raw === 'base' ? raw : 'normal';
}

function extractMapPreview(parsed: Record<string, unknown>) {
  const nodes: Array<{ x: number; z: number; role: 'normal' | 'spawn' | 'base' }> = [];
  const edges: Array<{ x1: number; z1: number; x2: number; z2: number; cx?: number; cz?: number }> = [];

  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : null;
  const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : null;
  const rawPaths = Array.isArray(parsed.paths) ? parsed.paths : null;
  const rawWaypoints = Array.isArray(parsed.waypoints) ? parsed.waypoints : [];

  if (rawNodes && rawSegs) {
    const byId = new Map<string, { x: number; z: number; role: 'normal' | 'spawn' | 'base' }>();
    for (const item of rawNodes) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.id === 'string' && typeof rec.x === 'number' && typeof rec.z === 'number') {
        const node = { x: rec.x, z: rec.z, role: normalizePreviewRole(rec.role) };
        byId.set(rec.id, node);
        nodes.push(node);
      }
    }
    for (const item of rawSegs) {
      const seg = item as Record<string, unknown>;
      const a = typeof seg.a === 'string' ? byId.get(seg.a) : undefined;
      const b = typeof seg.b === 'string' ? byId.get(seg.b) : undefined;
      if (!a || !b) continue;
      const ctrl = seg.control as Record<string, unknown> | undefined;
      const hasCtrl =
        ctrl &&
        typeof ctrl.x === 'number' &&
        Number.isFinite(ctrl.x) &&
        typeof ctrl.z === 'number' &&
        Number.isFinite(ctrl.z);
      edges.push(
        hasCtrl
          ? { x1: a.x, z1: a.z, x2: b.x, z2: b.z, cx: ctrl.x as number, cz: ctrl.z as number }
          : { x1: a.x, z1: a.z, x2: b.x, z2: b.z },
      );
    }
    return { nodes, edges };
  }

  if (rawPaths) {
    for (const p of rawPaths) {
      const pNodes = Array.isArray((p as { nodes?: unknown[] }).nodes)
        ? ((p as { nodes: unknown[] }).nodes as Array<Record<string, unknown>>)
        : [];
      let prev: { x: number; z: number } | null = null;
      for (let i = 0; i < pNodes.length; i++) {
        const pt = pNodes[i];
        if (typeof pt.x !== 'number' || typeof pt.z !== 'number') continue;
        const role: 'normal' | 'spawn' | 'base' =
          i === 0 ? 'spawn' : i === pNodes.length - 1 ? 'base' : 'normal';
        nodes.push({ x: pt.x, z: pt.z, role });
        if (prev) edges.push({ x1: prev.x, z1: prev.z, x2: pt.x, z2: pt.z });
        prev = { x: pt.x, z: pt.z };
      }
    }
    return { nodes, edges };
  }

  let prev: { x: number; z: number } | null = null;
  for (let i = 0; i < rawWaypoints.length; i++) {
    const wp = rawWaypoints[i] as Record<string, unknown>;
    if (typeof wp.x !== 'number' || typeof wp.z !== 'number') continue;
    const role: 'normal' | 'spawn' | 'base' =
      i === 0 ? 'spawn' : i === rawWaypoints.length - 1 ? 'base' : 'normal';
    nodes.push({ x: wp.x, z: wp.z, role });
    if (prev) edges.push({ x1: prev.x, z1: prev.z, x2: wp.x, z2: wp.z });
    prev = { x: wp.x, z: wp.z };
  }
  return { nodes, edges };
}

/**
 * Vite Dev Middleware plugin allowing the Browser Studio UI to persist edited
 * maps, waves, towers, uploaded 3D assets, and composite .glb scenes straight
 * back into `packages/shared/`.
 */
function sharedJsonWriterPlugin(): Plugin {
  return {
    name: 'defense-game-shared-writer',
    configureServer(server) {
      server.middlewares.use('/api/shared', async (req, res, next) => {
        const route = (req.url || '').split('?')[0];

        if (req.method === 'GET' && route === '/maps') {
          const mapsDir = path.join(SHARED_ROOT, 'maps');
          if (!fs.existsSync(mapsDir)) {
            sendJson(res, 200, { ok: true, maps: [] });
            return;
          }
          const files = fs
            .readdirSync(mapsDir, { withFileTypes: true })
            .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.json'))
            .map((d) => d.name)
            .sort();
          const maps = files.map((fileName) => {
            try {
              const raw = fs.readFileSync(path.join(mapsDir, fileName), 'utf8');
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : null;
              const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : null;
              const rawPaths = Array.isArray(parsed.paths) ? parsed.paths : null;
              const rawWaypoints = Array.isArray(parsed.waypoints) ? parsed.waypoints : [];

              let nodeCount = 0;
              let segmentCount = 0;
              if (rawNodes && rawSegs) {
                nodeCount = rawNodes.length;
                segmentCount = rawSegs.length;
              } else if (rawPaths) {
                for (const p of rawPaths) {
                  const nodes = (p as { nodes?: unknown[] }).nodes;
                  const len = Array.isArray(nodes) ? nodes.length : 0;
                  nodeCount += len;
                  segmentCount += Math.max(0, len - 1);
                }
              } else {
                nodeCount = rawWaypoints.length;
                segmentCount = Math.max(0, rawWaypoints.length - 1);
              }
              const obstacleCount = Array.isArray(parsed.obstacles)
                ? parsed.obstacles.length
                : 0;
              return {
                id:
                  typeof parsed.id === 'string' && parsed.id.trim().length > 0
                    ? parsed.id
                    : fileName.replace(/\.json$/i, ''),
                name:
                  typeof parsed.name === 'string' && parsed.name.trim().length > 0
                    ? parsed.name
                    : fileName,
                fileName,
                version: typeof parsed.version === 'number' ? parsed.version : 1,
                nodeCount,
                segmentCount,
                obstacleCount,
                preview: extractMapPreview(parsed),
              };
            } catch {
              return {
                id: fileName.replace(/\.json$/i, ''),
                name: fileName,
                fileName,
                version: 1,
                nodeCount: 0,
                segmentCount: 0,
                obstacleCount: 0,
              };
            }
          });
          sendJson(res, 200, { ok: true, maps });
          return;
        }

        if (req.method === 'GET' && route.startsWith('/maps/')) {
          const mapId = sanitizeId(decodeURIComponent(route.slice('/maps/'.length)), '');
          if (!mapId) {
            sendJson(res, 400, { ok: false, error: 'Invalid map id' });
            return;
          }
          const mapPath = path.join(SHARED_ROOT, 'maps', `${mapId}.json`);
          if (!fs.existsSync(mapPath)) {
            sendJson(res, 404, { ok: false, error: `Template "${mapId}" not found` });
            return;
          }
          try {
            const parsed = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            sendJson(res, 200, { ok: true, map: parsed });
          } catch (err) {
            sendJson(res, 500, {
              ok: false,
              error: err instanceof Error ? err.message : 'Failed to parse map template',
            });
          }
          return;
        }

        if (req.method === 'GET' && route.startsWith('/assets/')) {
          const assetName = sanitizeFileName(route.slice('/assets/'.length), '');
          if (!assetName) {
            res.statusCode = 400;
            res.end('Invalid asset name');
            return;
          }
          const assetPath = path.join(SHARED_ROOT, 'maps', 'assets', assetName);
          if (!fs.existsSync(assetPath)) {
            res.statusCode = 404;
            res.end('Asset not found');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/octet-stream');
          fs.createReadStream(assetPath).pipe(res);
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;

          if (route === '/map') {
            const id = sanitizeId(body.id, 'custom_map');
            const targetPath = path.join(SHARED_ROOT, 'maps', `${id}.json`);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true, filePath: `packages/shared/maps/${id}.json` });
            return;
          }

          if (route === '/upload-asset') {
            const fileName = sanitizeFileName(body.fileName, 'model.glb');
            const base64Data = typeof body.base64 === 'string' ? body.base64 : '';
            if (!base64Data) {
              sendJson(res, 400, { ok: false, error: 'Missing base64 asset payload' });
              return;
            }
            const buffer = Buffer.from(base64Data, 'base64');
            const targetPath = path.join(SHARED_ROOT, 'maps', 'assets', fileName);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, buffer);
            sendJson(res, 200, {
              ok: true,
              fileName,
              byteLength: buffer.length,
              filePath: `packages/shared/maps/assets/${fileName}`,
            });
            return;
          }

          if (route === '/save-scene-glb') {
            const id = sanitizeId(body.id, 'custom_map');
            const glbBase64 = typeof body.glbBase64 === 'string' ? body.glbBase64 : '';
            if (!glbBase64) {
              sendJson(res, 400, { ok: false, error: 'Missing glbBase64 payload' });
              return;
            }
            const buffer = Buffer.from(glbBase64, 'base64');
            const targetPath = path.join(SHARED_ROOT, 'maps', `${id}_scene.glb`);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, buffer);
            sendJson(res, 200, {
              ok: true,
              byteLength: buffer.length,
              filePath: `packages/shared/maps/${id}_scene.glb`,
            });
            return;
          }

          if (route === '/waves') {
            const mapId = sanitizeId(body.mapId, 'highway_01');
            const waves = Array.isArray(body.waves) ? body.waves : [];
            const targetPath = path.join(SHARED_ROOT, 'waves', `${mapId}.json`);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, `${JSON.stringify(waves, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true, filePath: `packages/shared/waves/${mapId}.json` });
            return;
          }

          if (route === '/tower') {
            const id = sanitizeId(body.id, 'custom_tower');
            const towersDir = path.join(SHARED_ROOT, 'towers');
            const existingDirs = fs.existsSync(towersDir)
              ? fs.readdirSync(towersDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
              : [];
            const folderName =
              existingDirs.find((d) => d.toLowerCase() === id.toLowerCase()) ||
              (id.charAt(0).toUpperCase() + id.slice(1));
            const targetPath = path.join(towersDir, folderName, `${id}.json`);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true, filePath: `packages/shared/towers/${folderName}/${id}.json` });
            return;
          }

          sendJson(res, 404, { ok: false, error: `Unknown /api/shared route: ${route}` });
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to write JSON',
          });
        }
      });
    },
  };
}

function workspaceWatchPlugin(): Plugin {
  return {
    name: 'watch-workspace-packages',
    configureServer(server) {
      server.watcher.add([
        path.resolve(__dirname, '../packages/vfx'),
        path.resolve(__dirname, '../packages/shared'),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sharedJsonWriterPlugin(), workspaceWatchPlugin()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'three',
      'three/examples/jsm/controls/TransformControls.js',
      'three/examples/jsm/exporters/GLTFExporter.js',
      'three/examples/jsm/loaders/FBXLoader.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/OBJLoader.js',
    ],
    exclude: ['@tactical-td/vfx', '@tactical-td/shared'],
  },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@towers-assets': path.resolve(__dirname, '../packages/shared/towers'),
    },
  },
  assetsInclude: ['**/*.glb'],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
