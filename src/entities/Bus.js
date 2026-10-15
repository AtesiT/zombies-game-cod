/** Oriented vehicle body, independent of input and game lifecycle. */
export class Bus {
  constructor(config) {
    this.config = config;
    this.pos = { x: config.x, y: config.y };
    this.vel = { x: 0, y: 0 };
    this.angle = config.angle ?? 0;
    this.steer = 0;
    this.hp = config.hp;
    this.fuel = config.fuel;
    this.length = config.length;
    this.width = config.width;
    this.driving = false;
  }
  /** Convert a world point to body coordinates. */
  local(x, y) {
    const c = Math.cos(this.angle),
      s = Math.sin(this.angle);
    const dx = x - this.pos.x,
      dy = y - this.pos.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }
  /** Convert body coordinates to world coordinates. */
  world(x, y) {
    const c = Math.cos(this.angle),
      s = Math.sin(this.angle);
    return { x: this.pos.x + x * c - y * s, y: this.pos.y + x * s + y * c };
  }
  /** Distance outside the body surface (zero inside). */
  distance(x, y) {
    const p = this.local(x, y);
    return Math.hypot(
      Math.max(0, Math.abs(p.x) - this.length / 2),
      Math.max(0, Math.abs(p.y) - this.width / 2),
    );
  }
  /** Resolve a circle against the oriented body. */
  resolve(pos, radius) {
    const p = this.local(pos.x, pos.y),
      hx = this.length / 2,
      hy = this.width / 2;
    const nx = Math.max(-hx, Math.min(hx, p.x)),
      ny = Math.max(-hy, Math.min(hy, p.y));
    const dx = p.x - nx,
      dy = p.y - ny,
      d = Math.hypot(dx, dy);
    if (d >= radius) return false;
    if (d > 0.001) {
      p.x += (dx / d) * (radius - d);
      p.y += (dy / d) * (radius - d);
    } else if (hx - Math.abs(p.x) < hy - Math.abs(p.y)) p.x = (p.x < 0 ? -1 : 1) * (hx + radius);
    else p.y = (p.y < 0 ? -1 : 1) * (hy + radius);
    Object.assign(pos, this.world(p.x, p.y));
    return true;
  }
  /** Draw a top-down armored bus with an obvious front/driver door. */
  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    const l = this.length,
      w = this.width;
    ctx.fillStyle = '#080c0e';
    ctx.fillRect(-l / 2 + 5, -w / 2 - 4, l - 10, w + 8);
    ctx.fillStyle = this.hp > 0 ? '#687f79' : '#3b302e';
    ctx.fillRect(-l / 2, -w / 2, l, w);
    ctx.strokeStyle = '#afc1a8';
    ctx.lineWidth = 2;
    ctx.strokeRect(-l / 2 + 3, -w / 2 + 3, l - 6, w - 6);
    ctx.fillStyle = '#162e36';
    ctx.fillRect(l / 2 - 21, -w / 2 + 4, 15, w - 8);
    for (let x = -l / 2 + 10; x < l / 2 - 24; x += 15) {
      ctx.fillStyle = '#203c45';
      ctx.fillRect(x, -w / 2 + 3, 10, 5);
      ctx.fillRect(x, w / 2 - 8, 10, 5);
    }
    ctx.fillStyle = '#b5b493';
    ctx.fillRect(-20, -10, 30, 20);
    ctx.fillStyle = '#f4df9a';
    ctx.fillRect(l / 2 - 2, -w / 2 + 2, 4, 7);
    ctx.fillRect(l / 2 - 2, w / 2 - 9, 4, 7);
    ctx.fillStyle = '#ef9e50';
    ctx.fillRect(l / 2 - 23, w / 2 - 3, 17, 4);
    ctx.restore();
  }
}
