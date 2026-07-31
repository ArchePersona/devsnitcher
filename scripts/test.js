import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const root = join(import.meta.dirname, '..');
const testFile = join(root, 'tests', 'devsnitcher.test.ts');
const outFile = join(root, '.test.cjs');

try {
  await build({
    entryPoints: [testFile],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    logLevel: 'info',
    write: true,
    outfile: outFile,
    external: ['node:test', 'node:assert', 'jsdom'],
  });
} catch (e) {
  console.error('Test build failed:', e);
  process.exit(1);
}

if (!existsSync(outFile)) {
  console.error('Bundled test file not found:', outFile);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', outFile], {
  stdio: 'inherit',
  env: { ...process.env, TS_MODE: '1' },
});

process.exit(result.status ?? 0);
