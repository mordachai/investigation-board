/**
 * Pack or unpack all compendium databases defined in module.json.
 * Usage: node build/packs.mjs [pack|unpack]
 *
 * fvtt CLI path semantics (v3):
 *   unpack: --in <dbParentDir>  (CLI appends packName to locate the DB)
 *           --out <exactSourceDir>  (files written directly here, no append)
 *   pack:   --in <exactSourceDir>  (CLI reads files directly from here)
 *           --out <dbParentDir>  (CLI appends packName to locate/create the DB)
 */
import { execSync } from 'child_process';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleJson = JSON.parse(readFileSync(resolve(rootDir, 'module.json'), 'utf8'));
const action = process.argv[2];

if (!['pack', 'unpack'].includes(action)) {
  console.error('Usage: node build/packs.mjs [pack|unpack]');
  process.exit(1);
}

// LevelDB requires exclusive access — fail early if Foundry has any pack locked.
// `fuser` is POSIX-only (used on CI/Linux runners); skip the check on Windows,
// where a locked LOCK file simply makes the pack command below fail loudly.
if (action === 'pack' && process.platform !== 'win32') {
  for (const pack of moduleJson.packs) {
    const lockPath = resolve(rootDir, pack.path, 'LOCK');
    if (!existsSync(lockPath)) continue;
    try {
      const pids = execSync(`fuser "${lockPath}" 2>/dev/null`).toString().trim();
      if (pids) {
        console.error(`\nError: "${pack.name}" pack is locked by PID ${pids}.`);
        console.error('Stop Foundry before running pack.\n');
        process.exit(1);
      }
    } catch { /* fuser exits non-zero when no process holds the lock — that's fine */ }
  }
}

for (const pack of moduleJson.packs) {
  // pack.path e.g. "packs/ib-scenes"
  const pathParts = pack.path.split('/');
  const dbParentDir = resolve(rootDir, pathParts.slice(0, -1).join('/'));
  const sourceDir = resolve(rootDir, 'packs/_source', pack.name);

  if (action === 'unpack') {
    mkdirSync(sourceDir, { recursive: true });
    console.log(`Unpacking ${pack.name} ...`);
    execSync(
      `npx fvtt package unpack -n "${pack.name}" --in "${dbParentDir}" --out "${sourceDir}"`,
      { stdio: 'inherit', cwd: rootDir }
    );
  } else {
    console.log(`Packing ${pack.name} ...`);
    execSync(
      `npx fvtt package pack -n "${pack.name}" --in "${sourceDir}" --out "${dbParentDir}"`,
      { stdio: 'inherit', cwd: rootDir }
    );
  }
}

console.log(`\nDone: ${action}`);
