import { audio } from '../../audio.js';
/** Shootable signs/supports, with delayed electrical falls or solid logging cover. */
export class DestructibleSystem {
  constructor(manager) {
    this.manager = manager;
    this.items = manager.configs
      .filter((c) => ['neon-sign', 'support-beam'].includes(c.type))
      .map((config) => ({ config, hp: config.hp, state: 'intact', fall: 0 }));
  }
  /** Find the closest ray-circle hit before static occlusion. */
  raycast(x, y, dx, dy, limit) {
    let best = null;
    for (const item of this.items) {
      if (item.state !== 'intact') continue;
      const c = item.config,
        ox = c.x - x,
        oy = c.y - y,
        t = ox * dx + oy * dy,
        d2 = ox * ox + oy * oy - t * t;
      if (d2 > c.radius * c.radius) continue;
      const entry = Math.max(0, t - Math.sqrt(c.radius * c.radius - d2));
      if (t + c.radius < 0 || entry > limit) continue;
      if (!best || entry < best.t) best = { item, t: entry };
    }
    return best;
  }
  /** Damage the target once per pellet; destruction is one-shot. */
  hit(item, damage) {
    if (item.state !== 'intact') return;
    item.hp = Math.max(0, item.hp - damage);
    this.manager.effect(item.config.x, item.config.y, item.config.color ?? '#deba78');
    if (item.hp <= 0) {
      audio.clang();
      item.state = 'falling';
      item.fall = item.config.fallSeconds;
      this.manager.emit('environment:destroyed', item.config.id);
    }
  }
  /** Resolve delayed falls; solidity changes happen once, never every frame. */
  update(dt) {
    for (const item of this.items)
      if (item.state === 'falling' && (item.fall -= dt) <= 0) {
        item.state = 'fallen';
        const c = item.config;
        if (c.type === 'neon-sign')
          this.manager.hazards.addZone({
            x: c.x,
            y: c.y,
            radius: c.hazardRadius,
            damage: c.damage,
            duration: c.duration,
          });
        else this.manager.placeCover(c.cells, c.damage);
      }
  }
  /** Count completed destruction for generic quest requirements. */
  count(type) {
    return this.items.filter((i) => i.config.type === type && i.state === 'fallen').length;
  }
  /** Draw signs, falling animation and completed solid logs. */
  draw(ctx) {
    ctx.save();
    for (const item of this.items) {
      const c = item.config;
      if (c.type === 'neon-sign') {
        ctx.save();
        ctx.translate(c.x, c.y);
        if (item.state === 'falling') ctx.rotate((1 - item.fall / c.fallSeconds) * 1.2);
        ctx.fillStyle = item.state === 'intact' ? '#17252b' : '#282524';
        ctx.fillRect(-24, -10, 48, 20);
        ctx.strokeStyle = item.state === 'intact' ? c.color : '#606267';
        ctx.lineWidth = 3;
        ctx.strokeRect(-24, -10, 48, 20);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        this.manager.label(ctx, c.name, 0, 3);
        ctx.restore();
      } else {
        if (item.state === 'intact') {
          ctx.fillStyle = '#876844';
          ctx.fillRect(c.x - 30, c.y - 31, 60, 12);
          ctx.fillStyle = '#d3bd87';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          this.manager.label(ctx, 'SHOOT SUPPORT', c.x, c.y - 37);
        }
        ctx.fillStyle = '#a67d49';
        ctx.fillRect(c.x - 5, c.y - 20, 10, 40);
        ctx.strokeStyle = '#e2cc8c';
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - 5, c.y - 20, 10, 40);
        if (item.state !== 'intact') {
          ctx.globalAlpha =
            item.state === 'falling' ? Math.max(0.15, 1 - item.fall / c.fallSeconds) : 1;
          for (const cell of c.cells) {
            ctx.fillStyle = '#715031';
            const t = item.state === 'falling' ? 1 - item.fall / c.fallSeconds : 1;
            const x = c.x + (cell.x * 24 - c.x) * t,
              y = c.y + (cell.y * 24 - c.y) * t;
            ctx.fillRect(x, y, 24, 24);
            ctx.strokeStyle = '#b09056';
            ctx.strokeRect(x + 2, y + 3, 20, 18);
          }
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }
  /** Drop state owned by this session. */
  dispose() {
    this.items.length = 0;
  }
}
