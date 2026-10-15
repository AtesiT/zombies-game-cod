/** Pseudo-elevation on the existing world plane; no changes to campaign storeys. */
export class ElevationSystem {
  constructor(manager) {
    this.manager = manager;
    this.platforms = manager.configs.filter((c) => c.type === 'platform');
    this.ziplines = manager.configs.filter((c) => c.type === 'zipline');
    this.states = new WeakMap();
    this.ride = null;
  }
  /** Get completed elevation state. */
  platform(entity) {
    const s = this.states.get(entity);
    return s?.progress >= 1 ? s.platform : null;
  }
  /** True when standing on a completed platform. */
  isElevated(entity) {
    return !!this.platform(entity);
  }
  /** Is this entity riding the line? */
  inTransit(entity) {
    return this.ride?.entity === entity;
  }
  /** Ground zombies must finish their climb before striking an elevated player. */
  canMelee(zombie, player) {
    const platform = this.platform(player);
    return !platform || this.platform(zombie)?.id === platform.id;
  }
  /** Speed while climbing, separate from base entity stats. */
  speedMultiplier(entity) {
    const s = this.states.get(entity);
    return s && s.progress < 1 ? 0.2 : 1;
  }
  /** Resolve nearest contextual entry/exit/zipline prompt. */
  interaction(player) {
    if (this.inTransit(player)) return null;
    const current = this.platform(player);
    for (const line of this.ziplines) {
      for (const [from, to] of [
        [line.from, line.to],
        [line.to, line.from],
      ])
        if (current?.id === from) {
          const p = this.platforms.find((p) => p.id === from);
          if (Math.hypot(player.pos.x - p.x, player.pos.y - p.y) < line.radius)
            return { label: 'RIDE ZIPLINE', kind: 'zipline', line, from, to };
        }
    }
    if (current)
      return { label: 'DESCEND FIRE ESCAPE / LOOKOUT', kind: 'descend', platform: current };
    for (const platform of this.platforms)
      if (Math.hypot(player.pos.x - platform.entry.x, player.pos.y - platform.entry.y) < 40)
        return { label: `CLIMB ${platform.name.toUpperCase()}`, kind: 'climb', platform };
    return null;
  }
  /** Execute the contextual interaction after clear landing tests. */
  interact(action, player) {
    const m = this.manager.game.map;
    if (action.kind === 'zipline') {
      const from = this.platforms.find((p) => p.id === action.from),
        to = this.platforms.find((p) => p.id === action.to);
      if (m._inSolid(to, player.r, 0)) {
        this.manager.message('ZIPLINE LANDING BLOCKED');
        return;
      }
      this.ride = { entity: player, from, to, duration: action.line.duration, age: 0 };
      player.vel.x = player.vel.y = 0;
      this.manager.emit('environment:zipline', action.line.id);
      return;
    }
    const point = action.kind === 'descend' ? action.platform.entry : action.platform;
    if (m._inSolid(point, player.r, 0)) {
      this.manager.message('LANDING BLOCKED');
      return;
    }
    Object.assign(player.pos, { x: point.x, y: point.y });
    player.vel.x = player.vel.y = 0;
    if (action.kind === 'descend') this.states.delete(player);
    else this.states.set(player, { platform: action.platform, progress: 1 });
    this.manager.emit('environment:elevation', {
      entity: player,
      platform: action.kind === 'descend' ? null : action.platform.id,
    });
  }
  /** Advance line travel and enemy climbing before movement/combat. */
  update(dt, entities) {
    if (this.ride) {
      const r = this.ride;
      r.age += dt;
      const a = Math.min(1, r.age / r.duration);
      Object.assign(r.entity.pos, {
        x: r.from.x + (r.to.x - r.from.x) * a,
        y: r.from.y + (r.to.y - r.from.y) * a,
      });
      r.entity.vel.x = r.entity.vel.y = 0;
      if (a >= 1) {
        this.states.set(r.entity, { platform: r.to, progress: 1 });
        this.ride = null;
      }
    }
    const player = this.manager.game.player,
      target = this.platform(player);
    for (const e of entities) {
      if (e === player || e.dead) continue;
      let s = this.states.get(e);
      if (s && !this.contains(s.platform, e.pos, 32)) {
        this.states.delete(e);
        s = null;
      }
      if (target && this.contains(target, e.pos, 32) && !s) {
        s = { platform: target, progress: 0 };
        this.states.set(e, s);
      }
      if (s && s.progress < 1) s.progress = Math.min(1, s.progress + dt / s.platform.climbSeconds);
    }
  }
  /** Keep the elevated player on the deck until explicit descent. */
  constrain(player) {
    const p = this.platform(player);
    if (!p || this.inTransit(player)) return;
    player.pos.x = Math.max(
      p.x - p.width / 2 + player.r,
      Math.min(p.x + p.width / 2 - player.r, player.pos.x),
    );
    player.pos.y = Math.max(
      p.y - p.height / 2 + player.r,
      Math.min(p.y + p.height / 2 - player.r, player.pos.y),
    );
  }
  /** Rectangle test, optionally extended for enemy climb acquisition. */
  contains(p, pos, padding = 0) {
    return (
      Math.abs(p.x - pos.x) <= p.width / 2 + padding &&
      Math.abs(p.y - pos.y) <= p.height / 2 + padding
    );
  }
  /** Render deck, ladder and cable; actor offset is applied by Game. */
  draw(ctx) {
    ctx.save();
    for (const line of this.ziplines) {
      const a = this.platforms.find((p) => p.id === line.from),
        b = this.platforms.find((p) => p.id === line.to);
      ctx.strokeStyle = '#abb8bb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 18);
      ctx.lineTo(b.x, b.y - 18);
      ctx.stroke();
    }
    for (const p of this.platforms) {
      ctx.fillStyle = '#101315';
      ctx.fillRect(p.x - p.width / 2 + 6, p.y - p.height / 2 + 8, p.width, p.height);
      ctx.fillStyle = '#4a5656';
      ctx.fillRect(p.x - p.width / 2, p.y - p.height / 2 - 18, p.width, p.height);
      ctx.strokeStyle = '#c7be93';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - p.width / 2, p.y - p.height / 2 - 18, p.width, p.height);
      ctx.beginPath();
      ctx.moveTo(p.entry.x - 7, p.entry.y);
      ctx.lineTo(p.x - 7, p.y);
      ctx.moveTo(p.entry.x + 7, p.entry.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.stroke();
      ctx.fillStyle = '#e0c888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      this.manager.label(ctx, p.name, p.x, p.y - p.height / 2 - 23);
    }
    ctx.restore();
  }
  /** Release all actor state. */
  dispose() {
    this.states = new WeakMap();
    this.ride = null;
    this.platforms = [];
    this.ziplines = [];
  }
}
