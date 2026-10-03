// Boot + fixed-ish main loop.
import { Input } from './input.js';
import { Game, VW, VH } from './game.js';
import { audio } from './audio.js';

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

function resize() {
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const scale = Math.max(1, Math.min(availW / VW, availH / VH));
  const snap = scale >= 2 ? Math.floor(scale * 2) / 2 : scale;   // half steps above 2x
  const w = Math.round(VW * snap);
  const h = Math.round(VH * snap);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
}
window.addEventListener('resize', resize);
resize();

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
