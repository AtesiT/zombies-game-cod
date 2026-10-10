// Headless harness for the entry point itself: src/main.js.
//
// Everything else in this folder imports the modules and pokes at them. This
// one has to walk the same path a browser does -- load main.js, let it build
// the game, mount the touch panel on #stage, and run its own loop -- because a
// crash in main.js is a black screen with no other test in the world failing.
//
// It happened twice, which is twice too often:
//   * main.js read `game.settings`, which did not exist;
//   * main.js called resize() before the touch panel existed, and resize()
//     scaled that panel -- a const read in its own temporal dead zone kills
//     the module before the first frame.
// The second one got through because this file used to *re-enact* the boot by
// hand instead of importing main.js, so it never ran the line that broke.
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');
const VW = 800, VH = 500;

// ------------------------------------------------------- a browser-shaped DOM
function el(tag = 'div', w = VW, h = VH) {
  return {
    tagName: tag, style: {}, children: [], parentNode: null, _l: {},
    clientWidth: w, clientHeight: h,      // what resize() measures the frame by
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    removeEventListener(t, f) { const a = this._l[t]; if (a) this._l[t] = a.filter((g) => g !== f); },
    getBoundingClientRect() { return { left: 0, top: 0, width: VW, height: VH }; },
    dispatch(t, ev) { for (const f of [...(this._l[t] ?? [])]) f(ev); },
  };
}
const canvas = createCanvas(VW, VH);
canvas.style = {};
canvas.addEventListener = () => {};
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: VW, height: VH });
const stage = el('div');
const frame = el('div', 1280, 800);     // the padded box the stage has to fit
const win = {
  _l: {},
  addEventListener(t, f) { (this._l[t] ||= []).push(f); },
  removeEventListener() {},
  innerWidth: 1280, innerHeight: 800,
  dispatch(t, ev) { for (const f of [...(this._l[t] ?? [])]) f(ev); },
};
globalThis.window = win;
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? createCanvas(300, 150) : el(t)),
  getElementById: (id) => (id === 'game' ? canvas : id === 'frame' ? frame : stage),
  addEventListener() {}, removeEventListener() {},
  body: el('body'),
};
// the loop asks for frames; we hand them out by hand so time is ours
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };

const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

// ------------------------------------------------------------------- boot ---
// importing the entry module is the whole point: a throw here is a black page
let threw = null;
try {
  await import(SRC + '/main.js');
} catch (e) { threw = e; }
ok(threw === null, `importing src/main.js threw: ${threw?.name ?? ''} ${threw?.message ?? ''}`);
if (threw) {
  console.log('BOOT FAIL: src/main.js dies on load -- that is a black screen.');
  console.log(threw.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const game = win.GAME;
const touch = win.TOUCH;
const input = win.INPUT;
ok(!!game && !!touch && !!input, 'main.js never published GAME / TOUCH / INPUT');
ok(game.scene === 'menu', `the game booted into "${game.scene}"`);
ok(typeof game.settings?.get === 'function', 'game.settings is missing — main.js and touch.js read it');
ok(stage.children.includes(touch.panel), 'the touch panel was never mounted on #stage');
ok(rafCb !== null, 'main.js never asked for a frame');

// ------------------------------------------------------------------ frames --
let clock = performance.now();
let frameErr = null;
const frames = (n) => {
  for (let i = 0; i < n; i++) {
    const cb = rafCb;
    rafCb = null;
    if (!cb) { frameErr = frameErr ?? new Error('the loop stopped asking for frames'); return; }
    clock += 1000 / 60;
    try { cb(clock); } catch (e) { frameErr = frameErr ?? e; return; }
  }
};

/** A frame that is entirely one colour is a black screen, whatever the fps. */
const colours = () => {
  const d = canvas.getContext('2d').getImageData(0, 0, VW, VH).data;
  const seen = new Set();
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
    if (seen.size < 400) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  }
  return { lit, variety: seen.size };
};

frames(5);
ok(frameErr === null, `the menu frame threw: ${frameErr?.stack?.split('\n').slice(0, 3).join(' | ')}`);
let px = colours();
ok(px.lit > 20000, `the menu is a black screen (${px.lit} lit pixels)`);
ok(px.variety > 30, `the menu drew a flat fill (${px.variety} colours)`);

// ------------------------------------------------------- the panel rescales --
// resize() drives the panel's scale, so the panel is the proof it ran
ok(touch._stageW === 1280 && touch._stageH === 800,
  `the panel was laid out for ${touch._stageW}x${touch._stageH}, not the 1280x800 window`);
ok(touch.panel.style.transform === 'scale(1.6)',
  `the panel scaled to "${touch.panel.style.transform}", not scale(1.6)`);
win.innerWidth = 1600; win.innerHeight = 1000;
frame.clientWidth = 1600; frame.clientHeight = 1000;
win.dispatch('resize', {});
ok(touch._stageW === 1600 && touch._stageH === 1000,
  `a resize left the panel at ${touch._stageW}x${touch._stageH}, not 1600x1000`);
ok(touch.panel.style.transform === 'scale(2)',
  `a resize left the panel at "${touch.panel.style.transform}", not scale(2)`);
win.innerWidth = 1280; win.innerHeight = 800;
frame.clientWidth = 1280; frame.clientHeight = 800;
win.dispatch('resize', {});
ok(touch._stageW === 1280, 'shrinking the window back did not reach the panel');

// ---- a four-inch phone ----------------------------------------------------
// It used to be handed an 800x500 stage inside a 667x320 window: the stage was
// centred and clipped, so the bottom of it -- the walking stick -- was off the
// screen entirely, and the right-hand buttons hung over the edge.
win.innerWidth = 667; win.innerHeight = 320;         // iPhone SE, Safari, sideways
frame.clientWidth = 667; frame.clientHeight = 320;
win.dispatch('resize', {});
const sw = parseInt(canvas.style.width, 10), sh = parseInt(canvas.style.height, 10);
ok(sw <= 667 && sh <= 320, `a 667x320 window got a ${sw}x${sh} stage -- it does not fit`);
ok(Math.abs(sw / sh - VW / VH) < 0.02, `the stage lost its shape: ${sw}x${sh}`);
ok(touch._stageW === sw && touch._stageH === sh,
  `the panel is laid out for ${touch._stageW}x${touch._stageH}, the stage is ${sw}x${sh}`);
ok(touch._tier === 'compact', `a four-inch screen got the ${touch._tier} panel`);
// the panel is scaled down with the stage, so the buttons have to grow back
const realStick = touch._geo.S * (sw / 800);
ok(realStick >= 60, `the walking stick is only ${realStick.toFixed(0)} real pixels on a phone`);
ok(touch._geo.B * (sw / 800) >= 36, `the buttons are only ${(touch._geo.B * (sw / 800)).toFixed(0)} real pixels`);
// the stick sits 14 units off the bottom of a 500-unit panel: still on screen
ok(touch._geo.S + 14 <= 500, 'the walking stick is cut off by the bottom edge');

win.innerWidth = 1280; win.innerHeight = 800;
frame.clientWidth = 1280; frame.clientHeight = 800;
win.dispatch('resize', {});

// ------------------------------------------------------------- press SOLO ----
// the way a thumb or a mouse would, through the input the real loop is reading
input.mouse.x = VW / 2;
input.mouse.y = VH * 0.46;
input.mouse.pressed = true;
frames(3);
ok(game.started === true, 'clicking SOLO did not start the game');
ok(game.scene === null, 'the menu stayed up after SOLO');

game.player.hurt = () => false;
frameErr = null;
frames(240);
ok(frameErr === null, `a game frame threw: ${frameErr?.stack?.split('\n').slice(0, 3).join(' | ')}`);
ok(game.round >= 1 && game.zombies.length > 0, 'four seconds in, nothing is happening');
px = colours();
ok(px.lit > 40000, `the game is a black screen (${px.lit} lit pixels)`);

// --------------------------------------------------------------- the panel ---
touch.show(false);
game.settings.set('touch', 2);
ok(touch.enabled === true && touch.panel.style.display === 'block', 'ON did not show the panel');
game.settings.set('touch', 1);
ok(touch.enabled === false && touch.panel.style.display === 'none', 'OFF did not hide the panel');
game.settings.set('touch', 0);

if (fails.length) {
  console.log('BOOT FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`BOOT PASS  src/main.js loads, the menu draws, SOLO starts, ${px.lit} pixels lit`);
}
