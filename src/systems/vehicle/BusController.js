import { Bus } from '../../entities/Bus.js';
import { VehicleController } from './VehicleController.js';
import { vehicleInput } from './VehicleInput.js';
import { VehicleAudio } from './VehicleAudio.js';
import { DynamicObstacle } from '../pathfinding/DynamicObstacle.js';
import { PathfindingManager } from '../pathfinding/PathfindingManager.js';
import { ObjectPool } from '../../utils/ObjectPool.js';
/** Session-owned bus gameplay, sparse navigation, services and presentation. */
export class BusController {
  constructor(game, config) {
    this.game = game;
    this.body = new Bus(config);
    this.physics = new VehicleController(this.body, game.map);
    this.sound = new VehicleAudio();
    this.obstacle = new DynamicObstacle();
    this.navigation = new PathfindingManager(game.map, this.obstacle);
    this.contacts = new Map();
    this.contactPool = new ObjectPool(
      () => ({}),
      (r) => {
        r.time = 0;
      },
      128,
    );
    this.sparks = [];
    this.sparkPool = new ObjectPool(
      () => ({}),
      (p, x, y) => Object.assign(p, { x, y, life: 0.4 }),
      32,
    );
    this.obstacle.update(this.body, game.map);
    this.navigation.begin();
    game.map.vehicle = this;
  }
  /** Driver door in world coordinates. */
  seat() {
    return this.body.world(this.body.length / 2 - 18, this.body.width / 2 + 12);
  }
  /** Safely exit beside a stationary body; refuses blocked exits. */
  exit(force = false) {
    const b = this.body,
      g = this.game;
    if (!force && Math.hypot(b.vel.x, b.vel.y) > 35) {
      this.message('BRAKE BEFORE EXIT');
      return false;
    }
    for (const side of [1, -1])
      for (const x of [b.length / 2 - 18, 0, -b.length / 2 - 15]) {
        const p = b.world(x, side * (b.width / 2 + g.player.r + 12));
        if (
          !g.map._inSolid(p, g.player.r, 0) &&
          !g.map.solidProps.some(
            (r) => p.x >= r.x0 - 12 && p.x <= r.x1 + 12 && p.y >= r.y0 - 12 && p.y <= r.y1 + 12,
          )
        ) {
          b.driving = false;
          Object.assign(g.player.pos, p);
          g.player.vel.x = g.player.vel.y = 0;
          g.player.invuln = 1;
          this.sound.stop();
          g.mapManager.emit('vehicle:exit', b);
          return true;
        }
      }
    this.message('EXIT BLOCKED');
    return false;
  }
  /** Show short vehicle feedback using the existing popup system. */
  message(text) {
    this.game.popups.add(this.body.pos.x, this.body.pos.y - 45, text, '#f0d98a', 11);
  }
  /** Consume E for vehicle entry/exit or a nearby service, before world interactions. */
  interact() {
    const g = this.game,
      b = this.body,
      p = g.player;
    if (p.dead || p.downed) return false;
    const station = (g.map.definition?.level.stations ?? []).find(
      (s) =>
        Math.hypot(b.pos.x - s.x, b.pos.y - s.y) < s.radius &&
        Math.hypot(p.pos.x - s.x, p.pos.y - s.y) < s.radius + 65,
    );
    if (
      station &&
      ((!b.driving && Math.hypot(p.pos.x - station.x, p.pos.y - station.y) < 40) ||
        (b.driving && g.input.isDown('ShiftLeft', 'ShiftRight')))
    ) {
      if (Math.hypot(b.vel.x, b.vel.y) > 35) {
        this.message('BRAKE FOR SERVICE');
        return true;
      }
      const full = station.type === 'repair' ? b.hp >= b.config.hp : b.fuel >= b.config.fuel;
      if (full) this.message('ALREADY FULL');
      else if (p.points < station.price) this.message('NOT ENOUGH POINTS');
      else {
        p.points -= station.price;
        if (station.type === 'repair') b.hp = b.config.hp;
        else b.fuel = b.config.fuel;
        this.message(station.type === 'repair' ? 'BUS REPAIRED' : 'TANK FILLED');
        g.mapManager.emit('vehicle:service', station);
      }
      return true;
    }
    if (b.driving) {
      this.exit();
      return true;
    }
    const seat = this.seat();
    if (Math.hypot(p.pos.x - seat.x, p.pos.y - seat.y) > 48) return false;
    if (b.hp <= 0) {
      this.message('REPAIR BUS AT DEPOT');
      return true;
    }
    b.driving = true;
    p.vel.x = p.vel.y = 0;
    g.craftOpen = false;
    Object.assign(p.pos, b.pos);
    g.mapManager.emit('vehicle:enter', b);
    return true;
  }
  /** Fixed simulation tick. Crush tests run along the swept motion, not just its endpoint. */
  update(dt) {
    const b = this.body,
      g = this.game;
    this.crushSoundCooldown = Math.max(0, (this.crushSoundCooldown ?? 0) - dt);
    for (const [z, r] of this.contacts) {
      r.time -= dt;
      if (r.time <= 0 || z.dead || z.remove) {
        this.contacts.delete(z);
        this.contactPool.release(r);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--)
      if ((this.sparks[i].life -= dt) <= 0) this.sparkPool.release(this.sparks.splice(i, 1)[0]);
    this.physics.update(
      dt,
      b.driving ? vehicleInput(g.input) : { throttle: 0, steer: 0, brake: true },
      () => this.collide(false),
    );
    this.obstacle.update(b, g.map);
    this.navigation.begin();
    if (b.driving) {
      Object.assign(g.player.pos, b.pos);
      g.player.vel.x = g.player.vel.y = 0;
      g.player.aim = b.angle;
    }
    this.sound.update(b.driving && b.hp > 0 && b.fuel > 0, Math.hypot(b.vel.x, b.vel.y));
    if (b.driving && (g.player.dead || g.player.downed || b.hp <= 0)) {
      this.exit(true);
      this.sound.stop();
    }
  }
  /** Damage/knock back contact zombies and resolve their physical overlap. */
  collide(resolve = true) {
    const b = this.body,
      g = this.game,
      speed = Math.hypot(b.vel.x, b.vel.y);
    for (const z of g.zombies) {
      if (z.dead || z.remove || z.hidden || (z.floor ?? 0) !== 0) continue;
      const distance = b.distance(z.pos.x, z.pos.y);
      if (distance > z.r + 8) continue;
      if (!this.contacts.has(z)) {
        const r = this.contactPool.acquire();
        r.time = speed > 45 ? 0.35 : 1;
        this.contacts.set(z, r);
        if (speed > 45) {
          const angle = Math.atan2(b.vel.y, b.vel.x),
            small = z.r <= 12 && z.type !== 'brute';
          const damage = small ? z.hp + 1000 : speed * 1.8;
          if (z.hurt(damage, false, g, angle, g.player) === 2)
            g.onZombieKilled(z, false, g.player, 'vehicle');
          z.vel.x += Math.cos(angle) * speed * 1.3;
          z.vel.y += Math.sin(angle) * speed * 1.3;
          b.hp = Math.max(0, b.hp - (small ? 1 : 6));
          if (this.sparks.length < 32) this.sparks.push(this.sparkPool.acquire(z.pos.x, z.pos.y));
          if (!(this.crushSoundCooldown > 0)) {
            this.sound.crush();
            this.crushSoundCooldown = 0.08;
          }
          g.mapManager.emit('vehicle:crush', z);
        } else {
          b.hp = Math.max(0, b.hp - z.dmg * 0.35);
          g.mapManager.emit('vehicle:damage', b.hp);
        }
      }
      if (resolve && !z.dead) this.resolve(z.pos, z.r + 1);
    }
    if (!b.driving) this.resolve(g.player.pos, g.player.r);
  }
  /** Resolve against the body without pushing an entity through an adjacent wall. */
  resolve(pos, radius) {
    const b = this.body,
      m = this.game.map,
      old = { ...pos };
    if (!b.resolve(pos, radius)) return;
    if (!m._inSolid(pos, radius, 0)) return;
    const local = b.local(old.x, old.y),
      candidates = [
        b.world(local.x, b.width / 2 + radius + 1),
        b.world(local.x, -b.width / 2 - radius - 1),
        b.world(b.length / 2 + radius + 1, local.y),
        b.world(-b.length / 2 - radius - 1, local.y),
      ].sort((a, c) => Math.hypot(a.x - old.x, a.y - old.y) - Math.hypot(c.x - old.x, c.y - old.y));
    const safe = candidates.find((p) => !m._inSolid(p, radius, 0));
    Object.assign(pos, safe ?? old);
  }
  /** Draw bus, pooled impact flashes, station/landmark labels and interaction hints. */
  draw(ctx) {
    const g = this.game,
      b = this.body;
    for (const landmark of g.map.definition?.level.landmarks ?? []) {
      ctx.fillStyle = '#b6c5b2';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(landmark.name, landmark.x, landmark.y);
    }
    for (const s of g.map.definition?.level.stations ?? []) {
      ctx.strokeStyle = s.type === 'repair' ? '#e3a568' : '#72c4c2';
      ctx.strokeRect(s.x - 25, s.y - 25, 50, 50);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px monospace';
      ctx.fillText(`${s.type.toUpperCase()} ${s.price}`, s.x - 30, s.y - 30);
    }
    b.draw(ctx);
    for (const p of this.sparks) {
      ctx.fillStyle = '#ffe4a6';
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    const seat = this.seat();
    ctx.fillStyle = '#f0d98a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    if (!b.driving && Math.hypot(g.player.pos.x - seat.x, g.player.pos.y - seat.y) < 75)
      ctx.fillText(b.hp > 0 ? 'E • DRIVE BUS' : 'BUS DISABLED', seat.x, seat.y + 18);
  }
  /** Draw vehicle status in logical screen space. */
  drawHUD(ctx) {
    const b = this.body;
    if (!b.driving) return;
    ctx.save();
    ctx.fillStyle = 'rgba(5,12,15,.9)';
    ctx.fillRect(200, 47, 400, 53);
    ctx.fillStyle = '#d8e1c8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `BUS  HP ${Math.ceil(b.hp)}/${b.config.hp}   FUEL ${Math.ceil(b.fuel)}%   ${Math.round(Math.hypot(b.vel.x, b.vel.y))} PX/S`,
      400,
      66,
    );
    ctx.font = '10px monospace';
    ctx.fillText('W/S DRIVE • A/D STEER • SPACE BRAKE • E EXIT', 400, 81);
    ctx.fillText('AT STATION: SHIFT + E TO REPAIR / REFUEL', 400, 94);
    ctx.restore();
  }
  /** Release session audio, search caches and pooled references. */
  dispose() {
    this.sound.stop();
    this.navigation.dispose();
    this.contacts.clear();
    this.contactPool.clear();
    this.sparks.length = 0;
    this.sparkPool.clear();
    if (this.game.map.vehicle === this) this.game.map.vehicle = null;
  }
}
