// Software Canvas integration/stress; not browser FPS or DevTools memory certification.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M = await load(),
  data = JSON.parse(await readFile(new URL('../../assets/maps/registry.json', import.meta.url)));
const seconds = Number(process.argv[2] ?? 15);
const penetrates = (map, e) => {
  for (let y = Math.floor((e.pos.y - e.r) / 24); y <= Math.floor((e.pos.y + e.r) / 24); y++)
    for (let x = Math.floor((e.pos.x - e.r) / 24); x <= Math.floor((e.pos.x + e.r) / 24); x++) {
      if (!map.solidAt(x, y)) continue;
      const nx = Math.max(x * 24, Math.min(x * 24 + 24, e.pos.x)),
        ny = Math.max(y * 24, Math.min(y * 24 + 24, e.pos.y));
      if ((e.pos.x - nx) ** 2 + (e.pos.y - ny) ** 2 < e.r ** 2 - 0.01) return true;
    }
  return false;
};
for (const id of ['neon-night-market', 'blackwood-logging-camp']) {
  const g = new M.Game(new M.Input(nc(800, 500)));
  await g.mapManager.load('', async () => ({ ok: true, json: async () => structuredClone(data) }));
  g.playMap(id);
  if (process.env.ABLATE_ENV === '1') {
    g.environment.draw = () => {};
    g.environment.drawHUD = () => {};
    g.environment.addLights = () => {};
  }
  if (process.env.ABLATE_ENV === 'lights') g.environment.addLights = () => {};
  if (process.env.ABLATE_ENV === 'zones') g.environment.hazards.draw = () => {};
  g.debug.god = true;
  g.roundActive = false;
  g.intermission = 1e9;
  let spawn = 0;
  const add = () => {
    const s = g.map.spawnPoints[spawn++ % g.map.spawnPoints.length];
    const z = g.makeZombie({ ...s, floor: 0 }, 'walker');
    z.pos = { x: s.x, y: s.y };
    z.state = 1;
    g.zombies.push(z);
  };
  while (g.zombies.length < 100) add();
  for (const item of g.environment.destructibles.items)
    g.environment.destructibles.hit(item, 10000);
  const canvas = nc(800, 500),
    ctx = canvas.getContext('2d'),
    times = [],
    updateTimes = [],
    drawTimes = [];
  let maxEffects = 0,
    maxZones = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    g.zombies = g.zombies.filter((z) => !z.dead && !z.remove);
    while (g.zombies.length < 100) add();
    const t = performance.now();
    g.update(1 / 60);
    const drawStart = performance.now();
    g.draw(ctx);
    const end = performance.now();
    updateTimes.push(drawStart - t);
    drawTimes.push(end - drawStart);
    times.push(end - t);
    g.input.endFrame();
    assert.ok(Number.isFinite(g.player.pos.x));
    for (const z of g.zombies) {
      assert.ok(Number.isFinite(z.pos.x) && Number.isFinite(z.pos.y));
      assert.equal(
        penetrates(g.map, z),
        false,
        `zombie in wall/new cover ${id} frame=${frame} pos=${JSON.stringify(z.pos)} state=${z.state} tile=${g.map.tileAt(Math.floor(z.pos.x / 24), Math.floor(z.pos.y / 24))}`,
      );
    }
    maxEffects = Math.max(maxEffects, g.environment.effects.length);
    maxZones = Math.max(maxZones, g.environment.hazards.zones.length);
    assert.ok(maxEffects <= 64 && maxZones <= 32);
  }
  times.sort((a, b) => a - b);
  updateTimes.sort((a, b) => a - b);
  drawTimes.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        map: id,
        simulationSeconds: seconds,
        livingZombies: g.zombies.filter((z) => !z.dead).length,
        softwareMedianMs: +times[Math.floor(times.length * 0.5)].toFixed(2),
        softwareP95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
        updateP95Ms: +updateTimes[Math.floor(updateTimes.length * 0.95)].toFixed(2),
        drawP95Ms: +drawTimes[Math.floor(drawTimes.length * 0.95)].toFixed(2),
        maxEffects,
        maxZones,
        heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      },
      null,
      2,
    ),
  );
  const env = g.environment;
  g.reset();
  assert.equal(env.entities.length, 0);
  assert.equal(env.effects.length, 0);
  assert.equal(env.hazards.zones.length, 0);
}
console.log('ENVIRONMENT STRESS PASS');
