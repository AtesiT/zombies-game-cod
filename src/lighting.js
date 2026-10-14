// Deferred-ish 2D lighting: a half-resolution darkness layer with holes
// punched out for each light, plus a warm additive glow pass.

// Baked radial masks. Creating a fresh createRadialGradient() for every light
// every frame was the single most expensive thing in the renderer; these are
// drawn once and then blitted with globalAlpha doing the dimming.
let PUNCH = null;      // darkness punch-out mask (destination-out)
const GLOWS = new Map();   // "r,g,b" -> tinted additive glow sprite (baked opaque)

const PUNCH_STOPS = [[0, 1], [0.4, 0.742], [0.75, 0.309], [1, 0]];
const GLOW_STOPS = [[0, 1], [0.45, 0.55], [1, 0]];

function bakeStops(size, stops, rgb) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(${rgb},${a})`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function punchMask() {
  if (!PUNCH) PUNCH = bakeStops(256, PUNCH_STOPS, '0,0,0');
  return PUNCH;
}

// The colour a light hands over carries a per-frame flicker alpha -- a pulsing
// perk machine, a fading explosion. Baking that alpha into the sprite meant a
// brand new 128x128 gradient canvas for every light of every frame, and the
// cache grew by ~46 MB a second and never let go of any of it. So bake one
// sprite per RGB and apply the alpha with globalAlpha instead: under 'lighter'
// the two are equivalent, and a flickering light now reuses one sprite forever.
let glowAlpha = 1;      // set by glowSprite(), read straight after by composite()

function glowSprite(colour) {
  const m = /rgba?\(([^)]+)\)/.exec(colour);
  const parts = m ? m[1].split(',').map((v) => parseFloat(v)) : [255, 255, 255];
  const r = Math.round(parts[0]) || 0;
  const g = Math.round(parts[1]) || 0;
  const b = Math.round(parts[2]) || 0;
  const a = parts.length > 3 ? parts[3] : 1;
  glowAlpha = Number.isFinite(a) ? a : 1;
  const key = `${r},${g},${b}`;
  let c = GLOWS.get(key);
  if (!c) {
    if (GLOWS.size > 64) GLOWS.clear();      // belt and braces
    c = bakeStops(128, GLOW_STOPS, key);
    GLOWS.set(key, c);
  }
  return c;
}

// The torch cone: a radial falloff baked inside a wedge pointing along +x, then
// rotated into place. One sprite per spread angle -- ever, instead of one clip
// plus one fresh gradient per frame. Softness rides on globalAlpha.
const CONES = new Map();
function coneSprite(spread) {
  const key = spread.toFixed(3);
  let c = CONES.get(key);
  if (!c) {
    if (CONES.size > 8) CONES.clear();          // belt and braces
    const N = 256, h = N / 2;
    c = document.createElement('canvas');
    c.width = N; c.height = N;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(h, h, h * 0.05, h, h, h);
    g.addColorStop(0, 'rgba(0,0,0,0.98)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(h, h);
    x.arc(h, h, h, -spread, spread);
    x.closePath();
    x.fill();
    CONES.set(key, c);
  }
  return c;
}

const GLOW_SCALE = 0.5;          // glow layer, relative to the darkness layer

export class Lighting {
  constructor(w, h, scale = 0.5) {
    this.baseW = w;
    this.baseH = h;
    this.w = Math.max(1, Math.round(w * scale));
    this.h = Math.max(1, Math.round(h * scale));
    this.scale = scale;
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    // Coloured glow used to be added straight onto the 800x500 scene, which
    // meant ~1.4 Mpx of additive blending per frame -- half the whole render.
    // They are soft blobs, so they lose nothing by being added at layer
    // resolution and upscaled in one go.
    // ...and half as much again for the coloured glow, because a soft blob
    // at a quarter of screen resolution looks exactly like a soft blob at a
    // half -- only a quarter of the pixels to add.
    const gc = document.createElement('canvas');
    this.gw = Math.max(1, Math.round(this.w * GLOW_SCALE));
    this.gh = Math.max(1, Math.round(this.h * GLOW_SCALE));
    gc.width = this.gw; gc.height = this.gh;
    this.glowCanvas = gc;
    this.glowCtx = gc.getContext('2d');
    this.ambient = [19, 25, 40];
    this.ambientAlpha = 0.66;
    this.glow = [];
  }

  setAmbient(rgb, alpha) { this.ambient = rgb; this.ambientAlpha = alpha; }

  /** Re-cut the layers at a new resolution -- the quality switch, live. */
  setScale(scale) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.w = Math.max(1, Math.round(this.baseW * scale));
    this.h = Math.max(1, Math.round(this.baseH * scale));
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.gw = Math.max(1, Math.round(this.w * GLOW_SCALE));
    this.gh = Math.max(1, Math.round(this.h * GLOW_SCALE));
    this.glowCanvas.width = this.gw; this.glowCanvas.height = this.gh;
    this.ctx = this.canvas.getContext('2d');
    this.glowCtx = this.glowCanvas.getContext('2d');
  }

  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    const [r, g, b] = this.ambient;
    c.fillStyle = `rgba(${r},${g},${b},${this.ambientAlpha})`;
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'destination-out';
    this.glow.length = 0;
    const gl = this.glowCtx;
    gl.setTransform(1, 0, 0, 1, 0, 0);
    gl.globalCompositeOperation = 'source-over';
    gl.clearRect(0, 0, this.gw, this.gh);
  }

  /** Cone-shaped light (the player's torch). */
  cone(x, y, angle, radius, spread, softness = 0.6) {
    const c = this.ctx;
    const s = this.scale;
    const X = x * s, Y = y * s, R = radius * s;
    if (X + R < 0 || Y + R < 0 || X - R > this.w || Y - R > this.h) return;
    // The torch used to be a clip + a fresh radial gradient every frame; the
    // wedge is now baked once and simply rotated into place.
    c.save();
    c.translate(X, Y);
    c.rotate(angle);
    c.globalAlpha = Math.min(1, softness);
    c.drawImage(coneSprite(spread), -R, -R, R * 2, R * 2);
    c.globalAlpha = 1;
    c.restore();
  }

  /** Round light. `power` 0..1 controls how much darkness is removed. */
  point(x, y, radius, power = 1, colour = null, glowPower = 0.5) {
    const c = this.ctx;
    const s = this.scale;
    const X = x * s, Y = y * s, R = radius * s;
    if (X + R < 0 || Y + R < 0 || X - R > this.w || Y - R > this.h) return;
    if (power <= 0) return;
    c.globalAlpha = Math.min(1, 0.97 * power);
    c.drawImage(punchMask(), X - R, Y - R, R * 2, R * 2);
    c.globalAlpha = 1;
    if (colour && glowPower > 0.02) {
      this.glow.push({ x, y, radius: radius * 1.15, colour, power: glowPower });
    }
  }

  /**
   * The soft light pass. Every lamp, muzzle flash and fire on the glow layer
   * is taken down to an eighth of the screen and blown back up again, which
   * is a blur for free: no shader, no per-pixel work, two blits. What you get
   * is a halo around anything that burns, and light that looks like it is
   * coming off the bulb instead of being stencilled on the floor.
   */
  _bloom(ctx, w, h, amount) {
    const glow = this.glowCanvas;
    if (!glow) return;
    if (!this.bloomCanvas) {
      this.bloomCanvas = document.createElement('canvas');
      this.bloomCtx = this.bloomCanvas.getContext('2d');
    }
    const b = this.bloomCanvas, bc = this.bloomCtx;
    const bw = Math.max(1, Math.round(w / 8)), bh = Math.max(1, Math.round(h / 8));
    if (b.width !== bw || b.height !== bh) { b.width = bw; b.height = bh; }
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    bc.globalAlpha = 1;
    bc.imageSmoothingEnabled = true;
    bc.clearRect(0, 0, bw, bh);
    bc.drawImage(glow, 0, 0, bw, bh);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    // wide: the halo that reaches into the dark around the bulb
    const spread = Math.round(Math.min(w, h) * 0.10);
    ctx.globalAlpha = 0.58 * amount;
    ctx.drawImage(b, -spread, -spread, w + spread * 2, h + spread * 2);
    // tight: the bloom hugging the light itself
    ctx.globalAlpha = 0.42 * amount;
    ctx.drawImage(b, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Composite the darkness layer + coloured glow onto the scene. `bloom`
   * (0..1) is DLSS5's soft light pass on top of all that.
   */
  composite(ctx, w, h, bloom = 0) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, w, h);

    // glows are accumulated on their own small layer, then added in one blit
    const g = this.glowCtx;
    const s = this.scale * GLOW_SCALE;
    g.globalCompositeOperation = 'lighter';
    for (const q of this.glow) {
      const X = q.x * s, Y = q.y * s, R = q.radius * s;
      if (X + R < 0 || Y + R < 0 || X - R > this.gw || Y - R > this.gh) continue;
      const sprite = glowSprite(q.colour);
      g.globalAlpha = Math.min(1, q.power * glowAlpha);
      g.drawImage(sprite, X - R, Y - R, R * 2, R * 2);
    }
    g.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.glowCanvas, 0, 0, w, h);
    ctx.globalAlpha = 1;

    if (bloom > 0.01) this._bloom(ctx, w, h, bloom);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
//  DLSS5's post-grade. The supersample and the bloom get the pixels clean and
//  glowing; this is the pass that makes the picture *feel* graded, the way a
//  colourist works over a finished frame. It is all cheap full-screen blits --
//  a couple of gradients and a tiny film-grain -- so it costs next to nothing
//  even when the frame underneath was supersampled.
// ---------------------------------------------------------------------------

// Film grain: three big sheets, each a shuffled patchwork of noise patches,
// baked once and stamped as a single repeating pattern. That is one fill per
// frame instead of two dozen tiled drawImage calls, which is the difference
// between "free" and "the reason DLSS5 lagged on a phone".
const GRAIN_N = 3;
const GRAIN_TILE = 96;
const GRAIN_SHEET = 288;
let GRAIN_SHEETS = null;
let GRAIN_PATTERNS = null;   // { ctx, pats[] } -- patterns belong to a context
function grainSheets() {
  if (GRAIN_SHEETS) return GRAIN_SHEETS;
  const patches = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = GRAIN_TILE; c.height = GRAIN_TILE;
    const x = c.getContext('2d');
    const img = x.createImageData(GRAIN_TILE, GRAIN_TILE);
    for (let j = 0; j < img.data.length; j += 4) {
      const v = 96 + Math.floor(Math.random() * 64);      // mid-grey speckle
      img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    patches.push(c);
  }
  GRAIN_SHEETS = [];
  for (let i = 0; i < GRAIN_N; i++) {
    const c = document.createElement('canvas');
    c.width = GRAIN_SHEET; c.height = GRAIN_SHEET;
    const x = c.getContext('2d');
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        x.drawImage(patches[(i + tx + ty * 2 + (tx * ty) % 3) % patches.length],
                    tx * GRAIN_TILE, ty * GRAIN_TILE);
      }
    }
    GRAIN_SHEETS.push(c);
  }
  return GRAIN_SHEETS;
}

// The warm radial grade used to be rebuilt as a gradient shader every frame;
// it never changes for a given frame size, so bake it once and blit it.
let WARM_LAYER = null;
function warmLayer(w, h) {
  if (WARM_LAYER && WARM_LAYER.w === w && WARM_LAYER.h === h) return WARM_LAYER.canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.1,
                                   w / 2, h * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,178,102,0.16)');
  g.addColorStop(0.6, 'rgba(180,150,120,0.05)');
  g.addColorStop(1, 'rgba(70,90,120,0.10)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  WARM_LAYER = { w, h, canvas: c };
  return c;
}

/**
 * Grade the finished frame. `t` is time, used to walk the grain around.
 * Returns silently when there is nothing to do.
 */
export function postgrade(ctx, w, h, t = 0) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;

  // -- the grade itself: one cached blit -------------------------------------
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(warmLayer(w, h), 0, 0);

  // Push the contrast a little: blacks slightly blacker, lights slightly more.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 0, w, h);

  // -- film grain: one pattern fill, walked a few pixels each frame ----------
  const sheets = grainSheets();
  if (!GRAIN_PATTERNS || GRAIN_PATTERNS.ctx !== ctx) {
    GRAIN_PATTERNS = { ctx, pats: sheets.map((sh) => ctx.createPattern(sh, 'repeat')) };
  }
  const ox = (Math.floor(t * 37) % GRAIN_SHEET);
  const oy = (Math.floor(t * 23) % GRAIN_SHEET);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = GRAIN_PATTERNS.pats[Math.floor(t * 18) % GRAIN_N];
  ctx.translate(-ox, -oy);
  ctx.fillRect(0, 0, w + GRAIN_SHEET, h + GRAIN_SHEET);
  ctx.globalAlpha = 1;

  ctx.restore();
}

/** Radial vignette drawn straight onto the scene. Baked once, then blitted. */
let VIGNETTE = null;
export function drawVignette(ctx, w, h, strength = 0.55) {
  if (!VIGNETTE || VIGNETTE.w !== w || VIGNETTE.h !== h || VIGNETTE.s !== strength) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    VIGNETTE = { w, h, s: strength, canvas: c };
  }
  ctx.drawImage(VIGNETTE.canvas, 0, 0);
}
