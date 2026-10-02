// Deferred-ish 2D lighting: a half-resolution darkness layer with holes
// punched out for each light, plus a warm additive glow pass.

// Baked radial masks. Creating a fresh createRadialGradient() for every light
// every frame was the single most expensive thing in the renderer; these are
// drawn once and then blitted with globalAlpha doing the dimming.
let PUNCH = null;      // darkness punch-out mask (destination-out)
const GLOWS = new Map();   // colour -> tinted additive glow sprite

const PUNCH_STOPS = [[0, 1], [0.4, 0.742], [0.75, 0.309], [1, 0]];
const GLOW_STOPS = [[0, 1], [0.45, 0.55], [1, 0]];   // scaled by the colour's own alpha

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

function glowSprite(colour) {
  let c = GLOWS.get(colour);
  if (!c) {
    const m = /rgba?\(([^)]+)\)/.exec(colour);
    const parts = m ? m[1].split(',').map((v) => parseFloat(v)) : [255, 255, 255, 1];
    const rgb = `${Math.round(parts[0])},${Math.round(parts[1])},${Math.round(parts[2])}`;
    const a = parts.length > 3 ? parts[3] : 1;
    const stops = GLOW_STOPS.map(([at, mul]) => [at, mul * a]);
    c = bakeStops(128, stops, rgb);
    GLOWS.set(colour, c);
  }
  return c;
}

export class Lighting {
  constructor(w, h, scale = 0.5) {
    this.w = Math.max(1, Math.round(w * scale));
    this.h = Math.max(1, Math.round(h * scale));
    this.scale = scale;
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ambient = [19, 25, 40];
    this.ambientAlpha = 0.66;
    this.glow = [];
  }

  setAmbient(rgb, alpha) { this.ambient = rgb; this.ambientAlpha = alpha; }

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
  }

  /** Cone-shaped light (the player's torch). */
  cone(x, y, angle, radius, spread, softness = 0.6) {
    const c = this.ctx;
    const s = this.scale;
    const X = x * s, Y = y * s, R = radius * s;
    if (X + R < 0 || Y + R < 0 || X - R > this.w || Y - R > this.h) return;
    c.save();
    c.beginPath();
    c.moveTo(X, Y);
    c.arc(X, Y, R, angle - spread, angle + spread);
    c.closePath();
    c.clip();
    const g = c.createRadialGradient(X, Y, R * 0.05, X, Y, R);
    g.addColorStop(0, `rgba(0,0,0,${0.98 * softness})`);
    g.addColorStop(0.45, `rgba(0,0,0,${0.75 * softness})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(X - R, Y - R, R * 2, R * 2);
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
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glow) {
      if (g.x + g.radius < 0 || g.y + g.radius < 0 || g.x - g.radius > w || g.y - g.radius > h) continue;
      ctx.globalAlpha = Math.min(1, g.power);
      ctx.drawImage(glowSprite(g.colour), g.x - g.radius, g.y - g.radius, g.radius * 2, g.radius * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/** Radial vignette drawn straight onto the scene. */
export function drawVignette(ctx, w, h, strength = 0.55) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
