// Player, zombies, projectiles and the particle system.
import { T, BODY_ROW, HEAD_ROW, SPRITE_W, SPRITE_H, TILE, buildArt } from './art.js';
import { WEAPONS, WEAPON_ORDER, isAuto, shotSound } from './weapons.js';
import { perkEffects, MAX_PERKS } from './perks.js';
import { clamp, dist, dist2, randRange, randInt, pick, approach, TAU, pointSegDist2 } from './util.js';
import { audio } from './audio.js';

const SPRITE_OX = SPRITE_W / 2;
const SPRITE_OY = BODY_ROW;             // sprite pixel drawn at the entity origin
export const HEAD_OFF_Y = SPRITE_OY - HEAD_ROW;   // head centre relative to origin

// ---------------------------------------------------------------------------
//  Particles
// ---------------------------------------------------------------------------
export class Particles {
  constructor(cap = 900) {
    this.items = [];
    this.cap = cap;
  }
  clear() { this.items.length = 0; }

  add(p) {
    if (this.items.length >= this.cap) this.items.shift();
    p.age = 0;
    this.items.push(p);
    return p;
  }

  blood(x, y, dir, amount = 6, scale = 1) {
    for (let i = 0; i < amount; i++) {
      const a = dir + randRange(-0.9, 0.9);
      const sp = randRange(30, 150) * scale;
      this.add({
        type: 'blood', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - randRange(0, 40),
        life: randRange(0.35, 0.8), size: randRange(1, 2.6) * scale,
        drag: 3.4, colour: pick(['#7c1f22', '#5d1518', '#93262a', '#3f0f11']),
        decal: Math.random() < 0.5,
      });
    }
  }

  mist(x, y, dir, amount = 4) {
    for (let i = 0; i < amount; i++) {
      const a = dir + randRange(-0.5, 0.5);
      const sp = randRange(40, 130);
      this.add({
        type: 'mist', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: randRange(0.18, 0.4), size: randRange(1.5, 3.5),
        drag: 6, colour: 'rgba(150,40,44,0.5)',
      });
    }
  }

  chunk(x, y, dir, amount = 3) {
    for (let i = 0; i < amount; i++) {
      const a = dir + randRange(-1.2, 1.2);
      const sp = randRange(60, 200);
      this.add({
        type: 'chunk', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - randRange(20, 90),
        life: randRange(0.5, 1.1), size: randRange(1.5, 3),
        drag: 1.6, gravity: 320, bounce: true,
        colour: pick(['#6d7a55', '#4b4a41', '#7c1f22']),
        decal: true,
      });
    }
  }

  spark(x, y, dir, amount = 5, colour = '#ffd9a0') {
    for (let i = 0; i < amount; i++) {
      const a = dir + randRange(-1.1, 1.1);
      const sp = randRange(60, 230);
      this.add({
        type: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: randRange(0.08, 0.24), size: randRange(1, 2),
        drag: 5, colour,
      });
    }
  }

  dust(x, y, dir, amount = 4) {
    for (let i = 0; i < amount; i++) {
      const a = dir + randRange(-1.4, 1.4);
      const sp = randRange(20, 90);
      this.add({
        type: 'dust', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: randRange(0.2, 0.55), size: randRange(1, 3),
        drag: 4, colour: 'rgba(120,120,115,0.45)',
      });
    }
  }

  smoke(x, y, amount = 3) {
    for (let i = 0; i < amount; i++) {
      this.add({
        type: 'smoke', x, y,
        vx: randRange(-18, 18), vy: randRange(-34, -8),
        life: randRange(0.4, 1.0), size: randRange(2, 5),
        drag: 1.4, colour: 'rgba(190,185,175,0.20)',
      });
    }
  }

  casing(x, y, dir) {
    const a = dir + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    this.add({
      type: 'casing', x, y,
      vx: Math.cos(a) * randRange(40, 110), vy: Math.sin(a) * randRange(40, 110) - 40,
      life: randRange(0.6, 1.1), size: 1.6, drag: 2.2, gravity: 260, bounce: true,
      colour: '#b99542', spin: randRange(-14, 14), rot: 0,
    });
  }

  update(dt, map) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const p = it[i];
      p.age += dt;
      if (p.age >= p.life) { it.splice(i, 1); continue; }
      const drag = 1 - Math.min(1, (p.drag || 0) * dt);
      p.vx *= drag; p.vy *= drag;
      if (p.gravity) p.vy += p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (p.bounce) {
        if (map.solidAt(Math.floor(nx / T), Math.floor(p.y / T))) { p.vx *= -0.35; p.x = p.x; }
        else p.x = nx;
        if (map.solidAt(Math.floor(p.x / T), Math.floor(ny / T))) { p.vy *= -0.35; }
        else p.y = ny;
      } else { p.x = nx; p.y = ny; }
      if (p.spin) p.rot += p.spin * dt;
    }
  }

  draw(ctx, decalCtx) {
    for (const p of this.items) {
      const k = 1 - p.age / p.life;
      ctx.save();
      switch (p.type) {
        case 'spark':
          ctx.globalAlpha = clamp(k * 1.4, 0, 1);
          ctx.fillStyle = p.colour;
          ctx.fillRect(p.x | 0, p.y | 0, Math.max(1, p.size * k), 1);
          break;
        case 'smoke':
          ctx.globalAlpha = clamp(k, 0, 1) * 0.7;
          ctx.fillStyle = p.colour;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, TAU);
          ctx.fill();
          break;
        case 'casing':
          ctx.globalAlpha = clamp(k * 2, 0, 1);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.colour;
          ctx.fillRect(-1, -1, 3, 2);
          break;
        case 'mist':
          ctx.globalAlpha = clamp(k, 0, 1) * 0.55;
          ctx.fillStyle = p.colour;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
          break;
        default:
          ctx.globalAlpha = clamp(k * 1.6, 0, 1);
          ctx.fillStyle = p.colour;
          if (p.size < 1.4) ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
          else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, TAU);
            ctx.fill();
          }
      }
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
//  Floating score popups
// ---------------------------------------------------------------------------
export class Popups {
  constructor() { this.items = []; }
  clear() { this.items.length = 0; }
  add(x, y, text, colour = '#e8d9a8', size = 10) {
    this.items.push({ x: x + randRange(-4, 4), y, text, colour, size, age: 0, life: 0.95, vy: -26 });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 2.2 * dt;
      if (p.age >= p.life) this.items.splice(i, 1);
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const p of this.items) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = clamp(k * 1.8, 0, 1);
      ctx.font = `bold ${p.size}px "Courier New", monospace`;
      ctx.fillStyle = '#000';
      ctx.fillText(p.text, p.x + 1, p.y + 1);
      ctx.fillStyle = p.colour;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
//  Player
// ---------------------------------------------------------------------------
export const PLAYER_R = 6.5;

export class Player {
  constructor(map, x, y) {
    this.map = map;
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.r = PLAYER_R;
    this.aim = 0;
    this.maxHp = 100;
    this.hp = 100;
    this.lastHurt = -99;
    this.invuln = 0;
    this.regenDelay = 5;
    this.regenRate = 30;
    this.speed = 132;
    this.accel = 1500;
    this.friction = 12;

    this.perks = new Set();
    this.applyPerks();

    this.loadout = {};
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id];
      this.loadout[id] = { id, mag: d.mag, reserve: 0, owned: false };
    }
    const w0 = WEAPONS.m1911;
    this.loadout.m1911 = { id: 'm1911', mag: w0.mag, reserve: w0.maxReserve, owned: true };
    this.current = 'm1911';
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.reloadStage = 0;
    this.triggerHeld = false;
    this.recoil = 0;
    this.walkPhase = 0;
    this.facing = 1;
    this.grenades = 0;
    this.dead = false;
    this.hurtFlash = 0;
    this.hitDirs = [];       // {angle, age}
    this.breath = 0;
    this.bob = 0;
    this.knifeCd = 0;
    this.knifeAnim = 0;
    this.knifeDir = 1;
    this.sprinting = false;
    this.portalCd = 0;
    this.dmTimer = 0;          // Death Machine
    this.diveT = 0;            // PhD Flopper dive
  }

  applyPerks() {
    this.perkFx = perkEffects(this.perks);
    const prevMax = this.maxHp ?? 100;
    this.maxHp = this.perkFx.maxHp;
    if (this.maxHp > prevMax) this.hp += (this.maxHp - prevMax);
    this.hp = Math.min(this.hp, this.maxHp);
    this.regenDelay = this.perkFx.regenDelay;
    this.regenRate = this.perkFx.regenRate;
    this.baseSpeed = 132 * this.perkFx.speedMul;
  }

  hasPerk(id) { return this.perks.has(id); }

  addPerk(id) {
    if (this.perks.has(id) || this.perks.size >= MAX_PERKS) return false;
    this.perks.add(id);
    this.applyPerks();
    return true;
  }

  get def() { return WEAPONS[this.current]; }
  get slot() { return this.loadout[this.current]; }

  ownedWeapons() { return WEAPON_ORDER.filter((id) => this.loadout[id].owned); }

  switchTo(id) {
    if (!this.loadout[id] || !this.loadout[id].owned || id === this.current) return false;
    this.current = id;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = Math.max(this.fireTimer, 0.25);
    audio.reload(2);
    return true;
  }

  cycle(dir) {
    const list = this.ownedWeapons();
    if (list.length < 2) return;
    let i = list.indexOf(this.current);
    i = (i + dir + list.length) % list.length;
    this.switchTo(list[i]);
  }

  startReload() {
    const s = this.slot, d = this.def;
    if (this.reloading || s.mag >= d.mag || s.reserve <= 0) return;
    if (this.dmTimer > 0) return;
    this.reloading = true;
    this.reloadTimer = d.reload * this.perkFx.reloadMul;
    this.reloadStage = 0;
    audio.reload(0);
  }

  finishReload() {
    const s = this.slot, d = this.def;
    const need = d.mag - s.mag;
    const take = Math.min(need, s.reserve);
    s.mag += take;
    s.reserve -= take;
    this.reloading = false;
    audio.reload(2);
  }

  addAmmo(id, full = true) {
    const d = WEAPONS[id], s = this.loadout[id];
    const before = s.reserve;
    s.reserve = d.maxReserve;
    if (full) s.mag = d.mag;
    return s.reserve - before;
  }

  /** Max Ammo: top up the reserve of every gun you carry. */
  refillAllReserve() {
    for (const id of WEAPON_ORDER) {
      const s = this.loadout[id];
      if (!s.owned) continue;
      s.reserve = WEAPONS[id].maxReserve;
      s.mag = WEAPONS[id].mag;
    }
    this.reloading = false;
    this.reloadTimer = 0;
  }

  useMedkit() {
    if ((this.medkits ?? 0) <= 0 || this.hp >= this.maxHp) return false;
    this.medkits--;
    this.heal(55);
    return true;
  }

  giveWeapon(id) {
    const d = WEAPONS[id], s = this.loadout[id];
    if (s.owned) {
      this.addAmmo(id, true);
      return 'ammo';
    }
    s.owned = true;
    s.mag = d.mag;
    s.reserve = d.maxReserve;
    this.switchTo(id);
    return 'weapon';
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

  hurt(amount, srcX, srcY, game) {
    if (this.invuln > 0 || this.dead) return false;
    // armour plates soak damage first
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount);
      this.armor -= absorbed;
      amount -= absorbed;
      game.popups.add(this.pos.x, this.pos.y - 30, `ARMOUR -${Math.round(absorbed)}`, '#7aa8d0', 9);
      if (amount <= 0) {
        this.lastHurt = game.time;
        this.invuln = 0.4;
        audio.impact(false, false);
        return false;
      }
    }
    game.roundDamageTaken = (game.roundDamageTaken ?? 0) + amount;
    this.hp -= amount;
    this.lastHurt = game.time;
    this.invuln = 0.65;
    this.hurtFlash = 1;
    const a = Math.atan2(srcY - this.pos.y, srcX - this.pos.x);
    this.hitDirs.push({ angle: a, age: 0 });
    // knock the player back a touch
    this.vel.x -= Math.cos(a) * 70;
    this.vel.y -= Math.sin(a) * 70;
    audio.playerHurt();
    game.shake(6, 0.28);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return true;
  }

  update(dt, game, input) {
    const d = this.def;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.recoil = approach(this.recoil, 0, dt * 26);
    this.knifeCd = Math.max(0, this.knifeCd - dt);
    this.knifeAnim = Math.max(0, this.knifeAnim - dt);
    for (const h of this.hitDirs) h.age += dt;
    this.hitDirs = this.hitDirs.filter((h) => h.age < 1.6);

    // health regen
    if (!this.dead && game.time - this.lastHurt > this.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
    }

    if (this.dead) return;

    // --------------------------------------------------------- timers ------
    this.dmTimer = Math.max(0, this.dmTimer - dt);
    this.portalCd = Math.max(0, this.portalCd - dt);

    // ---------------------------------------------------------- movement ---
    const mv = game.paused ? { x: 0, y: 0 } : input.moveVector();
    const moving = mv.x !== 0 || mv.y !== 0;
    this.sprinting = moving && !game.paused
      && input.isDown('ShiftLeft', 'ShiftRight') && this.hp > 1;
    this.speed = this.baseSpeed * (this.sprinting ? this.perkFx.sprintMul : 1);
    const targetVx = mv.x * this.speed;
    const targetVy = mv.y * this.speed;
    const a = (moving ? this.accel : this.accel * 1.6) * dt;
    this.vel.x = approach(this.vel.x, targetVx, a);
    this.vel.y = approach(this.vel.y, targetVy, a);
    if (!moving) {
      const f = Math.max(0, 1 - this.friction * dt);
      this.vel.x *= f; this.vel.y *= f;
    }
    this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r);

    // ---------------------------------------------------- stairwell hop ----
    if (this.portalCd <= 0) {
      const ti = this.map.tileIdxAt(this.pos.x, this.pos.y);
      const partner = this.map.stairPartner(ti);
      if (partner >= 0) {
        const c = this.map.stairCentre(ti);
        if (dist(this.pos.x, this.pos.y, c.x, c.y) < 10) {
          const dest = this.map.stairCentre(partner);
          game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 6);
          this.pos.x = dest.x; this.pos.y = dest.y;
          this.portalCd = 0.85;
          this.vel.x = this.vel.y = 0;
          game.onPlayerTeleport(c, dest);
        }
      }
    }

    const sp = Math.hypot(this.vel.x, this.vel.y);
    if (sp > 8) {
      this.walkPhase += dt * (2 + sp / 42);
      this.bob = Math.sin(this.walkPhase * Math.PI) * 0.9;
    } else {
      this.walkPhase = 0;
      this.bob *= Math.max(0, 1 - 8 * dt);
    }

    // -------------------------------------------------------------- aim ----
    const mw = game.screenToWorld(input.mouse.x, input.mouse.y);
    this.aim = Math.atan2(mw.y - this.pos.y, mw.x - this.pos.x);
    this.facing = Math.cos(this.aim) < 0 ? -1 : 1;

    // ------------------------------------------------------------ reload ---
    if (this.reloading) {
      this.reloadTimer -= dt;
      const k = 1 - this.reloadTimer / (d.reload * this.perkFx.reloadMul);
      const stage = k > 0.75 ? 2 : k > 0.35 ? 1 : 0;
      if (stage !== this.reloadStage) { this.reloadStage = stage; audio.reload(stage); }
      if (this.reloadTimer <= 0) this.finishReload();
    } else if (input.wasPressed('KeyR')) {
      this.startReload();
    }

    // -------------------------------------------------------------- fire ---
    const wantFire = isAuto(d) ? input.mouse.down : input.mouse.pressed;
    if (wantFire && !this.reloading && !game.paused) {
      if (this.slot.mag > 0) {
        if (this.fireTimer <= 0) this.fire(game);
      } else if (input.mouse.pressed || (isAuto(d) && this.fireTimer <= 0)) {
        if (this.fireTimer <= 0) {
          audio.dryFire();
          this.fireTimer = 0.25;
          if (this.slot.reserve > 0) this.startReload();
        }
      }
    }
    if (this.reloading && this.slot.mag <= 0 && input.mouse.pressed) this.reloadTimer = Math.min(this.reloadTimer, 0.12);

    // -------------------------------------------------------------- knife --
    if (input.wasPressed('KeyV') && !game.paused) this.knife(game);
  }

  /** Classic CoD melee: short reach, big points, never runs dry. */
  knife(game) {
    if (this.knifeCd > 0 || this.dead) return;
    this.knifeCd = 0.42;
    this.knifeAnim = 0.2;
    this.knifeDir = -this.knifeDir;
    audio.knife();

    const REACH = 38, ARC = 0.8;
    const hits = [];
    for (const z of game.zombies) {
      if (z.dead) continue;
      const d = dist(this.pos.x, this.pos.y, z.pos.x, z.pos.y);
      if (d > REACH) continue;
      let da = Math.atan2(z.pos.y - this.pos.y, z.pos.x - this.pos.x) - this.aim;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > ARC) continue;
      hits.push({ z, d });
    }
    hits.sort((a, b) => a.d - b.d);

    const dmg = 260 + game.round * 22;
    let any = false;
    for (const h of hits.slice(0, 2)) {
      const z = h.z;
      const ang = Math.atan2(z.pos.y - this.pos.y, z.pos.x - this.pos.x);
      const res = z.hurt(dmg, false, game, ang);
      any = true;
      if (res === 2) game.onZombieKilled(z, false, 130);
    }
    if (!any) {
      game.particles.spark(this.pos.x + Math.cos(this.aim) * 22, this.pos.y + Math.sin(this.aim) * 22, this.aim, 3, '#cfd6dd');
    } else {
      game.shake(2.5, 0.1);
    }
    // Widow's Wine: the swipe leaves a slowing web on everything nearby
    if (this.perkFx.webs) {
      for (const z of game.zombies) {
        if (z.dead) continue;
        if (dist(this.pos.x, this.pos.y, z.pos.x, z.pos.y) < 70) z.webbed = Math.max(z.webbed, 3.5);
      }
      game.webBlasts.push({ x: this.pos.x + Math.cos(this.aim) * 24, y: this.pos.y + Math.sin(this.aim) * 24, r: 46, life: 0.5, max: 0.5 });
    }
  }

  fire(game) {
    const d = this.def, s = this.slot;
    if (d.special === 'lure') { game.throwMonkey(); return; }

    if (this.dmTimer <= 0) s.mag--;
    this.fireTimer = d.delay * this.perkFx.fireDelayMul * (this.dmTimer > 0 ? 0.62 : 1);
    this.recoil = d.recoil;
    const muzzle = this.muzzlePos();
    const ox = this.pos.x, oy = this.pos.y;

    const moveSpread = Math.hypot(this.vel.x, this.vel.y) / Math.max(1, this.speed);
    const spread = d.spread * (1 + moveSpread * 1.3);
    const pellets = d.pellets ?? 1;

    if (d.special === 'shock') {
      game.fireShockwave(ox, oy, this.aim, d);
    } else {
      for (let p = 0; p < pellets; p++) {
        const ang = this.aim + randRange(-spread, spread) + randRange(-0.006, 0.006);
        game.fireHitscan(ox, oy, ang, d, muzzle);
      }
    }

    // presentation
    game.particles.spark(muzzle.x, muzzle.y, this.aim, 3, d.tracer);
    game.particles.smoke(muzzle.x, muzzle.y, 2);
    game.particles.casing(ox, oy, this.aim);
    game.muzzleFlash = { x: muzzle.x, y: muzzle.y, a: this.aim, t: 0.055, size: pellets > 1 ? 15 : 11, colour: d.tint };
    game.flashLights.push({ x: muzzle.x, y: muzzle.y, r: pellets > 1 ? 150 : 110, life: 0.075, max: 0.075, colour: d.tint });
    game.shake(d.kick, 0.09);
    audio.shot(shotSound(d), 0);
    this.vel.x -= Math.cos(this.aim) * d.kick * 5;
    this.vel.y -= Math.sin(this.aim) * d.kick * 5;
  }

  muzzlePos() {
    const art = buildArt().guns[this.current];
    const lx = art.muzzle.x - art.pivot.x;
    const ly = (art.muzzle.y - art.pivot.y) * (this.facing < 0 ? -1 : 1);
    const c = Math.cos(this.aim), s = Math.sin(this.aim);
    return { x: this.pos.x + lx * c - ly * s, y: this.pos.y + lx * s + ly * c };
  }

  headPos() { return { x: this.pos.x, y: this.pos.y - HEAD_OFF_Y }; }

  draw(ctx, art) {
    const flip = this.facing < 0;
    const px = Math.round(this.pos.x);
    const py = Math.round(this.pos.y + this.bob);

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(px, py + SPRITE_H - SPRITE_OY - 1, 7, 3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const frame = Math.floor(this.walkPhase * 2) % 4;
    let body = flip ? art.playerFlip[frame] : art.player[frame];
    let gx = px - SPRITE_OX, gy = py - SPRITE_OY;

    if (this.invuln > 0 && Math.floor(this.invuln * 22) % 2 === 0) {
      ctx.globalAlpha = 0.75;
    }
    ctx.drawImage(body, gx, gy);
    ctx.globalAlpha = 1;

    // gun
    const g = art.guns[this.current];
    ctx.save();
    ctx.translate(px, py - 1 + this.recoil * 0.35);
    ctx.rotate(this.aim);
    if (flip) ctx.scale(1, -1);
    ctx.drawImage(flip ? g.flip : g.img, -g.pivot.x, -g.pivot.y);
    ctx.restore();

    // knife slash
    if (this.knifeAnim > 0) {
      const k = this.knifeAnim / 0.2;
      ctx.save();
      ctx.translate(px, py - 2);
      ctx.rotate(this.aim);
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = 'rgba(235,240,245,0.95)';
      ctx.lineWidth = 2 - k * 0.6;
      const sweep = -0.85 + (1 - k) * 1.7;
      const r = 15 + (1 - k) * 12;
      ctx.beginPath();
      ctx.arc(0, 0, r, sweep * this.knifeDir, sweep * this.knifeDir + 1.15 * this.knifeDir, this.knifeDir < 0);
      ctx.stroke();
      ctx.restore();
    }

    if (this.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.hurtFlash * 0.5;
      ctx.globalCompositeOperation = 'lighter';
      const w = flip ? art.playerWhiteFlip[frame] : art.playerWhite[frame];
      ctx.drawImage(w, gx, gy);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
//  Zombie
// ---------------------------------------------------------------------------
let ZOMBIE_ID = 0;

export const ZSTATE = { CLIMB: 0, HUNT: 1, BARRICADE: 2, DOOR: 3, ATTACK: 4, DEAD: 5 };

/**
 * Enemy archetypes. Every value is a multiplier on the round's base stats,
 * except `r` (collision radius), `scale` (sprite scale) and `points`.
 */
export const ENEMY_TYPES = {
  walker: {
    id: 'walker', name: 'Walker', hp: 1, speed: 1, dmg: 1, r: 6.5, scale: 1,
    chew: 1, points: 1, set: 'zombie', headOff: 1,
  },
  runner: {
    id: 'runner', name: 'Runner', hp: 0.55, speed: 1.62, dmg: 0.8, r: 6.0, scale: 0.94,
    chew: 0.6, points: 1.3, set: 'runner', headOff: 1, sprinty: true,
  },
  brute: {
    id: 'brute', name: 'Brute', hp: 2.7, speed: 0.74, dmg: 1.7, r: 9.5, scale: 1.32,
    chew: 3.4, points: 1.7, set: 'brute', headOff: 1.25, smash: true,
  },
  dog: {
    id: 'dog', name: 'Hellhound', hp: 0.5, speed: 1.95, dmg: 0.7, r: 6.0, scale: 1,
    chew: 0.45, points: 1.35, set: 'dog', headOff: 0.45, sprinty: true, four: true,
  },
};

export class Zombie {
  constructor(map, x, y, opts = {}) {
    this.map = map;
    this.id = ++ZOMBIE_ID;
    this.type = opts.type ?? 'walker';
    this.def = ENEMY_TYPES[this.type] ?? ENEMY_TYPES.walker;
    const d = this.def;
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.r = d.r;
    this.maxHp = (opts.hp ?? 150) * d.hp;
    this.hp = this.maxHp;
    this.baseSpeed = (opts.speed ?? 34) * d.speed;
    this.dmg = (opts.dmg ?? 34) * d.dmg;
    this.chewMul = d.chew;
    this.pointsMul = d.points;
    this.frozen = 0;        // Winter's Howl
    this.webbed = 0;        // Widow's Wine
    this._jamT = 0;         // "am I actually going anywhere?" sampler
    this._jamX = x; this._jamY = y;
    this.portalCd = 0;
    this.state = ZSTATE.CLIMB;
    this.climbT = 0.55;
    this.walkPhase = Math.random() * 4;
    this.facing = 1;
    this.hurtFlash = 0;
    this.attackCd = 0;
    this.blockCd = 0;
    this.stuck = 0;
    this.dead = false;
    this.deadT = 0;
    this.remove = false;
    this.growlT = Math.random() * 6;
    this.wobble = Math.random() * TAU;
    this.target = null;         // barricade or door currently being chewed
    this.lunge = 0;
    this.lastDist = Infinity;
    this.spawnTint = opts.tint ?? 0;
  }

  get alive() { return !this.dead; }

  hurt(amount, head, game, dirAngle) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp -= amount;
    this.hurtFlash = 0.12;
    const ang = dirAngle ?? 0;
    if (head) {
      game.particles.blood(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 10, 1.3);
      game.particles.mist(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 6);
      game.particles.chunk(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 3);
    } else {
      game.particles.blood(this.pos.x, this.pos.y - 3, ang, 5, 1);
    }
    audio.impact(true, head);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(game, ang);
      return 2;
    }
    // flinch
    this.vel.x += Math.cos(ang) * 26;
    this.vel.y += Math.sin(ang) * 26;
    return 1;
  }

  die(game, ang) {
    if (this.dead) return;
    this.dead = true;
    this.state = ZSTATE.DEAD;
    this.deadT = 0;
    game.particles.blood(this.pos.x, this.pos.y, ang, 14, 1.4);
    game.particles.chunk(this.pos.x, this.pos.y, ang, 5);
    audio.zombieDie();
  }

  update(dt, game) {
    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 0.9) this.remove = true;
      return;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.blockCd = Math.max(0, this.blockCd - dt);
    this.lunge = Math.max(0, this.lunge - dt * 3);
    this.portalCd = Math.max(0, this.portalCd - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    this.webbed = Math.max(0, this.webbed - dt);
    if (this.frozen > 0.05) {
      // frozen solid: no movement, no attacks, just frost
      this.vel.x *= 0.82; this.vel.y *= 0.82;
      this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r);
      if (Math.random() < dt * 6) {
        game.particles.spark(this.pos.x + randRange(-6, 6), this.pos.y + randRange(-8, 4),
          randRange(0, TAU), 1, '#9fe9ff');
      }
      return;
    }
    this.growlT -= dt;
    if (this.growlT <= 0) {
      this.growlT = 3 + Math.random() * 9;
      const d = dist(this.pos.x, this.pos.y, game.player.pos.x, game.player.pos.y);
      if (d < 520) audio.growl(randRange(0.85, 1.2), clamp(1 - d / 520, 0.12, 1));
    }

    if (this.state === ZSTATE.CLIMB) {
      this.climbT -= dt;
      if (this.climbT <= 0) this.state = ZSTATE.HUNT;
      return;
    }

    const p = game.player;
    const pd = dist(this.pos.x, this.pos.y, p.pos.x, p.pos.y);

    // ------------------------------------------------- attack the player ---
    if (pd < 20 && !p.dead) {
      this.state = ZSTATE.ATTACK;
      if (this.attackCd <= 0) {
        this.attackCd = 1.05;
        this.lunge = 1;
        if (p.hurt(this.dmg, this.pos.x, this.pos.y, game)) {
          game.particles.blood(p.pos.x, p.pos.y, Math.atan2(p.pos.y - this.pos.y, p.pos.x - this.pos.x), 6, 0.8);
        }
      }
    } else if (this.state === ZSTATE.ATTACK && pd >= 24) {
      this.state = ZSTATE.HUNT;
      this.attackCd = Math.max(this.attackCd, 0.35);
    }

    // ------------------------------------------------------- navigation ---
    const step = this.map.flowStep(this.pos.x, this.pos.y);
    let tx, ty, speed = this.baseSpeed;

    if (!step) {
      // No step either because we are standing on the target tile itself (fine,
      // just walk straight at them) or because there is genuinely no route.
      tx = p.pos.x; ty = p.pos.y;
      if (!this.map.reachable(this.pos.x, this.pos.y)) this.stuck += dt;
    } else {
      tx = step.x; ty = step.y;
      const blocker = this._blockerOnPath(step);
      if (blocker) {
        if (blocker.kind === 'window') {
          const b = blocker.obj;
          if (b.planks > 0) {
            this.state = ZSTATE.BARRICADE;
            this.target = b;
            this._chew(dt, game, b);
            tx = b.cx; ty = b.cy;
            speed *= 0.42;
          } else {
            this.state = ZSTATE.HUNT;
            this.target = null;
          }
        } else {
          // locked door -- claw at it, but give up and re-route if stuck
          this.state = ZSTATE.DOOR;
          this.target = blocker.obj;
          this.stuck += dt;
          tx = this.pos.x; ty = this.pos.y;
          speed = 0;
          if (this.blockCd <= 0) { this.blockCd = 0.55; audio.wood(false); }
        }
      } else {
        if (this.state !== ZSTATE.ATTACK) this.state = ZSTATE.HUNT;
        this.target = null;
        this.stuck = Math.max(0, this.stuck - dt * 1.6);
      }
    }

    // -------------------------------------------------------- movement ----
    if (this.state === ZSTATE.ATTACK) {
      tx = p.pos.x; ty = p.pos.y;
      speed *= pd < 15 ? 0.15 : 0.55;
    } else {
      // classic CoD behaviour: they shamble up close but sprint when far away
      speed *= pd > 260 ? 1.55 : pd > 160 ? 1.25 : 1;
      if (this.def.sprinty) speed *= 1.2;
    }
    if (this.webbed > 0) speed *= 0.45;

    // --------------------------------------------------- stairwell portal --
    if (step && step.portal >= 0 && this.portalCd <= 0) {
      if (dist(this.pos.x, this.pos.y, tx, ty) < 9) {
        const dest = this.map.stairCentre(step.portal);
        game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 5);
        this.pos.x = dest.x + randRange(-4, 4);
        this.pos.y = dest.y + randRange(-4, 4);
        this.portalCd = 1.1;
        game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 5);
        return;
      }
    }

    let dx = tx - this.pos.x, dy = ty - this.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    // drunken wobble so the horde doesn't move like a rigid block
    this.wobble += dt * 1.7;
    const wob = Math.sin(this.wobble) * 0.22;
    const c = Math.cos(wob), s = Math.sin(wob);
    const wx = dx * c - dy * s, wy = dx * s + dy * c;

    // separation from other zombies
    let sx = 0, sy = 0;
    for (const o of game.zombies) {
      if (o === this || o.dead) continue;
      const d2 = dist2(this.pos.x, this.pos.y, o.pos.x, o.pos.y);
      if (d2 < 210 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        sx -= ((o.pos.x - this.pos.x) / d) * (1 - d / 14.5);
        sy -= ((o.pos.y - this.pos.y) / d) * (1 - d / 14.5);
      }
    }

    const lungeBoost = 1 + this.lunge * 0.9;
    this.vel.x = approach(this.vel.x, (wx + sx * 1.5) * speed * lungeBoost, 900 * dt);
    this.vel.y = approach(this.vel.y, (wy + sy * 1.5) * speed * lungeBoost, 900 * dt);
    this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r);

    const sp = Math.hypot(this.vel.x, this.vel.y);
    if (sp > 4) {
      this.walkPhase += dt * (1.4 + sp / 26);
      this.facing = this.vel.x < -2 ? -1 : this.vel.x > 2 ? 1 : this.facing;
    }

    // ------------------------------------------------------ stuck safety --
    // Two independent watchdogs. `stuck` catches "no route at all"; this one
    // catches "the flow field says go, but a corner or a crate says no" --
    // without it a wedged zombie can park forever and the round never ends.
    this._jamT += dt;
    if (this._jamT >= 1) {
      this._jamT = 0;
      const moved = dist(this.pos.x, this.pos.y, this._jamX, this._jamY);
      this._jamX = this.pos.x; this._jamY = this.pos.y;
      if (moved < 10) this.stuck += 1;
      else this.stuck = Math.max(0, this.stuck - 1);
    }
    if (this.stuck > 7) this.despawn(game);
  }

  _blockerOnPath(step) {
    const t = this.map.tiles[step.ti];
    if (t === TILE.WINDOW) {
      const b = this.map.barricades[this.map.barricadeOf[step.ti]];
      if (b && b.planks > 0) return { kind: 'window', obj: b };
    } else if (t === TILE.DOOR) {
      const d = this.map.doors[this.map.doorOf[step.ti]];
      if (d && !d.open) return { kind: 'door', obj: d };
    }
    // also treat the tile we're standing in
    return null;
  }

  _chew(dt, game, b) {
    b.hurt += dt * this.chewMul;
    const perPlank = 0.55;
    if (b.hurt >= perPlank) {
      b.hurt -= perPlank;
      const smash = this.def.smash ? 3 : 1;
      b.planks = Math.max(0, b.planks - smash);
      audio.wood(false, this.def.smash ? 0.7 : 1);
      game.particles.spark(b.cx, b.cy, randRange(0, TAU), this.def.smash ? 12 : 4, '#8a6338');
      game.particles.dust(b.cx, b.cy, randRange(0, TAU), this.def.smash ? 8 : 3);
      if (this.def.smash) game.shake(3.2, 0.22);
      // workbench spikes: the window bites back
      if (game.workbench?.spikesRounds > 0) {
        this.hurt(40, false, game, Math.atan2(this.pos.y - b.cy, this.pos.x - b.cx));
        game.particles.spark(this.pos.x, this.pos.y, randRange(0, TAU), 4, '#c86a5a');
        if (this.hp <= 0) game.onZombieKilled(this, false, null, 'spikes');
      }
      if (b.planks === 0) game.onBarricadeDown(b);
    }
  }

  despawn(game) {
    if (this.remove) return;
    this.remove = true;
    game.respawnQueue++;
    game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 6);
  }

  /** Pick the sprite set for this enemy's type / pose / facing. */
  _set(art, attacking, flip) {
    const s = this.def.set;
    if (s === 'dog') return { img: flip ? art.dogFlip : art.dog, framed: false };
    if (s === 'runner') {
      return {
        img: (attacking
          ? (flip ? art.zombieRunnerAtkFlip : art.zombieRunnerAtk)
          : (flip ? art.zombieRunnerFlip : art.zombieRunner))[this._frame(attacking)],
        framed: true,
      };
    }
    if (s === 'brute') {
      return {
        img: (attacking
          ? (flip ? art.zombieBruteAtkFlip : art.zombieBruteAtk)
          : (flip ? art.zombieBruteFlip : art.zombieBrute))[this._frame(attacking)],
        framed: true,
      };
    }
    return { img: (attacking ? (flip ? art.zombieAtkFlip : art.zombieAtk) : (flip ? art.zombieFlip : art.zombie))[this._frame(attacking)], framed: true };
  }

  _frame(attacking) {
    return attacking ? (Math.floor(this.walkPhase * 1.6) % 4) : (Math.floor(this.walkPhase) % 4);
  }

  draw(ctx, art) {
    const px = Math.round(this.pos.x);
    const py = Math.round(this.pos.y);
    const flip = this.facing < 0;
    const sc = this.def.scale;

    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(px, py + SPRITE_H - SPRITE_OY - 1, 7 * sc, 3 * sc, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (this.dead) {
      const k = Math.min(1, this.deadT / 0.75);
      ctx.globalAlpha = 1 - k * 0.85;
      ctx.translate(px, py);
      ctx.rotate(k * 1.3 * (this.id % 2 ? 1 : -1));
      ctx.scale(1 + k * 0.12, 1 - k * 0.55);
      ctx.translate(-px, -py);
    } else if (this.state === ZSTATE.CLIMB) {
      const k = 1 - this.climbT / 0.55;
      ctx.globalAlpha = k;
      ctx.translate(px, py);
      ctx.scale(1, 0.45 + k * 0.55);
      ctx.translate(-px, -py);
    }
    if (sc !== 1) { ctx.translate(px, py); ctx.scale(sc, sc); ctx.translate(-px, -py); }

    const attacking = this.state === ZSTATE.BARRICADE || this.state === ZSTATE.DOOR || this.state === ZSTATE.ATTACK;
    const { img } = this._set(art, attacking, flip);
    const gx = px - SPRITE_OX;
    const gy = py - SPRITE_OY - (attacking ? 1 : 0);

    // frozen / webbed overlay
    if (this.frozen > 0.05) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#7fc9e8';
      ctx.beginPath();
      ctx.ellipse(px, py - 2, 13, 16, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.drawImage(img, gx, gy);

    if (this.webbed > 0) {
      ctx.globalAlpha = Math.min(0.7, this.webbed * 0.6);
      ctx.strokeStyle = '#e8e8f2';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + this.id;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(a) * 13, py + Math.sin(a) * 13);
        ctx.lineTo(px + Math.cos(a + 2.1) * 13, py + Math.sin(a + 2.1) * 13);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (this.hurtFlash > 0) {
      ctx.globalAlpha = Math.min(1, this.hurtFlash * 7);
      ctx.globalCompositeOperation = 'lighter';
      if (this.def.set === 'dog') ctx.drawImage(art.dogWhite, gx, gy);
      else {
        const wset = flip ? art.zombieWhiteFlip : art.zombieWhite;
        ctx.drawImage(wset[this._frame(false)], gx, gy);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // health pip for the tanky ones
    if (!this.dead && this.def.smash && this.hp < this.maxHp) {
      const w = 18;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px - w / 2, py - 20, w, 3);
      ctx.fillStyle = '#c85a3c';
      ctx.fillRect(px - w / 2 + 1, py - 19, (w - 2) * (this.hp / this.maxHp), 1);
    }
  }
}

// ---------------------------------------------------------------------------
//  Monkey Bomb -- the crowd-control wonder weapon
// ---------------------------------------------------------------------------
export class MonkeyBomb {
  constructor(x, y, vx, vy, def) {
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
    this.def = def;
    this.fuse = def.fuse ?? 6;
    this.maxFuse = this.fuse;
    this.r = 4;
    this.rot = 0;
    this.remove = false;
    this.bounces = 0;
    this.tick = 0;
  }

  get luring() { return this.fuse > 0.35; }

  update(dt, game) {
    this.fuse -= dt;
    this.tick += dt;
    if (this.tick > 0.19) { this.tick = 0; audio.monkey(1 - this.fuse / this.maxFuse); }
    if (this.fuse <= 0) { this.explode(game); return; }

    this.vel.x *= Math.max(0, 1 - 2.4 * dt);
    this.vel.y *= Math.max(0, 1 - 2.4 * dt);
    const nx = this.pos.x + this.vel.x * dt, ny = this.pos.y + this.vel.y * dt;
    if (game.map.solidAt(Math.floor(nx / T), Math.floor(this.pos.y / T))) this.vel.x *= -0.45;
    else this.pos.x = nx;
    if (game.map.solidAt(Math.floor(this.pos.x / T), Math.floor(ny / T))) this.vel.y *= -0.45;
    else this.pos.y = ny;
  }

  explode(game) {
    if (this.remove) return;
    this.remove = true;
    const d = this.def;
    game.explodeAt(this.pos.x, this.pos.y, d.boomR ?? 150, d.boomDmg ?? 3000,
      { colour: '#ffd45c', fromPlayer: true });
    game.shake(7, 0.4);
    audio.explosion();
  }

  draw(ctx, art) {
    const px = Math.round(this.pos.x), py = Math.round(this.pos.y);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(px, py + 8, 7, 3, 0, 0, TAU); ctx.fill();
    ctx.restore();

    const wob = Math.sin(this.fuse * 22) * (this.fuse < 1.6 ? 2.2 : 0.9);
    ctx.save();
    ctx.translate(px, py + Math.abs(Math.sin(this.fuse * 9)) * -2);
    ctx.rotate(wob * 0.08);
    ctx.drawImage(art.monkeybomb, -5, -7);
    ctx.restore();

    if (this.luring) {
      const k = 0.5 + Math.sin(this.fuse * 7) * 0.5;
      ctx.strokeStyle = `rgba(255,214,110,${0.15 + k * 0.25})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 22 + k * 12, 0, TAU);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
//  Grenade
// ---------------------------------------------------------------------------
export class Grenade {
  constructor(x, y, vx, vy) {
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
    this.fuse = 2.4;
    this.r = 3;
    this.rot = 0;
    this.remove = false;
    this.bounces = 0;
  }
  update(dt, game) {
    this.fuse -= dt;
    this.rot += dt * 9 * Math.sign(this.vel.x || 1);
    if (this.fuse <= 0) { this.explode(game); return; }
    const map = game.map;
    map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r);
    // friction
    const f = Math.max(0, 1 - 1.6 * dt);
    this.vel.x *= f; this.vel.y *= f;
  }
  explode(game) {
    this.remove = true;
    const { x, y } = this.pos;
    const R = 96;
    game.explosion(x, y, R);
    for (const z of game.zombies) {
      if (z.dead) continue;
      const d = dist(x, y, z.pos.x, z.pos.y);
      if (d > R) continue;
      const k = 1 - d / R;
      const ang = Math.atan2(z.pos.y - y, z.pos.x - x);
      const boom = (420 + game.round * 55) * (k * k * 0.75 + k * 0.25);
      if (z.hurt(boom, false, game, ang) === 2) game.onZombieKilled(z, false);
      z.vel.x += Math.cos(ang) * 180 * k;
      z.vel.y += Math.sin(ang) * 180 * k;
    }
    game.particles.spark(x, y, 0, 26, '#ffcf7a');
    game.particles.smoke(x, y, 16);
    game.particles.chunk(x, y, randRange(0, TAU), 8);
    if (game.player.perkFx.webs) {
      for (const z of game.zombies) {
        if (z.dead) continue;
        if (dist(x, y, z.pos.x, z.pos.y) < R * 1.2) z.webbed = Math.max(z.webbed, 5);
      }
      game.webBlasts.push({ x, y, r: R, life: 0.7, max: 0.7 });
    }
  }
}

export function throwGrenade(game, px, py, aim) {
  const speed = 380;
  const g = new Grenade(px, py, Math.cos(aim) * speed, Math.sin(aim) * speed);
  game.grenades.push(g);
}
