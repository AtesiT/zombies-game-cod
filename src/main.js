// Boot + fixed-ish main loop.
import { Input } from './input.js';
import { Game, VW, VH } from './game.js';
import { T } from './art.js';
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
// PICTURE SIZE (SETTINGS): how much world the screen is asked to hold. 1 is
// the neutral zoom; the low step pulls back, the high ones push in.
const VIEW_MULTS = [0.85, 1, 1.15, 1.32];

// The view: how many world units the screen is showing right now, and the CSS
// box those units are painted into. `zoom` is CSS pixels per world unit.
const view = { w: VW, h: VH, zoom: 1, cssW: VW, cssH: VH };
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
  // device pixels per world unit: the ratio the browser is going to shrink
  // the backing store down by
  const px = (displayW || VW) * (window.devicePixelRatio || 1);
  const perUnit = px / Math.max(1, view.w);
  // the old ceiling was 2x, which is FOUR times the pixels -- and four times
  // every full-screen pass with it. 1.75 keeps the anti-aliasing win (you
  // cannot see the difference against 2 once the browser downscales) for
  // about three quarters of the fill cost. This is where DLSS5 "lagged".
  return Math.max(1.25, Math.min(1.75, perUnit * 1.6));
}

// and how far the perf watch is allowed to walk that back: 1 = all of it,
// 0 = none, i.e. the frame is drawn at one pixel per world unit again
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
  // the backing store is the *view*, supersampled: the picture the player
  // sees is the CSS box, and this is what is drawn into before the browser
  // scales it down to fit
  const w = Math.max(1, Math.round(view.w * ss));
  const h = Math.max(1, Math.round(view.h * ss));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  // let the browser filter it back down -- that is the whole trick. Empty
  // string hands it back to the stylesheet, which asks for hard pixels.
  canvas.style.imageRendering = ss > 1 ? 'auto' : '';
  return ss;
}

/**
 * Work out the viewport from the space the game has and the PICTURE SIZE
 * setting.
 *
 * The old code painted a fixed 800x500 picture and scaled it to fit, which is
 * why a phone got a small landscape strip in the middle of a tall screen and
 * a square-ish window got bars on two sides. Instead, the *world* view is now
 * derived from the screen: the same number of world units the screen has room
 * for, at a zoom that keeps the amount of world roughly constant whatever the
 * device. A phone in portrait gets a tall view, a widescreen gets a wide one,
 * and there is never a letterbox to look at.
 *
 * `zoom` is area-matched to 800x500: a 1920x1080 window shows about the same
 * amount of map a 800x500 one used to, at the same apparent size.
 */
function computeView() {
  const availW = Math.max(240, frameEl?.clientWidth || window.innerWidth || VW);
  const availH = Math.max(200, frameEl?.clientHeight || window.innerHeight || VH);
  const mult = VIEW_MULTS[settings.get('view') ?? 1] ?? 1;
  const base = Math.sqrt((availW * availH) / (VW * VH));
  // a floor and a ceiling on the zoom: below this the sprites stop reading,
  // above it a big monitor would show four tiles of map
  const zoom = Math.max(0.42, Math.min(3.2, base * mult));
  const worldW = game.map ? game.map.w * T : 1728;
  const worldH = game.map ? game.map.h * T : 1200;
  let vw = Math.round(availW / zoom);
  let vh = Math.round(availH / zoom);
  vw = Math.max(360, Math.min(worldW, vw));
  vh = Math.max(300, Math.min(worldH, vh));
  view.w = vw;
  view.h = vh;
  view.zoom = zoom;
  view.cssW = Math.round(vw * zoom);
  view.cssH = Math.round(vh * zoom);
  displayW = view.cssW;
}

function resize() {
  computeView();
  canvas.style.width = `${view.cssW}px`;
  canvas.style.height = `${view.cssH}px`;
  wrap.style.width = `${view.cssW}px`;
  wrap.style.height = `${view.cssH}px`;
  // the game lays its HUD, its menus and its camera out in view units
  game.setViewport(view.w, view.h);
  // the buttons live in the same space the game draws in
  touch.layout(view.cssW, view.cssH);
}

window.addEventListener('resize', () => { resize(); applyBacking(); });
resize();
applyBacking();

// ---------------------------------------------------------------------------
//  On-screen controls: shown when the setting says so (AUTO = any touch
//  screen). Mounted on the stage wrapper above, so they scale with the game.
// ---------------------------------------------------------------------------
function syncTouch() {
  // the HUD asks the game which controls page to print, and the game had no
  // handle on this panel at all -- so a phone was shown the keyboard page
  game.touch = touch;
  const mode = settings.get('touch');
  touch.setSize(SIZE_MULTS[settings.get('touchSize') ?? 1]);
  touch.show(mode === 2 || (mode === 0 && isTouchDevice()));
}
settings.onChange((id) => {
  if (id === 'touch' || id === 'touchAssist' || id === 'touchSize') syncTouch();
  if (id === 'view') { resize(); applyBacking(); }
  if (id === 'dlss') { ssLevel = 0; ssSlow = 0; ssFast = 0; applyBacking(); }
  // AUTO PERFORMANCE off means *nothing* is allowed to ease the picture back:
  // the supersample goes to full and stays there, whatever the frame time says
  if (id === 'autoQuality') { ssLevel = 0; ssSlow = 0; ssFast = 0; applyBacking(); }
});
syncTouch();

// WebAudio starts inside a user gesture, and whether that first gesture was
// enough is entirely up to the browser: an autoplay policy, a preview frame
// without the autoplay permission or a tab that was in the background can all
// leave the context suspended. So the unlock is permanent and runs on every
// gesture -- and a failed build is retried instead of swallowing the context.
const unlock = () => { audio.init(); audio.resume(); };
for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) {
  window.addEventListener(ev, unlock, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlock(); });
window.addEventListener('focus', () => { audio.resume(); });
window.addEventListener('pageshow', () => { audio.resume(); });

// Looking away. The window keeps drawing while another app has the focus, so
// a solo round used to carry on -- and keep biting -- during a coffee break.
// A shared game is left running (the world belongs to the host), and a menu
// or a death screen has nothing live to pause; `pauseForFocusLoss` decides.
// `visibilitychange` covers phones, where switching apps does not always blur
// the window; both paths are idempotent.
const lookAway = () => { game.pauseForFocusLoss(); };
window.addEventListener('blur', lookAway);
document.addEventListener('visibilitychange', () => { if (document.hidden) lookAway(); });

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

  // the game draws in view units; `ss` is how many backing-store pixels make
  // one of them (1 unless DLSS5 is on and the frame has not been eased back)
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
    // a frame past 33 ms is not "a bit slow", it is the game crawling: it
    // counts triple, so a real stutter steps the supersample down in under
    // half a second instead of the old second and a half
    if (workMs > 33) { ssSlow += 3; ssFast = 0; }
    else if (workMs > 20) { ssSlow++; ssFast = 0; }
    else if (workMs < 11) { ssFast++; ssSlow = 0; }
    else { ssSlow = 0; ssFast = 0; }
    if (ssSlow >= 45 && ssLevel < SS_STEPS.length - 1) { ssLevel++; ssSlow = 0; applyBacking(); }
    else if (ssFast >= 420 && ssLevel > 0) { ssLevel--; ssFast = 0; applyBacking(); }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose a little handle for debugging in the console
window.GAME = game;
window.TOUCH = touch;
window.INPUT = input;
