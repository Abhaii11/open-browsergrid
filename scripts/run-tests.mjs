import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';

function collectTestFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

const testFiles = collectTestFiles('tests');
if (testFiles.length === 0) {
  console.error('No *.test.ts files found in tests/');
  process.exit(1);
}

const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
const result = spawnSync(process.execPath, [tsxCli, '--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
