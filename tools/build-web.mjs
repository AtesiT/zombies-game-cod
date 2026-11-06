#!/usr/bin/env node
// Prepare a dependency-free static web root for GitHub Pages, other static hosts,
// and the web assets consumed by Capacitor.
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedOutput = process.argv[2] ?? 'dist';
const output = path.resolve(root, requestedOutput);
if (output === root || !output.startsWith(`${root}${path.sep}`)) {
  throw new Error(`Output must be a child of the repository: ${requestedOutput}`);
}

const files = [
  'index.html',
  'styles.css',
  'game-config.js',
  'manifest.webmanifest',
  'icons',
  'src',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of files) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}

console.log(`Built static game at ${path.relative(root, output)}/index.html`);
console.log('Upload the contents of this directory to a static host.');
