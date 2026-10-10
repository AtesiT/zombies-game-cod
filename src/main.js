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
// the game thinks in 800x500 whatever size the canvas ends up being, and the
// mouse has to be told so before DLSS5 changes the backing store underneath it
input.setLogicalSize(VW, VH);
const game = new Game(input);

// ---------------------------------------------------------------------------
//  Crisp integer-ish upscaling: the game renders at 800x500 and is stretched
//  to fill the window while keeping the pixel grid as clean as possible.
// ---------------------------------------------------------------------------
const wrap = document.getElementById('stage');
const frameEl = document.getElementById('frame');
const touch = new TouchControls(input, { mount: wrap });

const SIZE_MULTS = [0.82, 1, 1.18];
// how wide the game is on screen, in CSS pixels -- DLSS5 sizes its backing
// store from it, so it has to be kept up to date by resize()
let displayW = VW;

// ---------------------------------------------------------------------------
//  DLSS5.
//
//  The game draws in a fixed 800x500 space, so on a big screen every rotated
//  sprite, every light cone and every letter of the HUD arrives as a flight of
//  stairs. With this on, the backing store is rendered *larger* than the
//  picture you see and the browser scales it back down, which is the cheapest
//  way there is of getting rid of them. Sprites get filtered on the way up
//  (see `game.smooth`) so the pixel art goes soft rather than blocky.
//
//  It costs fill rate -- 2x means four times the pixels -- so, when AUTO
//  PERFORMANCE is on, it watches the frame time and eases itself down the list
//  rather than letting the game crawl. With AUTO PERFORMANCE off it never
//  eases: the backing store stays at full supersample no matter what.
// ---------------------------------------------------------------------------
// How far to supersample: enough to be worth it on the screen you actually
// have, never more than 2x. A phone showing the game 320 px wide does not need
// a 1600 px backing store, and it certainly cannot afford one.
function dlssTarget() {
  const px = (displayW || VW) * (window.devicePixelRatio || 1);
  return Math.max(1.25, Math.min(2, (px / VW) * 1.6));
}

// and how far the perf watch is allowed to walk that back: 1 = all of it,
// 0 = none, i.e. the frame is drawn at 800x500 again
const SS_STEPS = [1, 0.75, 0.5, 0];
let ssLevel = 0;
let ssSlow = 0;
let ssFast = 0;

function dlssScale() {
  if (!settings.get('dlss')) return 1;
  const base = dlssTarget();
  return 1 + (base - 1) * SS_STEPS[ssLevel];
}

function applyBacking() {
  const ss = dlssScale();
  const w = Math.round(VW * ss);
  const h = Math.round(VH * ss);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  // let the browser filter it back down -- that is the whole trick. Empty
  // string hands it back to the stylesheet, which asks for hard pixels.
  canvas.style.imageRendering = ss > 1 ? 'auto' : '';
  return ss;
}

function resize() {
  // measured off the padded frame, so the safe areas are already excluded
  const availW = frameEl?.clientWidth || window.innerWidth;
  const availH = frameEl?.clientHeight || window.innerHeight;
  // The stage used to refuse to go below 800x500, which on a four-inch phone
  // is larger than the screen: it got centred, clipped, and the bottom of it
  // -- the walking stick -- simply was not there. It shrinks to fit instead.
  const byW = availW / VW, byH = availH / VH;
  // FIT leaves the whole game visible with bars to the sides; FILL crops the
  // long axis and gives you the biggest picture the screen can hold
  const fit = settings.get('screen') === 1 ? Math.max(byW, byH) : Math.min(byW, byH);
  const scale = Math.max(0.2, fit);
  const snap = scale >= 2 ? Math.floor(scale * 2) / 2 : scale;   // half steps above 2x
  const w = Math.round(VW * snap);
  const h = Math.round(VH * snap);
  displayW = w;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  // the buttons live in the same 800x500 space the game draws in
  touch.layout(w, h);
}
window.addEventListener('resize', () => { resize(); applyBacking(); });
resize();
applyBacking();

// ---------------------------------------------------------------------------
//  On-screen controls: shown when the setting says so (AUTO = any touch
//  screen). Mounted on the stage wrapper above, so they scale with the game.
// ---------------------------------------------------------------------------
function syncTouch() {
  const mode = settings.get('touch');
  touch.setSize(SIZE_MULTS[settings.get('touchSize') ?? 1]);
  touch.show(mode === 2 || (mode === 0 && isTouchDevice()));
}
settings.onChange((id) => {
  if (id === 'touch' || id === 'touchAssist' || id === 'touchSize') syncTouch();
  if (id === 'screen') resize();
  if (id === 'dlss') { ssLevel = 0; ssSlow = 0; ssFast = 0; applyBacking(); }
  // AUTO PERFORMANCE off means *nothing* is allowed to ease the picture back:
  // the supersample goes to full and stays there, whatever the frame time says
  if (id === 'autoQuality') { ssLevel = 0; ssSlow = 0; ssFast = 0; applyBacking(); }
});
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

  // everything the game draws is in 800x500; this is what makes it land on a
  // bigger canvas than that when DLSS5 is on
  const ss = dlssScale();
  ctx.setTransform(ss, 0, 0, ss, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  game.smooth = ss > 1;
  // and the lighting half of it: finer shadows and a soft bloom over them
  game.setDlss(ss > 1);
  game.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const workMs = performance.now() - t0;
  game.tickPerf(workMs);

  // the supersample watch: too slow for long enough and it steps down, fast
  // for long enough and it climbs back up. Only when AUTO PERFORMANCE is on --
  // a player who switched that off asked for the full picture, lag and all
  if (settings.get('dlss') && settings.get('autoQuality')) {
    if (workMs > 20) { ssSlow++; ssFast = 0; } else if (workMs < 11) { ssFast++; ssSlow = 0; } else { ssSlow = 0; ssFast = 0; }
    if (ssSlow >= 90 && ssLevel < SS_STEPS.length - 1) { ssLevel++; ssSlow = 0; applyBacking(); } else if (ssFast >= 600 && ssLevel > 0) { ssLevel--; ssFast = 0; applyBacking(); }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose a little handle for debugging in the console
window.GAME = game;
window.TOUCH = touch;
window.INPUT = input;
