import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MapManager } from '../src/systems/map/MapManager.js';
import { validateRegistry } from '../src/systems/map/MapSchema.js';
const data = JSON.parse(await readFile(new URL('../assets/maps/registry.json', import.meta.url)));
const response = value => ({ ok: true, json: async () => structuredClone(value) });
test('valid registry, distinct layouts and metadata', () => {
  validateRegistry(data);
  assert.equal(new Set(data.maps.map(m => m.level.rows.join(''))).size, 3);
  const duplicate = structuredClone(data); duplicate.maps.push(duplicate.maps[0]);
  assert.throws(() => validateRegistry(duplicate), /Duplicate/);
  const bad = structuredClone(data); bad.maps[0].level.start.x = -1;
  assert.throws(() => validateRegistry(bad), /start/);
});
test('selection events and failed refresh preserve current registry', async () => {
  const manager = new MapManager();
  assert.equal(await manager.load('', async () => response(data)), true);
  let seen; const off = manager.on('map:loaded', m => seen = m);
  manager.select(data.maps[0].id); assert.equal(seen.id, data.maps[0].id);
  assert.throws(() => manager.select('missing')); assert.equal(manager.current, seen);
  assert.equal(await manager.load('', async () => ({ ok: false, status: 503 })), false);
  assert.equal(manager.maps.length, 3); off(); manager.dispose();
});
test('out-of-order fetch cannot overwrite newer result', async () => {
  const manager = new MapManager(); let resolve;
  const first = manager.load('', () => new Promise(r => resolve = r));
  await manager.load('', async () => response(data));
  resolve({ ok: false, status: 404 }); await first;
  assert.equal(manager.status, 'ready');
});
test('all maps simulate, spawn, draw, reset and preserve legacy range', async () => {
  const { nc, load } = await import('../tools/harness/stub.mjs');
  const M = await load(); const g = new M.Game(new M.Input(nc()));
  await g.mapManager.load('', async () => response(data));
  const ctx = nc(800, 500).getContext('2d');
  const canvases = [];
  for (const map of data.maps) {
    g.scene = 'maps'; g.started = false;
    const rows = M.menuRows('maps', g);
    g.menuIndex = rows.findIndex(r => r.id === `map:${map.id}`);
    g.input.mouse.x = 0; g.input.mouse.y = 0;
    g.input.pressed.add('Enter'); g.update(1/60); g.input.endFrame();
    assert.equal(g.started, true);
    g.powerOn = true; g.player.hurt = () => false;
    canvases.push(g.map.staticCanvas);
    assert.equal(g.map.floorName, map.name);
    assert.equal(g.map.floors.length, 1);
    for (let i = 0; i < 360; i++) { g.update(1/60); g.input.endFrame(); if (i % 60 === 0) g.draw(ctx); }
    assert.ok(g.zombies.length > 0);
    assert.ok(Number.isFinite(g.player.pos.x));
    g.reset(); assert.equal(g.map.definition.id, map.id);
  }
  assert.equal(new Set(canvases).size, 3, 'static level cache must not share different layouts');
  g._loadMap(true); assert.ok(g.map.rangePads.length);
  g.mapManager.select(null); g._loadMap(false); assert.equal(g.map.floors.length, 3);
});
