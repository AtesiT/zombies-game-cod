// Headless harness for the entry point itself: src/main.js.
//
// Everything else in this folder imports the modules and pokes at them. This
// one walks the same path a browser does -- canvas, Input, Game, the touch
// panel mounted on #stage, then the loop -- because a crash in main.js is a
// black screen with no other test in the world failing. (It happened: main.js
// asked for `game.settings`, which did not exist, and the whole page died
// before the first frame.)
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');
const VW = 800, VH = 500;

// ------------------------------------------------------- a browser-shaped DOM
function el(tag = 'div') {
  return {
    tagName: tag, style: {}, children: [], parentNode: null, _l: {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: VW, height: VH }; },
    dispatch(t, ev) { for (const f of this._l[t] ?? []) f(ev); },
  };
}
const canvas = createCanvas(VW, VH);
canvas.style = {};
canvas.addEventListener = () => {};
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: VW, height: VH });
const stage = el('div');
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 };
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? createCanvas(300, 150) : el(t)),
  getElementById: (id) => (id === 'game' ? canvas : stage),
  body: el('body'),
};
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };

const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

// ------------------------------------------------------------------- boot ---
let threw = null;
let Input, Game, TouchControls, isTouchDevice, settings;
try {
  ({ Input } = await import(SRC + '/input.js'));
  ({ Game } = await import(SRC + '/game.js'));
  ({ TouchControls, isTouchDevice } = await import(SRC + '/touch.js'));
  ({ settings } = await import(SRC + '/settings.js'));
} catch (e) { threw = e; }
ok(threw === null, `importing the entry module threw: ${threw?.message}`);
if (threw) { console.log('BOOT FAIL:\n  -', threw.stack.split('\n').slice(0, 4).join('\n  ')); process.exit(1); }

const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
const input = new Input(canvas);
const game = new Game(input);

ok(game.scene === 'menu', `the game booted into "${game.scene}"`);
ok(typeof game.settings?.get === 'function', 'game.settings is missing — main.js and touch.js read it');

const touch = new TouchControls(input, { mount: stage });
ok(!!touch.panel, 'the touch panel was never built');
const syncTouch = () => {
  const mode = settings.get('touch');
  touch.show(mode === 2 || (mode === 0 && isTouchDevice()));
};
threw = null;
try {
  settings.onChange((id) => { if (id === 'touch' || id === 'touchAssist') syncTouch(); });
  syncTouch();
} catch (e) { threw = e; }
ok(threw === null, `wiring the touch panel threw: ${threw?.message}`);

// ------------------------------------------------------------------ frames --
const STEP = 1 / 60;
let frameErr = null;
const frame = () => {
  try {
    touch.update(game);
    game.update(STEP);
    input.endFrame();
    game.draw(ctx);
  } catch (e) { frameErr = frameErr ?? e; }
};

/** A frame that is entirely one colour is a black screen, whatever the fps. */
const colours = () => {
  const d = ctx.getImageData(0, 0, VW, VH).data;
  const seen = new Set();
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
    if (seen.size < 400) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  }
  return { lit, variety: seen.size };
};

for (let i = 0; i < 5; i++) frame();
ok(frameErr === null, `the menu frame threw: ${frameErr?.stack?.split('\n').slice(0, 3).join(' | ')}`);
let px = colours();
ok(px.lit > 20000, `the menu is a black screen (${px.lit} lit pixels)`);
ok(px.variety > 30, `the menu drew a flat fill (${px.variety} colours)`);

// press SOLO the way a thumb or a mouse would
input.mouse.x = VW / 2;
input.mouse.y = VH * 0.46;
input.mouse.pressed = true;
game.update(STEP);
input.endFrame();
ok(game.started === true, 'clicking SOLO did not start the game');
ok(game.scene === null, 'the menu stayed up after SOLO');

game.player.hurt = () => false;
frameErr = null;
for (let i = 0; i < 240; i++) frame();
ok(frameErr === null, `a game frame threw: ${frameErr?.stack?.split('\n').slice(0, 3).join(' | ')}`);
ok(game.round >= 1 && game.zombies.length > 0, 'four seconds in, nothing is happening');
px = colours();
ok(px.lit > 40000, `the game is a black screen (${px.lit} lit pixels)`);

// and the panel must come up by itself on a phone
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
  console.log(`BOOT PASS  main.js runs, the menu draws, SOLO starts, ${px.lit} pixels lit`);
}
