// Deferred-ish 2D lighting: a half-resolution darkness layer with holes
// punched out for each light, plus a warm additive glow pass.

export class Lighting {
  constructor(w, h, scale = 0.5) {
    this.w = Math.max(1, Math.round(w * scale));
    this.h = Math.max(1, Math.round(h * scale));
    this.scale = scale;
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ambient = [8, 10, 18];
    this.ambientAlpha = 0.79;
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
    const g = c.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, `rgba(0,0,0,${0.97 * power})`);
    g.addColorStop(0.4, `rgba(0,0,0,${0.72 * power})`);
    g.addColorStop(0.75, `rgba(0,0,0,${0.3 * power})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(X, Y, R, 0, Math.PI * 2);
    c.fill();
    if (colour) this.glow.push({ x, y, radius: radius * 1.15, colour, power: glowPower });
  }

  /** Composite the darkness layer + coloured glow onto the scene. */
  composite(ctx, w, h) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glow) {
      const rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
      rg.addColorStop(0, g.colour);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = g.power;
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
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
