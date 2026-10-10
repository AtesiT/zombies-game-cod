// Player, zombies, projectiles and the particle system.
import { T, BODY_ROW, HEAD_ROW, SPRITE_W, SPRITE_H, TILE, buildArt } from './art.js';
import { WEAPONS, WEAPON_ORDER, isAuto, shotSound, defFor, packedTracer } from './weapons.js';
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

    // Two carried guns (slot 0 / slot 1). Everything you own stays in the
    // armoury and can be pulled into the active slot with the wheel, but only
    // the two you carry swap instantly.
    this.slots = ['m1911', null];
    this.active = 0;
    this.packed = new Set();     // weapons that have been through the machine
    this.swapTimer = 0;
    this.swapTotal = 0;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.reloadStage = 0;
    this.triggerHeld = false;
    this.recoil = 0;
    this.kickVis = 0;          // visual kick: 1 is a pistol shove, 1.7 a shotgun
    this.walkPhase = 0;
    this.facing = 1;
    this.grenades = 0;
    this.dead = false;
    this.downed = false;      // on the floor, but not out of it yet
    this.bleedT = 0;          // seconds left before a downed body is finished
    this.netId = 0;           // who this is, on the wire
    this.name = '';
    this.points = 0;
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

  /** Id of the gun currently in your hands. */
  get current() { return this.slots[this.active] ?? 'm1911'; }
  get def() { return defFor(this.current, this.packed.has(this.current)); }
  get slot() { return this.loadout[this.current]; }
  get isPacked() { return this.packed.has(this.current); }
  /** Mid-swap: you cannot fire or reload while your hands are full. */
  get busy() { return this.swapTimer > 0; }

  ownedWeapons() { return WEAPON_ORDER.filter((id) => this.loadout[id].owned); }

  /** Keep the two slots in WEAPON_ORDER so slot 1 is always your "best" gun. */
  tidySlots() {
    const order = new Map(WEAPON_ORDER.map((id, i) => [id, i]));
    this.slots.sort((a, b) => (a ? order.get(a) : 99) - (b ? order.get(b) : 99));
  }

  /** Pull a weapon out of the armoury into the active slot (takes a moment). */
  equip(id, instant = false) {
    if (!this.loadout[id] || !this.loadout[id].owned) return false;
    if (this.slots[this.active] === id) return false;
    this.slots[this.active] = id;
    this.reloading = false;
    this.reloadTimer = 0;
    this.swapTimer = instant ? 0 : 0.9;
    this.swapTotal = this.swapTimer;
    this.fireTimer = Math.max(this.fireTimer, this.swapTimer);
    audio.reload(2);
    return true;
  }

  /** Instant A/B swap between the two guns you carry. */
  swapActive() {
    const other = this.active === 0 ? 1 : 0;
    if (!this.slots[other]) return false;
    this.active = other;
    this.reloading = false;
    this.reloadTimer = 0;
    this.swapTimer = 0.35;
    this.swapTotal = 0.35;
    this.fireTimer = Math.max(this.fireTimer, 0.35);
    audio.reload(2);
    return true;
  }

  /** Press 1 or 2: pressing the other slot's number swaps to it. */
  setSlot(i) {
    if (i === this.active) return false;
    return this.swapActive();
  }

  /** Fill an empty slot first, otherwise replace the active one. */
  autoSlot(id) {
    if (this.slots[0] === id || this.slots[1] === id) return;
    if (!this.slots[0]) { this.active = 0; this.equip(id, true); return; }
    if (!this.slots[1]) { this.active = 1; this.equip(id, true); return; }
    this.equip(id, false);
  }

  cycle(dir) {
    const list = this.ownedWeapons();
    if (list.length < 2) return;
    let i = list.indexOf(this.current);
    i = (i + dir + list.length) % list.length;
    this.equip(list[i]);
  }

  /** Run the current gun through the Pack-a-Punch machine. */
  packCurrent() {
    const id = this.current;
    if (this.packed.has(id)) return false;
    this.packed.add(id);
    const d = this.def;
    this.slot.mag = d.mag;
    this.slot.reserve = d.maxReserve;
    this.reloading = false;
    this.reloadTimer = 0;
    this.swapTimer = 1.1;
    this.swapTotal = 1.1;
    this.fireTimer = Math.max(this.fireTimer, 1.1);
    return true;
  }

  startReload() {
    const s = this.slot, d = this.def;
    if (this.reloading || s.mag >= d.mag || s.reserve <= 0) return;
    if (this.dmTimer > 0 || this.swapTimer > 0) return;
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
      const d = defFor(id, this.packed.has(id));
      s.reserve = d.maxReserve;
      s.mag = d.mag;
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
    this.autoSlot(id);
    return 'weapon';
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

  hurt(amount, srcX, srcY, game) {
    if (this.invuln > 0 || this.dead) return false;
    // already on the floor: the hits do not kill you, they hurry you up
    if (this.downed) {
      this.bleedT = Math.max(0, this.bleedT - 3);
      this.hurtFlash = 1;
      this.lastHurt = game.time;
      audio.playerHurt();
      game.shake?.(4, 0.2);
      return true;
    }
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
    if (this.hp <= 0) {
      this.hp = 0;
      // with somebody else in the building, going down is not the end of it
      const coop = (game.players?.length ?? 1) > 1;
      if (coop && !this.downed) {
        this.downed = true;
        this.bleedT = 32;
        this.invuln = 1.2;
        game.shake?.(9, 0.5);
        game.popups?.add?.(this.pos.x, this.pos.y - 34, 'DOWN', '#c4463a', 13);
      } else {
        this.dead = true;
      }
    }
    return true;
  }

  update(dt, game, input) {
    const d = this.def;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.recoil = approach(this.recoil, 0, dt * 26);
    this.kickVis = approach(this.kickVis, 0, dt * 13);
    this.knifeCd = Math.max(0, this.knifeCd - dt);
    this.knifeAnim = Math.max(0, this.knifeAnim - dt);
    this.swapTimer = Math.max(0, this.swapTimer - dt);
    for (const h of this.hitDirs) h.age += dt;
    this.hitDirs = this.hitDirs.filter((h) => h.age < 1.6);

    // health regen
    if (!this.dead && !this.downed && game.time - this.lastHurt > this.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
    }

    if (this.dead) return;

    // ---- last stand: crawl, bleed, wait for somebody ---------------------
    if (this.downed && !this.dead) {
      this.bleedT -= dt;
      this.invuln = Math.max(0, this.invuln - dt);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
      if (this.bleedT <= 0) {
        this.downed = false;
        this.dead = true;
        game.popups?.add?.(this.pos.x, this.pos.y - 30, 'BLEED OUT', '#c4463a', 12);
      }
    }

    // --------------------------------------------------------- timers ------
    this.dmTimer = Math.max(0, this.dmTimer - dt);
    this.portalCd = Math.max(0, this.portalCd - dt);

    // ---------------------------------------------------------- movement ---
    const mv = game.paused ? { x: 0, y: 0 } : input.moveVector();
    const moving = mv.x !== 0 || mv.y !== 0;
    this.sprinting = moving && !game.paused && !this.downed
      && input.isDown('ShiftLeft', 'ShiftRight') && this.hp > 1;
    this.speed = this.baseSpeed * (this.sprinting ? this.perkFx.sprintMul : 1)
      * (this.downed ? 0.34 : 1);
    const targetVx = mv.x * this.speed;
    const targetVy = mv.y * this.speed;
    const a = (moving ? this.accel : this.accel * 1.6) * dt;
    this.vel.x = approach(this.vel.x, targetVx, a);
    this.vel.y = approach(this.vel.y, targetVy, a);
    if (!moving) {
      const f = Math.max(0, 1 - this.friction * dt);
      this.vel.x *= f; this.vel.y *= f;
    }
    this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);

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
    } else if (input.wasPressed('KeyR') && this.swapTimer <= 0) {
      this.startReload();
    }

    // -------------------------------------------------------------- fire ---
    if (this.downed) { this.reloading = false; this.recoil = 0; return; }
    const wantFire = isAuto(d) ? input.mouse.down : input.mouse.pressed;
    if (wantFire && !this.reloading && !game.paused && this.swapTimer <= 0) {
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
      const res = z.hurt(dmg, false, game, ang, this);
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

    const lastRound = this.dmTimer <= 0 && s.mag === 1;   // this shot empties it
    if (this.dmTimer <= 0) s.mag--;
    this.fireTimer = d.delay * this.perkFx.fireDelayMul * (this.dmTimer > 0 ? 0.62 : 1);
    this.recoil = d.recoil;
    // A shot you cannot feel is a shot that did not happen: the bigger the
    // kick stat, the further the gun is shoved back into the hands.
    this.kickVis = Math.min(1.7, 0.5 + d.kick * 0.24);
    const muzzle = this.muzzlePos();
    const ox = this.pos.x, oy = this.pos.y;

    const moveSpread = Math.hypot(this.vel.x, this.vel.y) / Math.max(1, this.speed);
    const spread = d.spread * (1 + moveSpread * 1.3);
    const pellets = d.pellets ?? 1;

    if (d.special === 'shock') {
      game.fireShockwave(ox, oy, this.aim, d, this);
    } else {
      for (let p = 0; p < pellets; p++) {
        const ang = this.aim + randRange(-spread, spread) + randRange(-0.006, 0.006);
        game.fireHitscan(ox, oy, ang, d, muzzle, this);
      }
    }

    // presentation
    game.particles.spark(muzzle.x, muzzle.y, this.aim, 3, d.tracer);
    game.particles.smoke(muzzle.x, muzzle.y, 2);
    game.particles.casing(ox, oy, this.aim);
    // a punched gun flashes in the same colour it fires
    const tint = d.packed ? packedTracer(game.time + game.stats.shots * 0.013) : d.tint;
    // a punched gun is the loudest thing on the map: a wider flash and a
    // bigger, longer-lived pool of light in the colour it fires
    const flash = d.packed ? 1.5 : 1;
    game.muzzleFlash = {
      x: muzzle.x, y: muzzle.y, a: this.aim, t: 0.055,
      size: (pellets > 1 ? 15 : 11) * flash, colour: tint, packed: d.packed ? 1 : 0,
    };
    game.flashLights.push({
      x: muzzle.x, y: muzzle.y, r: (pellets > 1 ? 150 : 110) * flash,
      life: d.packed ? 0.12 : 0.075, max: d.packed ? 0.12 : 0.075,
      colour: tint, packed: d.packed ? 1 : 0,
    });
    game.shake(d.kick * 1.5, 0.11);
    audio.shot(shotSound(d), 0);
    if (lastRound) audio.lastRound();
    this.vel.x -= Math.cos(this.aim) * d.kick * 6.5;
    this.vel.y -= Math.sin(this.aim) * d.kick * 6.5;
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
    // the shot pushes the whole soldier back a step, and the gun further
    const kv = this.kickVis;
    const bx = -Math.cos(this.aim) * kv * 1.1, by = -Math.sin(this.aim) * kv * 1.1;
    let gx = px - SPRITE_OX + bx, gy = py - SPRITE_OY + by;

    if (this.invuln > 0 && Math.floor(this.invuln * 22) % 2 === 0) {
      ctx.globalAlpha = 0.75;
    }
    ctx.drawImage(body, gx, gy);
    ctx.globalAlpha = 1;

    // gun
    const g = art.guns[this.current];
    ctx.save();
    ctx.translate(px + bx * 2.6, py - 1 + by * 2.6 + this.recoil * 0.35);
    // muzzle climb: the barrel tips up as it comes back
    ctx.rotate(this.aim - kv * 0.08 * (flip ? -1 : 1));
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

export const ZSTATE = {
  CLIMB: 0, HUNT: 1, BARRICADE: 2, DOOR: 3, ATTACK: 4, DEAD: 5,
  BURIED: 6,     // miner: under the ground, cannot move or be hurt
  EMERGE: 7,     // miner: climbing out, a beat to shoot it or run
  HIDDEN: 8,     // mimic: playing dead until you walk past
  REVIVING: 9,   // medic: hauling a crawler back onto its feet
};

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
  crawler: {
    id: 'crawler', name: 'Crawler', hp: 0.28, speed: 0.46, dmg: 0.85, r: 5.5, scale: 1,
    chew: 0.35, points: 1.45, set: 'crawler', headOff: 0.35, low: true,
  },
  shrieker: {
    id: 'shrieker', name: 'Shrieker', hp: 0.95, speed: 1.15, dmg: 0.55, r: 6.5, scale: 1.04,
    chew: 0.5, points: 1.7, set: 'shrieker', headOff: 1, ranged: true,
  },
  helmet: {
    id: 'helmet', name: 'Helmeted', hp: 1.35, speed: 0.92, dmg: 1.1, r: 7.0, scale: 1.06,
    chew: 1.6, points: 1.55, set: 'helmet', headOff: 1.05, helmet: 3,
  },
  napalm: {
    id: 'napalm', name: 'Napalm', hp: 1.3, speed: 0.82, dmg: 1.0, r: 7.0, scale: 1.08,
    chew: 2.2, points: 1.7, set: 'napalm', headOff: 1, burns: true, fireOnDeath: true,
  },
  gasbag: {
    id: 'gasbag', name: 'Gasbag', hp: 0.9, speed: 0.86, dmg: 0.9, r: 7.2, scale: 1.1,
    chew: 1.4, points: 1.6, set: 'gasbag', headOff: 1, gasOnDeath: true,
  },
  // ---- round of ideas, item B -------------------------------------------
  miner: {
    id: 'miner', name: 'Miner', hp: 0.85, speed: 1.05, dmg: 1.35, r: 6.5, scale: 1.02,
    chew: 0.5, points: 1.8, set: 'miner', headOff: 1, burrows: true,
  },
  mimic: {
    id: 'mimic', name: 'Mimic', hp: 1.15, speed: 1.35, dmg: 1.6, r: 6.5, scale: 1,
    chew: 0.8, points: 1.9, set: 'mimic', headOff: 1, ambush: true,
  },
  medic: {
    id: 'medic', name: 'Field Medic', hp: 1.0, speed: 0.94, dmg: 0.55, r: 6.5, scale: 1.02,
    chew: 0.6, points: 2.2, set: 'medic', headOff: 1, medic: true, standoff: 240,
  },
  fusion: {
    // not spawned: three or four walkers that have been standing on top of
    // each other long enough get tired of the queue and become one
    id: 'fusion', name: 'Amalgam', hp: 3.6, speed: 0.7, dmg: 2.0, r: 11, scale: 1.6,
    chew: 3.0, points: 3.4, set: 'fusion', headOff: 1.3, smash: true,
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
    this.shriekCd = d.ranged ? randRange(2.5, 5) : 0;
    this.standoff = d.ranged ? randRange(140, 215) : 0;
    this.floor = 0;        // which storey it is currently on
    this.rally = 0;        // haste from a nearby Shrieker
    this.dmgMul = 1;
    this.helmet = d.helmet ?? 0;   // Stahlhelm headshots left
    this._flameT = 0;
    this.frozen = 0;        // Winter's Howl / electric traps
    this.webbed = 0;        // Widow's Wine / steam traps
    this.burning = 0;       // flame trap afterburn
    this.burnDmg = 0;
    this._jamT = 0;         // "am I actually going anywhere?" sampler
    this._jamX = x; this._jamY = y;
    this._jamD = Infinity;  // how far from the target we were last time we looked
    this._slide = 0;        // which way round the thing in front of us
    this._slideT = 0;
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
    // ---- item B: miner, mimic, medic, fusion ----
    this.hidden = !!d.ambush;                             // mimic: playing dead
    this.burrowCd = d.burrows ? randRange(0.6, 1.4) : 0;  // until it digs in
    this.emergeT = 0;                                     // climbing out of the ground
    this.reviveT = 0;                                     // medic: reviving a crawler
    this.reviveTarget = null;
    this.clusterT = 0;                                    // fusion: time spent in a huddle
    this.medicCd = 0;                                     // how often it looks for a patient
    if (this.hidden) this.state = ZSTATE.HIDDEN;   // a mimic starts out on the floor
  }

  get alive() { return !this.dead; }

  hurt(amount, head, game, dirAngle, by = null) {
    if (by) this._by = by;
    if (this.dead) return 0;
    // it is under the ground -- the bullets only stir the dirt
    if (this.state === ZSTATE.BURIED) {
      game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 2);
      return 0;
    }
    // A Stahlhelm eats headshots first: three of them and it is gone. Until
    // then the shot still lands, it just lands on steel.
    if (head && this.helmet > 0) {
      this.helmet--;
      this.hurtFlash = 0.12;
      const ang = dirAngle ?? 0;
      game.particles.spark(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 7, '#cfe4f2');
      game.particles.spark(this.pos.x, this.pos.y - HEAD_OFF_Y, ang + 1.4, 4, '#8fa8bd');
      audio.clang();
      if (this.helmet <= 0) {
        game.popups.add(this.pos.x, this.pos.y - 34, 'HELMET OFF', '#cfe4f2', 10);
        game.particles.chunk(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 5);
        game.particles.spark(this.pos.x, this.pos.y - HEAD_OFF_Y, ang, 12, '#e8f2fa');
        audio.helmetOff();
      } else {
        game.popups.add(this.pos.x, this.pos.y - 30, 'CLANG', '#9fb6c9', 9);
      }
      // half damage, no head multiplier, and it does not flinch
      this.hp -= amount * 0.5;
      if (this.hp <= 0) { this.hp = 0; this.die(game, ang); return 2; }
      return 1;
    }
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

    if (this.def.fireOnDeath) {
      game.addFire(this.pos.x, this.pos.y, 52, 4.6);
      audio.ignite();
      game.shake(3, 0.22);
    }
    if (this.def.gasOnDeath) {
      game.addGas(this.pos.x, this.pos.y, 74, 6.5);
      audio.ignite();
    }
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
    this.rally = Math.max(0, (this.rally ?? 0) - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    this.webbed = Math.max(0, this.webbed - dt);
    if (this.burning > 0) {
      this.burning = Math.max(0, this.burning - dt);
      this._burnTick = (this._burnTick ?? 0) + dt;
      if (Math.random() < dt * 9) {
        game.particles.spark(this.pos.x + randRange(-5, 5), this.pos.y + randRange(-8, 2),
          -Math.PI / 2, 1, '#f07a2a');
      }
      if (this._burnTick >= 0.4) {
        this._burnTick = 0;
        if (this.hurt(this.burnDmg, false, game, randRange(0, TAU)) === 2) {
          game.onZombieKilled(this, false, null, 'trap');
        }
      }
    }
    if (this.frozen > 0.05) {
      // frozen solid: no movement, no attacks, just frost
      this.vel.x *= 0.82; this.vel.y *= 0.82;
      this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);
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

    // In co-op the hound picks a body: nearest one, same storey preferred,
    // and the ones still standing before the ones on the floor.
    this._tgtT = (this._tgtT ?? 0) - dt;
    if (this._tgtT <= 0 || !this._tgt || this._tgt.dead || this._tgt.downed) {
      this._tgt = game.pickTarget ? game.pickTarget(this) : game.player;
      this._tgtT = 0.6;
    }
    const p = this._tgt ?? game.player;
    const sameFloor = this.floor === (p.floor ?? game.map.floor);
    // on another storey it cannot reach you, so it cannot hurt you either
    const pd = sameFloor
      ? dist(this.pos.x, this.pos.y, p.pos.x, p.pos.y)
      : 9999;

    // ------------------------------------------------ item B: four of them --
    // Miner. It does not walk at you across open ground, it digs in on the
    // way over and waits under your feet. You get a puff of dirt when it
    // goes down and half a second of heaving soil when it comes back up --
    // long enough to move, if you were paying attention.
    if (this.def.burrows) {
      if (this.state === ZSTATE.BURIED) {
        this.vel.x = 0; this.vel.y = 0;
        this.stuck = 0;
        // near enough to feel your steps -- or the round is nearly over and
        // the last of the horde is not allowed to sulk underground
        if (pd < 58 || game.lastCall) {
          this.state = ZSTATE.EMERGE;
          this.emergeT = 0.5;
          game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 10);
          game.shake(1.6, 0.14);
          audio.growl(0.72, 1);
        }
        return;
      }
      if (this.state === ZSTATE.EMERGE) {
        this.vel.x = 0; this.vel.y = 0;
        this.emergeT -= dt;
        if (this.emergeT <= 0) {
          this.state = ZSTATE.HUNT;
          this.burrowCd = randRange(7, 12);
          this.lunge = 1;
        }
        return;
      }
      this.burrowCd -= dt;
      // never in your face, never while you are on another storey
      if (this.burrowCd <= 0 && sameFloor && pd > 96 && pd < 520) {
        this.state = ZSTATE.BURIED;
        this.vel.x = 0; this.vel.y = 0;
        game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 7);
        audio.wood(false);
        return;
      }
    }

    // Mimic. Lies down among the bodies you made and stays there until you
    // are close enough to reach. It is not invisible and it is not immune --
    // a careful player shoots the ones on the floor before walking past.
    if (this.hidden) {
      this.vel.x *= 0.8; this.vel.y *= 0.8;
      this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);
      this.stuck = 0;
      // ditto for the one playing dead: it gets up when you are close, and
      // it gets up anyway once the round is down to its last few
      if (game.lastCall || (sameFloor && pd < 72)) {
        this.hidden = false;
        this.state = ZSTATE.HUNT;
        this.lunge = 1;
        this.attackCd = 0.25;
        game.shake(2.4, 0.2);
        game.popups.add(this.pos.x, this.pos.y - 32, 'IT MOVED', '#e07a7a', 11);
        audio.growl(0.7, 1);
      }
      return;
    }

    // Field medic. It does not fight you: it hangs at the back and puts the
    // crawlers you worked for back on their feet. Kill it first, and the
    // floor stays clear of everything you already paid to put down.
    if (this.def.medic) {
      this.medicCd -= dt;
      const t = this.reviveTarget;
      if (t && (t.dead || t.type !== 'crawler' || t.floor !== this.floor)) {
        this.reviveTarget = null; this.reviveT = 0;
      }
      if (this.reviveT > 0) {
        this.vel.x = 0; this.vel.y = 0;
        this.stuck = 0;
        this.reviveT -= dt;
        if (this.reviveT <= 0 && this.reviveTarget && !this.reviveTarget.dead) {
          this.reviveTarget.riseUp(game);
          this.reviveTarget = null;
          this.medicCd = randRange(3.5, 6);
        }
        return;
      }
      if (!this.reviveTarget && this.medicCd <= 0) {
        this.medicCd = 0.8;
        let best = null, bd = 420 * 420;
        for (const z of game.zombies) {
          if (z === this || z.dead || z.type !== 'crawler' || z.floor !== this.floor) continue;
          const d2 = dist2(this.pos.x, this.pos.y, z.pos.x, z.pos.y);
          if (d2 < bd) { bd = d2; best = z; }
        }
        this.reviveTarget = best;
      }
      // Walk straight at the patient when there is a clear line to it, and
      // follow the horde's own route when there is not: a straight line
      // through a partition wall only pins it in a corner forever.
      const pt = this.reviveTarget;
      const clear = pt && !this.map.rayWall(this.pos.x, this.pos.y, pt.pos.x, pt.pos.y);
      this._goto = clear ? { x: pt.pos.x, y: pt.pos.y } : null;
      // it walks at the patient in a straight line, which is fine across a
      // room and useless through a wall -- if it is plainly not getting
      // there, drop the patient and look for another
      if (this.reviveTarget && this.stuck > 1.2) { this.reviveTarget = null; this.medicCd = 2; return; }
      if (this.reviveTarget
        && dist(this.pos.x, this.pos.y, this.reviveTarget.pos.x, this.reviveTarget.pos.y) < 36) {
        this.reviveT = 1.7;
        this.vel.x = 0; this.vel.y = 0;
        game.particles.spark(this.reviveTarget.pos.x, this.reviveTarget.pos.y - 4,
          -Math.PI / 2, 3, '#8fd47a');
      }
    }

    // ------------------------------------------------- attack the player ---
    if (pd < 20 && !p.dead) {
      this.state = ZSTATE.ATTACK;
      if (this.attackCd <= 0) {
        this.attackCd = 1.05;
        this.lunge = 1;
        if (p.hurt(this.dmg * (this.dmgMul ?? 1), this.pos.x, this.pos.y, game)) {
          game.particles.blood(p.pos.x, p.pos.y, Math.atan2(p.pos.y - this.pos.y, p.pos.x - this.pos.x), 6, 0.8);
        }
      }
    } else if (this.state === ZSTATE.ATTACK && pd >= 24) {
      this.state = ZSTATE.HUNT;
      this.attackCd = Math.max(this.attackCd, 0.35);
    }

    // napalm types leave burning footprints behind them
    if (this.def.burns) {
      this._flameT -= dt;
      if (this._flameT <= 0) {
        this._flameT = 0.07;
        game.particles.spark(this.pos.x + randRange(-4, 4), this.pos.y - randRange(2, 12),
          -Math.PI / 2, 1, Math.random() < 0.5 ? '#f07a2a' : '#f5c04a');
      }
    }

    // ------------------------------------------------- shrieker behaviour --
    // It hangs back out of reach and screams, hasting everything nearby.
    if (this.def.ranged) {
      this.shriekCd -= dt;
      if (this.shriekCd <= 0 && pd < 520) {
        this.shriekCd = randRange(8, 12.5);
        this.shriek(game);
      }
    }

    // ------------------------------------------------- changing storey -----
    // On the wrong floor it walks to the staircase that leads towards the
    // player, climbs, and carries on. The climb itself is the CLIMB state so
    // it cannot chew or swing while it is halfway up.
    const pf = game.map.floor;
    if (this.floor !== pf) {
      const hop = game.map.hopTowards(this.floor, pf);
      if (hop) {
        const at = game.map.linkPos(hop.link, this.floor);
        const d = dist(this.pos.x, this.pos.y, at.x, at.y);
        if (d < 16) {
          const other = hop.link.a.floor === this.floor ? hop.link.b : hop.link.a;
          this.pos.x = (other.tx + 0.5) * T;
          this.pos.y = (other.ty + 0.5) * T;
          this.vel.x = 0; this.vel.y = 0;
          this.floor = other.floor;
          this.state = ZSTATE.CLIMB;
          this.climbMax = hop.link.kind === 'ladder' ? 0.9 : 0.65;
          this.climbT = this.climbMax;
          game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 4);
          audio.wood(false);
          return;
        }
      }
    }

    // ------------------------------------------------------- navigation ---
    const step = this.map.flowStep(this.pos.x, this.pos.y, this.floor);
    let tx, ty, speed = this.baseSpeed;

    if (!step) {
      // No step either because we are standing on the target tile itself (fine,
      // just walk straight at them) or because there is genuinely no route.
      tx = p.pos.x; ty = p.pos.y;
      if (!this.map.reachable(this.pos.x, this.pos.y, this.floor)) this.stuck += dt;
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

    // a medic with somebody to fix walks at them instead of at the horde's route
    if (this._goto) { tx = this._goto.x; ty = this._goto.y; }

    // -------------------------------------------------------- movement ----
    if (this.state === ZSTATE.ATTACK) {
      tx = p.pos.x; ty = p.pos.y;
      speed *= pd < 15 ? 0.15 : 0.55;
    } else {
      // classic CoD behaviour: they shamble up close but sprint when far away
      speed *= pd > 260 ? 1.7 : pd > 160 ? 1.3 : 1;
      if (this.def.sprinty) speed *= 1.2;
    }
    if (this.def.ranged || (this.def.medic && !this._goto)) {
      // hover at its own preferred range, with a dead band so it does not
      // jitter on the boundary
      if (pd < this.standoff) speed *= 1.15;
      else if (pd > this.standoff + 70) speed *= 1.25;
      else speed *= 0.7;
    }
    if (this.webbed > 0) speed *= 0.45;
    if (this.rally > 0) { speed *= 1.35; this.dmgMul = 1.25; } else this.dmgMul = 1;

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
    if ((this.def.ranged || (this.def.medic && !this._goto)) && pd < this.standoff) { dx = -dx; dy = -dy; }
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

    // Sliding round furniture. The flow field is built from tiles and knows
    // nothing about the crate or the machine standing in the room, so a route
    // can point straight through one. Without this a walker leans on it and
    // shuffles up and down its side for the rest of the round.
    let fx = wx, fy = wy;
    if (this._slideT > 0) {
      // swing the heading across the obstacle instead of into it
      fx = wx * 0.3 - wy * this._slide;
      fy = wy * 0.3 + wx * this._slide;
    }

    const lungeBoost = 1 + this.lunge * 0.9;
    this.vel.x = approach(this.vel.x, (fx + sx * 1.5) * speed * lungeBoost, 900 * dt);
    this.vel.y = approach(this.vel.y, (fy + sy * 1.5) * speed * lungeBoost, 900 * dt);

    const wasX = this.pos.x, wasY = this.pos.y;
    this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);

    // Did we get where we were trying to go? If not, pick a side and go round.
    const wantD = Math.hypot(this.vel.x * dt, this.vel.y * dt);
    const gotD = dist(this.pos.x, this.pos.y, wasX, wasY);
    if (this._slideT > 0) this._slideT -= dt;
    if (wantD > 0.35 && gotD < wantD * 0.6) {
      if (this._slideT <= 0) {
        const probe = (s) => !this.map.blockedAt(
          this.pos.x - (wy) * s * 26, this.pos.y + (wx) * s * 26, this.r, this.floor);
        if (probe(1)) this._slide = 1;
        else if (probe(-1)) this._slide = -1;
        else this._slide = (ZOMBIE_ID & 1) ? 1 : -1;
        this._slideT = 1.1;
      }
    }

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
      // Moving is not the same as getting closer: a walker leaning on a crate
      // shuffles up and down its side all day and never arrives.
      const closed = (this._jamD - pd) > 8;
      this._jamX = this.pos.x; this._jamY = this.pos.y;
      this._jamD = pd;
      // a zombie that is already chewing on you has not jammed -- it is busy
      const busy = this.state === ZSTATE.ATTACK && pd < 46;
      if ((moved < 10 || !closed) && !busy) this.stuck += 1;
      else this.stuck = Math.max(0, this.stuck - 1);
    }
    if (this.stuck > 7) this.despawn(game);
  }

  /** A scream that hastes and hardens every zombie in earshot. */
  shriek(game) {
    audio.shriek();
    game.shriekRings.push({
      x: this.pos.x, y: this.pos.y, r: 8, max: 230, life: 0.75, maxLife: 0.75,
      colour: '#d0a0e8',
    });
    game.shake(3, 0.25);
    let n = 0;
    for (const z of game.zombies) {
      if (z === this || z.dead) continue;
      if (dist2(this.pos.x, this.pos.y, z.pos.x, z.pos.y) > 230 * 230) continue;
      z.rally = 5;
      n++;
    }
    if (n) game.popups.add(this.pos.x, this.pos.y - 30, `RALLY x${n}`, '#d0a0e8', 11);
  }

  /** Explosive death: sometimes they keep coming on their elbows. */
  becomeCrawler(game) {
    const d = ENEMY_TYPES.crawler;
    // remember what it had when it could still walk -- a medic can restore it
    if (!this._wasWalker) this._wasWalker = { maxHp: this.maxHp, baseSpeed: this.baseSpeed, type: this.type };
    this.type = 'crawler';
    this.def = d;
    this.r = d.r;
    this.helmet = 0;
    this.chewMul = d.chew;
    this.pointsMul = d.points;
    this.maxHp = Math.max(16, Math.round(this.maxHp * 0.35));
    this.hp = this.maxHp;
    this.baseSpeed *= 0.7;
    this.climbT = 0;
    this.state = ZSTATE.HUNT;
    game.particles.chunk(this.pos.x, this.pos.y, randRange(0, TAU), 5);
    game.splat(this.pos.x, this.pos.y, 13, 0.45);
  }

  /** A medic got to it: back on its feet, more or less as good as new. */
  riseUp(game) {
    const back = this._wasWalker;
    const d = ENEMY_TYPES[back?.type] ?? ENEMY_TYPES.walker;
    this.type = d.id;
    this.def = d;
    this.r = d.r;
    this.chewMul = d.chew;
    this.pointsMul = d.points;
    this.maxHp = Math.max(40, Math.round((back?.maxHp ?? this.maxHp) * 0.85));
    this.hp = this.maxHp;
    this.baseSpeed = back?.baseSpeed ?? this.baseSpeed / 0.7;
    this.state = ZSTATE.HUNT;
    this.hidden = false;
    this._wasWalker = null;
    game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 8);
    game.particles.spark(this.pos.x, this.pos.y - 6, -Math.PI / 2, 5, '#8fd47a');
    game.popups.add(this.pos.x, this.pos.y - 30, 'BACK UP', '#8fd47a', 10);
  }

  _blockerOnPath(step) {
    return this.map.blockerOn(this.floor, step.ti);
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
    if (s === 'crawler') {
      return { img: (flip ? art.crawlerFlip : art.crawler)[this._frame(false)], framed: true };
    }
    if (s === 'shrieker') {
      return {
        img: (attacking
          ? (flip ? art.shriekerAtkFlip : art.shriekerAtk)
          : (flip ? art.shriekerFlip : art.shrieker))[this._frame(attacking)],
        framed: true,
      };
    }
    if (s === 'helmet' || s === 'napalm' || s === 'gasbag'
      || s === 'miner' || s === 'medic' || s === 'fusion') {
      const set = attacking
        ? (flip ? art[`${s}AtkFlip`] : art[`${s}Atk`])
        : (flip ? art[`${s}Flip`] : art[s]);
      return { img: set[this._frame(attacking)], framed: true };
    }
    if (s === 'mimic') {
      // dead on the floor until you are close, then a livid thing on its feet
      const set = this.hidden
        ? (flip ? art.mimicFlip : art.mimic)
        : (attacking
          ? (flip ? art.mimicUpAtkFlip : art.mimicUpAtk)
          : (flip ? art.mimicUpFlip : art.mimicUp));
      return { img: set[this._frame(attacking)], framed: true };
    }
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

  /** The only sign of a miner: a heap of disturbed earth, breathing. */
  _drawMound(ctx, px, py, t, alpha = 1) {
    const j = Math.sin(t * 19 + this.id) * 0.7;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#2e2718';
    ctx.beginPath(); ctx.ellipse(px + j, py + 3, 11, 5.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a3d24';
    ctx.beginPath(); ctx.ellipse(px + j, py + 2, 8, 3.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5d4c2c';
    ctx.beginPath(); ctx.ellipse(px + j - 1, py + 1, 4.5, 1.8, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  draw(ctx, art, t = 0) {
    const px = Math.round(this.pos.x);
    const py = Math.round(this.pos.y);
    const flip = this.facing < 0;
    const sc = this.def.scale;

    // underground: all you get is the dirt
    if (this.state === ZSTATE.BURIED && !this.dead) { this._drawMound(ctx, px, py, t); return; }

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
      // fades out as it sinks into the stairwell, back in as it comes out
      const k = clamp(this.climbT / (this.climbMax || 0.55), 0, 1);
      ctx.globalAlpha = 0.15 + k * 0.85;
      ctx.translate(px, py);
      ctx.scale(1, 0.45 + k * 0.55);
      ctx.translate(-px, -py);
    } else if (this.state === ZSTATE.EMERGE) {
      // hauling itself up out of the hole: nothing but the dirt shows at first
      this._emergeK = 1 - clamp(this.emergeT / 0.5, 0, 1);
      ctx.translate(0, (1 - this._emergeK) * 13);
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

    if (this.def.low) ctx.translate(0, 5);      // crawlers hug the floor
    ctx.drawImage(img, gx, gy);
    if (this.def.low) ctx.translate(0, -5);

    if (this.state === ZSTATE.EMERGE) {
      // the hole it is climbing out of, drawn over the legs
      this._drawMound(ctx, px, py + (1 - this._emergeK) * -13, t);
    }
    if (this.reviveT > 0 && this.reviveTarget && !this.reviveTarget.dead) {
      // you can see exactly who it is fixing, and you can stop it
      const q = this.reviveTarget;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#8fd47a';
      ctx.globalAlpha = 0.35 + Math.sin(t * 14) * 0.2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py - 8);
      ctx.lineTo(q.pos.x, q.pos.y - 4);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#8fd47a';
      ctx.beginPath(); ctx.ellipse(q.pos.x, q.pos.y + 2, 9, 3.5, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (this.def.medic) {
      // a red cross, so it stands out from the thing it is standing behind
      ctx.save();
      ctx.fillStyle = '#d84a4a';
      ctx.fillRect(px - 1, py - SPRITE_OY - 6, 2, 6);
      ctx.fillRect(px - 3, py - SPRITE_OY - 4, 6, 2);
      ctx.restore();
    }
    if (this.burning > 0 || this.def.burns) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (this.def.burns ? 0.42 : 0.35) + Math.sin(t * 20 + this.id) * 0.15;
      ctx.fillStyle = '#f07a2a';
      ctx.beginPath(); ctx.ellipse(px, py - 2, 9, 13, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (this.def.id === 'gasbag') {
      // a slow green sweat rolling off it
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + Math.sin(t * 3 + this.id) * 0.07;
      ctx.fillStyle = '#8fd45a';
      ctx.beginPath(); ctx.ellipse(px, py - 1, 11, 9, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (this.def.ranged) {
      // the mouth: a bright wet slit that pulses before the scream
      const w = this.shriekCd < 1.2 ? 1 : 0.45;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(w * (0.5 + Math.sin(t * 6 + this.id) * 0.2), 0, 1);
      ctx.fillStyle = '#e0b0f0';
      ctx.beginPath();
      ctx.ellipse(px + (flip ? -3 : 3), py - 13, 3, 2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (this.rally > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#d0a0e8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py - 2, 15, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    if (this.helmet > 0) {
      const hy = py - HEAD_OFF_Y * (this.def.headOff ?? 1) - 1;
      ctx.save();
      ctx.fillStyle = '#5d6a72';
      ctx.beginPath();
      ctx.ellipse(px, hy, 6.2, 5.0, 0, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = '#78868f';
      ctx.beginPath();
      ctx.ellipse(px + (flip ? -1.2 : 1.2), hy - 0.8, 4.4, 3.2, 0, Math.PI, TAU);
      ctx.fill();
      // brim + strap
      ctx.fillStyle = '#4a545c';
      ctx.fillRect(px - 7, hy - 0.5, 14, 1.6);
      ctx.fillRect(px - 1, hy + 1, 2, 4);
      // a highlight so it reads as curved steel
      ctx.fillStyle = '#aebcc6';
      ctx.fillRect(px + (flip ? -4 : 1), hy - 4, 3, 1);
      // damage pips: one dent per shot it has already eaten
      ctx.fillStyle = '#2f373d';
      for (let i = 0; i < 3 - this.helmet; i++) {
        ctx.fillRect(px - 3 + i * 3, hy - 2.5, 2, 2);
      }
      ctx.restore();
    }

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
      { colour: '#ffd45c', fromPlayer: true, blast: true });
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
    map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);
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
      if (game.tryCrawl(z, 0.30)) continue;         // blast takes the legs
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
