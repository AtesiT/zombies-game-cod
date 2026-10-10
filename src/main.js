// Boot + fixed-ish main loop.
import { Input } from './input.js';
import { Game, VW, VH } from './game.js';
import { audio } from './audio.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { settings } from './settings.js';

const canvas = document.getElementById('game');
canvas.width = VW;
canvas.height = VH;
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const input = new Input(canvas);
const game = new Game(input);

// ---------------------------------------------------------------------------
//  Crisp integer-ish upscaling: the game renders at 800x500 and is stretched
//  to fill the window while keeping the pixel grid as clean as possible.
// ---------------------------------------------------------------------------
const wrap = document.getElementById('stage');
const frameEl = document.getElementById('frame');
const touch = new TouchControls(input, { mount: wrap });

const SIZE_MULTS = [0.82, 1, 1.18];

function resize() {
  // measured off the padded frame, so the safe areas are already excluded
  const availW = frameEl?.clientWidth || window.innerWidth;
  const availH = frameEl?.clientHeight || window.innerHeight;
  // The stage used to refuse to go below 800x500, which on a four-inch phone
  // is larger than the screen: it got centred, clipped, and the bottom of it
  // -- the walking stick -- simply was not there. It shrinks to fit instead.
  const fit = Math.min(availW / VW, availH / VH);
  const scale = Math.max(0.2, fit);
  const snap = scale >= 2 ? Math.floor(scale * 2) / 2 : scale;   // half steps above 2x
  const w = Math.round(VW * snap);
  const h = Math.round(VH * snap);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  // the buttons live in the same 800x500 space the game draws in
  touch.layout(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
//  On-screen controls: shown when the setting says so (AUTO = any touch
//  screen). Mounted on the stage wrapper above, so they scale with the game.
// ---------------------------------------------------------------------------
function syncTouch() {
  const mode = settings.get('touch');
  touch.setSize(SIZE_MULTS[settings.get('touchSize') ?? 1]);
  touch.show(mode === 2 || (mode === 0 && isTouchDevice()));
}
settings.onChange((id) => { if (id === 'touch' || id === 'touchAssist' || id === 'touchSize') syncTouch(); });
syncTouch();

// first gesture unlocks WebAudio
const unlock = () => { audio.init(); audio.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---------------------------------------------------------------------------
//  Loop
// ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25;
// 120 Hz physics is lovely right up until the frame rate dips, at which point
// the catch-up loop doubles the work on exactly the frames that can least
// afford it. 60 is plenty for a top-down shooter, and it is a setting.
const MAX_STEPS = 6;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  const t0 = performance.now();

  const STEP = 1 / (game.stepRate || 60);
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    touch.update(game);
    game.update(STEP);
    input.endFrame();
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;      // too far behind to catch up: drop time

  game.draw(ctx);

  game.tickPerf(performance.now() - t0);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose a little handle for debugging in the console
window.GAME = game;
window.TOUCH = touch;
window.INPUT = input;
