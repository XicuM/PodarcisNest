#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distEntry = path.join(rootDir, 'dist', 'cli', 'index.js');

if (fs.existsSync(distEntry)) {
  import(distEntry);
} else {
  // Fallback to running directly via tsx if running uncompiled
  import('child_process').then(({ spawn }) => {
    const srcEntry = path.join(rootDir, 'src', 'cli', 'index.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', srcEntry, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });
}
