import { build, context } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const watch = process.argv.includes('--watch');

const classicEntries = {
  'content': join(root, 'extension', 'content', 'index.ts'),
};

const moduleEntries = {
  'background': join(root, 'extension', 'background', 'index.ts'),
  'popup': join(root, 'extension', 'popup', 'popup.ts'),
};

const assets = [
  ['manifest.json', join(root, 'manifest.json')],
  ['popup.html', join(root, 'extension', 'popup', 'popup.html')],
  ['popup.css', join(root, 'extension', 'popup', 'popup.css')],
];

function baseConfig(entries, format) {
  return {
    entryPoints: entries,
    bundle: true,
    format,
    sourcemap: false,
    logLevel: 'info',
    outdir: distDir,
    splitting: false,
    target: format === 'esm' ? 'es2022' : 'chrome110',
  };
}

function ensureDist() {
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  const iconsSrc = join(root, 'icons');
  const iconsDst = join(distDir, 'icons');
  if (existsSync(iconsSrc)) {
    if (existsSync(iconsDst)) {
      rmSync(iconsDst, { recursive: true, force: true });
    }
    cpSync(iconsSrc, iconsDst, { recursive: true });
  }
}

async function copyAssets() {
  ensureDist();
  for (const [name, src] of assets) {
    if (existsSync(src)) copyFileSync(src, join(distDir, name));
  }
}

async function runOnce() {
  await build(baseConfig(classicEntries, 'iife'));
  await build(baseConfig(moduleEntries, 'esm'));
  await copyAssets();
  console.log('Build complete: dist/ ready');
}

try {
  if (watch) {
    const ctxClassic = context(baseConfig(classicEntries, 'iife'));
    const ctxModule = context(baseConfig(moduleEntries, 'esm'));
    const [c, m] = await Promise.all([ctxClassic, ctxModule]);
    await c.watch();
    await m.watch();
    await copyAssets();
    console.log('Watching for changes...');
  } else {
    await runOnce();
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
