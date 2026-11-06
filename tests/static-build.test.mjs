import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'tools', 'build-web.mjs');

async function jsFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('static web build is self-contained and keeps module paths portable', async () => {
  const output = path.join(ROOT, `.static-build-test-${process.pid}`);
  const relativeOutput = path.relative(ROOT, output);
  try {
    const run = spawnSync(process.execPath, [BUILD, relativeOutput], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /href="\.\/styles\.css"/);
    assert.match(html, /href="\.\/manifest\.webmanifest"/);
    assert.match(html, /src="\.\/game-config\.js"/);
    assert.match(html, /src="\.\/src\/main\.js"/);
    assert.doesNotMatch(html, /(?:src|href)="\//, 'site asset URLs must not assume domain-root hosting');

    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok((await stat(path.join(output, 'icons', 'app-icon.svg'))).isFile());
    assert.ok((await stat(path.join(output, 'game-config.js'))).isFile());
    assert.ok((await stat(path.join(output, 'src', 'main.js'))).isFile());
    assert.equal(await stat(path.join(output, 'server.mjs')).then(() => true, () => false), false);
    assert.equal(await stat(path.join(output, 'README.md')).then(() => true, () => false), false);

    const files = await jsFiles(path.join(output, 'src'));
    assert.ok(files.length > 10, 'expected all game modules in the static package');
    for (const filename of files) {
      const source = await readFile(filename, 'utf8');
      const imports = source.matchAll(/\b(?:from\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g);
      for (const [, specifier] of imports) {
        const dependency = path.resolve(path.dirname(filename), specifier);
        assert.ok(await stat(dependency).then(() => true, () => false), `${path.relative(output, filename)} imports missing ${specifier}`);
      }
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('GitHub Pages workflow deploys from the session branch or main', async () => {
  const workflow = await readFile(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(workflow, /npm run build:web/);
  assert.match(workflow, /path: dist/);
  assert.match(workflow, /deploy-pages@/);
  assert.match(workflow, /arena\/852e1f6a-zombies-game-cod/);
  assert.match(workflow, /main/);
});

test('presentation exports and their generator tree are not part of the app branch', async () => {
  for (const filename of [
    'presentation_variants',
    'docs/assets/presentation',
    'tools/generate_presentation.py',
    'tools/generate_presentation_09.py',
  ]) {
    assert.equal(await stat(path.join(ROOT, filename)).then(() => true, () => false), false, `${filename} should be absent`);
  }
});
