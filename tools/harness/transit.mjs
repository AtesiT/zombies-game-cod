// Node/software-canvas stress probe. Not a browser FPS or DevTools memory claim.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M = await load(),
  data = JSON.parse(await readFile(new URL('../../assets/maps/registry.json', import.meta.url)));
const g = new M.Game(new M.Input(nc(800, 500)));
await g.mapManager.load('', async () => ({ ok: true, json: async () => data }));
g.playMap('terminal-transit');
g.debug.god = true;
g.player.hurt = () => false;
g.roundActive = false;
g.intermission = 1e9;
for (let i = 0; i < 100; i++) {
  const z = g.makeZombie({ x: 700 + (i % 10) * 18, y: 470 + Math.floor(i / 10) * 19 }, 'walker');
  z.state = 1;
  g.zombies.push(z);
}
const ctx = nc(800, 500).getContext('2d'),
  seconds = Number(process.argv[2] ?? 10),
  times = [];
let maxNodes = 0,
  maxRoutes = 0,
  maxContacts = 0;
for (let frame = 0; frame < seconds * 60; frame++) {
  g.bus.body.hp = 2000;
  // stationary armored target stresses routing/contact without clearing the crowd
  g.bus.body.driving = true;
  const t = performance.now();
  g.update(1 / 60);
  g.draw(ctx);
  times.push(performance.now() - t);
  g.input.endFrame();
  maxNodes = Math.max(maxNodes, g.bus.navigation.expansions);
  maxRoutes = Math.max(maxRoutes, g.bus.navigation.cache.size);
  maxContacts = Math.max(maxContacts, g.bus.contacts.size);
  assert.ok(maxNodes <= 1200);
  assert.ok(Number.isFinite(g.bus.body.pos.x));
  for (const z of g.zombies) assert.ok(Number.isFinite(z.pos.x) && Number.isFinite(z.pos.y));
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      simulationSeconds: seconds,
      zombies: g.zombies.length,
      softwareFrameMedianMs: +times[Math.floor(times.length * 0.5)].toFixed(2),
      softwareFrameP95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
      maxNavigationExpansions: maxNodes,
      maxCachedRoutes: maxRoutes,
      maxContactRecords: maxContacts,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    },
    null,
    2,
  ),
);
g.bus.dispose();
assert.equal(g.bus.contacts.size, 0);
console.log('TRANSIT STRESS PASS');
