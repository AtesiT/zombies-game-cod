import { EnvironmentRenderer } from './EnvironmentRenderer.js';
import { TILE } from '../../art.js';
import { ObjectPool } from '../../utils/ObjectPool.js';
import { HazardSystem } from './HazardSystem.js';
import { ElevationSystem } from './ElevationSystem.js';
import { DestructibleSystem } from './DestructibleSystem.js';
import { RelayQuest } from './RelayQuest.js';
/** Session-owned data-driven hazards, elevation, destructibles and quests. */
export class EnvironmentManager {
  constructor(game, configs) {
    this.game = game;
    this.configs = configs;
    this.elapsed = 0;
    this.renderer = new EnvironmentRenderer();
    this.lightColors = new Map(
      configs
        .filter((c) => c.type === 'neon-sign')
        .map((c) => {
          const n = parseInt(c.color.slice(1), 16);
          return [c.id, `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.4)`];
        }),
    );
    this.entities = [];
    this.owners = new WeakMap();
    this.elevation = new ElevationSystem(this);
    this.hazards = new HazardSystem(this);
    this.destructibles = new DestructibleSystem(this);
    this.quests = configs
      .filter((c) => c.type === 'relay-quest')
      .map((c) => new RelayQuest(this, c));
    this.mud = configs.filter((c) => c.type === 'mud');
    this.effects = [];
    this.pool = new ObjectPool(
      () => ({}),
      (p, x, y, color) => Object.assign(p, { x, y, color, life: 0.35 }),
      64,
    );
    game.map.environment = this;
  }
  /** Draw cached environment text with the current Canvas style. */
  label(ctx, text, x, y) {
    this.renderer.label(ctx, text, x, y);
  }
  /** Publish through the shared event bus, so consumers own their subscriptions. */
  emit(type, payload) {
    this.game.mapManager.emit(type, payload);
  }
  /** Bounded reusable impact effect. */
  effect(x, y, color) {
    if (this.effects.length >= 64) this.pool.release(this.effects.shift());
    this.effects.push(this.pool.acquire(x, y, color));
  }
  /** Short interaction feedback. */
  message(text) {
    const p = this.game.player;
    this.game.popups.add(p.pos.x, p.pos.y - 30, text, '#b9e8dc', 11);
  }
  /** Compose terrain/climb/root movement without mutating base entity stats. */
  speedMultiplier(entity) {
    if (this.hazards.rooted(entity)) return 0;
    if (this.elevation.isElevated(entity)) return 1;
    const muddy = this.mud.some(
      (c) =>
        Math.abs(entity.pos.x - c.x) < c.width / 2 && Math.abs(entity.pos.y - c.y) < c.height / 2,
    );
    return (muddy ? 0.6 : 1) * this.elevation.speedMultiplier(entity);
  }
  /** Accuracy bonus while on an elevated deck; smaller spread is more accurate. */
  accuracyMultiplier(entity) {
    return this.elevation.isElevated(entity) ? 0.65 : 1;
  }
  /** Central collision guard stops rooted actors, including knockback movement branches. */
  canMove(pos) {
    const entity = this.owners.get(pos);
    return !entity || !this.hazards.rooted(entity);
  }
  /** Acquire current session actors and advance mechanics before movement. */
  beforeUpdate(dt) {
    this.elapsed += dt;
    this.entities.length = 0;
    this.entities.push(...this.game.players, ...this.game.zombies);
    for (const e of this.entities) this.owners.set(e.pos, e);
    this.elevation.update(dt, this.entities);
    this.destructibles.update(dt);
    for (let i = this.effects.length - 1; i >= 0; i--)
      if ((this.effects[i].life -= dt) <= 0) this.pool.release(this.effects.splice(i, 1)[0]);
  }
  /** Apply hazards and deck constraints after all actors have moved. */
  afterUpdate(dt) {
    this.elevation.constrain(this.game.player);
    this.hazards.update(dt, this.entities);
    for (const q of this.quests) q.update(dt);
  }
  /** Return a contextual action; environment actions use the existing E prompt. */
  interaction(player) {
    const elevation = this.elevation.interaction(player);
    if (elevation)
      return {
        type: 'environment',
        action: elevation,
        label: elevation.label,
        price: 0,
        affordable: true,
      };
    for (const quest of this.quests) {
      const action = quest.interaction(player);
      if (action)
        return { type: 'environment', action, label: action.label, price: 0, affordable: true };
    }
    return null;
  }
  /** Execute an action supplied by interaction(). */
  interact(player, action) {
    if (action.quest) action.quest.interact(action);
    else if (this.hazards.rooted(player)) this.message('ROOTED • WAIT FOR TRAP RELEASE');
    else this.elevation.interact(action, player);
  }
  /** Install local solid tiles once a support finishes falling, then invalidate routes. */
  placeCover(cells, damage) {
    const g = this.game,
      m = g.map;
    for (const cell of cells) m.tiles[m.idx(cell.x, cell.y)] = TILE.CRATE;
    // Push affected actors to the nearest legal center, not into the new cover.
    for (const e of this.entities) {
      if (e.dead || !m._inSolid(e.pos, e.r, 0)) continue;
      this.hazards.damage(e, damage, e.pos.x, e.pos.y);
      const tx = Math.floor(e.pos.x / 24),
        ty = Math.floor(e.pos.y / 24);
      let best = null,
        bestD = Infinity;
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const p = { x: (tx + dx + 0.5) * 24, y: (ty + dy + 0.5) * 24 };
          if (m._inSolid(p, e.r, 0)) continue;
          const d = Math.hypot(p.x - e.pos.x, p.y - e.pos.y);
          if (d < bestD) {
            best = p;
            bestD = d;
          }
        }
      if (best) Object.assign(e.pos, best);
      e.vel.x = e.vel.y = 0;
    }
    g.bus?.navigation.cache.clear();
    m.flowDirty = true;
    g.flowTimer = 0;
    g.hud._miniDirty = true;
    this.emit('environment:topology', { cells });
  }
  /** Draw floor mechanics before actors. */
  draw(ctx) {
    ctx.save();
    for (const l of this.game.map.definition?.level.landmarks ?? []) {
      ctx.fillStyle = '#b9c6b3';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      this.label(ctx, l.name, l.x, l.y);
    }
    for (const c of this.mud) {
      ctx.fillStyle = 'rgba(73,48,25,.7)';
      ctx.fillRect(c.x - c.width / 2, c.y - c.height / 2, c.width, c.height);
      ctx.strokeStyle = '#7f633c';
      ctx.strokeRect(c.x - c.width / 2, c.y - c.height / 2, c.width, c.height);
      ctx.fillStyle = '#bca776';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      this.label(ctx, 'MUD • -40% SPEED', c.x, c.y);
    }
    this.elevation.draw(ctx);
    this.destructibles.draw(ctx);
    this.hazards.draw(ctx);
    this.quests.forEach((q) => q.draw(ctx));
    for (const p of this.effects) {
      ctx.globalAlpha = p.life / 0.35;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
    }
    ctx.restore();
  }
  /** Reuse the existing baked lighting layers with a bounded static color palette. */
  addLights(lighting, camX, camY) {
    for (const item of this.destructibles.items)
      if (item.config.type === 'neon-sign' && item.state === 'intact')
        lighting.point(
          item.config.x - camX,
          item.config.y - camY,
          95,
          0.65,
          this.lightColors.get(item.config.id),
          0.5,
        );
    for (const zone of this.hazards.zones)
      lighting.point(
        zone.x - camX,
        zone.y - camY,
        zone.radius * 1.4,
        0.7,
        'rgba(90,190,255,0.35)',
        0.5,
      );
  }
  /** Offset elevated actors visually without changing their world/storey coordinates. */
  drawActor(ctx, entity, draw) {
    ctx.save();
    if (this.elevation.isElevated(entity) || this.elevation.inTransit(entity))
      ctx.translate(0, -18);
    draw();
    ctx.restore();
  }
  /** Status strips for root/zipline/elevation and broadcast progress. */
  drawHUD(ctx) {
    const p = this.game.player;
    let message = '';
    if (this.hazards.rooted(p)) message = 'BEAR TRAP • ROOTED';
    else if (this.elevation.inTransit(p)) message = 'ZIPLINE • HOLD ON';
    else if (this.elevation.isElevated(p))
      message = 'ELEVATED • 35% LESS SPREAD • E DESCEND / ZIPLINE';
    const charging = this.quests.find((q) => q.charging);
    if (charging)
      message = `DEFEND BROADCAST: ${charging.charge.toFixed(1)} / ${charging.config.holdSeconds}s`;
    if (!message) return;
    ctx.save();
    ctx.fillStyle = 'rgba(5,10,12,.85)';
    ctx.fillRect(160, 49, 480, 23);
    ctx.fillStyle = '#b6e9d2';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    this.label(ctx, message, 400, 65);
    ctx.restore();
  }
  /** Dispose session objects/references; base tiles are owned by the discarded GameMap. */
  dispose() {
    this.renderer.dispose();
    this.hazards.dispose();
    this.elevation.dispose();
    this.destructibles.dispose();
    this.quests.length = 0;
    this.effects.length = 0;
    this.pool.clear();
    this.entities.length = 0;
    this.owners = new WeakMap();
    this.lightColors.clear();
    if (this.game.map.environment === this) this.game.map.environment = null;
  }
}
