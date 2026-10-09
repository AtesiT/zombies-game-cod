// Headless harness for the on-screen controls: a fake DOM, a fake phone, and
// synthetic thumbs. `npm i` in this directory first, then: node touch.mjs
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');

// ---------------------------------------------------------------- fake DOM --
function fakeEl(tag) {
  const el = {
    tagName: tag, style: {}, children: [], parentNode: null, textContent: '',
    _l: {},
    _rect: { left: 0, top: 0, width: 132, height: 132 },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, fn) { (el._l[t] ||= []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return el._rect; },
    fire(t, ev) { for (const fn of el._l[t] ?? []) fn(ev); },
  };
  return el;
}
function canvasStub(w, h) {
  const c = createCanvas(w, h);
  c.style = {};
  c.addEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 844, innerHeight: 390, maxTouchPoints: 5, navigator: { maxTouchPoints: 5 } };
try { Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true }); } catch { /* node 19+ owns it */ }
globalThis.document = { createElement: (t) => (t === 'canvas' ? canvasStub(800, 500) : fakeEl(t)), body: fakeEl('body') };
globalThis.performance = { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.AudioContext = undefined;

const { TouchControls, isTouchDevice } = await import(SRC + '/touch.js');
const { Input } = await import(SRC + '/input.js');
const { SETTING_DEFS } = await import(SRC + '/settings.js');

const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); };

// ------------------------------------------------------------------ set up --
const canvas = canvasStub(800, 500);
const input = new Input(canvas);
const mount = fakeEl('div');
const touch = new TouchControls(input, { mount });
ok(touch.panel && mount.children[0] === touch.panel, 'panel was not mounted');

touch.show(true);
ok(touch.enabled, 'show(true) did not enable');
ok(touch.panel.style.display === 'block', 'panel stayed hidden');

// put the two sticks somewhere known so the maths is checkable
touch.left.base._rect = { left: 10, top: 250, width: 132, height: 132 };   // centre 76,316
touch.right.base._rect = { left: 600, top: 250, width: 132, height: 132 }; // centre 666,316

const T = (id, x, y, target) => ({
  identifier: id, clientX: x, clientY: y, target,
});
const start = (target, x, y, id = 1) =>
  touch.panel.fire('touchstart', { changedTouches: [T(id, x, y, target)], preventDefault() {} });
const moveTo = (x, y, id = 1) =>
  touch.panel.fire('touchmove', { changedTouches: [T(id, x, y, null)], preventDefault() {} });
const end = (id = 1) =>
  touch.panel.fire('touchend', { changedTouches: [T(id, 0, 0, null)], preventDefault() {} });

// a stand-in game: the touch layer only reads player.pos, cam, zombies, settings
const game = {
  player: { pos: { x: 400, y: 300 } },
  cam: { x: 0, y: 0 },
  zombies: [],
  settings: { get: (k) => (k === 'touchAssist' ? true : 0) },
};

// ------------------------------------------------------------------ 1. walk --
input.keys.clear();
start(touch.left.base, 76 + 60, 316, 1);         // thumb pushed right
const pushed = Math.hypot(touch.move.x, touch.move.y);
ok(touch.move.x > 0.8 && Math.abs(touch.move.y) < 0.01, `stick right gave ${touch.move.x.toFixed(3)},${touch.move.y.toFixed(3)}`);
ok(pushed <= 1, 'stick exceeded unit length');
touch.update(game);
let mv = input.moveVector();
ok(Math.abs(mv.x - touch.move.x) < 1e-6 && mv.y === 0, 'moveVector ignored the stick');

// diagonal + keyboard at once, and it must never exceed 1
input.keys.add('KeyW');
start(touch.left.base, 76 + 66 * 0.707, 316 + 66 * 0.707, 2);
mv = input.moveVector();
ok(Math.hypot(mv.x, mv.y) <= 1.0001, `combined vector blew past 1 (${Math.hypot(mv.x, mv.y).toFixed(3)})`);
input.keys.delete('KeyW');
end(2);

// a thumb merely resting on the stick must not walk
start(touch.left.base, 76 + 4, 316, 3);
ok(Math.hypot(touch.move.x, touch.move.y) === 0, 'dead zone let a resting thumb through');
end(3);

end(1);
ok(touch.move.x === 0 && touch.move.y === 0, 'releasing the stick left the player walking');
touch.update(game);
ok(Math.abs(input.moveVector().x) < 1e-9, 'moveVector kept walking after release');

// ----------------------------------------------------------------- 2. fire --
start(touch.buttons.fire, 0, 0, 10);
ok(input.mouse.down === true, 'fire button did not hold the trigger');
ok(input.mouse.pressed === true, 'fire button did not register a press');
input.endFrame();
ok(input.mouse.pressed === false, 'the press never cleared');
end(10);
ok(input.mouse.down === false && input.mouse.released === true, 'fire button did not release');

// ------------------------------------------------------------- 3. the keys --
input.endFrame();
start(touch.buttons.interact, 0, 0, 11);
ok(input.keys.has('KeyF') && input.pressed.has('KeyF'), 'F button did not press KeyF');
end(11);
ok(!input.keys.has('KeyF') && input.released.has('KeyF'), 'F button did not release KeyF');
input.endFrame();

for (const [id, key] of [['reload', 'KeyR'], ['swap', 'KeyQ'], ['sprint', 'ShiftLeft'],
  ['grenade', 'KeyG'], ['medkit', 'KeyH'], ['knife', 'KeyV']]) {
  start(touch.buttons[id], 0, 0, 20);
  const good = input.keys.has(key) && input.pressed.has(key);
  end(20);
  ok(good, `${id} button did not press ${key}`);
  input.endFrame();
}
start(touch.buttons.pause, 0, 0, 21);
ok(input.pressed.has('Escape'), 'pause button did not press Escape');
end(21);
input.endFrame();

// ------------------------------------------------------------------ 4. aim --
input.endFrame();
start(touch.right.base, 666 + 60, 316, 30);      // aim right
touch.update(game);
ok(input.mouse.x > 400 && Math.abs(input.mouse.y - 300) < 1, `aim right pointed at ${input.mouse.x.toFixed(0)},${input.mouse.y.toFixed(0)}`);
moveTo(666, 316 - 60, 30);                       // swing up
touch.update(game);
ok(input.mouse.y < 300 && Math.abs(input.mouse.x - 400) < 1, `aim up pointed at ${input.mouse.x.toFixed(0)},${input.mouse.y.toFixed(0)}`);
end(30);

// with no thumb on the aim stick, assist finds the nearest walker
game.zombies = [{ pos: { x: 700, y: 200 }, dead: false }, { pos: { x: 100, y: 480 }, dead: false }];
touch.update(game);
ok(Math.abs(input.mouse.x - 700) < 1 && Math.abs(input.mouse.y - 200) < 1,
  `assist pointed at ${input.mouse.x.toFixed(0)},${input.mouse.y.toFixed(0)}, not the near zombie`);
// a dead one is not a target
game.zombies[0].dead = true;
touch.update(game);
ok(Math.abs(input.mouse.x - 100) < 1 && Math.abs(input.mouse.y - 480) < 1, 'assist picked a corpse');
// assist off: the cursor stays where the player left it
game.settings = { get: () => false };
const frozen = { x: input.mouse.x, y: input.mouse.y };
game.zombies[1].dead = true;
touch.update(game);
ok(input.mouse.x === frozen.x && input.mouse.y === frozen.y, 'assist ran while switched off');

// ------------------------------------------------------------------ 6. tap --
// A press on bare canvas has to reach the game underneath, or the front menu
// is unpressable on the only device that needs the panel.
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
input.endFrame();
start(touch.panel, 400, 100, 50);
ok(input.mouse.pressed === true && input.mouse.down === true, 'a tap on bare canvas did not reach the game');
ok(Math.abs(input.mouse.x - 400) < 0.01 && Math.abs(input.mouse.y - 100) < 0.01,
  `a tap landed at ${input.mouse.x},${input.mouse.y} instead of 400,100`);
moveTo(250, 200, 50);
ok(Math.abs(input.mouse.x - 250) < 0.01 && Math.abs(input.mouse.y - 200) < 0.01, 'dragging a tap did not track');
end(50);
ok(input.mouse.down === false && input.mouse.released === true, 'a tap never lifted');
input.endFrame();

// --------------------------------------------------------------- 5. hiding --
start(touch.buttons.fire, 0, 0, 40);
start(touch.left.base, 76 + 60, 316, 41);
touch.show(false);
ok(touch.panel.style.display === 'none', 'hiding left the panel up');
ok(input.mouse.down === false, 'hiding left the trigger held');
ok(touch.held.size === 0, 'hiding left buttons held');
ok(touch._touches.size === 0, 'hiding forgot to drop live touches');
ok(!input.keys.has('KeyF'), 'hiding left keys down');

// the setting actually exists and is reachable from the overlay
const def = SETTING_DEFS.find((d) => d.id === 'touch');
ok(def && def.min === 0 && def.max === 2 && def.def === 0, 'ON-SCREEN CONTROLS setting is missing');
ok(def && def.fmt(0) === 'AUTO' && def.fmt(2) === 'ON', 'touch setting labels are wrong');
ok(SETTING_DEFS.some((d) => d.id === 'touchAssist'), 'AIM ASSIST setting is missing');
ok(isTouchDevice() === true, 'the harness phone was not detected as a touch device');

// ------------------------------------------------------------------- report --
if (fails.length) {
  console.log('TOUCH FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('TOUCH PASS  sticks, 8 buttons, aim assist and a clean hide all behave');
}
