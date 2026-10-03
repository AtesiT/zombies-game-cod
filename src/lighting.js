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
    const gc = document.createElement('canvas');
    gc.width = this.w; gc.height = this.h;
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
    this.glowCanvas.width = this.w; this.glowCanvas.height = this.h;
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
    gl.clearRect(0, 0, this.w, this.h);
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

  /** Composite the darkness layer + coloured glow onto the scene. */
  composite(ctx, w, h) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, w, h);

    // glows are accumulated on their own small layer, then added in one blit
    const g = this.glowCtx;
    const s = this.scale;
    g.globalCompositeOperation = 'lighter';
    for (const q of this.glow) {
      const X = q.x * s, Y = q.y * s, R = q.radius * s;
      if (X + R < 0 || Y + R < 0 || X - R > this.w || Y - R > this.h) continue;
      const sprite = glowSprite(q.colour);
      g.globalAlpha = Math.min(1, q.power * glowAlpha);
      g.drawImage(sprite, X - R, Y - R, R * 2, R * 2);
    }
    g.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.glowCanvas, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
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
