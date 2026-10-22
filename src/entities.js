// Player, zombies, projectiles and the particle system.
import { T, BODY_ROW, HEAD_ROW, SPRITE_W, SPRITE_H, TILE, buildArt } from './art.js';
import { WEAPONS, WEAPON_ORDER, isAuto, shotSound, defFor, packedTracer, GRENADE_MAX } from './weapons.js';
import { perkEffects, MAX_PERKS } from './perks.js';
import { SKILLS, skillEffects, NO_SKILLS } from './skills.js';
import { skinEffects } from './skins.js';
import { clamp, dist, dist2, randRange, randInt, pick, approach, TAU, pointSegDist2 } from './util.js';
import { audio } from './audio.js';

// One hand for everything thrown. The three counters are still the wire and
// save format, but the game only ever fills one of them at a time: whatever
// you bought last is what G throws, and buying another kind replaces it.
export const THROW_KINDS = ['frag', 'molotov', 'gas'];
export const THROW_POCKET = Object.freeze({ frag: 'grenades', molotov: 'molotovs', gas: 'gasbombs' });
export const throwPocket = (kind) => THROW_POCKET[kind] ?? 'grenades';

// Shift is a dash, not a jog: a short burst of legs with a five-second clock
// on it. It used to cover 93 world units -- most of a room -- which made the
// five-second clock feel like a teleport with a cooldown; it now covers about
// 31, a little over one tile, so it is a step out of a swing and nothing more.
// The burst itself stays sharp: a third of a second of nothing would not read
// as a dash at all, so the distance came out of the length, not the speed.
export const DASH_TIME = 0.10;
export const DASH_CD = 5;
export const DASH_SPEED = 420;

const SPRITE_OX = SPRITE_W / 2;
const SPRITE_OY = BODY_ROW;             // sprite pixel drawn at the entity origin
const MAX_SKELETONS = 4;         // the most one Bonewright can keep on its feet
const JAM_RADIUS = 460;          // how close a Jammer has to be to blank your markers
export const HEAD_OFF_Y = SPRITE_OY - HEAD_ROW;   // head centre relative to origin

// ---------------------------------------------------------------------------
//  Particles
// ---------------------------------------------------------------------------
export class Particles {
  constructor(cap = 900) {
    this.items = [];
    this.cap = cap;
    // The storey the next speck belongs to. The game sets it from whatever
    // body it is updating -- a walker bleeding on the second floor must not
    // spray blood over the ground floor you are standing on.
    this.floor = 0;
  }
  clear() { this.items.length = 0; }

  add(p) {
    if (this.items.length >= this.cap) this.items.shift();
    p.age = 0;
    if (p.f === undefined) p.f = this.floor;
    this.items.push(p);
    return p;
  }

  /** Draw only the storey you are looking at. */
  draw(ctx, floor) {
    for (const p of this.items) {
      if (floor !== undefined && (p.f ?? 0) !== floor) continue;
      this._one(ctx, p);
    }
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

  _one(ctx, p) {
    {
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
  constructor() {
    this.items = [];
    // set by the game from whatever body is talking: "+130" belongs to the
    // storey the walker died on, not to the one you happen to be looking at
    this.floor = 0;
  }
  clear() { this.items.length = 0; }
  add(x, y, text, colour = '#e8d9a8', size = 10) {
    this.items.push({ x: x + randRange(-4, 4), y, text, colour, size, age: 0, life: 0.95, vy: -26, f: this.floor });
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
  /** Draw only the storey you are looking at. */
  draw(ctx, floor) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const p of this.items) {
      if (floor !== undefined && (p.f ?? 0) !== floor) continue;
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
    // Run skills: a separate set from the bought perks. They last one night
    // and are picked between waves (see src/skills.js), never bought.
    this.skills = new Set();
    this.skillDraft = null;   // { round, ids, index, t } while the pick is open
    this.skillFx = NO_SKILLS;
    this.applyPerks();

    this.loadout = {};
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id];
      this.loadout[id] = { id, mag: d.mag, reserve: 0, owned: false };
    }
    const w0 = WEAPONS.m1911;
    this.loadout.m1911 = { id: 'm1911', mag: w0.mag, reserve: w0.maxReserve, owned: true };

    // Two carried guns (slot 0 / slot 1), and two is the ceiling: a third
    // weapon replaces the one in your hands instead of joining a shelf.
    this.slots = ['m1911', null];
    this.active = 0;
    this.packed = new Set();     // weapons that have been through the machine
    this.swapTimer = 0;
    this.swapTotal = 0;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.reloadTotal = 0;     // what this reload started at: dry ones are longer
    this.reloading = false;
    this.reloadStage = 0;
    this.chillT = 0;          // snowman: legs in slush, 62 % speed
    this.stunT = 0;           // shocker: hands forget how to work
    this.silkT = 0;           // weaver: silk on the boots, and no dash
    this.venomT = 0;          // widow: the bite keeps working after it lets go
    this.venomRate = 0;       // ...at this many hit points a second
    this._venomTick = 0;
    this.triggerHeld = false;
    this.recoil = 0;
    this.kickVis = 0;          // visual kick: 1 is a pistol shove, 1.7 a shotgun
    this.walkPhase = 0;
    this.facing = 1;
    this.grenades = 0;
    this.molotovs = 0;      // fire bottles: a pool of burning fuel where they land
    this.gasbombs = 0;      // stink pots: a cloud that slows the horde to a crawl
    this.throwKind = 'frag'; // the one kind in the throwing hand
    this.ownThrow = { frag: false, molotov: false, gas: false };
    // Whether *this body* has the bench menu open. It used to be one flag on
    // the game, which works for one player and is a lie for four: a guest at
    // the workbench had no menu of its own to open. Each body keeps its own,
    // and `game.craftOpen` is a proxy for "mine" (see game.js).
    this.craftOpen = false;
    this.craftRow = 0;        // which blueprint the pointer or the arrows are on
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
    this.sprinting = false;      // on the wire only: a dash reads as a sprint
    // ---- the outfit, and the dash -------------------------------------
    // `skin` is an id from src/skins.js, or null for the standard kit.
    this.skin = null;
    this.skinFx = skinEffects(null);
    this.dashT = 0;              // seconds of burst left
    this.dashCd = 0;             // seconds until the next one
    this.dashMax = DASH_CD;      // what this body's clock started at (HUD)
    this.dashDir = { x: 1, y: 0 };
    this.portalCd = 0;
    this.dmTimer = 0;          // Death Machine
    this.diveT = 0;            // PhD Flopper dive
  }

  applyPerks() {
    // Perks and skills are two different purses, but they spend from the same
    // stat block: fold them into one object here so every caller downstream
    // (reload, trigger, legs, regen) keeps reading `perkFx` and cannot forget
    // that skills exist.
    const fx = perkEffects(this.perks);
    const sk = skillEffects(this.skills);
    const outfit = skinEffects(this.skin);
    // three purses, one stat block: a coat is worth as much as a run skill,
    // and both are folded in here so nothing downstream can forget them
    fx.maxHp += outfit.bonusHp;
    fx.speedMul *= outfit.speedMul;
    fx.reloadMul *= outfit.reloadMul;
    fx.regenRate *= outfit.regenRateMul;
    fx.dashMul *= outfit.dashMul;
    this.skinFx = outfit;
    fx.maxHp += sk.bonusHp;
    fx.reloadMul *= sk.reloadMul;
    fx.fireDelayMul *= sk.fireDelayMul;
    fx.speedMul *= sk.speedMul;
    fx.sprintMul *= sk.sprintMul;
    fx.regenDelay *= sk.regenDelayMul;
    fx.regenRate *= sk.regenRateMul;
    this.perkFx = fx;
    this.skillFx = sk;
    const prevMax = this.maxHp ?? 100;
    this.maxHp = fx.maxHp;
    if (this.maxHp > prevMax) this.hp += (this.maxHp - prevMax);
    this.hp = Math.min(this.hp, this.maxHp);
    this.regenDelay = fx.regenDelay;
    this.regenRate = fx.regenRate;
    this.baseSpeed = 132 * fx.speedMul;
  }

  /** Add a run skill. Unknown or duplicate ids are refused, never thrown. */
  addSkill(id) {
    if (!id || this.skills.has(id)) return false;
    if (!(id in SKILLS)) return false;
    this.skills.add(id);
    this.applyPerks();
    return true;
  }

  hasSkill(id) { return this.skills.has(id); }

  /**
   * Put a different outfit on. Anything unknown falls back to the standard
   * kit, and the stat block is recomputed immediately -- a coat that only
   * counts after the next perk machine would be a coat you cannot trust.
   */
  setSkin(id) {
    const next = id && skinEffects(id).id ? id : null;
    if (next === this.skin) return false;
    this.skin = next;
    this.applyPerks();
    return true;
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
    const other = this.active === 0 ? 1 : 0;
    if (this.slots[other] === id) {
      // it is in your other hand: change hands, never stamp it into both
      // slots at once (that orphaned the third gun and grew the kit)
      this.active = other;
      this.reloading = false;
      this.reloadTimer = 0;
      this.swapTimer = instant ? 0 : 0.35;
      this.swapTotal = this.swapTimer;
      this.fireTimer = Math.max(this.fireTimer, this.swapTimer);
      audio.reload(2);
      return true;
    }
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
    // An empty gun is a longer job: the bolt is back, the first round has to
    // be chambered by hand. It used to be the opposite -- holding the trigger
    // on an empty mag snapped the reload to 0.12 s, which read as a bug and
    // played as a free perk. Dry is honestly slower now, and nothing skips it.
    const dry = s.mag === 0 ? 0.3 : 0;
    this.reloadTotal = (d.reload + dry) * this.perkFx.reloadMul;
    this.reloadTimer = this.reloadTotal;
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
    // a medkit is also the way to stop the venom early -- but it is not the
    // only way, because the venom stops by itself
    if ((this.medkits ?? 0) <= 0 || (this.hp >= this.maxHp && this.venomT <= 0)) return false;
    this.medkits--;
    this.heal(Math.round(55 * (this.skillFx?.medkitMul ?? 1)));
    if (this.venomT > 0) {
      this.venomT = 0;
      this._venomTick = 0;
    }
    return true;
  }

  /** A widow's bite: nine seconds of bleed that nothing has to be spent on. */
  poison(game) {
    this.venomT = Math.max(this.venomT ?? 0, 9);
    this.venomRate = 4;
    this._venomTick = 0;
    audio.venom?.(0.7);
    game?.popups?.add?.(this.pos.x, this.pos.y - 34, 'VENOM', '#8fd47a', 11);
  }

  // ------------------------------------------------------ the throwing hand --
  // Grenades, molotovs and gas bombs share one slot. `throwKind` remembers
  // what is in it (or what came out of it last), so a round refill gives the
  // same kind back and the HUD knows which icon to draw even at zero.

  /** Which throwable is in the hand right now. */
  throwableKind() {
    if ((this.molotovs ?? 0) > 0) return 'molotov';
    if ((this.gasbombs ?? 0) > 0) return 'gas';
    if ((this.grenades ?? 0) > 0) return 'frag';
    return this.throwKind || 'frag';
  }

  /** How many are in it. */
  throwableCount() { return this[throwPocket(this.throwableKind())] ?? 0; }

  /**
   * Put something in the throwing hand. The same kind stacks to the ordinary
   * cap; a different kind *replaces* what was there, because that is the one
   * slot the player has. Returns how many were actually added.
   */
  giveThrowable(kind, n = 2) {
    if (!THROW_KINDS.includes(kind)) return 0;
    const key = throwPocket(kind);
    const had = this.throwableKind();
    const before = (this[key] ?? 0);
    if (had !== kind) {
      // buying a molotov when the hand is full of frags is a replacement, not
      // a second pocket -- the old contents go with the decision
      for (const k of THROW_KINDS) if (k !== kind) this[throwPocket(k)] = 0;
    }
    const cur = had === kind ? before : 0;
    const next = Math.min(GRENADE_MAX, cur + Math.max(0, Math.floor(n) || 0));
    this[key] = next;
    this.throwKind = kind;
    if (this.ownThrow) this.ownThrow[kind] = true;
    return next - cur;
  }

  /** Take one out of the hand; returns the kind, or null when it is empty. */
  takeThrowable() {
    const kind = this.throwableKind();
    const key = throwPocket(kind);
    if ((this[key] ?? 0) <= 0) return null;
    this[key]--;
    this.throwKind = kind;
    return kind;
  }

  /** Between rounds: the kind you carry comes back, two at a time. */
  refillThrowable(n = 2) {
    const kind = this.throwKind || this.throwableKind();
    if (!this.ownThrow?.[kind]) return 0;
    return this.giveThrowable(kind, n);
  }

  /**
   * Hand over a gun. A soldier carries two: while a slot is free the new gun
   * fills it, but a third gun knocks whatever is in your hands out of the kit
   * -- taking a new toy means saying goodbye to the old one, PAP and all.
   */
  giveWeapon(id) {
    const d = WEAPONS[id], s = this.loadout[id];
    if (s.owned) {
      this.addAmmo(id, true);
      return 'ammo';
    }
    const had = this.ownedWeapons().length;
    if (had >= 2) {
      const dropId = this.current;
      const ds = this.loadout[dropId];
      ds.owned = false;
      ds.mag = 0;
      ds.reserve = 0;
      this.packed.delete(dropId);
      this.slots[this.active] = id;
      this.swapTimer = 0.9;
      this.swapTotal = 0.9;
      this.fireTimer = Math.max(this.fireTimer, 0.9);
    } else if (!this.slots[0]) {
      this.slots[0] = id;
      this.active = 0;
    } else {
      this.slots[1] = id;
      this.active = 1;
    }
    s.owned = true;
    s.mag = d.mag;
    s.reserve = d.maxReserve;
    this.reloading = false;
    this.reloadTimer = 0;
    return 'weapon';
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

  hurt(amount, srcX, srcY, game) {
    if (this.invuln > 0 || this.dead) return false;
    if (this.evac) return false;                 // aboard the bird, out of the war
    if (game?.debug?.god || this.god) return false;   // the debug panel's god mode
    // a run skill can take the edge off everything that arrives
    amount = amount * (this.skillFx?.takenMul ?? 1);
    // already on the floor: the hits do not kill you and they do not hurry
    // you up either -- the clock is the only thing out here that finishes
    // somebody, so a zombie chewing on a downed body is just scenery
    if (this.downed) {
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
      game.recordRound?.('armor', absorbed);
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
    game.recordRound?.('damage', Math.min(this.hp, amount));
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
        game.recordRound?.('downs');
        this.bleedT = 60;      // a full minute for somebody to reach you
        this.invuln = 1.2;
        game.shake?.(9, 0.5);
        game.popups?.add?.(this.pos.x, this.pos.y - 34, 'DOWN', '#c4463a', 13);
      } else {
        this.dead = true;
      }
    }
    return true;
  }

  /**
   * Shift: one burst of legs, one press, five seconds before the next.
   *
   * It fires from a standstill as well -- a dash into the room you were
   * aiming at is the reason to have one -- and it is refused while the body
   * is downed, stunned, aboard the bird or in a menu. The cooldown is stored
   * on the body, so a co-op guest's clock is theirs and the host's is theirs.
   */
  _dashTick(game, input, mv, moving) {
    if (this.dashT > 0 || this.dashCd > 0) return;
    if (game.paused || this.dead || this.downed || this.stunT > 0 || this.evac) return;
    // silk on the floor is stronger than silk on the boots: you cannot start
    // a dash from inside a knot, but one that began outside tears it apart
    if (this.silkT > 0) {
      if (!this._silkDeny || game.time - this._silkDeny > 1.2) {
        this._silkDeny = game.time;
        game.popups?.add?.(this.pos.x, this.pos.y - 30, 'STUCK FAST', '#e8e4d2', 10);
      }
      return;
    }
    if (!input?.wasPressed('ShiftLeft', 'ShiftRight')) return;
    const dir = moving ? { x: mv.x, y: mv.y } : { x: Math.cos(this.aim), y: Math.sin(this.aim) };
    const len = Math.hypot(dir.x, dir.y) || 1;
    this.dashDir.x = dir.x / len;
    this.dashDir.y = dir.y / len;
    this.dashT = DASH_TIME;
    // the outfit can shorten the clock (THE GHOST), and so can Stamin-Up
    this.dashMax = DASH_CD * (this.skinFx?.dashMul ?? 1) * (this.perkFx?.dashMul ?? 1);
    this.dashCd = this.dashMax;
    this.walkPhase += 1.2;
    game.particles?.dust(this.pos.x, this.pos.y, Math.atan2(-this.dashDir.y, -this.dashDir.x), 9);
    // a dash that starts outside a knot of silk goes through it, not into it
    game.tearThreads?.(this);
    audio.dash();
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

    // Health regen -- but not through venom. It used to heal straight through
    // the widow's bite (30 a second against a 4-a-second bleed), so the poison
    // was decoration: you lost nothing, and the one thing it was supposed to
    // cost you -- the next few seconds -- cost nothing at all.
    if (!this.dead && !this.downed && !(this.venomT > 0)
      && game.time - this.lastHurt > this.regenDelay && this.hp < this.maxHp) {
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
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.portalCd = Math.max(0, this.portalCd - dt);
    this.chillT = Math.max(0, (this.chillT ?? 0) - dt);
    this.silkT = Math.max(0, (this.silkT ?? 0) - dt);

    // ---- the widow's venom ------------------------------------------------
    // It runs its own clock and it runs out by itself: nine seconds of a slow
    // bleed that a medkit will cut short and that nothing else in the game
    // has to be spent on. Standing in it is the whole cost.
    if (this.venomT > 0 && !this.dead) {
      this.venomT = Math.max(0, this.venomT - dt);
      this._venomTick += dt;
      if (Math.random() < dt * 5) {
        game.particles.spark(this.pos.x + randRange(-8, 8), this.pos.y - randRange(2, 18),
          -Math.PI / 2, 1, '#8fd47a');
      }
      if (this._venomTick >= 0.5) {
        this._venomTick = 0;
        const tick = Math.max(1, (this.venomRate || 4) * 0.5);
        // It takes you down to a fifth of your health and then stops: the
        // price of the bite is the next nine seconds and the risk of a second
        // one, never a medkit. (A wound that can finish you on its own would
        // be a wound you have to carry a medkit for, which is the thing the
        // widow was asked *not* to be.)
        const floor = Math.max(Math.min(this.hp, 8), Math.round((this.maxHp ?? 100) * 0.2));
        const dealt = Math.max(0, this.hp - Math.max(floor, this.hp - tick));
        this.hp = Math.max(floor, this.hp - tick);
        game.roundDamageTaken = (game.roundDamageTaken ?? 0) + dealt;
        this.hurtFlash = Math.max(this.hurtFlash, 0.25);
        if (this.hp <= 0) {
          if ((game.players?.length ?? 1) > 1 && !this.downed) {
            this.downed = true;
            this.bleedT = 60;
            this.invuln = 1.2;
            game.popups?.add?.(this.pos.x, this.pos.y - 34, 'DOWN', '#c4463a', 13);
          } else this.dead = true;
        }
      }
    }

    // A Shocker's bolt: for most of a second nothing works -- no legs, no
    // trigger, no reload, no knife. It is short on purpose: long enough to be
    // bitten, not long enough to be a free kill.
    // aboard the helicopter: no legs, no trigger, no knife -- you are luggage
    if (this.evac) {
      this.reloading = false;
      this.recoil = 0;
      this.knifeAnim = Math.max(0, this.knifeAnim - dt);
      this.vel.x *= 0.85; this.vel.y *= 0.85;
      this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);
      return;
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.reloading = false;
      this.reloadTimer = 0;
      this.vel.x *= 0.8; this.vel.y *= 0.8;
      this.map.moveCircle(this.pos, this.vel.x * dt, this.vel.y * dt, this.r, this.floor);
      if (Math.random() < dt * 22) {
        game.particles.spark(this.pos.x + randRange(-9, 9), this.pos.y - randRange(2, 18),
          randRange(0, TAU), 1, '#bfe0ff');
      }
      return;
    }

    // ---------------------------------------------------------- movement ---
    const mv = game.paused ? { x: 0, y: 0 } : input.moveVector();
    const moving = mv.x !== 0 || mv.y !== 0;
    // Shift used to be a hold-to-run; it is a dash now -- one burst, one
    // press, five seconds before the next. `sprinting` survives as the wire
    // flag the other machines read to draw the streak.
    this._dashTick(game, input, mv, moving);
    this.sprinting = this.dashT > 0;
    // Second Wind: one burst of legs per round, the moment the health bar
    // falls into the red. It buys distance, never immunity.
    if (this.skillFx?.secondwind) {
      if (!this._windUsed && this.hp > 0 && this.hp < this.maxHp * 0.30) {
        this._windUsed = true;
        this.windT = 2;
        game.popups?.add?.(this.pos.x, this.pos.y - 30, 'SECOND WIND', '#7fbf5f', 11);
        audio.perk?.();
      }
      this.windT = Math.max(0, (this.windT ?? 0) - dt);
    }
    // Cold Blood: staying put for half a second (and not while being shoved
    // around) loads exactly one shot with extra punch.
    const still = Math.hypot(this.vel.x, this.vel.y) < 8 && this.dashT <= 0;
    this._stillT = still ? (this._stillT ?? 0) + dt : 0;
    if (this.skillFx?.coolhead && this._stillT >= 0.6) this._coolReady = true;
    this.speed = this.baseSpeed
      * (this.windT > 0 ? (this.skillFx?.secondwindSpeed ?? 1) : 1)
      * (this.downed ? 0.34 : 1) * (this.chillT > 0 ? 0.62 : 1)
      * (this.silkT > 0 ? 0.55 : 1);
    if (this.dashT > 0) {
      // a dash is not steering: all of it goes where it started, and the last
      // third of it eases out so the stop does not read as a wall
      const k = 0.5 + 0.5 * (this.dashT / DASH_TIME);
      this.vel.x = this.dashDir.x * DASH_SPEED * k;
      this.vel.y = this.dashDir.y * DASH_SPEED * k;
    } else {
      const targetVx = mv.x * this.speed;
      const targetVy = mv.y * this.speed;
      const a = (moving ? this.accel : this.accel * 1.6) * dt;
      this.vel.x = approach(this.vel.x, targetVx, a);
      this.vel.y = approach(this.vel.y, targetVy, a);
      if (!moving) {
        const f = Math.max(0, 1 - this.friction * dt);
        this.vel.x *= f; this.vel.y *= f;
      }
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
      const total = this.reloadTotal || d.reload * this.perkFx.reloadMul;
      const k = 1 - this.reloadTimer / total;
      const stage = k > 0.75 ? 2 : k > 0.35 ? 1 : 0;
      if (stage !== this.reloadStage) { this.reloadStage = stage; audio.reload(stage); }
      if (this.reloadTimer <= 0) this.finishReload();
    } else if (input.wasPressed('KeyR') && this.swapTimer <= 0) {
      this.startReload();
    }

    // -------------------------------------------------------------- fire ---
    if (this.downed) { this.reloading = false; this.recoil = 0; return; }
    // At the bench the pointer belongs to the list: without this, every click
    // on a blueprint is also a shot, and on a phone every tap is. Only this
    // body's own menu counts -- the host never opens one for anybody else.
    const atBench = !!this.craftOpen;
    const wantFire = !atBench && (isAuto(d) ? input.mouse.down : input.mouse.pressed);
    if (wantFire && !this.reloading && !game.paused && this.swapTimer <= 0) {
      if (this.slot.mag > 0) {
        if (this.fireTimer <= 0) this.fire(game);
      } else if (input.mouse.pressed || (isAuto(d) && this.fireTimer <= 0)) {
        if (this.fireTimer <= 0) {
          audio.gunDry();       // louder than the menu tick: this one matters
          this.fireTimer = 0.25;
          if (this.slot.reserve > 0) this.startReload();
        }
      }
    }

    // -------------------------------------------------------------- knife --
    if (input.wasPressed('KeyV') && !game.paused && !atBench) this.knife(game);
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
      if (z.dead || (z.floor ?? 0) !== (this.floor ?? game.map.floor)) continue;
      const d = dist(this.pos.x, this.pos.y, z.pos.x, z.pos.y);
      if (d > REACH) continue;
      let da = Math.atan2(z.pos.y - this.pos.y, z.pos.x - this.pos.x) - this.aim;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > ARC) continue;
      hits.push({ z, d });
    }
    hits.sort((a, b) => a.d - b.d);

    const dmg = (260 + game.round * 22) * (this.skillFx?.dmgMul ?? 1) * (this.skinFx?.knifeMul ?? 1);
    let any = false;
    for (const h of hits.slice(0, 2)) {
      const z = h.z;
      const ang = Math.atan2(z.pos.y - this.pos.y, z.pos.x - this.pos.x);
      const res = z.hurt(dmg, false, game, ang, this);
      any = true;
      if (res === 2) game.onZombieKilled(z, false, 130, 'knife');
    }
    if (!any) {
      game.particles.spark(this.pos.x + Math.cos(this.aim) * 22, this.pos.y + Math.sin(this.aim) * 22, this.aim, 3, '#cfd6dd');
    } else {
      game.shake(2.5, 0.1);
    }
    // Widow's Wine: the swipe leaves a slowing web on everything nearby
    if (this.perkFx.webs) {
      for (const z of game.zombies) {
        if (z.dead || (z.floor ?? 0) !== (this.floor ?? game.map.floor)) continue;
        if (dist(this.pos.x, this.pos.y, z.pos.x, z.pos.y) < 70) z.webbed = Math.max(z.webbed, 3.5);
      }
      game.webBlasts.push({ x: this.pos.x + Math.cos(this.aim) * 24, y: this.pos.y + Math.sin(this.aim) * 24, r: 46, life: 0.5, max: 0.5, f: this.floor ?? game.map.floor });
    }
  }

  fire(game) {
    const d = this.def, s = this.slot;
    if (d.special === 'lure') { game.throwMonkey(this); return; }

    const lastRound = this.dmTimer <= 0 && s.mag === 1;   // this shot empties it
    if (this.dmTimer <= 0) s.mag--;
    // the click you hear even in the meat: the gun telling you it is now empty
    if (lastRound) audio.lastClick();
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
      const once = d.special === 'rift' || d.special === 'flame' || d.special === 'lob';
      for (let p = 0; p < pellets; p++) {
        const ang = this.aim + randRange(-spread, spread) + randRange(-0.006, 0.006);
        game.fireHitscan(ox, oy, ang, d, muzzle, this, !(once && p > 0));
      }
    }

    // presentation
    game.particles.spark(muzzle.x, muzzle.y, this.aim, 3, d.tracer);
    game.particles.smoke(muzzle.x, muzzle.y, 2);
    game.particles.casing(ox, oy, this.aim);
    // a punched gun flashes in the same colour it fires
    const tint = d.packed ? packedTracer(game.time + game.stats.shots * 0.013) : d.tint;
    // The muzzle blast was the loudest thing on screen by a long way -- a
    // shotgun flash covered a third of the room and, on the ground floor
    // where the lighting pass actually ran, washed the walls out for four
    // frames at a time. A punched gun is *meant* to be flashier downrange,
    // not blinder up close, so it now throws the smallest flash of all.
    const punch = d.packed ? 0.62 : 1;
    game.muzzleFlash = {
      x: muzzle.x, y: muzzle.y, a: this.aim, t: 0.055,
      size: (pellets > 1 ? 12 : 8.5) * punch, colour: tint,
    };
    game.flashLights.push({
      x: muzzle.x, y: muzzle.y, r: (pellets > 1 ? 116 : 86) * punch,
      life: 0.075, max: 0.075, colour: tint, f: this.floor ?? game.map.floor,
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
    // The outfit: one sprite set per coat, built once in art.js. A body with
    // no outfit (or one that arrived from an older guest) wears the standard
    // kit, which is filed under ''.
    const set = art.playerSets?.[this.skin ?? ''] ?? null;
    const setFlip = set?.flip ?? art.playerFlip;
    const setBody = set?.frames ?? art.player;
    let body = flip ? setFlip[frame] : setBody[frame];
    // the shot pushes the whole soldier back a step, and the gun further
    const kv = this.kickVis;
    const bx = -Math.cos(this.aim) * kv * 1.1, by = -Math.sin(this.aim) * kv * 1.1;
    let gx = px - SPRITE_OX + bx, gy = py - SPRITE_OY + by;

    if (this.invuln > 0 && Math.floor(this.invuln * 22) % 2 === 0) {
      ctx.globalAlpha = 0.75;
    }
    // the streak: two after-images of the coat, further back the faster the
    // body is going. A guest sees this too -- `sprinting` is what the wire
    // carries for it, so a dash reads at a glance in a shared room.
    if (this.sprinting || this.dashT > 0) {
      const sp = Math.hypot(this.vel.x, this.vel.y);
      const k = Math.min(1, sp / DASH_SPEED);
      for (let i = 2; i >= 1; i--) {
        const back = i * 7 * k;
        ctx.globalAlpha = 0.16 * (3 - i) * k;
        ctx.drawImage(body, gx - this.dashDir.x * back, gy - this.dashDir.y * back);
      }
      ctx.globalAlpha = 1;
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
      const w = flip ? (set?.whiteFlip ?? art.playerWhiteFlip)[frame]
        : (set?.white ?? art.playerWhite)[frame];
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
    // A hound is a dog, not a pony. 1.75 on a 26x16 sprite drew a 45x28 body --
    // wider than two soldiers and taller at the shoulder than a man -- which
    // read as something you ride, not something that bites your ankles. It is
    // back to 1.0, so the drawing lands at its own 26x16: three times less
    // body than before, still twice the length of an old 18x12 frame, and
    // still a dog from across the room. `hitScale` follows the body down --
    // bullets hit what the picture shows.
    id: 'dog', name: 'Hellhound', hp: 0.5, speed: 1.95, dmg: 0.7, r: 7.0, scale: 1.0,
    hitScale: 1.35, chew: 0.45, points: 1.35, set: 'dog', headOff: 0.45,
    sprinty: true, four: true,
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
  // ---- the first three of the creature shortlist -------------------------
  bonewright: {
    // Frail and slow, and it will not come to you: it stands off at 260px and
    // sews. Every cycle two skeletons climb out of the dirt beside it, up to
    // four at a time, and none of them count towards the round -- so the round
    // will not end while its work is still walking about.
    id: 'bonewright', name: 'Bonewright', hp: 0.85, speed: 0.62, dmg: 0.9, r: 7.2,
    scale: 1.12, chew: 0.8, points: 2.8, set: 'bonewright', headOff: 1.15,
    raises: true, standoff: 260,
  },
  skeleton: {
    // never rolled: the Bonewright sews these. Forty hit points flat, one and
    // a half times walking pace, no blood and no head to shoot at. Worth a
    // fraction of a walker, and it still holds the round open.
    id: 'skeleton', name: 'Skeleton', hp: 0.27, speed: 1.5, dmg: 0.7, r: 5.4,
    scale: 0.9, chew: 0.5, points: 0.4, set: 'skeleton', headless: true,
    noBlood: true, summoned: true, flatHp: 40,
  },
  swarmling: {
    // Not one body: seven small ones sharing a single pool of hit points.
    // Every fifth hit knocks one loose and it starts hunting on its own, so
    // dying to a swarm means you let it come apart in your face.
    id: 'swarmling', name: 'Swarmling', hp: 2.3, speed: 1.06, dmg: 0.55, r: 11,
    scale: 1, chew: 1.2, points: 3.4, set: 'swarmling', headOff: 1, swarm: 7,
  },
  swarmlet: {
    // a piece that has broken off the swarm: small, quick, on its own
    id: 'swarmlet', name: 'Swarmlet', hp: 0.34, speed: 1.42, dmg: 0.45, r: 4.6,
    scale: 0.72, chew: 0.6, points: 0.55, set: 'swarmlet', headOff: 0.8,
  },
  jammer: {
    // Carries a wireless set: while it is close every marker you rely on goes
    // dark -- minimap, perk machines, door prices, the crosshair telling you
    // you are on target. The guns and your ears still work.
    id: 'jammer', name: 'Jammer', hp: 1.15, speed: 0.95, dmg: 0.9, r: 6.8,
    scale: 1.04, chew: 1.1, points: 3.0, set: 'jammer', headOff: 1, jams: true,
  },
  // ---- the haunt round: seven new bodies and what they leave behind -------
  bearer: {
    // Keeps its distance like the Bonewright and, once per life, kneels and
    // stands a totem up. While that totem hums the whole house goes to dusk
    // and the horde gets bolder. Shoot the totem -- it has 140 hp of its own
    // and 50 seconds of life even if nobody does.
    id: 'bearer', name: 'Totem Bearer', hp: 1.05, speed: 0.88, dmg: 0.9, r: 6.8,
    scale: 1.06, chew: 0.9, points: 3.2, set: 'bearer', headOff: 1,
    places: 'totem', standoff: 300,
  },
  mourner: {
    // Digs one grave and keens over it. The grave rings a bell every few
    // seconds and lets half-seen wraiths out to walk; kill the grave or wait
    // it out (45 s) and whatever walked out fades with it.
    id: 'mourner', name: 'Mourner', hp: 1.0, speed: 0.8, dmg: 0.8, r: 6.8,
    scale: 1.04, chew: 0.8, points: 3.0, set: 'mourner', headOff: 1,
    places: 'grave', standoff: 280,
  },
  wraith: {
    // never rolled: the grave lets these out. Half-seen, quick, a sabre of
    // cold iron, and cheap to put down -- but they do not count towards the
    // round, and they keep coming while the headstone stands.
    id: 'wraith', name: 'Wraith', hp: 0.3, speed: 1.55, dmg: 1.15, r: 6.0,
    scale: 1.02, chew: 0.5, points: 0.7, set: 'wraith', headOff: 1,
    summoned: true, ghostly: true, flatHp: 46, sprinty: true,
  },
  snowman: {
    // Lobs snowballs from a distance and is not good at it -- the scatter is
    // enormous. But one that lands on you leaves your legs in a bucket of
    // slush for three seconds, and three seconds is a long time in a doorway.
    id: 'snowman', name: 'Snowman', hp: 1.3, speed: 0.7, dmg: 0.8, r: 7.6,
    scale: 1.14, chew: 1.2, points: 2.6, set: 'snowman', headOff: 1.1,
    throws: 'snow', standoff: 260,
  },
  arsonist: {
    // Fire bottles, thrown at where you are standing. The bottle breaks and
    // the floor burns -- the same burn as a Napalm's death, but delivered to
    // your favourite camping spot on purpose.
    id: 'arsonist', name: 'Arsonist', hp: 0.95, speed: 0.95, dmg: 0.9, r: 6.6,
    scale: 1.04, chew: 0.9, points: 2.8, set: 'arsonist', headOff: 1,
    throws: 'bottle', standoff: 240,
  },
  witch: {
    // The same arm, the other bottle: a stink potion that bursts into a
    // Gasbag's cloud and holds the hallway for six and a half seconds.
    id: 'witch', name: 'Witch', hp: 0.9, speed: 1.0, dmg: 0.7, r: 6.4,
    scale: 1.0, chew: 0.7, points: 2.9, set: 'witch', headOff: 1,
    throws: 'potion', standoff: 250,
  },
  shocker: {
    // Carries the storm on a rod. It stands off, gathers for three quarters
    // of a second -- you can see the light climbing the wire -- and then puts
    // a bolt into you: little damage, but your hands forget how to work for
    // most of a second. Walls do stop the bolt. So does shooting it mid-gather.
    id: 'shocker', name: 'Shocker', hp: 1.05, speed: 0.98, dmg: 0.8, r: 6.6,
    scale: 1.04, chew: 0.9, points: 3.1, set: 'shocker', headOff: 1,
    zaps: true, standoff: 380,
  },
  knight: {
    // A slab of a thing in plate: slower than a Brute, tankier than one too.
    // Body shots ring off the steel for half damage -- the head is the only
    // honest way in, five full-damage headshots at round twenty, or a great
    // many more of anything else.
    id: 'knight', name: 'Knight', hp: 3.6, speed: 0.52, dmg: 1.9, r: 10,
    scale: 1.42, chew: 3.2, points: 3.6, set: 'knight', headOff: 1.2,
    plate: true,
  },

  // ------------------------------------------------------------------------
  //  The apiary, the barrow and the web.
  //
  //  Nine bodies, each one a role the roster did not have: something that
  //  leaves a nest behind, something that shoots, something you cannot shoot
  //  from the front, something that makes the others faster, something that
  //  is a bomb with legs, a king with three lives -- and three spiders that
  //  change the floor you are standing on.
  // ------------------------------------------------------------------------
  beekeeper: {
    // Stands off, kneels once, and leaves a hive. The hive is not scenery: it
    // hums bees out of it every few seconds until somebody shoots it, and the
    // bees are tiny, fast and worth almost nothing. The point of the beekeeper
    // is that killing the bees is losing: kill the hive.
    id: 'beekeeper', name: 'Beekeeper', hp: 1.05, speed: 0.74, dmg: 0.85, r: 7.0,
    scale: 1.04, chew: 1.1, points: 3.0, set: 'beekeeper', headOff: 1,
    places: 'hive', standoff: 290,
  },
  bee: {
    // never rolled: the hive makes them. Fourteen hit points, quick, and they
    // do not count towards the round -- so a hive you ignore adds up.
    id: 'bee', name: 'Bee', hp: 0.12, speed: 1.4, dmg: 0.35, r: 3.4,
    scale: 1.0, chew: 0.3, points: 0.2, set: 'bee', headOff: 1,
    summoned: true, flatHp: 14, noBlood: true, sprinty: true,
  },
  archer: {
    // A bow, three arrows at a time and a long, visible draw. It does not
    // come to you; it stands at 300 and makes you move. The middle arrow is
    // fastest and goes where you were, so a step sideways is the answer.
    id: 'archer', name: 'Bone Archer', hp: 0.5, speed: 0.9, dmg: 0.6, r: 6.2,
    scale: 0.98, chew: 0.5, points: 2.0, set: 'archer', headOff: 1.0,
    bows: true, standoff: 300, flatHp: 95, noBlood: true,
  },
  bulwark: {
    // Carries a plank shield turned towards you. Shots that land on it do a
    // fifth of their damage and ring; it turns with a lag of a third of a
    // second, so the way through is round the side, not more bullets.
    id: 'bulwark', name: 'Bulwark', hp: 1.5, speed: 0.5, dmg: 1.1, r: 7.6,
    scale: 1.08, chew: 1.4, points: 2.6, set: 'bulwark', headOff: 1,
    shield: true, noBlood: true, flatHp: 230,
  },
  drummer: {
    // No attack worth the name. Beats a drum, and everything dead within
    // three hundred units walks and bites a fifth faster. Kill it and the
    // room slows down; the aura is drawn, so you can see where it comes from.
    id: 'drummer', name: 'Drummer', hp: 0.7, speed: 0.55, dmg: 0.4, r: 6.4,
    scale: 1.04, chew: 0.5, points: 2.4, set: 'drummer', headOff: 1,
    drums: true, noBlood: true, flatHp: 110,
  },
  sapper: {
    // A crawler with a bundle of charges roped to its back. Shoot it early
    // and the blast takes the skeletons around it with it -- that is the gift.
    // Let it reach you and the gift is yours.
    id: 'sapper', name: 'Sapper', hp: 0.4, speed: 0.66, dmg: 0.5, r: 5.6,
    scale: 0.95, chew: 0.4, points: 0.9, set: 'sapper', headOff: 0.5,
    low: true, sapper: true, noBlood: true, flatHp: 60,
  },
  first: {
    // The first of them: a rib crown, a red tabard, and it does not stay
    // dead. Every time it goes down it gathers itself out of the nearest
    // bones and stands back up, quicker and angrier, twice.
    id: 'first', name: 'The First', hp: 2.2, speed: 0.62, dmg: 2.1, r: 9.5,
    scale: 1.3, chew: 2.2, points: 5.0, set: 'first', headOff: 1.05,
    reassembles: 2, noBlood: true,
  },
  weaver: {
    // Fast, cheap, and it does not so much attack you as change the floor.
    // Every second or so it leaves a knot of silk; stand in one and your legs
    // are half yours. The knots can be shot, cut with the knife, or torn by a
    // dash -- the point is that standing still next to one is a decision.
    id: 'weaver', name: 'Weaver', hp: 0.55, speed: 1.16, dmg: 0.55, r: 7.2,
    scale: 1.0, chew: 0.7, points: 2.2, set: 'weaver', headOff: 0.25,
    spins: true, noBlood: true,
  },
  widow: {
    // A pale cross on its back and a bite that keeps working. The venom runs
    // out by itself in nine seconds -- a medkit takes it off sooner, but you
    // are not carrying one for this.
    id: 'widow', name: 'Widow', hp: 0.95, speed: 0.92, dmg: 0.8, r: 8.4,
    scale: 1.22, chew: 1.0, points: 3.0, set: 'widow', headOff: 0.25,
    venom: true, noBlood: true,
  },
  porter: {
    // Slow, fat, and carrying a sac of brood. Every few seconds it sets a
    // handful down; killing it is worth more than anything it can hatch, and
    // the sac bursts when it dies. A room with a porter in it fills up.
    id: 'porter', name: 'Porter', hp: 1.9, speed: 0.5, dmg: 0.85, r: 10.5,
    scale: 1.45, chew: 1.2, points: 3.4, set: 'porter', headOff: 0.25,
    broods: true, noBlood: true,
  },

  // ------------------------------------------------------------------------
  //  The nine wardens: one on every fifth round from ten, and then the whole
  //  list again. Each is a body you have already met, wearing the job it had
  //  before it died -- that is where the mechanic comes from.
  // ------------------------------------------------------------------------
  warden: {
    // Holds the lantern and the keys: plate from the neck down, and it calls
    // the others in. Standing behind it is a mistake, standing next to it is
    // a worse one.
    id: 'warden', name: 'The Warden', hp: 1.9, speed: 0.58, dmg: 1.9, r: 10.5,
    scale: 1.45, chew: 2.6, points: 9, set: 'warden', headOff: 1.2,
    plate: true, summons: 'walker', boss: true,
  },
  organist: {
    // The organ is gone but the rope is not. Keeps its distance and screams:
    // the ring staggers you and hastes everything else.
    id: 'organist', name: 'The Organist', hp: 1.7, speed: 0.66, dmg: 1.4, r: 9.5,
    scale: 1.35, chew: 1.8, points: 9, set: 'organist', headOff: 1.05,
    ranged: true, shrieksHard: true, standoff: 240, boss: true,
  },
  butcher: {
    // Chooses you, plants its feet, and comes at you in a straight line with
    // a cleaver. The line is the telegraph: step off it.
    id: 'butcher', name: 'The Butcher', hp: 2.1, speed: 0.66, dmg: 2.4, r: 10,
    scale: 1.4, chew: 2.6, points: 9, set: 'butcher', headOff: 1.1,
    charges: true, boss: true,
  },
  mother: {
    // A porter grown enormous, with a sac that never empties. The spiders she
    // sets down are the same ones the ordinary porter carries.
    id: 'mother', name: 'The Mother', hp: 2.0, speed: 0.46, dmg: 1.6, r: 12,
    scale: 2.0, chew: 2.0, points: 9, set: 'porter', headOff: 0.25,
    broods: true, boss: true, noBlood: true,
  },
  queen: {
    // The hive is behind her and the hive is not the point: the bees come out
    // of her hands. Two hives at once, and she does not kneel for long.
    id: 'queen', name: 'The Queen', hp: 1.9, speed: 0.7, dmg: 1.5, r: 9.5,
    scale: 1.4, chew: 1.6, points: 9, set: 'queen', headOff: 1,
    places: 'hive', standoff: 240, boss: true,
  },
  gravedigger: {
    // Two graves at a time, and the bells do not stop while he stands.
    id: 'gravedigger', name: 'The Gravedigger', hp: 1.9, speed: 0.62, dmg: 1.8, r: 10,
    scale: 1.4, chew: 2.0, points: 9, set: 'gravedigger', headOff: 1.05,
    places: 'grave', standoff: 260, boss: true,
  },
  bellringer: {
    // The bell in its hand is the bolt. Same gather, longer reach, and every
    // ring brings a handful of the horde with it.
    id: 'bellringer', name: 'The Bellringer', hp: 1.9, speed: 0.62, dmg: 1.7, r: 9.5,
    scale: 1.4, chew: 1.8, points: 9, set: 'bellringer', headOff: 1,
    zaps: true, summons: 'walker', standoff: 330, boss: true,
  },
  colonel: {
    // The last of the staff. Plate, a cap that used to mean something, and a
    // whistle: the knights come when it blows.
    id: 'colonel', name: 'The Colonel', hp: 2.2, speed: 0.6, dmg: 2.2, r: 10.5,
    scale: 1.45, chew: 2.6, points: 9, set: 'colonel', headOff: 1.15,
    plate: true, summons: 'knight', boss: true,
  },
};

/** The order the wardens arrive in, from round ten, one every five rounds. */
export const BOSS_ORDER = ['warden', 'organist', 'butcher', 'first', 'mother',
  'queen', 'gravedigger', 'bellringer', 'colonel'];

/** Which warden owns a round, or null. Ten, fifteen, ... fifty, then again. */
export function bossForRound(round) {
  if (!(round >= 10) || round % 5 !== 0) return null;
  return BOSS_ORDER[((round / 5) - 2) % BOSS_ORDER.length];
}

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
    // `flatHp` is for things that should cost the same in round thirty as in
    // round five -- the skeletons a Bonewright sews are meant to be cheap
    // however late you meet them.
    this.maxHp = d.flatHp != null ? d.flatHp : (opts.hp ?? 150) * d.hp;
    this.hp = this.maxHp;
    this.baseSpeed = (opts.speed ?? 34) * d.speed;
    this.dmg = (opts.dmg ?? 34) * d.dmg;
    this.chewMul = d.chew;
    this.pointsMul = d.points;
    this.shriekCd = d.ranged ? randRange(2.5, 5) : 0;
    // the bonewright keeps its own distance, the shriekers pick one at random
    this.standoff = d.ranged ? randRange(140, 215) : (d.standoff ?? 0);
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
    // ---- the first three of the creature shortlist ----
    this.units = d.swarm ?? 1;                            // swarmling: bodies in the cloud
    this.unitHp = this.units > 1 ? this.maxHp / this.units : this.maxHp;
    this.hitCount = 0;                                    // every fifth hit knocks one loose
    this.raiseCd = d.raises ? randRange(2.2, 3.4) : 0;    // bonewright: until it starts sewing
    this.raiseT = 0;                                      // and how far into the stitching it is
    this.minions = 0;                                     // what it has already raised and lost
    this.summonedBy = opts.summonedBy ?? null;            // skeleton: whose work you are
    this.summoned = !!opts.summoned || !!d.summoned;      // made during the round, not of it
    this.jamCd = 0;
    // ---- the haunt round ---------------------------------------------------
    this.placeT = d.places ? randRange(5, 11) : 0;        // bearer/mourner: until it kneels
    this.placed = false;                                  // ...once per life, and only once
    this.channelT = 0;                                    // the kneeling itself
    this.throwCd = d.throws ? randRange(2, 4.5) : 0;      // snowman/arsonist/witch
    this.throwAnim = 0;                                   // the arm swing you can see coming
    this.zapCd = d.zaps ? randRange(4, 7) : 0;            // shocker
    this.zapping = 0;                                     // gathering: the bolt is coming
    this.dyingT = 0;                                      // wraith: its grave died, fade out
    this.graveUid = opts.graveUid ?? 0;                   // wraith: whose bell rang it out
    this._clangCd = 0;                                    // knight: how often the steel may ring
    // ---- the apiary, the barrow and the web --------------------------------
    this.bowT = d.bows ? randRange(1.8, 3.4) : 0;         // archer: seconds until it draws
    this.drawT = 0;                                        // archer: the draw itself
    this.shieldAng = 0;                                    // bulwark: where the plank points
    this.shieldT = 0;                                      // ...and when it will look again
    this.drumT = d.drums ? randRange(0.6, 1.6) : 0;        // drummer: the next beat
    this.broodT = d.broods ? randRange(2.6, 4.4) : 0;      // porter/mother: the next cluster
    this.spinT = d.spins ? randRange(0.6, 1.2) : 0;        // weaver: the next knot of silk
    this.chargeT = d.charges ? randRange(3.2, 5.2) : 0;    // butcher: the next rush
    this.chargeWind = 0;                                   // butcher: planted, about to go
    this.chargeT2 = 0;                                     // butcher: the rush itself
    this.chargeDir = { x: 1, y: 0 };
    this.summonT = d.summons ? randRange(6, 11) : 0;       // warden/colonel: the next call
    this.revivesLeft = d.reassembles ?? 0;                 // the First: lives after this one
    this.gatherT = 0;                                      // the First: pulling itself back
    this.boss = false;                                     // set by the round, not the type
    this.bossPower = 1;
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
    // A bulwark holds a plank between you and it. The plank turns, slowly,
    // and a shot that lands on it is a fifth of a shot: the answer is to move
    // round it, not to feed it bullets.
    if (this.def.shield) {
      const to = by ? Math.atan2(by.pos.y - this.pos.y, by.pos.x - this.pos.x)
        : (dirAngle ?? 0) + Math.PI;
      const off = Math.abs(Math.atan2(Math.sin(to - this.shieldAng), Math.cos(to - this.shieldAng)));
      if (off < 0.95) {
        amount *= 0.2;
        if ((this._clangCd ?? 0) <= 0) {
          this._clangCd = 0.22;
          audio.clang();
          game.particles.spark(this.pos.x + Math.cos(this.shieldAng) * 8,
            this.pos.y - 8 + Math.sin(this.shieldAng) * 4, this.shieldAng, 6, '#c8d2da');
        }
        this.hp -= amount;
        this.hurtFlash = 0.1;
        if (this.hp <= 0) { this.hp = 0; this.die(game, dirAngle ?? 0); return this.dead ? 2 : 0; }
        return 1;
      }
    }
    // A knight is a wall of plate from the neck down: body shots ring and do
    // half. The head is the only honest way in.
    if (this.def.plate && !head) {
      amount *= 0.5;
      if ((this._clangCd ?? 0) <= 0) {
        this._clangCd = 0.22;
        audio.clang();
        game.particles.spark(this.pos.x, this.pos.y - 9, dirAngle ?? 0, 5, '#cfe0ee');
      }
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
      if (this.hp <= 0) { this.hp = 0; this.die(game, ang); return this.dead ? 2 : 0; }
      return 1;
    }
    // a skeleton has no head to shoot at: the shot lands on the ribs instead
    if (head && this.def.headless) head = false;
    this.hp -= amount;
    this.hurtFlash = 0.12;
    const ang = dirAngle ?? 0;
    // Every fifth hit on the cloud knocks one of the bodies loose, and it
    // starts hunting on its own from wherever it was standing.
    if (this.def.swarm && this.units > 1) {
      this.hitCount++;
      if (this.hitCount % 5 === 0) this._shedUnit(game);
    }
    if (this.def.noBlood) {
      game.particles.dust(this.pos.x, this.pos.y, ang, 6);
      game.particles.chunk(this.pos.x, this.pos.y - 3, ang, 2);
      audio.impact(false, false);
      if (this.hp <= 0) { this.hp = 0; this.die(game, ang); return this.dead ? 2 : 0; }
      this.vel.x += Math.cos(ang) * 26;
      this.vel.y += Math.sin(ang) * 26;
      return 1;
    }
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
      return this.dead ? 2 : 0;
    }
    // flinch
    this.vel.x += Math.cos(ang) * 26;
    this.vel.y += Math.sin(ang) * 26;
    return 1;
  }

  die(game, ang) {
    if (this.dead || this.gatherT > 0) return;
    // The First has been dying since before the house was built. It comes
    // apart, gathers itself, and stands back up -- twice -- and every time it
    // is quicker and it hits harder.
    if (this.revivesLeft > 0 && this.hp <= 0 && !game.__noRevive) {
      this.revivesLeft--;
      this.gatherT = 2.2;
      this.hp = 0;
      this.vel.x = 0; this.vel.y = 0;
      game.particles.dust(this.pos.x, this.pos.y, ang, 16);
      game.particles.chunk(this.pos.x, this.pos.y, ang, 12);
      game.particles.spark(this.pos.x, this.pos.y - 6, randRange(0, TAU), 14, '#efe9d2');
      game.shake?.(3, 0.3);
      audio.zombieDie();
      game.popups?.add?.(this.pos.x, this.pos.y - 34, this.revivesLeft ? 'IT IS NOT DONE' : 'LAST TIME', '#efe9d2', 11);
      return;
    }
    this.dead = true;
    this.state = ZSTATE.DEAD;
    this.deadT = 0;
    if (this.def.noBlood) {
      game.particles.dust(this.pos.x, this.pos.y, ang, 12);
      game.particles.chunk(this.pos.x, this.pos.y, ang, 8);
      game.particles.spark(this.pos.x, this.pos.y - 4, ang, 4, '#e8e4d2');
    } else {
      game.particles.blood(this.pos.x, this.pos.y, ang, 14, 1.4);
      game.particles.chunk(this.pos.x, this.pos.y, ang, 5);
    }
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
    // the sapper's bundle: it kills what is standing next to it, which is
    // usually the rest of the round, and it is why you shoot it early
    if (this.def.sapper) game.sapperBoom?.(this, false);
    // the porter's sac bursts on the way down
    if (this.def.broods) game.spawnBrood?.(this, this.boss ? 3 : 2);
  }

  /** Is there a floor between me and the player who is listening? */
  _muffled(game) {
    return (this.floor ?? 0) !== (game.player?.floor ?? game.map.floor);
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
    this.drummedBy = Math.max(0, (this.drummedBy ?? 0) - dt);
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
      // through a ceiling you still hear them, but only just: the old code
      // went on distance alone, so a walker pacing about directly overhead
      // growled as if it were standing in the room with you
      const v = clamp(1 - d / 520, 0.12, 1) * (this._muffled(game) ? 0.22 : 1);
      if (d < 520) audio.growl(this._muffled(game) ? 0.72 : randRange(0.85, 1.2), v);
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
        // near enough to feel your steps -- or the round is thinning out:
        // once half the horde is gone nobody is allowed to sulk underground,
        // and the last few are not allowed to stall the round either
        if (pd < 58 || game.lastCall || game.hordeThin) {
          this.state = ZSTATE.EMERGE;
          this.emergeT = 0.5;
          game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 10);
          if (!this._muffled(game)) game.shake(1.6, 0.14);
          audio.growl(0.72, this._muffled(game) ? 0.25 : 1);
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
        if (!this._muffled(game)) game.shake(2.4, 0.2);
        game.popups.add(this.pos.x, this.pos.y - 32, 'IT MOVED', '#e07a7a', 11);
        audio.growl(0.7, this._muffled(game) ? 0.25 : 1);
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
      const clear = pt && !this.map.rayWall(this.pos.x, this.pos.y, pt.pos.x, pt.pos.y, Infinity, this.floor);
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

    // ------------------------------------------------- bonewright behaviour --
    // It does not come to you. It stops at its own range, takes out a needle
    // and sews for a second and a half -- and then two skeletons climb out of
    // the dirt beside it. Four is the most it can keep standing at once, so
    // one you ignore stops growing and simply stays a problem. Kill it inside
    // the cycle and the cycle is wasted.
    if (this.def.raises) {
      if (this.raiseT > 0) {
        this.vel.x = 0; this.vel.y = 0;
        this.stuck = 0;
        this._goto = null;
        this.raiseT -= dt;
        if (Math.random() < dt * 7) {
          game.particles.spark(this.pos.x + randRange(-7, 7), this.pos.y - randRange(4, 18),
            -Math.PI / 2, 1, '#cfc9b4');
        }
        if (this.raiseT <= 0) { this.raiseT = 0; this._raiseTwo(game); }
        return;
      }
      this.raiseCd -= dt;
      // not while it is busy at a barricade, and not from another storey
      if (this.raiseCd <= 0 && sameFloor && pd < 640
        && this.state !== ZSTATE.BARRICADE && this.state !== ZSTATE.DOOR) {
        this.raiseT = 1.6;
        this.raiseCd = randRange(7.5, 10.5);
        if (!this._muffled(game)) audio.growl(0.7, 0.7);
      }
      // Keep its distance properly: back away when you crowd it, come in when
      // you have run off, and sidle round you in between so it is never a
      // statue.
      this._vantageTick(dt, game, p, pd, sameFloor);
    }

    // Everything else that wants to stay out of arm's reach: the archer at
    // three hundred, the organist, the beekeeper, the bearer, the mourner.
    // They used to walk straight into your face and then stand there doing
    // their one trick -- a thing that only works at range -- into your chest.
    if (!this.def.raises && (this.def.places && !this.placed || this.def.bows || this.def.shrieksHard)
      && this.channelT <= 0 && this.drawT <= 0) {
      this._vantageTick(dt, game, p, pd, sameFloor);
    }

    // ------------------------------------------------- jammer behaviour -----
    // The wireless set on its back takes your markers away while it is close:
    // the minimap, the machines, the prices on the doors, and the crosshair
    // telling you that you are on target. The guns still work. So do your ears.
    if (this.def.jams) {
      this.jamCd = Math.max(0, this.jamCd - dt);
      if (sameFloor && pd < JAM_RADIUS && this.state !== ZSTATE.CLIMB) game.jam?.(10, this);
    }

    // ------------------------------------------- the haunt round: seven of them
    // A wraith whose grave is gone loses its shape and stops being a problem.
    if (this.dyingT > 0) {
      this.dyingT -= dt;
      this.vel.x *= 0.86; this.vel.y *= 0.86;
      if (Math.random() < dt * 5) game.particles.spark(this.pos.x, this.pos.y - 8, randRange(0, TAU), 1, '#cfe0ee');
      if (this.dyingT <= 0) { this.hp = 0; this.die(game, randRange(0, TAU)); }
      return;
    }
    this._clangCd = Math.max(0, (this._clangCd ?? 0) - dt);

    // Bearer / Mourner: keeps its distance (the standoff vantage code above),
    // and once in its life it stops, kneels for a second and a half, and
    // leaves something behind that has to be shot.
    if (this.def.places && !this.placed) {
      if (this.channelT > 0) {
        this.channelT -= dt;
        this.vel.x = 0; this.vel.y = 0;
        if (Math.random() < dt * 10) {
          game.particles.spark(this.pos.x + randRange(-9, 9), this.pos.y - 2,
            -Math.PI / 2, 1, this.def.places === 'totem' ? '#b07ae0'
            : this.def.places === 'hive' ? '#e0b04a' : '#8a8371');
        }
        if (this.channelT <= 0) {
          // placeHaunt says false when the house already has one of these:
          // the bundle goes back on its shoulder and it tries again later
          this.placed = game.placeHaunt(this) !== false;
          if (!this.placed) this.placeT = randRange(8, 14);
        }
        return;
      }
      this.placeT -= dt;
      // A hive goes down close: a keeper that walked all the way to you and
      // then put a box at your feet was leaving it where it would be shot
      // before it hummed once. Sixty is close enough to matter and far enough
      // to see.
      const near = this.def.places === 'hive' ? 60 : 150;
      if (this.placeT <= 0 && sameFloor && pd > near && pd < 520 && this.state === ZSTATE.HUNT) {
        this.channelT = 1.5;
        audio.growl(0.58, this._muffled(game) ? 0.3 : 0.9);
        const verb = this.def.places === 'totem' ? 'IT KNEELS'
          : this.def.places === 'hive' ? 'IT SETS THE BOX DOWN' : 'IT DIGS';
        game.popups?.add?.(this.pos.x, this.pos.y - 36, verb,
          this.def.places === 'hive' ? '#e0b04a' : '#b07ae0', 11);
        return;
      }
    }

    // Snowman / Arsonist / Witch: the arm comes back, then something flies.
    if (this.def.throws) {
      this.throwAnim = Math.max(0, this.throwAnim - dt);
      this.throwCd -= dt;
      if (this.throwCd <= 0 && sameFloor && pd > 70 && pd < 520 && this.state !== ZSTATE.CLIMB) {
        const snow = this.def.throws === 'snow';
        this.throwCd = randRange(snow ? 2.8 : 3.6, snow ? 5 : 6.4);
        this.throwAnim = 0.4;
        game.throwZombieProjectile(this, p, this.def.throws);
      }
    }

    // Shocker: it stops dead, the light climbs the rod for three quarters of
    // a second -- that is your window to shoot it -- and then the bolt goes.
    if (this.def.zaps) {
      if (this.zapping > 0) {
        this.zapping -= dt;
        this.vel.x = 0; this.vel.y = 0;
        if (this.zapping <= 0) {
          this.zapCd = randRange(9, 14);
          if (sameFloor && pd < 470) game.zapPlayer(this, p);
        }
        return;
      }
      this.zapCd -= dt;
      if (this.zapCd <= 0 && sameFloor && pd > 90 && pd < 430 && this.state !== ZSTATE.CLIMB) {
        this.zapping = 0.75;
        audio.zapCharge?.(this._muffled(game) ? 0.3 : 0.8);
      }
    }

    // ------------------------------------------------- the apiary and the web
    // ---- the First, between lives: it is a heap of bones until it stands up
    if (this.gatherT > 0) {
      this.gatherT -= dt;
      this.vel.x *= 0.7; this.vel.y *= 0.7;
      if (Math.random() < dt * 12) {
        game.particles.spark(this.pos.x + randRange(-8, 8), this.pos.y - randRange(0, 14),
          -Math.PI / 2, 1, '#e8e4d2');
      }
      if (this.gatherT <= 0) {
        this.hp = this.maxHp * 0.8;
        this.hurtFlash = 0;
        this.bossPower *= 1.25;
        this.baseSpeed *= 1.18;
        this.dmgMul = (this.dmgMul ?? 1) * 1.1;
        game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 12);
        game.particles.chunk(this.pos.x, this.pos.y - 6, randRange(0, TAU), 8);
        game.shake?.(4, 0.3);
        audio.growl?.(0.6, 0.9);
        game.popups?.add?.(this.pos.x, this.pos.y - 34, 'IT STANDS', '#efe9d2', 11);
      }
      return;
    }

    // ---- the archer: a long, visible draw, then three arrows --------------
    if (this.def.bows) {
      if (this.drawT > 0) {
        this.drawT -= dt;
        this.vel.x = 0; this.vel.y = 0;
        this.stuck = 0;
        if (this.drawT <= 0) game.archerVolley?.(this, p);
        return;
      }
      this.bowT -= dt;
      if (this.bowT <= 0 && sameFloor && pd > 120 && pd < 520 && this.state === ZSTATE.HUNT) {
        this.drawT = 1.1;
        game.popups?.add?.(this.pos.x, this.pos.y - 34, 'DRAW', '#cfc9b4', 9);
      }
      return;
    }

    // ---- the bulwark: the plank follows you, but it is heavy --------------
    if (this.def.shield) {
      this.shieldT -= dt;
      if (sameFloor && this.shieldT <= 0) {
        this.shieldT = 0.34;
        this.shieldAng = Math.atan2(p.pos.y - this.pos.y, p.pos.x - this.pos.x);
      }
    }

    // ---- the drummer: everything dead in earshot walks to its beat --------
    if (this.def.drums) {
      this.drumT -= dt;
      if (this.drumT <= 0) {
        this.drumT = 2;
        game.shriekRings.push({
          x: this.pos.x, y: this.pos.y, r: 10, max: 300, life: 0.6, maxLife: 0.6,
          f: this.floor ?? game.map.floor, colour: '#d08a5a',
        });
        audio.drum?.(0.7);
        let n = 0;
        for (const z of game.zombies) {
          if (z === this || z.dead) continue;
          if (dist2(this.pos.x, this.pos.y, z.pos.x, z.pos.y) > 300 * 300) continue;
          z.drummedBy = 2.4;
          n++;
        }
        if (n && !this._muffled(game)) game.popups?.add?.(this.pos.x, this.pos.y - 30, `BEAT x${n}`, '#d08a5a', 9);
      }
    }

    // ---- the weaver: knots of silk on the floor behind it ------------------
    if (this.def.spins) {
      this.spinT -= dt;
      if (this.spinT <= 0) {
        this.spinT = randRange(0.9, 1.5);
        const moved = this.vel.x * this.vel.x + this.vel.y * this.vel.y > 220;
        if (moved) game.addThread?.(this.pos.x, this.pos.y, this.floor ?? game.map.floor);
      }
    }

    // ---- the sapper: it wants to be next to you ---------------------------
    if (this.def.sapper && sameFloor && pd < 30) {
      game.sapperBoom?.(this, true);
      return;
    }

    // ---- a porter sets its brood down every few seconds -------------------
    if (this.def.broods) {
      this.broodT -= dt;
      if (this.broodT <= 0) {
        this.broodT = this.boss ? randRange(3.4, 5) : randRange(5.5, 8);
        const live = game.zombies.reduce((n, z) => n + (!z.dead && z.summonedBy === this.id ? 1 : 0), 0);
        if (live < (this.boss ? 8 : 5)) game.spawnBrood?.(this, this.boss ? 3 : 2);
      }
    }

    // ---- the butcher: plant the feet, then cross the room in a line --------
    if (this.def.charges) {
      if (this.chargeT2 > 0) {
        this.chargeT2 -= dt;
        if (this.chargeT2 <= 0) this.chargeT = randRange(5, 7);
      } else if (this.chargeWind > 0) {
        this.chargeWind -= dt;
        this.vel.x = 0; this.vel.y = 0;
        this.chargeDir = { x: p.pos.x - this.pos.x, y: p.pos.y - this.pos.y };
        const l = Math.hypot(this.chargeDir.x, this.chargeDir.y) || 1;
        this.chargeDir.x /= l; this.chargeDir.y /= l;
        if (this.chargeWind <= 0) { this.chargeT2 = 0.85; audio.growl?.(0.5, 0.9); }
        return;
      } else {
        this.chargeT -= dt;
        if (this.chargeT <= 0 && sameFloor && pd > 70 && pd < 420) {
          this.chargeWind = 0.7;
          game.popups?.add?.(this.pos.x, this.pos.y - 38, 'IT PLANTS ITS FEET', '#e0896a', 10);
          audio.drum?.(0.5);
          return;
        }
      }
    }

    // ---- the organist sings: a ring that staggers you and hastes the rest --
    if (this.def.shrieksHard) {
      this.shriekCd -= dt;
      if (this.shriekCd <= 0 && sameFloor && pd < 430) {
        this.shriekCd = randRange(6.5, 8.5);
        game.bossShock?.(this, 230);
      }
    }

    // ---- the warden and the colonel call the others in --------------------
    if (this.def.summons) {
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = this.boss ? randRange(11, 15) : randRange(16, 22);
        game.bossSummon?.(this);
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
          // the widow's bite keeps working after it has let go
          if (this.def.venom) p.poison?.(game);
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
    // a charge is a straight line and the walls are the brake
    if (this.chargeT2 > 0) {
      tx = this.pos.x + this.chargeDir.x * 260;
      ty = this.pos.y + this.chargeDir.y * 260;
    }

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
    // the drummer's beat: a fifth more legs, for everybody but the drummer
    if (this.drummedBy > 0) speed *= 1.2;
    // and the butcher does not walk, it arrives
    if (this.chargeT2 > 0) speed = this.baseSpeed * 3.2;
    // while a totem hums, the whole horde's hair stands up: faster, bolder,
    // and the windows come apart a third quicker
    if (game.totemPower) { speed *= 1.18; this.dmgMul *= 1.15; }

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

  /**
   * Pick a spot at arm's length and hold it.
   *
   * It picks a vantage and holds it for the better part of a second. That
   * matters: choosing fresh every frame flips between "back off" and the
   * horde's own route in the same breath, and the two cancel out into a thing
   * vibrating against a wall. A straight line through a partition is given up
   * in favour of the next idea, and if none of them are open the horde's route
   * takes over -- the trick the field medic uses.
   */
  _vantageTick(dt, game, p, pd, sameFloor) {
    this._vantageT = (this._vantageT ?? 0) - dt;
    if (this._vantageT <= 0 || this.stuck > 1) {
      this._vantageT = 0.7;
      this._vantage = null;
      if (sameFloor && pd < 640) {
        const away = Math.atan2(this.pos.y - p.pos.y, this.pos.x - p.pos.x);
        const clear = (x, y) => !this.map.rayWall(this.pos.x, this.pos.y, x, y, Infinity, this.floor);
        if (pd < this.standoff - 40) {
          for (const r of [140, 90, 60]) {
            const c = { x: this.pos.x + Math.cos(away) * r, y: this.pos.y + Math.sin(away) * r };
            if (clear(c.x, c.y)) { this._vantage = c; break; }
          }
        } else if (pd < this.standoff + 90) {
          // circle rather than stand and grin: try one side, then the other
          for (const side of [0.85, -0.85, 1.7, -1.7]) {
            const a = away + side;
            const c = { x: p.pos.x + Math.cos(a) * this.standoff, y: p.pos.y + Math.sin(a) * this.standoff };
            if (clear(c.x, c.y)) { this._vantage = c; break; }
          }
        }
      }
    }
    this._goto = this._vantage ?? null;
  }

  /** A scream that hastes and hardens every zombie in earshot. */
  shriek(game) {
    audio.shriek();
    game.shriekRings.push({
      x: this.pos.x, y: this.pos.y, r: 8, max: 230, life: 0.75, maxLife: 0.75,
      f: this.floor ?? game.map.floor,
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
    b.hurt += dt * this.chewMul * (game.totemPower ? 1.3 : 1);
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
    // Something sewn out of the dirt, or a piece that came off a swarm, is not
    // one of the round's own: queueing it would quietly hand the round a spare
    // walker to spend somewhere else.
    if (!this.summoned) game.respawnQueue++;
    game.particles.dust(this.pos.x, this.pos.y, randRange(0, TAU), 6);
  }

  /** Pick the sprite set for this enemy's type / pose / facing. */
  _set(art, attacking, flip) {
    let s = this.def.set;
    // the cloud is drawn as a cluster of bodies, never as one sprite; this is
    // only the fallback so the shared draw path still has an image to hold
    if (s === 'swarmling') s = 'swarmlet';
    if (s === 'dog') {
      const trot = Math.floor(this.walkPhase * 2) % 2;
      const frames = flip ? art.dogFramesFlip : art.dogFrames;
      const img = frames?.[trot] ?? (flip ? art.dogFlip : art.dog);
      return { img, framed: false };
    }
    if (s === 'bee') {
      // two wing beats, and it hangs above the floor like the insect it is
      const beat = Math.floor(this.walkPhase * 4) % 2;
      const frames = flip ? art.beeFlip : art.bee;
      return { img: frames?.[beat] ?? art.bee?.[0], framed: false };
    }
    if (s === 'weaver' || s === 'widow' || s === 'porter') {
      // the spiders trot: two leg poses, and nothing else about them animates
      const trot = Math.floor(this.walkPhase * 2) % 2;
      const frames = flip ? art[`${s}Flip`] : art[s];
      return { img: frames?.[trot] ?? frames?.[0], framed: false };
    }
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
      || s === 'miner' || s === 'medic' || s === 'fusion'
      || s === 'bonewright' || s === 'skeleton' || s === 'jammer' || s === 'swarmlet'
      || s === 'bearer' || s === 'mourner' || s === 'wraith' || s === 'snowman'
      || s === 'arsonist' || s === 'witch' || s === 'shocker' || s === 'knight'
      || s === 'beekeeper' || s === 'archer' || s === 'bulwark' || s === 'drummer'
      || s === 'sapper' || s === 'first' || s === 'warden' || s === 'organist'
      || s === 'butcher' || s === 'queen' || s === 'gravedigger'
      || s === 'bellringer' || s === 'colonel') {
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

  /**
   * Somewhere beside this body to put a newly made one: open ground, on this
   * storey, that the horde's own route can actually reach.
   *
   * It matters more than it looks. A skeleton dropped the far side of a
   * partition is not a threat, it is a round that will never end: it can
   * neither reach you nor be reached, and the tally sits and waits on it for
   * ever. Nothing gets made unless there is somewhere sensible to put it.
   */
  _besideOpen(minR, maxR) {
    for (let i = 0; i < 14; i++) {
      const a = randRange(0, TAU);
      const r = randRange(minR, maxR);
      const x = this.pos.x + Math.cos(a) * r;
      const y = this.pos.y + Math.sin(a) * r;
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (!this.map.inside(tx, ty)) continue;
      if (this.map.solidTileOn(this.floor, tx, ty)) continue;
      // the flow field is built for the storey the map is currently on, so
      // only trust it when that is the one we are standing on
      if (this.floor === this.map.floor && this.map.dist) {
        const d = this.map.dist[ty * this.map.w + tx];
        if (d === undefined || d >= 1e8) continue;
      }
      return { x: (tx + 0.5) * T, y: (ty + 0.5) * T };
    }
    return null;
  }

  /**
   * Two skeletons climb out of the dirt beside it. They are not part of the
   * round's tally, so the round cannot end while any of them are still up --
   * which is the whole point of the thing.
   */
  _raiseTwo(game) {
    const plan = game.roundPlan ? game.roundPlan(game.round) : null;
    const live = () => game.zombies.reduce(
      (n, z) => n + (!z.dead && z.summonedBy === this.id ? 1 : 0), 0);
    let made = 0;
    for (let i = 0; i < 2; i++) {
      if (live() >= MAX_SKELETONS) break;
      const spot = this._besideOpen(26, 46);
      if (!spot) break;                  // nowhere to put one: the cycle is wasted
      const { x, y } = spot;
      const ang = Math.atan2(y - this.pos.y, x - this.pos.x);
      const s = new Zombie(this.map, x, y, {
        type: 'skeleton',
        speed: (plan?.speed ?? 34) * randRange(0.95, 1.1),
        dmg: 34,
        summonedBy: this.id,
      });
      s.floor = this.floor;
      // it climbs out of the ground rather than simply appearing
      s.state = ZSTATE.EMERGE;
      s.emergeT = 0.5;
      s.lunge = 1;
      game.zombies.push(s);
      game.particles.dust(x, y, ang, 9);
      made++;
    }
    if (made) {
      game.particles.spark(this.pos.x, this.pos.y - 6, -Math.PI / 2, 6, '#e8e4d2');
      if (!this._muffled(game)) {
        game.popups.add(this.pos.x, this.pos.y - 34, 'IT SEWS', '#cfc9b4', 10);
        audio.wood(false, 0.8);
      }
    }
  }

  /**
   * A body comes off the cloud and starts hunting on its own, taking its share
   * of the pool with it -- so a swarm you have been chipping at has less left
   * in the middle than a fresh one. Dying to a swarm is letting it do this
   * seven times.
   */
  _shedUnit(game) {
    if (this.units <= 1) return;
    const spot = this._besideOpen(9, 18);
    if (!spot) return;                   // wedged in a corner: it stays in the pile
    const { x, y } = spot;
    const ang = Math.atan2(y - this.pos.y, x - this.pos.x);
    const share = this.unitHp;
    this.units--;
    this.maxHp = Math.max(1, this.maxHp - share);
    this.hp = Math.min(this.hp, this.maxHp);
    const plan = game.roundPlan ? game.roundPlan(game.round) : null;
    const s = new Zombie(this.map, x, y, {
      type: 'swarmlet',
      summoned: true,
      hp: share / (ENEMY_TYPES.swarmlet.hp || 1),
      speed: (plan?.speed ?? 34) * randRange(0.92, 1.08),
      dmg: 34,
    });
    s.floor = this.floor;
    s.lunge = 1;
    game.zombies.push(s);
    game.particles.dust(x, y, ang, 5);
    game.particles.chunk(x, y, ang, 2);
  }

  /**
   * The cloud: one small body for every unit still in it, jostling against
   * each other. You can count them -- which is the point, because every fifth
   * hit takes one off the pile and sets it running at you on its own.
   */
  _drawCluster(ctx, px, py, t) {
    const n = Math.max(1, this.units);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.7 + this.id * 0.7;
      const rr = 5 + (i % 3) * 2.2;
      const x = px + Math.cos(a) * rr + Math.sin(t * 7 + i * 2) * 1.1;
      const y = py + Math.sin(a) * rr * 0.6 + Math.cos(t * 6 + i) * 0.9;
      ctx.strokeStyle = '#241a12';
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const la = a + (k - 1) * 0.9 + Math.sin(t * 9 + i + k) * 0.25;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(la) * 5.5, y + Math.sin(la) * 4 + 2);
        ctx.stroke();
      }
      ctx.fillStyle = i % 2 ? '#5c4632' : '#4a3a2c';
      ctx.beginPath(); ctx.ellipse(x, y, 3.4, 2.6, a, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a6248';
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 2.2, y + Math.sin(a) * 1.4, 1.7, 1.4, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
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
    // A wraith is a rumour of a body: everything it draws goes through one
    // alpha, and as its grave's death fades it, the rumour fades with it.
    if (this.def.ghostly) {
      const a = this.dyingT > 0
        ? Math.min(0.42, (this.dyingT / 2.6) * 0.42)
        : 0.34 + Math.sin(t * 2.4 + this.id) * 0.08;
      ctx.save();
      ctx.globalAlpha = a;
      this._drawBody(ctx, art, t);
      ctx.restore();
      return;
    }
    this._drawBody(ctx, art, t);
  }

  _drawBody(ctx, art, t = 0) {
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
    const { img, framed } = this._set(art, attacking, flip);
    const gx = px - SPRITE_OX;
    // The dog is drawn in its own little 18x12 frame, not in the 20x22 human
    // one: hanging it from the human shoulder line left it floating a hand's
    // width above its own shadow. A body in its own frame is centred on the
    // entity instead, which puts the paws back on the ground.
    const gy = framed
      ? py - SPRITE_OY - (attacking ? 1 : 0)
      : py - img.height / 2;

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
    if (this.def.swarm) this._drawCluster(ctx, px, py, t);
    else ctx.drawImage(img, gx, gy);
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
    if (this.def.raises) {
      // the ring of disturbed earth it works inside, and the needle itself
      ctx.save();
      ctx.globalAlpha = this.raiseT > 0 ? 0.5 : 0.22;
      ctx.strokeStyle = '#cfc9b4';
      ctx.lineWidth = 1;
      const rr = 15 + (this.raiseT > 0 ? Math.sin(t * 11) * 2.5 : 0);
      ctx.beginPath(); ctx.ellipse(px, py + 4, rr, rr * 0.42, 0, 0, TAU); ctx.stroke();
      if (this.raiseT > 0) {
        // the thread being pulled: it grows as the cycle runs out
        const k = 1 - this.raiseT / 1.6;
        ctx.translate(px + (flip ? -6 : 6), py - 12);
        ctx.rotate(Math.sin(t * 15) * 0.6);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#e8e4d2';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6); ctx.stroke();
        ctx.globalAlpha = 0.35 + k * 0.6;
        ctx.strokeStyle = '#9fd0e0';
        ctx.beginPath(); ctx.moveTo(0, 6);
        for (let i = 1; i <= 4; i++) ctx.lineTo(Math.sin(i * 2 + t * 9) * 3, 6 + i * 3.1);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.def.jams) {
      // the set on its back, with the noise leaking off the aerial
      const ax = px + (flip ? 5 : -5);
      const ay = py - SPRITE_OY + 5;
      ctx.save();
      ctx.fillStyle = '#2b333d';
      ctx.fillRect(ax - 2.5, ay, 5, 7);
      ctx.strokeStyle = '#8fa8bd';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (flip ? 3 : -3), ay - 12); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(t * 17 + this.id) * 0.25;
      ctx.fillStyle = '#9fd0e0';
      ctx.beginPath(); ctx.arc(ax + (flip ? 3 : -3), ay - 13, 1.6, 0, TAU); ctx.fill();
      for (let i = 0; i < 2; i++) {
        const rr2 = 6 + i * 6 + ((t * 22 + i * 3) % 8);
        ctx.globalAlpha = Math.max(0, 0.3 - rr2 * 0.018);
        ctx.beginPath(); ctx.arc(ax + (flip ? 3 : -3), ay - 13, rr2, 0, TAU); ctx.stroke();
      }
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

    // ---- the haunt round: what each of them carries ------------------------
    if (this.def.places && !this.placed) {
      // the bundle on its back: a totem wrapped in rope, or a spade
      ctx.save();
      const bx = px + (flip ? 5 : -5), by = py - 16 * sc;
      ctx.translate(bx, by);
      ctx.rotate(flip ? 0.5 : -0.5);
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(-1.2, -11, 2.4, 15);
      if (this.def.places === 'totem') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + Math.sin(t * 3 + this.id) * 0.25;
        ctx.fillStyle = '#b07ae0';
        ctx.beginPath(); ctx.arc(0, -12, 3.1, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#8a8f98';
        ctx.fillRect(-3.4, -13, 6.8, 3.4);
      }
      ctx.restore();
    }
    if (this.channelT > 0) {
      // kneeling: a ring of intent on the floor, colour of what is coming
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + Math.sin(t * 9) * 0.2;
      ctx.strokeStyle = this.def.places === 'totem' ? '#b07ae0' : '#9fb4c8';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(px, py + 2, 13, 6, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (this.def.throws) {
      const snow = this.def.throws === 'snow';
      const ready = snow ? this.throwCd < 1.2 : this.throwCd < 1.0;
      const hx = px + (flip ? -7 : 7), hy = py - 11 * sc;
      if (ready || this.throwAnim > 0) {
        ctx.save();
        if (snow) {
          ctx.fillStyle = '#f2f8fc';
          ctx.beginPath(); ctx.arc(hx, hy - (this.throwAnim > 0 ? 3 : 0), 2.6, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = this.def.throws === 'bottle' ? '#5a3a20' : '#2e4a2a';
          ctx.fillRect(hx - 1.2, hy - 3.4, 2.4, 5.4);
          ctx.fillStyle = this.def.throws === 'bottle' ? '#d0703a' : '#7ac050';
          ctx.fillRect(hx - 1.2, hy - 1.4, 2.4, 2.4);
          if (this.def.throws === 'bottle') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = '#f0a040';
            ctx.globalAlpha = 0.7 + Math.sin(t * 24) * 0.3;
            ctx.beginPath(); ctx.arc(hx, hy - 4.6, 1.8, 0, TAU); ctx.fill();
          }
        }
        ctx.restore();
      }
      if (snow) {
        // it is cold standing next to it: a faint rime on the floor
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.10 + Math.sin(t * 2 + this.id) * 0.04;
        ctx.fillStyle = '#9fd0f0';
        ctx.beginPath(); ctx.ellipse(px, py + 2, 12, 5, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    if (this.def.zaps) {
      const hx = px + (flip ? -6 : 6), hy = py - 13 * sc;
      // the rod: always there, and during the gather the light climbs it
      ctx.save();
      ctx.strokeStyle = '#6a7a88';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx, hy + 9); ctx.lineTo(hx, hy - 8); ctx.stroke();
      if (this.zapping > 0) {
        const k = 1 - this.zapping / 0.75;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#bfe0ff';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const a = t * 22 + i * 2.1;
          ctx.globalAlpha = 0.45 + k * 0.45;
          ctx.beginPath();
          ctx.moveTo(hx, hy - 8);
          ctx.lineTo(hx + Math.cos(a) * (3 + k * 5), hy - 8 + Math.sin(a) * (3 + k * 5));
          ctx.stroke();
        }
        ctx.globalAlpha = 0.35 + k * 0.5;
        ctx.fillStyle = '#dff0ff';
        ctx.beginPath(); ctx.arc(hx, hy - 9, 1.6 + k * 2.4, 0, TAU); ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + Math.sin(t * 5 + this.id) * 0.12;
        ctx.fillStyle = '#9fd0ff';
        ctx.beginPath(); ctx.arc(hx, hy - 9, 1.6, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (this.def.plate) {
      // the breastplate: a slab of old steel with a dint for every fight
      ctx.save();
      const cy2 = py - 9 * sc;
      ctx.fillStyle = '#5d6a72';
      ctx.beginPath(); ctx.ellipse(px, cy2, 6.4 * sc, 8 * sc, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#78868f';
      ctx.beginPath(); ctx.ellipse(px + (flip ? -1.4 : 1.4), cy2 - 1, 4.6 * sc, 6 * sc, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#aebcc6';
      ctx.fillRect(px + (flip ? -4 : 1), cy2 - 5 * sc, 3, 1.4);
      // pauldrons
      ctx.fillStyle = '#4d5a62';
      ctx.beginPath(); ctx.ellipse(px - 6.4 * sc, cy2 - 5, 2.8, 2.2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px + 6.4 * sc, cy2 - 5, 2.8, 2.2, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (this.type === 'wraith') {
      // the sabre: a line of cold light in the hand, and a wisp trailing
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hx = px + (flip ? -8 : 8), hy = py - 10;
      ctx.strokeStyle = '#dff0ff';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 4);
      ctx.quadraticCurveTo(hx + (flip ? -5 : 5), hy - 4, hx + (flip ? -3 : 3), hy - 11);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#cfe0ee';
      ctx.beginPath(); ctx.ellipse(px - (flip ? -1 : -1) * 4, py + 1, 7, 3, 0, 0, TAU); ctx.fill();
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
  constructor(x, y, vx, vy, def, floor = 0) {
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
    this.def = def;
    this.floor = floor;     // it only distracts the dead on its own storey
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
    if (game.map.solidTileOn(this.floor, Math.floor(nx / T), Math.floor(this.pos.y / T))) this.vel.x *= -0.45;
    else this.pos.x = nx;
    if (game.map.solidTileOn(this.floor, Math.floor(this.pos.x / T), Math.floor(ny / T))) this.vel.y *= -0.45;
    else this.pos.y = ny;
  }

  explode(game) {
    if (this.remove) return;
    this.remove = true;
    const d = this.def;
    game.explodeAt(this.pos.x, this.pos.y, d.boomR ?? 150, d.boomDmg ?? 3000,
      { colour: '#ffd45c', fromPlayer: true, blast: true, floor: this.floor, owner: this.owner });
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
  constructor(x, y, vx, vy, floor = 0, owner = null) {
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
    this.floor = floor;     // it rolls on, and blows up on, the storey it was thrown from
    this.owner = owner;     // who gets the credit (and whose Demo skill widens it)
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
    const fx = this.owner?.skillFx ?? NO_SKILLS;
    // Demolitionist: the same frag, a wider ring and a little more bite
    const R = 96 * (fx.blastR ?? 1);
    game.explosion(x, y, R);
    game.hurtHaunts?.(x, y, R, 300, this.floor ?? 0);
    let killed = 0;
    for (const z of game.zombies) {
      if (z.dead || (z.floor ?? 0) !== (this.floor ?? 0)) continue;
      const d = dist(x, y, z.pos.x, z.pos.y);
      if (d > R) continue;
      if (game.tryCrawl(z, 0.30)) continue;         // blast takes the legs
      const k = 1 - d / R;
      const ang = Math.atan2(z.pos.y - y, z.pos.x - x);
      const boom = (420 + game.round * 55) * (fx.blastDmgMul ?? 1) * (k * k * 0.75 + k * 0.25);
      if (z.hurt(boom, false, game, ang) === 2) { game.onZombieKilled(z, false, null, 'grenade'); killed++; }
      z.vel.x += Math.cos(ang) * 180 * k;
      z.vel.y += Math.sin(ang) * 180 * k;
    }
    if (killed) {
      game.stats.grenadeBest = Math.max(game.stats.grenadeBest ?? 0, killed);
      if (killed >= 5) game.achievements.unlock('frag_out');
    }
    game.particles.spark(x, y, 0, 26, '#ffcf7a');
    game.particles.smoke(x, y, 16);
    game.particles.chunk(x, y, randRange(0, TAU), 8);
    if (game.player.perkFx.webs) {
      for (const z of game.zombies) {
        if (z.dead || (z.floor ?? 0) !== (this.floor ?? 0)) continue;
        if (dist(x, y, z.pos.x, z.pos.y) < R * 1.2) z.webbed = Math.max(z.webbed, 5);
      }
      game.webBlasts.push({ x, y, r: R, life: 0.7, max: 0.7, f: this.floor ?? game.map.floor });
    }
  }
}

export function throwGrenade(game, px, py, aim, speed = 380, floor, owner = null) {
  const g = new Grenade(px, py, Math.cos(aim) * speed, Math.sin(aim) * speed,
    floor ?? game.player?.floor ?? game.map.floor, owner ?? game.player ?? null);
  game.grenades.push(g);
}
