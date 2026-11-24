import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const outDir = path.join(pkgRoot, '.test-dist');
const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

fs.rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.test.json'], {
  cwd: pkgRoot,
  stdio: 'inherit',
});

if (compile.status !== 0) {
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(compile.status ?? 1);
}

fs.writeFileSync(path.join(outDir, 'package.json'), '{"type":"commonjs"}\n', 'utf8');

const testFiles = [
  path.join(outDir, 'path', '__tests__', 'pathModel.test.js'),
  path.join(outDir, 'path', '__tests__', 'roadGeometry.test.js'),
  path.join(outDir, 'path', '__tests__', 'roadShaping.test.js'),
  path.join(outDir, 'path', '__tests__', 'roadBuildMath.test.js'),
];
const run = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: pkgRoot,
  stdio: 'inherit',
});

fs.rmSync(outDir, { recursive: true, force: true });
process.exit(run.status ?? 1);
