// Four things a player reported, each of which had a root cause that no other
// test was watching:
//
//   * the settings panel was not centred (it was inset to dodge the BACK chip)
//   * the arrow keys did nothing in some menus (a mouse resting on the list put
//     the selection back in the same frame)
//   * the test range read "SCRAP undefined" (salvage is created by a campaign
//     round, and the range never starts one)
//   * the first press of TEST RANGE cost a frame (the map paints its floor)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const { settingsLayout, outfitsLayout, menuRows } = await import('../../src/hud.js');

const init = (w = 800, h = 500) => {
  const M = globalThis.__M ??= null;
  return M;
};
const game = async (w = 800, h = 500) => {
  const M = await load();
  const g = new M.Game(new M.Input(nc(w, h)));
  g.setViewport(w, h);
  return g;
};

test('the settings panel is centred on every screen there is', async () => {
  for (const [w, h] of [[800, 500], [1280, 800], [1920, 1080], [360, 640], [430, 930], [640, 360], [1024, 600], [700, 900]]) {
    const g = await game(w, h);
    const L = settingsLayout(g, w, h);
    const offX = L.cx + L.cw / 2 - w / 2;
    const offY = L.cy + L.ch / 2 - h / 2;
    assert.ok(Math.abs(offX) <= 1, `${w}x${h}: ${L.cw} wide panel is ${offX.toFixed(1)} px off centre`);
    assert.ok(Math.abs(offY) <= 1, `${w}x${h}: ${L.ch} tall panel is ${offY.toFixed(1)} px off centre`);
    assert.ok(L.cy >= 0 && L.cy + L.ch <= h, `${w}x${h}: the panel fits`);
  }
});

test('the arrows move a list even with the mouse parked on it', async () => {
  const press = (g, code, times = 3) => {
    for (let i = 0; i < times; i++) {
      g.input.pressed.add(code); g.update(1 / 60); g.input.pressed.clear();
      g.update(1 / 60);     // a frame with no press, as the real loop has
    }
  };

  // the front door
  {
    const g = await game();
    const n = menuRows('menu', g).length;
    g.input.mouse.x = g.vw / 2; g.input.mouse.y = 250;
    g.update(1 / 60); g.update(1 / 60);    // the hover settles here
    const before = g.menuIndex;
    press(g, 'ArrowDown');
    assert.equal(g.menuIndex, (before + 3) % n, 'the front door answers the arrows');
  }

  // the wardrobe
  {
    const g = await game();
    g.scene = 'outfits'; g.outfitIndex = 0;
    const L = outfitsLayout(g, g.vw, g.vh);
    g.input.mouse.x = g.vw / 2; g.input.mouse.y = L.cy + L.head + L.rowH;
    g.update(1 / 60); g.update(1 / 60);
    const before = g.outfitIndex;
    press(g, 'ArrowDown');
    assert.equal(g.outfitIndex, (before + 3) % L.rows, 'the wardrobe answers the arrows');
  }

  // the debug list: it used to snap back to the row under the cursor
  {
    const g = await game();
    g.debugOpen = true; g.debugIndex = 0; g.debugTop = 0;
    g.input.mouse.x = g.vw / 2; g.input.mouse.y = 120;
    g.update(1 / 60); g.update(1 / 60);
    const before = g.debugIndex;
    press(g, 'ArrowDown');
    assert.equal(g.debugIndex, before + 3, 'the debug list answers the arrows');
  }
});

test('the test range has scrap and medkits to read, not undefined', async () => {
  const g = await game();
  g._loadMap(true);
  assert.equal(g.player.salvage, 0, 'a fresh body carries a scrap count');
  assert.equal(g.player.medkits, 0, 'and a medkit count');
  const ctx = nc(g.vw, g.vh).getContext('2d');
  const drawn = [];
  const realFill = ctx.fillText.bind(ctx);
  ctx.fillText = (s, ...a) => { drawn.push(String(s)); return realFill(s, ...a); };
  g.hud.draw(ctx, g, g.vw, g.vh);
  assert.ok(drawn.some((s) => /^SCRAP \d+$/.test(s)), `SCRAP reads a number, saw ${drawn.filter((s) => s.includes('SCRAP')).join(' / ') || 'nothing'}`);
  assert.ok(!drawn.some((s) => s.includes('undefined')), 'nothing on the HUD is undefined');
});

test('the range is built before the first press, and handed over once', async () => {
  const g = await game();
  assert.equal(g._rangeCache ?? null, null, 'nothing is cached before the warm-up');
  assert.equal(g._prewarmRange(), true, 'the warm-up builds a range');
  const cached = g._rangeCache;
  assert.ok(cached, 'and keeps it');
  assert.equal(g._prewarmRange(), false, 'a second warm-up is a no-op');
  const t0 = performance.now();
  g._loadMap(true);
  const ms = performance.now() - t0;
  assert.equal(g.map, cached, 'the press takes the prewarmed map');
  assert.equal(g._rangeCache, null, 'and the cache is handed over, not shared');
  assert.ok(ms < 60, `opening the range takes ${ms.toFixed(0)} ms, not a painted floor`);
});
