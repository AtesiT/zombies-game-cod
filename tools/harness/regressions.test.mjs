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

test('a laptop with a touchscreen is still a laptop', async () => {
  const T = await import('../../src/touch.js');
  const hadMM = globalThis.matchMedia;
  const points = globalThis.navigator?.maxTouchPoints;
  const set = (mm) => { globalThis.matchMedia = (q) => ({ matches: mm(String(q)) }); };
  try {
    // a phone: one coarse pointer and nothing else
    set((q) => q.includes('(pointer: coarse)'));
    assert.equal(T.isTouchDevice(), true, 'a phone is a phone');

    // a laptop with a touchscreen, being driven with its mouse: the cursor and
    // the thumb stick belong to the mouse, not to the finger it also has
    set((q) => q.includes('(any-pointer: fine)'));
    const hadTouch = 'ontouchstart' in globalThis.window;
    globalThis.window.ontouchstart = null;
    try { Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 10 }, configurable: true }); } catch { /* node owns it */ }
    assert.equal(T.isTouchDevice(), false, 'a touchscreen laptop with a mouse keeps its cursor');

    // ...and folded into a tablet, where the finger is all there is
    set(() => true);
    assert.equal(T.isTouchDevice(), true, 'the same machine in tablet mode is a tablet');
    if (!hadTouch) delete globalThis.window.ontouchstart;
  } finally {
    if (hadMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = hadMM;
    try { Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: points ?? 0 }, configurable: true }); } catch { /* ignore */ }
  }
});

test('a hound carries no pool of light, a walker still does', async () => {
  const M = await load();
  const mk = (type) => {
    const g = new M.Game(new M.Input(nc(800, 500)));
    g.setViewport(800, 500); g.begin(); g.startRound(8);
    g.banner = null; g.zombies.length = 0;
    const z = g.makeZombie({ x: g.player.pos.x + 30, y: g.player.pos.y + 8, floor: g.player.floor }, type);
    z.state = 0; z.emergeT = 0; g.zombies.push(z);
    for (let i = 0; i < 4; i++) g.update(1 / 60);
    const glow = g._eyeGlow();
    const ctx = nc(g.vw, g.vh).getContext('2d');
    let hits = 0;
    const real = ctx.drawImage.bind(ctx);
    ctx.drawImage = (img, ...a) => { if (img === glow) hits++; return real(img, ...a); };
    g.draw(ctx, 1 / 60);
    return hits;
  };
  assert.equal(mk('dog'), 0, 'the hounds are low, and low heads get no light');
  assert.equal(mk('crawler'), 0, 'nor do the crawlers');
  assert.ok(mk('walker') >= 1, 'a standing body still carries its eyes');
});

test('a pointer in the gap between plates lights nothing, on every screen', async () => {
  const H = await import('../../src/hud.js');
  for (const [w, h] of [[800, 500], [1280, 800], [1920, 1080], [360, 640], [640, 360], [1366, 768]]) {
    const g = await game(w, h);
    g.paused = true; g.pauseIndex = 0;
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(H.pauseRowRect(i, w, h));
    for (const [i, r] of rows.entries()) {
      g.input.mouse.x = r.x + r.w / 2; g.input.mouse.y = r.y + r.h / 2;
      assert.equal(H.pauseHoverRow(g, w, h), i, `${w}x${h}: the middle of plate ${i} is plate ${i}`);
    }
    // the gaps: the pause screen must not fall back to the keyboard's row,
    // which is what made the highlight jump to the first plate and come back
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (Math.abs(a.x - b.x) > 1) continue;              // two columns: skip
      g.input.mouse.x = a.x + a.w / 2;
      g.input.mouse.y = (a.y + a.h + b.y) / 2;
      assert.equal(H.pauseHoverRow(g, w, h), -1, `${w}x${h}: the gap between ${i} and ${i + 1} is not a plate`);
    }
    g.input.mouse.x = 3; g.input.mouse.y = h - 3;
    assert.equal(H.pauseHoverRow(g, w, h), -1, `${w}x${h}: the corner is not a plate`);
  }
});

test('the wardrobe highlight is measured in the same space as the pointer', async () => {
  const H = await import('../../src/hud.js');
  for (const [w, h] of [[800, 500], [1920, 1080], [360, 640]]) {
    const g = await game(w, h);
    const L = H.outfitsLayout(g, w, h);
    // row 3, in screen units, must read back as row 3 at every scale
    g.input.mouse.x = L.x + L.cw / 2;
    g.input.mouse.y = L.y + L.head + L.rowH * 3 + L.rowH / 2;
    assert.equal(H.outfitHoverRow(g, w, h), 3, `${w}x${h}: the pointer and the painter agree`);
  }
});

test('the engine is built at load and only the clock waits for a gesture', async () => {
  const { AudioContext } = await import('./webaudio.mjs');
  const had = window.AudioContext;
  window.AudioContext = AudioContext;
  const { AudioEngine } = await import('../../src/audio.js');
  const a = new AudioEngine();
  assert.equal(a.prepare(), true, 'a context exists before anybody clicks');
  assert.equal(a.ready, true, 'and its graph is built');
  assert.equal(a.gestures ?? 0, 0, 'no gesture has happened yet');
  assert.equal(a.blocked, false, 'so silence is not yet a fault');
  a.gesture();
  assert.equal(a.ctx.state, 'running');
  assert.equal(a.blocked, false);
  a._teardown();
  window.AudioContext = had;
});

test('a frame that refuses to start the clock is reported, with a way out', async () => {
  const { AudioContext } = await import('./webaudio.mjs');
  class Refuses extends AudioContext {
    constructor() { super(); this.state = 'suspended'; }
    resume() { return Promise.resolve(); }        // ignored, as a blocked frame does
  }
  const had = window.AudioContext;
  window.AudioContext = Refuses;
  const A = await import('../../src/audio.js');
  const a = new A.AudioEngine();
  a.prepare();
  a.gesture();
  assert.equal(a.ctx.state, 'suspended');
  // `blocked` waits a moment before accusing the browser
  const realNow = Date.now;
  Date.now = () => realNow() + 2000;
  try {
    assert.equal(a.blocked, true, 'a context still parked after a gesture is blocked');
    // the HUD talks to the singleton, so put the singleton in the same state
    const { audio } = await import('../../src/audio.js');
    const H = await import('../../src/hud.js');
    const saved = { ctx: audio.ctx, ready: audio.ready, gestures: audio.gestures, at: audio._lastGestureAt };
    audio.ctx = a.ctx; audio.ready = true; audio.gestures = 1; audio._lastGestureAt = Date.now() - 2000;
    try {
      const label = H.HUD.prototype._soundLabel.call(new H.HUD());
      assert.ok(label && /SOUND BLOCKED/.test(label.label), `got ${JSON.stringify(label)}`);
      assert.equal(label.fix, 'unlock', 'and it is a button');
    } finally {
      Object.assign(audio, { ctx: saved.ctx, ready: saved.ready, gestures: saved.gestures, _lastGestureAt: saved.at });
    }
  } finally { Date.now = realNow; a._teardown(); window.AudioContext = had; }
});

test('the warm-up list covers every sprite the art bundle builds', async () => {
  const A = await import('../../src/art.js');
  const art = A.buildArt();
  const list = A.allCanvases(art);
  assert.ok(list.length > 800, `only ${list.length} canvases found`);
  assert.equal(new Set(list).size, list.length, 'no canvas is drawn twice for nothing');
  // and the screens the game actually draws are in it
  for (const key of ['player', 'knight', 'dog', 'skeleton', 'beekeeper']) {
    const found = A.allCanvases(art[key] ?? {});
    assert.ok(found.length > 0, `${key} has no canvases to warm`);
  }
});

test('a fader at zero is silent, and the chip fixes it in one press', async () => {
  const { AudioContext } = await import('./webaudio.mjs');
  const hadCtx = window.AudioContext;
  window.AudioContext = AudioContext;
  const { settings } = await import('../../src/settings.js');
  const { audio } = await import('../../src/audio.js');
  const H = await import('../../src/hud.js');
  audio._teardown();
  audio.prepare();
  audio.gesture();
  const g = await game(800, 500);
  g.begin(); g.applySettings();
  const hadSfx = settings.get('sfx'), hadMaster = settings.get('master');
  try {
    settings.set('sfx', 0);
    g.applySettings();
    // one fader at zero used to have a clean bill of health
    const info = H.HUD.prototype._soundLabel.call(g.hud);
    assert.ok(info && /EFFECTS VOLUME 0/.test(info.label), `got ${JSON.stringify(info)}`);
    assert.equal(info.fix, 'volume', 'and pressing it is the fix');
    const r = H.HUD.prototype._soundRectFor.call(g.hud, g, 800);
    assert.equal(H.HUD.prototype.soundChipAt.call(g.hud, g, 800, 500, r.x + 4, r.y + 4), true);
    g.input.mouse.x = r.x + r.w / 2; g.input.mouse.y = r.y + 9; g.input.mouse.pressed = true;
    g.update(1 / 60);
    assert.equal(settings.get('sfx'), 100, 'the press put the effects back');
    assert.match(g.banner?.title ?? '', /SOUND RESTORED/);
  } finally {
    settings.set('sfx', hadSfx); settings.set('master', hadMaster);
    g.applySettings();
    audio._pianoWant?.(false);
    audio._teardown();
    window.AudioContext = hadCtx;
  }
});

test('a frame that blocks the clock says so on the title screen too', async () => {
  const { audio } = await import('../../src/audio.js');
  const H = await import('../../src/hud.js');
  const g = await game(800, 500);
  const saved = { ctx: audio.ctx, ready: audio.ready, gestures: audio.gestures, at: audio._lastGestureAt };
  try {
    audio.ready = true;
    audio.ctx = { state: 'suspended' };
    audio.gestures = 1;
    audio._lastGestureAt = Date.now() - 2000;
    const chip = H.HUD.prototype._soundRectFor.call(g.hud, g, 800, true);
    assert.ok(chip, 'the chip exists on the menu');
    assert.equal(chip.y, 6, 'and it takes the corner, with no minimap to dodge');
    // the menu copies the painter once: a warning with a button behind it
    let painted = 0;
    const real = H.HUD.prototype._sound;
    H.HUD.prototype._sound = function (...a) { painted++; return real.apply(this, a); };
    try { H.HUD.prototype._soundOnMenu.call(g.hud, nc(800, 500).getContext('2d'), g, 800, 500); }
    finally { H.HUD.prototype._sound = real; }
    assert.equal(painted, 1, 'it is drawn over the title screen');
  } finally {
    Object.assign(audio, { ctx: saved.ctx, ready: saved.ready, gestures: saved.gestures, _lastGestureAt: saved.at });
  }
});
