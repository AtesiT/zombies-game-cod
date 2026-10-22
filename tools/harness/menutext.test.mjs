// No label may print through another one, at any size, in any panel.
//
// The bug this exists for is the SOUND IS OFF chip printing across the boss
// bar on a small phone at maximum picture size, and the same class of bug in
// the settings list (a label under its own slider) and the debug list (a long
// outfit row under its value). Reading renders catches a few of them; this
// catches all of them, every time, because it reads the draw calls instead of
// the pixels: every string, where it landed, and how big it came out.
//
// Two draw paths: at 1:1 a label is a pre-rendered sprite (`drawImage`), and
// under a menu scale it is `fillText`. Both carry `textInfo` or the font and
// alignment they were drawn with, so both can be turned into a box.
//
// Rules protected here:
//   * no two labels on any panel overlap, at 360x640 up to 1920x1080;
//   * no label is drawn outside the screen;
//   * the same holds for the HUD's own furniture (the top and bottom bands,
//     where the chips, the boss bar, the map tag and the health bar live), in
//     play, on a warden round and at the bench.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const { Game, Input, VW, VH } = await load();
const HUD = await import('../../src/hud.js');

const H = 1 / 60;
const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };
const fresh = (w, h) => {
  const g = new Game(new Input(nc(w, h)));
  g.setViewport(w, h);
  g.begin();
  return g;
};

/**
 * A 2D context that also remembers every label drawn on it.
 *
 * A proxy over the native context rather than a fake: the panels call a lot of
 * canvas, and every one of those calls has to land on the real thing or the
 * layout code measures imaginary text. Only the two text paths are read, and
 * both are reduced to the box their glyphs actually occupy.
 */
function recordingContext(real) {
  const items = [];
  const scale = () => {
    const m = real.getTransform ? real.getTransform() : null;
    return m ? { a: m.a, d: m.d } : { a: 1, d: 1 };
  };
  const push = (str, x0, y0, x1, y1, font) => {
    const t = scale();
    if (real.globalAlpha <= 0.25) return;          // faded out: not readable
    items.push({ str, x0: x0 * t.a, y0: y0 * t.d, x1: x1 * t.a, y1: y1 * t.d,
      xs: x0 * t.a, ys: y0 * t.d, font });
  };
  return {
    items,
    ctx: new Proxy({}, {
      get(_, prop) {
        const v = real[prop];
        if (typeof v !== 'function') return v;
        if (prop === 'drawImage') {
          return (img, ...args) => {
            const info = img?.textInfo;
            if (info) {
              const [dx, dy, dw, dh] = args.length >= 4 ? args : [args[0], args[1], img.width, img.height];
              const w = dw ?? img.width, h = dh ?? img.height;
              const k = w / img.width;
              const PAD = 2;                         // the sprite's own padding
              push(info.str, dx + PAD * k, dy + PAD * k,
                dx + w - PAD * k, dy + h - PAD * k, info.font);
            }
            return v.call(real, img, ...args);
          };
        }
        if (prop === 'fillText' || prop === 'strokeText') {
          return (str, x, y, ...rest) => {
            const m = real.measureText(String(str));
            const asc = m.actualBoundingBoxAscent || 9;
            const desc = m.actualBoundingBoxDescent || 2;
            const w = m.width;
            const x0 = real.textAlign === 'center' ? x - w / 2 : real.textAlign === 'right' ? x - w : x;
            push(String(str), x0, y - asc, x0 + w, y + desc, real.font);
            return v.call(real, str, x, y, ...rest);
          };
        }
        return v.bind(real);
      },
      set(_, prop, val) { real[prop] = val; return true; },
    }),
  };
}

/** Pairs of labels that share more than a hair of screen. */
function collisions(items) {
  const bad = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      // the same string in the same place is one label drawn by two passes
      if (a.str === b.str && Math.abs(a.xs - b.xs) < 2.5 && Math.abs(a.ys - b.ys) < 2.5) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      // a sprite carries two pixels of padding on each side, so a box may
      // touch its neighbour without the letters doing so
      if (ox > 4 && oy > 4) {
        bad.push(`"${a.str}" at ${a.x0.toFixed(0)},${a.y0.toFixed(0)} over "${b.str}" at ${b.x0.toFixed(0)},${b.y0.toFixed(0)} (${ox.toFixed(0)}x${oy.toFixed(0)})`);
      }
    }
  }
  return bad;
}

const offscreen = (items, vw, vh) => items
  .filter((b) => b.x1 < -2 || b.x0 > vw + 2 || b.y1 < -2 || b.y0 > vh + 2)
  .map((b) => `"${b.str}" at ${b.x0.toFixed(0)},${b.y0.toFixed(0)}`);

// A short phone, a tall phone, a small desktop, a big one.
const SIZES = [[360, 640], [430, 930], [800, 500], [1280, 800], [1920, 1080]];

const PANELS = {
  title: (ctx, g, w, h) => HUD.drawTitle(ctx, g, w, h),
  menu: (ctx, g, w, h) => HUD.drawMenu(ctx, g, w, h),
  settings: (ctx, g, w, h) => HUD.drawSettings(ctx, g, w, h),
  controls: (ctx, g, w, h) => HUD.drawControls(ctx, g, w, h),
  debug: (ctx, g, w, h) => { g.debugTab = 0; HUD.drawDebug(ctx, g, w, h); },
  zoo: (ctx, g, w, h) => { g.debugTab = 1; HUD.drawDebug(ctx, g, w, h); },
  music: (ctx, g, w, h) => { g.debugTab = HUD.DEBUG_MUSIC_TAB; HUD.drawDebug(ctx, g, w, h); },
  pause: (ctx, g, w, h) => HUD.drawPause(ctx, g, w, h),
  achievements: (ctx, g, w, h) => HUD.drawAchievements(ctx, g, w, h),
  stats: (ctx, g, w, h) => HUD.drawStats(ctx, g, w, h),
  outfits: (ctx, g, w, h) => HUD.drawOutfits(ctx, g, w, h),
  gameover: (ctx, g, w, h) => HUD.drawGameOver(ctx, g, w, h),
};

test('no two labels print through each other, on any panel, at any size', () => {
  clearStorage();
  for (const [w, h] of SIZES) {
    for (const [name, draw] of Object.entries(PANELS)) {
      const g = fresh(w, h);
      g.startRound(3);
      g.scene = 'game';
      g.paused = true;
      const { ctx, items } = recordingContext(nc(g.vw, g.vh).getContext('2d'));
      draw(ctx, g, g.vw, g.vh);
      assert.ok(items.length > 2, `${name} at ${w}x${h} drew no text at all`);
      const bad = collisions(items);
      assert.deepEqual(bad, [], `${name} at ${w}x${h}: ${bad.length} overlaps\n  ${bad.join('\n  ')}`);
      const off = offscreen(items, g.vw, g.vh);
      assert.deepEqual(off, [], `${name} at ${w}x${h}: ${off.length} labels off screen\n  ${off.join('\n  ')}`);
      clearStorage();
    }
  }
});

test('the HUD corners hold, on every state a phone can be in', () => {
  clearStorage();
  const states = {
    play: () => {},
    warden: (g) => { g.startRound(25); g.banner = null; },
    dog: (g) => { g.startRound(5); g.banner = null; },
    hurt: (g) => { g.player.hp = g.player.maxHp * 0.15; g.player.poison(g); },
    lowammo: (g) => { g.player.slot.mag = 0; g.player.reloading = false; },
  };
  for (const [w, h] of SIZES) {
    for (const [name, setup] of Object.entries(states)) {
      const g = fresh(w, h);
      g.startRound(3);
      setup(g);
      for (let i = 0; i < 3; i++) g.update(H);
      const { ctx, items } = recordingContext(nc(g.vw, g.vh).getContext('2d'));
      g.draw(ctx, H);
      // only the two bands the HUD lives in: the middle of the screen is the
      // world, where a price tag may sit over the floor it is painted on
      const band = 130;
      const hud = items.filter((b) => b.y1 < band || b.y0 > g.vh - band);
      assert.ok(hud.length > 2, `${name} at ${w}x${h}: the HUD drew almost nothing`);
      const bad = collisions(hud);
      assert.deepEqual(bad, [], `${name} at ${w}x${h}: the HUD overlaps itself\n  ${bad.join('\n  ')}`);
      clearStorage();
    }
  }
});

// ---------------------------------------------------------------------------
//  The three panels that had a bug in them, one test each, so the rule is
//  written down next to the thing it protects.
// ---------------------------------------------------------------------------
test('the controls list gives the key its room and the label the cut', () => {
  clearStorage();
  for (const [w, h] of SIZES) {
    const g = fresh(w, h);
    const { ctx, items } = recordingContext(nc(g.vw, g.vh).getContext('2d'));
    HUD.drawControls(ctx, g, g.vw, g.vh);
    // a key that has been cut ("WHEEL O…") is a wrong answer: on a narrow
    // panel the list must say the short form instead
    const keys = items.filter((it) => it.x1 > g.vw * 0.55 && it.xs > g.vw * 0.3);
    assert.ok(keys.length >= 10, `${w}x${h}: the key column drew ${keys.length} rows`);
    for (const k of keys) {
      assert.ok(!k.str.endsWith('\u2026'), `${w}x${h}: a key was cut short: "${k.str}"`);
    }
    // and the title never runs into the way out
    const title = items.find((it) => it.str.startsWith('CONTROLS'));
    const out = items.find((it) => it.str.includes('CLOSE'));
    assert.ok(title && out, `${w}x${h}: the panel is missing its title or its way out`);
    assert.ok(out.x0 >= title.x1 - 1 || out.ys !== title.ys,
      `${w}x${h}: "ESC OR CLICK TO CLOSE" runs into "${title.str}"`);
    // the way out is reachable wherever it ended up: header or footer, on screen
    assert.ok(out.y0 > 0 && out.y1 < g.vh, `${w}x${h}: the way out is off screen`);
    clearStorage();
  }
});

test('the pause menu fits a phone, and stays out of the HUD', () => {
  clearStorage();
  for (const [w, h] of SIZES) {
    const g = fresh(w, h);
    g.paused = true;
    for (let i = 0; i < HUD.PAUSE_ROWS.length; i++) {
      const r = HUD.pauseRowRect(i, g.vw, g.vh);
      assert.ok(r.x >= 0 && r.x + r.w <= g.vw, `${w}x${h}: row ${i} is ${r.w.toFixed(0)} wide on a ${g.vw} screen`);
      assert.ok(r.y >= 0 && r.y + r.h <= g.vh, `${w}x${h}: row ${i} runs off the bottom`);
    }
    const { ctx, items } = recordingContext(nc(g.vw, g.vh).getContext('2d'));
    HUD.drawPause(ctx, g, g.vw, g.vh);
    // the hint under the last row is above the health bar, not on top of it
    const hint = items.find((it) => it.str.includes('ARROWS'));
    assert.ok(hint, `${w}x${h}: no hint line`);
    assert.ok(hint.y1 < g.vh - 80, `${w}x${h}: the hint line sits at ${hint.y1.toFixed(0)}, in the HUD band`);
    clearStorage();
  }
});
