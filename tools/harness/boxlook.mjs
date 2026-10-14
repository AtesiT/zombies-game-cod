// Headless harness: the mystery box must not be mistaken for furniture.
// The map is full of sandbag piles and ammo cans; the one crate that sells
// guns has to read differently at a glance -- pulsing gold against olive
// drab. We render the spawn view and compare the box's pixels with the
// nearest prop's pixels.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const H = 1 / 120;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 20251010;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
g.input.mouse.x = 400; g.input.mouse.y = 100;
for (let f = 0; f < 60; f++) { g.player.hp = 100; g.update(H); }

const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.draw(cx);
const img = cx.getImageData(0, 0, M.VW, M.VH).data;

const sx = (wx) => Math.round(wx - g.cam.x);
const sy = (wy) => Math.round(wy - g.cam.y);
function crop(px, py, r) {
  const out = [];
  for (let y = py - r; y <= py + r; y++) {
    for (let x = px - r; x <= px + r; x++) {
      if (x < 0 || y < 0 || x >= M.VW || y >= M.VH) continue;
      const i = (y * M.VW + x) * 4;
      out.push([img[i], img[i + 1], img[i + 2]]);
    }
  }
  return out;
}
const mean = (c) => c.reduce((a, [r, gg, b]) => [a[0] + r, a[1] + gg, a[2] + b], [0, 0, 0]).map((v) => v / c.length);

// the box and a sandbag pile near the spawn room
const box = g.box.spot;
ok(!!box, 'the box has no spot');
// nearest solid prop that is not the box: the sandbags above the spawn
const TILE = 24;
let prop = null;
const { GameMap } = await import(SRC + '/map.js');
// scan tiles around the player for CRATE (sandbag) tiles
const CRATE = 5; // art.js TILE.CRATE
for (let ty = 8; ty < 20 && !prop; ty++) {
  for (let tx = 12; tx < 28 && !prop; tx++) {
    const t = g.map.tiles[ty * g.map.w + tx];
    if (t === CRATE) prop = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
}
ok(!!prop, 'no sandbag pile found near the spawn to compare against');

const b = crop(sx(box.x), sy(box.y), 12);
const c = crop(sx(prop.x), sy(prop.y), 10);
const mb = mean(b), mc = mean(c);
const diff = Math.abs(mb[0] - mc[0]) + Math.abs(mb[1] - mc[1]) + Math.abs(mb[2] - mc[2]);
ok(diff > 30, `box and sandbags read too similar (mean channel diff ${diff.toFixed(1)})`);

// the box must contain bright gold pixels (the pulsing ? plate)
const gold = b.filter(([r, gg, bb]) => r > 190 && gg > 150 && bb < 140).length;
ok(gold >= 8, `no glowing ? plate on the closed box (gold px ${gold})`);

// and the sandbag pile must contain none of that gold
const goldC = c.filter(([r, gg, bb]) => r > 190 && gg > 150 && bb < 140).length;
ok(goldC < 4, `the sandbag pile glows gold like the box (${goldC} px)`);

if (fails.length) { console.error('BOXLOOK FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log(`BOXLOOK PASS  box mean [${mb.map((v) => v | 0)}] vs sandbags [${mc.map((v) => v | 0)}], diff ${diff.toFixed(1)}, gold px ${gold}`);
