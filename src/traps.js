// Buyable level traps. Pay, step back, and watch the funnel burn.
//
// Every trap is a wall device plus a trigger zone. Arming one costs points and
// runs it for a few seconds; then it needs to recharge before it will arm
// again. Damage only ever lands on zombies -- the player is safe.

import { T } from './art.js';

export const TRAP_PRICE = 500;

const KINDS = {
  flame: {
    id: 'flame', name: 'Flame Trap', colour: '#f07a2a',
    dur: 8, cool: 26, dps: 115, burn: 34, burnTime: 3.2,
    desc: 'Torches the whole window ledge.',
  },
  electric: {
    id: 'electric', name: 'Electric Barrier', colour: '#6ac8f0',
    dur: 8, cool: 24, dps: 80, stun: 0.55,
    desc: 'Cooks and stuns anyone in the doorway.',
  },
  steam: {
    id: 'steam', name: 'Steam Vent', colour: '#cfe0ea',
    dur: 8, cool: 22, dps: 75, slow: 5, push: 240,
    desc: 'Scalds the doorway and washes them back out.',
  },
};

export class Trap {
  constructor(def) {
    Object.assign(this, def);
    this.x = (def.tx + 0.5) * T;
    this.y = (def.ty + 0.5) * T;
    // trigger zone, in pixels
    this.zx = def.zone.x * T;
    this.zy = def.zone.y * T;
    this.zw = def.zone.w * T;
    this.zh = def.zone.h * T;
    this.kind = KINDS[def.kind];
    this.name = this.kind.name;
    // nudge the box off the wall face so it reads as wall-mounted
    this.y += def.face === 'up' ? -6 : def.face === 'down' ? 6 : 0;
    this.price = TRAP_PRICE;
    this.active = 0;      // seconds left of mayhem
    this.cool = 0;        // recharge
    this.tick = 0;        // damage accumulator
    this.puff = 0;
  }

  get ready() { return this.active <= 0 && this.cool <= 0; }
  get running() { return this.active > 0; }

  arm() {
    if (!this.ready) return false;
    this.active = this.kind.dur;
    this.tick = 0;
    return true;
  }

  inZone(x, y) {
    return x >= this.zx && x <= this.zx + this.zw && y >= this.zy && y <= this.zy + this.zh;
  }

  centre() { return { x: this.zx + this.zw / 2, y: this.zy + this.zh / 2 }; }

  update(dt, game) {
    if (this.active > 0) {
      this.active -= dt;
      if (this.active <= 0) { this.active = 0; this.cool = this.kind.cool; }
      this.puff -= dt;
      // 5 damage ticks a second
      this.tick += dt;
      const step = 0.2;
      while (this.tick >= step) {
        this.tick -= step;
        this.damageTick(game, step);
      }
      if (this.puff <= 0) { this.puff = 0.04; this.emit(game); }
    } else if (this.cool > 0) {
      this.cool = Math.max(0, this.cool - dt);
    }
  }

  damageTick(game, step) {
    const k = this.kind;
    for (const z of game.zombies) {
      if (z.dead) continue;
      if (!this.inZone(z.pos.x, z.pos.y)) continue;
      const dmg = k.dps * step;
      const res = z.hurt(dmg, false, game, Math.atan2(z.pos.y - this.y, z.pos.x - this.x));
      if (k.burn) z.burning = Math.max(z.burning ?? 0, k.burnTime), z.burnDmg = k.burn;
      if (k.stun) z.frozen = Math.max(z.frozen, k.stun);
      if (k.slow) z.webbed = Math.max(z.webbed, k.slow);
      if (k.push) {
        // shoved back towards the vent -- i.e. out of the door they came in
        const a = Math.atan2(this.y - z.pos.y, this.x - z.pos.x);
        z.vel.x += Math.cos(a) * k.push * step;
        z.vel.y += Math.sin(a) * k.push * step;
      }
      if (res === 2) game.onZombieKilled(z, false, null, 'trap');
    }
  }

  emit(game) {
    const k = this.kind;
    const n = k.id === 'steam' ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const x = this.zx + Math.random() * this.zw;
      const y = this.zy + Math.random() * this.zh;
      if (k.id === 'flame') {
        game.particles.spark(x, y, -Math.PI / 2 + Math.random() - 0.5, 2, k.colour);
      } else if (k.id === 'steam') {
        game.particles.smoke(x, y, 2);
      } else {
        game.particles.spark(x, y, Math.random() * Math.PI * 2, 2, k.colour);
      }
    }
    if (k.id === 'electric' && Math.random() < 0.4) {
      const c = this.centre();
      game.arcs.push({
        x0: this.x, y0: this.y, x1: c.x + (Math.random() - 0.5) * this.zw,
        y1: c.y + (Math.random() - 0.5) * this.zh, life: 0.16, max: 0.16, colour: k.colour,
      });
    }
  }

  draw(ctx, time) {
    const k = this.kind;
    // the zone itself, only while it is running
    if (this.running) {
      ctx.save();
      const a = 0.16 + Math.sin(time * 12) * 0.06;
      ctx.fillStyle = k.id === 'flame' ? `rgba(240,122,42,${a})`
        : k.id === 'steam' ? `rgba(207,224,234,${a})`
          : `rgba(106,200,240,${a})`;
      ctx.fillRect(this.zx, this.zy, this.zw, this.zh);
      ctx.strokeStyle = `${k.colour}66`;
      ctx.lineWidth = 1;
      ctx.strokeRect(this.zx + 0.5, this.zy + 0.5, this.zw - 1, this.zh - 1);
      ctx.restore();
    }

    // wall device
    const x = this.x, y = this.y;
    ctx.save();
    ctx.fillStyle = '#2b2e33';
    ctx.fillRect(x - 7, y - 10, 14, 20);
    ctx.fillStyle = '#3a3e45';
    ctx.fillRect(x - 7, y - 10, 14, 3);
    ctx.fillStyle = '#191b1e';
    ctx.fillRect(x - 7, y + 7, 14, 3);
    // status lamp
    const lamp = this.ready ? k.colour : this.running ? '#fff2c0' : '#4a4d52';
    ctx.fillStyle = lamp;
    ctx.fillRect(x - 3, y - 4, 6, 4);
    if (this.ready) {
      ctx.globalAlpha = 0.25 + Math.sin(time * 3) * 0.12;
      ctx.fillStyle = k.colour;
      ctx.fillRect(x - 6, y - 7, 12, 10);
      ctx.globalAlpha = 1;
    }
    // nozzle / coil / vent, one silhouette per kind
    if (k.id === 'flame') {
      ctx.fillStyle = '#5a5f66';
      ctx.fillRect(x - 2, y + 2, 4, 6);
      ctx.fillRect(x - 4, y + 7, 8, 2);
    } else if (k.id === 'electric') {
      ctx.strokeStyle = '#6a7180';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 2 + i * 2.5);
        ctx.lineTo(x + 5, y + 2 + i * 2.5);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#7a8089';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 5, y + 2 + i * 3, 10, 1.5);
    }
    ctx.restore();

    // price / countdown
    ctx.save();
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    const label = this.ready ? `${TRAP_PRICE}` : this.running ? `${this.active.toFixed(1)}s` : `${Math.ceil(this.cool)}s`;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(label, x + 1, y + 22);
    ctx.fillStyle = this.ready ? '#f0d98a' : this.running ? k.colour : '#6f6a5c';
    ctx.fillText(label, x, y + 21);
    ctx.restore();
  }
}

/**
 * Three traps, placed on the funnels the horde actually uses.
 *   flame    -> the ledge under room C's south windows
 *   electric -> the ledge under room A's north windows
 *   steam    -> the mouth of the room B -> room D doorway
 *
 * Each device sits on a stretch of wall with nothing else on it, so the
 * "hold E" prompt is never fighting a wall buy or a door for the same tile.
 */
export const TRAP_DEFS = [
  { kind: 'flame', tx: 26, ty: 30, face: 'up', zone: { x: 14, y: 28, w: 14, h: 2 } },
  { kind: 'electric', tx: 26, ty: 8, face: 'down', zone: { x: 14, y: 9, w: 14, h: 2 } },
  { kind: 'steam', tx: 33, ty: 19, face: 'down', zone: { x: 29, y: 20, w: 12, h: 4 } },
];

export class Traps {
  constructor(defs = TRAP_DEFS) {
    this.list = defs.map((d, i) => new Trap({ ...d, i }));
    this.kills = 0;
  }

  update(dt, game) { for (const t of this.list) t.update(dt, game); }
  draw(ctx, time) { for (const t of this.list) t.draw(ctx, time); }

  nearest(x, y, maxDist = 46) {
    let best = null, bd = maxDist;
    for (const t of this.list) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}
