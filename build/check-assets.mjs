/**
 * Verify that every module asset referenced from packs/_source/**\/*.json exists on disk,
 * and warn about orphaned scene thumbnails (Foundry regenerates `<id>-thumb.webp` on scene
 * save, so an unpack can leave stale files behind).
 *
 * Usage: node build/check-assets.mjs   (also run automatically by packs.mjs)
 * Exit code 1 when a referenced asset is missing; orphans only warn.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleId = JSON.parse(readFileSync(resolve(rootDir, 'module.json'), 'utf8')).id;
const prefix = `modules/${moduleId}/`;
const scenesDir = 'assets/scenes';

function* walkJson(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walkJson(full);
    else if (name.endsWith('.json')) yield full;
  }
}

function* collectPaths(value, keyPath = '') {
  if (typeof value === 'string') {
    if (value.startsWith(prefix)) yield { keyPath, value };
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* collectPaths(value[i], `${keyPath}[${i}]`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* collectPaths(v, keyPath ? `${keyPath}.${k}` : k);
  }
}

export function checkAssets() {
  const sourceRoot = resolve(rootDir, 'packs/_source');
  if (!existsSync(sourceRoot)) return true;

  const referenced = new Set();
  const missing = [];

  for (const file of walkJson(sourceRoot)) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const { keyPath, value } of collectPaths(data)) {
      const rel = value.slice(prefix.length).split('?')[0];
      referenced.add(rel);
      if (!existsSync(resolve(rootDir, rel))) missing.push({ file: file.replace(rootDir, '').replace(/^[\\/]/, ''), keyPath, rel });
    }
  }

  const scenesAbs = resolve(rootDir, scenesDir);
  const orphans = existsSync(scenesAbs)
    ? readdirSync(scenesAbs).filter(f => f.endsWith('-thumb.webp') && !referenced.has(`${scenesDir}/${f}`))
    : [];

  for (const o of orphans) console.warn(`Warning: orphaned thumbnail ${scenesDir}/${o} (no scene references it)`);

  if (missing.length) {
    console.error('\nMissing assets referenced by pack source:');
    for (const m of missing) console.error(`  ${m.rel}\n    <- ${m.file} (${m.keyPath})`);
    console.error('');
    return false;
  }

  console.log(`Asset check OK (${referenced.size} referenced, ${orphans.length} orphaned thumbnail(s)).`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(checkAssets() ? 0 : 1);
}
