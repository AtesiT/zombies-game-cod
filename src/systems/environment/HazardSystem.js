import { ObjectPool } from '../../utils/ObjectPool.js';
/** Pooled electrical zones and ground traps with weakly-owned root timers. */
export class HazardSystem {
  constructor(manager) {
    this.manager = manager;
    this.zones = [];
    this.roots = new WeakMap();
    this.tick = 0;
    this.sprites = new Map();
    this.traps = manager.configs
      .filter((c) => c.type === 'bear-trap')
      .map((config) => ({ config, armed: true, cooldown: 0 }));
    this.pool = new ObjectPool(
      () => ({}),
      (z, c) => Object.assign(z, { ...c, remaining: c.duration }),
      32,
    );
  }
  /** Create a timed electrical hazard from a destroyed sign. */
  addZone(config) {
    if (this.zones.length >= 32) this.pool.release(this.zones.shift());
    const zone = this.pool.acquire(config);
    zone.sprite = this.zoneSprite(config.radius);
    this.zones.push(zone);
  }
  /** Current root status; does not retain the entity. */
  rooted(entity) {
    return (this.roots.get(entity) ?? 0) > this.manager.elapsed;
  }
  /** Apply active damage to an entity through the established combat API. */
  damage(entity, amount, x, y) {
    const g = this.manager.game;
    if (entity.dead || entity.remove || this.manager.elevation.inTransit(entity)) return;
    if (entity === g.player || g.players.includes(entity)) entity.hurt(amount, x, y, g);
    else if (entity.hurt(amount, false, g, Math.atan2(entity.pos.y - y, entity.pos.x - x)) === 2)
      g.onZombieKilled(entity, false, null, 'environment');
  }
  /** Tick lifetimes/trap cooldowns and apply DOT at intervals longer than player hurt immunity. */
  update(dt, entities) {
    for (let i = this.zones.length - 1; i >= 0; i--)
      if ((this.zones[i].remaining -= dt) <= 0) this.pool.release(this.zones.splice(i, 1)[0]);
    this.tick += dt;
    const pulse = this.tick >= 0.75;
    if (pulse) this.tick -= 0.75;
    for (const trap of this.traps) {
      if (!trap.armed) {
        trap.cooldown -= dt;
        if (trap.cooldown <= 0) trap.armed = true;
      }
      if (!trap.armed) continue;
      const c = trap.config;
      const victim = entities.find(
        (e) =>
          !e.dead &&
          !e.remove &&
          !this.manager.elevation.isElevated(e) &&
          !this.manager.elevation.inTransit(e) &&
          Math.hypot(e.pos.x - c.x, e.pos.y - c.y) <= c.radius + (e.r ?? 8),
      );
      if (victim) {
        trap.armed = false;
        trap.cooldown = c.rearmSeconds;
        this.roots.set(victim, this.manager.elapsed + c.rootSeconds);
        this.damage(victim, c.damage, c.x, c.y);
        this.manager.effect(c.x, c.y, '#dfa77c');
        this.manager.emit('environment:trap', { id: c.id, entity: victim });
      }
    }
    if (pulse)
      for (const z of this.zones)
        for (const e of entities)
          if (!e.dead && Math.hypot(e.pos.x - z.x, e.pos.y - z.y) <= z.radius + (e.r ?? 8))
            this.damage(e, z.damage * 0.75, z.x, z.y);
  }
  /** Bake electrical arcs once per radius; per-frame drawing is a single cached blit. */
  zoneSprite(radius) {
    if (this.sprites.has(radius)) return this.sprites.get(radius);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.ceil(radius * 2 + 6);
    const ctx = canvas.getContext('2d');
    ctx.translate(radius + 3, radius + 3);
    ctx.fillStyle = 'rgba(75,150,235,.22)';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#97e9ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = i * 1.25;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      ctx.lineTo(Math.cos(a + 0.22) * radius * 0.8, Math.sin(a + 0.22) * radius * 0.8);
      ctx.stroke();
    }
    if (this.sprites.size >= 8) this.sprites.delete(this.sprites.keys().next().value);
    this.sprites.set(radius, canvas);
    return canvas;
  }
  /** Draw bounded zones and armed/disarmed traps in world coordinates. */
  draw(ctx) {
    ctx.save();
    for (const z of this.zones) {
      if (!this.manager.game._vis(z.x, z.y, z.radius + 5)) continue;
      ctx.globalAlpha = 1;
      ctx.drawImage(z.sprite, z.x - z.radius - 3, z.y - z.radius - 3);
    }
    ctx.globalAlpha = 1;
    for (const t of this.traps) {
      const c = t.config;
      ctx.strokeStyle = t.armed ? '#cfb48a' : '#615c55';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, t.armed ? 13 : 6, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = t.armed ? '#a53426' : '#665b4b';
      ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
    }
    ctx.restore();
  }
  /** Release retained transient objects and root state. */
  dispose() {
    this.zones.forEach((z) => this.pool.release(z));
    this.zones.length = 0;
    this.pool.clear();
    this.sprites.clear();
    this.roots = new WeakMap();
    this.traps.length = 0;
  }
}
