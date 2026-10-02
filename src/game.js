// Game state: rounds, spawning, interactions, camera and the frame renderer.
import { T, buildArt } from './art.js';
import { GameMap } from './map.js';
import {
  Player, Zombie, Particles, Popups, throwGrenade, MonkeyBomb, HEAD_OFF_Y, ENEMY_TYPES,
} from './entities.js';
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, GRENADE_MAX, PAP_PRICE, defFor } from './weapons.js';
import { PERKS } from './perks.js';
import { MysteryBox } from './mysterybox.js';
import { Powerup, rollPowerup } from './powerups.js';
import { Workbench, RECIPES, RECIPE_ORDER } from './crafting.js';
import { Achievements, EasterEgg, submitScore } from './achievements.js';
import { Traps, TRAP_PRICE } from './traps.js';
import { Lighting, drawVignette } from './lighting.js';
import { HUD, drawTitle, drawPause, drawGameOver } from './hud.js';
import { audio } from './audio.js';
import {
  clamp, lerp, damp, dist, dist2, randRange, randInt, TAU, pointSegDist2,
} from './util.js';

export const VW = 800;
export const VH = 500;

const POINTS_HIT = 10;
const POINTS_KILL = 60;
const POINTS_HEAD = 40;
const POINTS_PLANK = 10;
const SALVAGE_DROP = 0.16;      // chance a kill drops salvage

const MAX_ALIVE_BASE = 24;
const DOG_ROUND_EVERY = 5;      // every 5th round is a hellhound round

/** '#rrggbb' -> 'rgba(r,g,b,a)' */
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Ceiling lamps, bunker floodlights and machine glows.
 * `mains: true` fixtures only burn once the generator is running.
 */
const LAMPS = [
  // room A
  { x: 16, y: 12, mains: true }, { x: 23, y: 12, mains: true }, { x: 19, y: 16, mains: true },
  // room B
  { x: 33, y: 12, mains: true }, { x: 41, y: 12, mains: true }, { x: 36, y: 16, mains: true },
  // room C
  { x: 16, y: 24, mains: true }, { x: 23, y: 24, mains: true }, { x: 19, y: 28, mains: true },
  // room D
  { x: 33, y: 24, mains: true }, { x: 41, y: 24, mains: true }, { x: 36, y: 28, mains: true },
  // radio room + shed
  { x: 53, y: 5, mains: true }, { x: 59, y: 6, mains: true }, { x: 56, y: 17, mains: true },
  // cellar
  { x: 8, y: 36, mains: true }, { x: 12, y: 38, mains: true },
  // secret vault
  { x: 66, y: 20, mains: true },
  // exterior floods -- always on, they run off the truck battery
  { x: 10, y: 24 }, { x: 47, y: 24 }, { x: 61, y: 30 }, { x: 20, y: 32 },
].map((l) => ({
  x: (l.x + 0.5) * T, y: (l.y + 0.5) * T,
  phase: Math.random() * TAU, flick: 1, mains: !!l.mains,
}));

export class Game {
  constructor(input) {
    this.input = input;
    this.vw = VW;
    this.vh = VH;
    this.map = new GameMap();
    this.art = buildArt();
    this.lighting = new Lighting(VW, VH, 0.5);
    this.hud = new HUD();
    this.achievements = new Achievements();

    this.decals = document.createElement('canvas');
    this.decals.width = this.map.w * T;
    this.decals.height = this.map.h * T;
    this.decalCtx = this.decals.getContext('2d');

    this.reset();
  }

  reset() {
    this.map = new GameMap();
    this.decalCtx.clearRect(0, 0, this.decals.width, this.decals.height);
    this.player = new Player(this.map, this.map.playerStart.x, this.map.playerStart.y);
    this.player.game = this;
    this.player.salvage = 0;
    this.player.medkits = 0;
    this.player.armor = 0;
    this.player.crafted = {};
    this.zombies = [];
    this.grenades = [];
    this.monkeys = [];
    this.powerups = [];
    this.webBlasts = [];
    this.arcs = [];
    this.shriekRings = [];
    this.traps = new Traps();
    this.particles = new Particles();
    this.popups = new Popups();
    this.tracers = [];
    this.flashLights = [];
    this.explosionLights = [];

    this.time = 0;
    this.round = 0;
    this.points = 500;
    this.zombiesTotal = 0;
    this.zombiesSpawned = 0;
    this.zombiesKilled = 0;
    this.respawnQueue = 0;
    this.spawnTimer = 0;
    this.intermission = 3.0;
    this.roundActive = false;
    this.started = false;
    this.paused = false;
    this.gameOver = false;
    this.overT = 0;
    this.banner = null;
    this.interaction = null;
    this.muzzleFlash = null;
    this.shakeMag = 0;
    this.shakeT = 0;
    this.shakeMax = 0.001;
    this.cam = { x: 0, y: 0 };
    this.flowTimer = 0;
    this.heartTimer = 0;
    this.deathFade = 0;

    this.stats = {
      round: 0, kills: 0, headshots: 0, points: 0, shots: 0, hits: 0, planks: 0, doors: 0,
    };

    // --- systems ---------------------------------------------------------
    this.powerOn = false;
    this.powerSurge = 0;
    this.box = new MysteryBox(this.map.boxSpots);
    this.workbench = new Workbench(this.map.workbench);
    this.egg = new EasterEgg(this.map.secretSwitches);
    this.craftOpen = false;
    this.dogRound = false;
    this.timers = { instakill: 0, doublepoints: 0, firesale: 0, deathmachine: 0 };
    this.killsSinceDrop = 0;
    this.roundDamageTaken = 0;
    this.weather = { wind: Math.random() * TAU, gust: 0, leaves: [], rain: null, fog: 0 };
    for (let i = 0; i < 46; i++) {
      this.weather.leaves.push({
        x: Math.random() * this.map.w * T, y: Math.random() * this.map.h * T,
        vx: 0, vy: 0, r: Math.random() * TAU, vr: randRange(-2, 2),
        s: randRange(0.6, 1.5), a: randRange(0.25, 0.6),
      });
    }
    this.teleportFx = 0;

    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    this.cam.x = clamp(this.player.pos.x - VW / 2, 0, this.map.w * T - VW);
    this.cam.y = clamp(this.player.pos.y - VH / 2, 0, this.map.h * T - VH);
    this.revealAround(this.player.pos.x, this.player.pos.y, 14);
  }

  // ------------------------------------------------------------------ utils
  screenToWorld(sx, sy) { return { x: sx + this.cam.x, y: sy + this.cam.y }; }

  /** Stats for a weapon, upgraded if the player has punched it. */
  packedDef(id) { return defFor(id, this.player.packed.has(id)); }
  worldToScreen(wx, wy) { return { x: wx - this.cam.x, y: wy - this.cam.y }; }

  shake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
    this.shakeMax = Math.max(this.shakeT, 0.001);
  }

  bannerShow(title, sub, opts = {}) {
    this.banner = { title, sub, t: opts.dur ?? 2.2, max: opts.dur ?? 2.2, big: !!opts.big, colour: opts.colour };
  }

  addPoints(n, x, y, colour) {
    this.points += n;
    this.stats.points += Math.max(0, n);
    if (x !== undefined) this.popups.add(x, y, (n > 0 ? '+' : '') + n, colour);
    if (n > 0) this.hud.pointPulse = 1;
  }

  revealAround(x, y, rTiles) {
    const m = this.map;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    for (let j = -rTiles; j <= rTiles; j++) {
      for (let i = -rTiles; i <= rTiles; i++) {
        if (i * i + j * j > rTiles * rTiles) continue;
        const ax = tx + i, ay = ty + j;
        if (ax < 0 || ay < 0 || ax >= m.w || ay >= m.h) continue;
        if (!m.seen[ay * m.w + ax]) { m.seen[ay * m.w + ax] = 1; this.hud._miniDirty = true; }
      }
    }
  }

  // ------------------------------------------------------------------ waves
  roundPlan(round) {
    const dog = round > 0 && round % DOG_ROUND_EVERY === 0;
    const total = dog
      ? Math.min(10 + Math.round(round * 1.6), 46)
      : Math.round(6 + round * 3.5);
    const maxAlive = dog
      ? Math.min(MAX_ALIVE_BASE + Math.floor(round / 3) * 3, 40)
      : Math.min(MAX_ALIVE_BASE + Math.floor(round / 4) * 3, 34);
    const hp = dog ? Math.min(80 + (round - 1) * 30, 1600) : Math.min(120 + (round - 1) * 46, 2600);
    const speed = Math.min(44 + (round - 1) * 1.5, 88);
    const interval = dog ? Math.max(0.22, 0.75 - round * 0.02) : Math.max(0.3, 1.35 - round * 0.05);
    return { total, maxAlive, hp, speed, interval, dog };
  }

  /** Roll which enemy archetype the next spawn is. */
  rollEnemyType() {
    if (this.dogRound) return 'dog';
    const r = this.round;
    const runnerChance = Math.min(0.34, Math.max(0, (r - 5) * 0.035));
    const bruteChance = Math.min(0.18, Math.max(0, (r - 9) * 0.020));
    const shriekChance = Math.min(0.10, Math.max(0, (r - 11) * 0.014));
    const x = Math.random();
    if (x < shriekChance) return 'shrieker';
    if (x < shriekChance + bruteChance) return 'brute';
    if (x < shriekChance + bruteChance + runnerChance) return 'runner';
    return 'walker';
  }

  makeZombie(sp) {
    const plan = this.roundPlan(this.round);
    const type = this.rollEnemyType();
    const jitter = type === 'brute' ? 4 : 10;
    return new Zombie(this.map, sp.x + randRange(-jitter, jitter), sp.y + randRange(-jitter, jitter), {
      hp: Math.round(plan.hp * randRange(0.85, 1.15)),
      speed: plan.speed * randRange(0.88, 1.12),
      dmg: 34,
      type,
    });
  }

  startRound(n) {
    this.round = n;
    this.stats.round = n;
    const plan = this.roundPlan(n);
    this.dogRound = plan.dog;
    this.zombiesTotal = plan.total;
    this.zombiesSpawned = 0;
    this.zombiesKilled = 0;
    this.roundDamageTaken = 0;
    this.roundActive = true;
    this.intermission = 0;
    this.spawnTimer = 0.35;
    this.workbench.onRoundStart();
    if (plan.dog) {
      this.bannerShow(`ROUND ${n}`, 'something is out there', { dur: 2.6, big: true, colour: '#e0705a' });
      audio.dogRound();
    } else {
      this.bannerShow(`ROUND ${n}`, n === 1 ? 'they are coming' : null, { dur: 2.4, big: true });
      audio.roundSting(true);
    }
    if (n >= 10) this.achievements.unlock('round_10');
    if (n >= 20) this.achievements.unlock('round_20');
    if (n >= 30) this.achievements.unlock('round_30');
    if (n >= 10 && this.stats.doors === 0) this.achievements.unlock('recluse');
  }

  endRound() {
    this.roundActive = false;
    this.intermission = 6;
    this.respawnQueue = 0;
    if (this.roundDamageTaken === 0) this.achievements.unlock('untouchable');
    this.bannerShow(`ROUND ${this.round} CLEARED`, 'catch your breath', { dur: 2.6, colour: '#f0d98a' });
    audio.roundSting(false);
  }

  get zombiesLeft() {
    return Math.max(0, this.zombiesTotal - this.zombiesKilled);
  }

  /** Pick a spawn point outside the building that can actually reach the player. */
  pickSpawn() {
    const cands = [];
    for (const s of this.map.spawnPoints) {
      if (!this.map.reachable(s.x, s.y)) continue;
      const d = dist2(s.x, s.y, this.player.pos.x, this.player.pos.y);
      cands.push({ s, d });
    }
    if (!cands.length) return this.map.spawnPoints[0];
    // avoid spawning right on top of the player, prefer moderately distant
    cands.sort((a, b) => a.d - b.d);
    const lo = Math.floor(cands.length * 0.25);
    const hi = cands.length - 1;
    return cands[randInt(lo, hi)].s;
  }

  spawnZombie() {
    const sp = this.pickSpawn();
    if (!sp) return;
    this.zombies.push(this.makeZombie(sp));
    this.zombiesSpawned++;
  }

  onZombieKilled(z, head, ptsOverride = null, source = 'bullet') {
    this.zombiesKilled++;
    this.stats.kills++;
    if (head) this.stats.headshots++;
    const pts = ptsOverride
      ?? Math.round((POINTS_KILL + (head ? POINTS_HEAD : 0)) * z.pointsMul
        * (this.timers.doublepoints > 0 ? 2 : 1));
    this.addPoints(pts, z.pos.x, z.pos.y - 24,
      ptsOverride ? '#a8d06a' : head ? '#f0d98a' : '#e6dcc2');
    this.splat(z.pos.x, z.pos.y, 9 + Math.random() * 7, 0.5);

    // salvage
    const dropChance = SALVAGE_DROP + (z.type === 'brute' ? 0.55 : 0);
    if (Math.random() < dropChance) {
      const n = z.type === 'brute' ? randInt(2, 4) : 1;
      this.player.salvage += n;
      this.popups.add(z.pos.x + randRange(-6, 6), z.pos.y - 34, `+${n} SCRAP`, '#9fd0e0', 9);
    }

    // power-up drops
    this.killsSinceDrop++;
    if (this.killsSinceDrop >= randInt(22, 34)) {
      this.killsSinceDrop = 0;
      this.dropPowerup(z.pos.x, z.pos.y);
    }

    // achievements
    this.achievements.unlock('first_blood');
    if (this.stats.headshots >= 100) this.achievements.unlock('headhunter');
    if (this.player.ownedWeapons().length >= 6) this.achievements.unlock('walking_armoury');
    if (source === 'monkey') this._monkeyKills = (this._monkeyKills ?? 0) + 1;
    if (source === 'trap') this.traps.kills++;
  }

  /**
   * A blast sometimes takes the legs instead of the head: the zombie drops to
   * its elbows and keeps coming. Slow, but a much smaller target.
   */
  tryCrawl(z, chance = 0.26) {
    if (z.type === 'crawler' || z.type === 'dog' || z.dead) return false;
    if (this.round < 3) return false;
    if (Math.random() >= chance) return false;
    z.becomeCrawler(this);
    return true;
  }

  dropPowerup(x, y) {
    const id = rollPowerup(Math.random, {
      hasBox: true,
      brokenWindows: this.map.barricades.filter((b) => b.planks < b.maxPlanks).length,
    });
    this.powerups.push(new Powerup(x, y, id));
    audio.chime();
  }

  collectPowerup(pu) {
    const p = this.player;
    switch (pu.id) {
      case 'maxammo':
        p.refillAllReserve();
        this.bannerShow('MAX AMMO', 'every magazine topped up', { dur: 2.2, colour: '#f2e26a' });
        break;
      case 'instakill':
        this.timers.instakill = pu.def.duration;
        this.bannerShow('INSTA-KILL', `${pu.def.duration}s of one-shot kills`, { dur: 2.2, colour: '#e8563c' });
        break;
      case 'doublepoints':
        this.timers.doublepoints = pu.def.duration;
        this.bannerShow('DOUBLE POINTS', `${pu.def.duration}s of double pay`, { dur: 2.2, colour: '#54c8f0' });
        break;
      case 'nuke': {
        let n = 0;
        for (const z of this.zombies) {
          if (z.dead) continue;
          z.hurt(1e9, false, this, Math.atan2(z.pos.y - p.pos.y, z.pos.x - p.pos.x));
          this.onZombieKilled(z, false, 0);
          n++;
        }
        this.shake(9, 0.5);
        this.explosionLights.push({ x: p.pos.x, y: p.pos.y, r: 900, life: 0.7, max: 0.7 });
        this.bannerShow('NUKE', n ? `${n} down` : 'the air crackles', { dur: 2.4, colour: '#8fe05a' });
        audio.nuke();
        break;
      }
      case 'carpenter':
        this.carpenter(6);
        this.bannerShow('CARPENTER', 'every window boarded', { dur: 2.2, colour: '#d9a95c' });
        break;
      case 'firesale':
        this.timers.firesale = pu.def.duration;
        this.box.firesale = true;
        this.box.firesaleTimer = pu.def.duration;
        this.box.relocate();
        this.bannerShow('FIRE SALE', 'the box is nearly giving it away', { dur: 2.4, colour: '#f07ac0' });
        break;
      case 'deathmachine':
        this.timers.deathmachine = pu.def.duration;
        p.dmTimer = pu.def.duration;
        this.bannerShow('DEATH MACHINE', `${pu.def.duration}s of endless ammo`, { dur: 2.4, colour: '#c05ce0' });
        break;
      default: break;
    }
    audio.chime();
  }

  /** Carpenter / plank bundle: nail `n` planks back on every window. */
  carpenter(n) {
    let fixed = 0;
    for (const b of this.map.barricades) {
      const before = b.planks;
      b.planks = Math.min(b.maxPlanks, b.planks + n);
      fixed += b.planks - before;
      if (b.planks - before > 0) this.particles.dust(b.cx, b.cy, randRange(0, TAU), 4);
    }
    audio.wood(true);
    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    return fixed;
  }

  onBarricadeDown(b) {
    audio.wood(false);
    this.particles.dust(b.cx, b.cy, randRange(0, TAU), 10);
    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
  }

  explosion(x, y, r) {
    audio.explosion();
    this.shake(11, 0.42);
    this.explosionLights.push({ x, y, r: r * 2.4, life: 0.4, max: 0.4 });
    this.splat(x, y, r * 0.5, 0.25, '#1a1512');
  }

  splat(x, y, r, alpha = 0.5, colour = '#4d1214') {
    const c = this.decalCtx;
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = colour;
    c.beginPath();
    c.ellipse(x, y, r * randRange(0.7, 1.2), r * randRange(0.5, 1.0), Math.random() * TAU, 0, TAU);
    c.fill();
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU, d = r * randRange(0.9, 2.1);
      c.globalAlpha = alpha * randRange(0.3, 0.7);
      c.beginPath();
      c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, randRange(1, 3), randRange(1, 2.4), 0, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  // -------------------------------------------------------------- shooting
  fireHitscan(ox, oy, angle, def, muzzle) {
    this.stats.shots++;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const ex = ox + dx * def.range, ey = oy + dy * def.range;
    const wall = this.map.rayWall(ox, oy, ex, ey);
    const wallT = wall ? wall.t : def.range;

    const hits = [];
    const magnet = this.player.perkFx.headMagnet;
    for (const z of this.zombies) {
      if (z.dead) continue;
      // Deadshot Daiquiri nudges the ray toward the head box
      let hx = z.pos.x, hy = z.pos.y - HEAD_OFF_Y * (z.def.headOff ?? 1);
      if (magnet > 0) {
        const d = dist(ox, oy, hx, hy);
        const off = pointSegDist2(hx, hy, ox, oy, ox + dx * def.range, oy + dy * def.range);
        const lateral = Math.sqrt(Math.max(0, off.d2));
        if (lateral < magnet * d) { hx = z.pos.x; hy = z.pos.y - HEAD_OFF_Y * (z.def.headOff ?? 1); }
      }
      let res = pointSegDist2(hx, hy, ox, oy, ox + dx * def.range, oy + dy * def.range);
      let head = false;
      const low = z.def.low ? 0.72 : 1;
      const headR = (3.9 + (magnet > 0 ? 1.6 : 0)) * low;
      const bodyR = (7.2 + (z.def.smash ? 3.4 : 0)) * (z.def.low ? 0.78 : 1);
      if (res.d2 > headR * headR) {
        res = pointSegDist2(z.pos.x, z.pos.y, ox, oy, ox + dx * def.range, oy + dy * def.range);
        if (res.d2 > bodyR * bodyR) continue;
      } else head = true;
      const t = Math.hypot(res.cx - ox, res.cy - oy);
      if (t > wallT) continue;
      hits.push({ z, t, head, x: res.cx, y: res.cy });
    }
    hits.sort((a, b) => a.t - b.t);

    const insta = this.timers.instakill > 0 ? 9999 : 1;
    let pierce = def.pierce;
    let endT = wallT;
    let anyHit = false;
    let firstHit = null;
    for (const h of hits) {
      const wasAlive = !h.z.dead;
      const mul = (h.head ? def.headMul : 1) * insta;
      const res = h.z.hurt(def.dmg * mul, h.head, this, angle);
      if (!wasAlive) continue;
      anyHit = true;
      if (!firstHit) firstHit = h;
      this.stats.hits++;
      this.addPoints(POINTS_HIT, h.x, h.y - 8, h.head ? '#f0d98a' : 'rgba(230,220,194,0.9)');
      this.hud.hit(h.head);
      if (res === 2) { this.onZombieKilled(h.z, h.head); }
      if (pierce > 0 && insta === 1) { pierce--; endT = Math.max(endT, h.t + 8); }
      else if (insta === 1) { endT = h.t; break; }
    }

    // wonder-weapon extras fire once per shot, at the point of impact
    if (def.special && def.special !== 'shock' && def.special !== 'lure') {
      const ix = firstHit ? firstHit.x : ox + dx * endT;
      const iy = firstHit ? firstHit.y : oy + dy * endT;
      this.applySpecial(def, ix, iy, firstHit ? firstHit.z : null, insta);
      endT = Math.min(endT, Math.hypot(ix - ox, iy - oy));
    }

    if (!anyHit && wall) {
      this.particles.spark(wall.x, wall.y, Math.atan2(-wall.ny, -wall.nx), 5, '#d8c9a8');
      this.particles.dust(wall.x, wall.y, Math.atan2(-wall.ny, -wall.nx), 3);
      audio.impact(false, false);
    }

    const hx = ox + dx * endT, hy = oy + dy * endT;
    this.tracers.push({ x0: muzzle.x, y0: muzzle.y, x1: hx, y1: hy, life: 0.055, max: 0.055, colour: def.tracer });
  }

  /** Ray Gun splash / DG-2 chain / Winter's Howl frost. */
  applySpecial(def, x, y, source, insta = 1) {
    if (def.special === 'splash') {
      this.explosionLights.push({ x, y, r: def.splashR * 3.2, life: 0.28, max: 0.28, colour: def.splashColor });
      for (const z of this.zombies) {
        if (z.dead) continue;
        const d = dist(x, y, z.pos.x, z.pos.y);
        if (d > def.splashR) continue;
        if (this.tryCrawl(z, 0.18)) continue;
        const res = z.hurt(def.splashDmg * insta * (1 - d / def.splashR * 0.4), false, this,
          Math.atan2(z.pos.y - y, z.pos.x - x));
        if (res === 2) this.onZombieKilled(z, false);
      }
      this.particles.spark(x, y, randRange(0, TAU), 12, def.splashColor);
      return;
    }

    if (def.special === 'chain') {
      let from = source ? { x: source.pos.x, y: source.pos.y } : { x, y };
      const hitSet = new Set(source ? [source] : []);
      for (let i = 0; i < def.chainCount; i++) {
        let best = null, bd = def.chainRange * def.chainRange;
        for (const z of this.zombies) {
          if (z.dead || hitSet.has(z)) continue;
          const d2 = dist2(from.x, from.y, z.pos.x, z.pos.y);
          if (d2 < bd) { bd = d2; best = z; }
        }
        if (!best) break;
        this.arcs.push({
          x0: from.x, y0: from.y - 6, x1: best.pos.x, y1: best.pos.y - 6,
          life: 0.22, max: 0.22, colour: def.chainColor,
        });
        const dmg = def.dmg * Math.pow(def.chainFalloff, i + 1) * insta;
        const res = best.hurt(dmg, false, this, Math.atan2(best.pos.y - from.y, best.pos.x - from.x));
        hitSet.add(best);
        if (res === 2) this.onZombieKilled(best, false);
        from = { x: best.pos.x, y: best.pos.y };
      }
      audio.shot('wunderwaffe', 0);
      return;
    }

    if (def.special === 'freeze') {
      let frozen = 0;
      for (const z of this.zombies) {
        if (z.dead) continue;
        const d = dist(x, y, z.pos.x, z.pos.y);
        if (d > def.freezeR) continue;
        z.frozen = def.freezeTime;
        const res = z.hurt(def.dmg * insta, false, this, Math.atan2(z.pos.y - y, z.pos.x - x));
        frozen++;
        if (res === 2) this.onZombieKilled(z, false);
        this.particles.spark(z.pos.x, z.pos.y, randRange(0, TAU), 3, def.freezeColor);
      }
      if (frozen >= 10) this.achievements.unlock('frostbite');
      this.explosionLights.push({ x, y, r: def.freezeR * 3, life: 0.3, max: 0.3, colour: def.freezeColor });
    }
  }

  // ---------------------------------------------------------- interactions
  updateInteraction() {
    const p = this.player;
    let best = null;
    const offer = (o) => { if (!best || o.d < best.d) best = o; };

    for (const wb of this.map.wallBuys) {
      const d = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (d >= 30) continue;
      const def = WEAPONS[wb.weapon];
      const owned = p.loadout[wb.weapon].owned;
      const price = owned ? def.ammoPrice : def.price;
      offer({ type: 'wallbuy', weapon: wb.weapon, price, affordable: this.points >= price, d, wb });
    }

    for (const g of this.map.grenadeCrates) {
      const d = dist(p.pos.x, p.pos.y, g.x, g.y);
      if (d < 30) {
        offer({
          type: 'grenade', price: GRENADE_PRICE, d,
          affordable: this.points >= GRENADE_PRICE && p.grenades < 9,
        });
      }
    }

    for (const dr of this.map.doors) {
      if (dr.open) continue;
      const d = dist(p.pos.x, p.pos.y, dr.cx, dr.cy);
      if (d < 34) offer({ type: 'door', door: dr, price: dr.price, affordable: this.points >= dr.price, d });
    }

    const nearB = this.map.nearestBarricade(p.pos.x, p.pos.y, 34, false);
    if (nearB) {
      const d = dist(p.pos.x, p.pos.y, nearB.cx, nearB.cy);
      if (d < 34) offer({ type: 'barricade', barricade: nearB, d, affordable: true, price: 0 });
    }

    for (const ps of this.map.perkSpots) {
      const d = dist(p.pos.x, p.pos.y, ps.x, ps.y);
      if (d >= 40) continue;
      const def = PERKS[ps.id];
      const owned = p.hasPerk(ps.id);
      const full = p.perks.size >= 6;
      offer({
        type: 'perk', perk: ps, def, owned, d,
        price: owned ? 0 : def.price,
        affordable: !owned && !full && this.points >= def.price && this.powerOn,
      });
    }

    const bs = this.box.spot;
    const db = dist(p.pos.x, p.pos.y, bs.x, bs.y);
    if (db < 42) {
      const price = this.box.price();
      offer({
        type: 'box', d: db, price,
        affordable: this.powerOn && this.points >= price
          && (this.box.state === 'closed' || this.box.state === 'offering'),
      });
    }

    const dps = dist(p.pos.x, p.pos.y, this.map.powerSwitch.x, this.map.powerSwitch.y);
    if (dps < 36) offer({ type: 'power', d: dps, price: 0, affordable: !this.powerOn });

    const dwb = dist(p.pos.x, p.pos.y, this.workbench.x, this.workbench.y);
    if (dwb < 40) offer({ type: 'workbench', d: dwb, price: 0, affordable: true });

    const nt = this.traps.nearest(p.pos.x, p.pos.y, 46);
    if (nt) {
      offer({
        type: 'trap', i: nt.i, d: dist(p.pos.x, p.pos.y, nt.x, nt.y),
        price: TRAP_PRICE, ready: nt.ready, affordable: this.points >= TRAP_PRICE && nt.ready,
      });
    }

    const dpp = dist(p.pos.x, p.pos.y, this.map.papSpot.x, this.map.papSpot.y);
    if (dpp < 44) {
      const id = p.current;
      const already = p.packed.has(id);
      offer({
        type: 'pap', d: dpp, price: PAP_PRICE, id,
        affordable: this.powerOn && !already && this.points >= PAP_PRICE && !p.dead,
        already,
      });
    }

    for (const sw of this.map.secretSwitches) {
      const d = dist(p.pos.x, p.pos.y, sw.x, sw.y);
      if (d < 32) offer({ type: 'switch', sw, d, price: 0, affordable: !sw.found });
    }

    if (this.map.secretDoorOpen) {
      for (const l of this.map.secretLoot) {
        const d = dist(p.pos.x, p.pos.y, l.x, l.y);
        if (d < 30) offer({ type: 'loot', loot: l, d, price: 0, affordable: true });
      }
    }

    this.interaction = best;
  }

  doInteraction() {
    const it = this.interaction;
    if (!it) return;
    const p = this.player;

    if (it.type === 'wallbuy') {
      const def = WEAPONS[it.weapon];
      const slot = p.loadout[it.weapon];
      const price = slot.owned ? def.ammoPrice : def.price;
      if (this.points < price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      if (slot.owned && slot.reserve >= def.maxReserve && slot.mag >= def.mag) {
        audio.deny();
        this.popups.add(p.pos.x, p.pos.y - 26, 'FULL AMMO', '#9a917c');
        return;
      }
      this.points -= price;
      const kind = p.giveWeapon(it.weapon);
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, kind === 'ammo' ? 'AMMO' : def.name.toUpperCase(), '#f0d98a', 12);
      if (p.ownedWeapons().length >= 6) this.achievements.unlock('walking_armoury');
      return;
    }

    if (it.type === 'door') {
      if (this.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      this.points -= it.price;
      it.door.open = true;
      this.stats.doors++;
      audio.buy();
      audio.door();
      this.popups.add(p.pos.x, p.pos.y - 26, 'DOOR OPEN', '#f0d98a', 12);
      this.map.buildFlow(p.pos.x, p.pos.y);
      return;
    }

    if (it.type === 'grenade') {
      if (this.points < it.price || p.grenades >= 9) { audio.deny(); return; }
      this.points -= it.price;
      p.grenades += 2;
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, 'FRAG GRENADES', '#f0d98a', 12);
      return;
    }

    if (it.type === 'perk') {
      if (it.owned) { audio.deny(); return; }
      if (!this.powerOn) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POWER', '#c4463a'); return; }
      if (p.perks.size >= 6) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'PERK LIMIT', '#c4463a'); return; }
      if (this.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      this.points -= it.price;
      p.addPerk(it.perk.id);
      audio.perk();
      this.bannerShow(it.def.name.toUpperCase(), it.def.desc, { dur: 2.4, colour: it.def.colour });
      if (p.perks.size >= 4) this.achievements.unlock('perk_fiend');
      return;
    }

    if (it.type === 'box') {
      const price = this.box.price();
      if (!this.powerOn) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POWER', '#c4463a'); return; }
      if (this.box.state === 'offering') {
        const id = this.box.take();
        if (!id) return;
        const kind = p.giveWeapon(id);
        audio.buy();
        this.popups.add(p.pos.x, p.pos.y - 26, WEAPONS[id].name.toUpperCase(), '#f0d98a', 12);
        if (WEAPONS[id].wonder) this.achievements.unlock('wonder_seeker');
        if (p.ownedWeapons().length >= 6) this.achievements.unlock('walking_armoury');
        return;
      }
      if (this.box.state !== 'closed') return;
      if (this.points < price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      this.points -= price;
      const res = this.box.spin();
      audio.boxSpin();
      if (res === 'teddy') {
        this.bannerShow('THE BOX MOVES', 'you hear a faint giggle', { dur: 2.4, colour: '#f0a0d0' });
      }
      return;
    }

    if (it.type === 'power') {
      if (this.powerOn) return;
      this.powerOn = true;
      this.powerSurge = 1.4;
      this.shake(4, 0.5);
      audio.powerUp();
      this.bannerShow('POWER RESTORED', 'the lights buzz back on', { dur: 3.0, colour: '#f2e26a' });
      this.achievements.unlock('power_on');
      return;
    }

    if (it.type === 'workbench') {
      this.craftOpen = !this.craftOpen;
      audio.reload(2);
      return;
    }

    if (it.type === 'trap') {
      const t = this.traps.list[it.i];
      if (!t.ready) { audio.deny(); return; }
      if (this.points < TRAP_PRICE) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      this.points -= TRAP_PRICE;
      t.arm();
      audio.trap(t.kind.id);
      this.shake(4, 0.3);
      this.popups.add(p.pos.x, p.pos.y - 26, t.name.toUpperCase(), t.kind.colour, 12);
      return;
    }

    if (it.type === 'pap') {
      if (it.already) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'ALREADY PUNCHED', '#9a917c', 11); return; }
      if (!this.powerOn) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POWER', '#c4463a'); return; }
      if (this.points < PAP_PRICE) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      const oldName = p.def.name.toUpperCase();
      this.points -= PAP_PRICE;
      p.packCurrent();
      audio.packAPunch();
      this.shake(5, 0.6);
      this.flashLights.push({ x: this.map.papSpot.x, y: this.map.papSpot.y, r: 260, life: 0.5, max: 0.5, colour: '#7fd75a' });
      this.bannerShow('PACK-A-PUNCH', `${oldName} -> ${p.def.name.toUpperCase()}`, { dur: 3.2, colour: '#8fe05a' });
      this.achievements.unlock('packed');
      return;
    }

    if (it.type === 'switch') {
      if (it.sw.found) return;
      this.egg.activate(it.sw);
      audio.chime();
      this.popups.add(p.pos.x, p.pos.y - 28,
        `SIGNAL ${this.egg.found}/${this.egg.switches.length}`, '#9fd0e0', 11);
      if (this.egg.complete && this.egg.state === 'idle') {
        this.egg.start();
        this.bannerShow('THE RADIO SPEAKS', 'something is transmitting', { dur: 3.0, colour: '#9fd0e0' });
        audio.radioStart();
      }
      return;
    }

    if (it.type === 'loot') {
      if (it.loot.taken) return;
      it.loot.taken = true;
      audio.chime();
      this.points += 3000;
      this.player.salvage += 25;
      const pool = ['raygun', 'wunderwaffe', 'thundergun', 'winterhowl', 'monkeybomb'];
      const id = pool[randInt(0, pool.length - 1)];
      this.player.giveWeapon(id);
      this.bannerShow('CACHE FOUND', `${WEAPONS[id].name.toUpperCase()}  +3000 POINTS`, { dur: 3.4, colour: '#f2e26a' });
      this.achievements.unlock('egg_hunter');
      return;
    }
  }

  /** Hold E next to a broken window to nail planks back on, one at a time. */
  rebuildTick(dt) {
    const it = this.interaction;
    if (!it || it.type !== 'barricade') { this._rebuildT = 0; return; }
    const b = it.barricade;
    if (b.planks >= b.maxPlanks) { this._rebuildT = 0; return; }
    this._rebuildT = (this._rebuildT || 0) + dt;
    if (this._rebuildT >= 0.3) {
      this._rebuildT = 0;
      b.planks++;
      this.stats.planks++;
      this.addPoints(POINTS_PLANK, b.cx + randRange(-6, 6), b.cy - 6, '#f0d98a');
      audio.wood(true);
      this.particles.dust(b.cx, b.cy, randRange(0, TAU), 3);
      if (this.stats.planks >= 50) this.achievements.unlock('handy');
      if (b.planks === 1) this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    }
  }

  /** Called by the EasterEgg once the broadcast finishes. */
  onEasterEggComplete() {
    this.map.secretDoorOpen = true;
    this.shake(6, 0.7);
    audio.powerUp();
    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    this.bannerShow('A WALL GIVES WAY', 'something opened in the east wall', { dur: 3.6, colour: '#f2e26a' });
  }

  onPlayerTeleport(from, to) {
    this.teleportFx = 1;
    this.particles.dust(to.x, to.y, randRange(0, TAU), 8);
    this.revealAround(to.x, to.y, 12);
    audio.door();
  }

  /** Throw a Monkey Bomb from the player's hands. */
  throwMonkey() {
    const p = this.player;
    const def = WEAPONS.monkeybomb;
    p.slot.mag--;
    p.fireTimer = def.delay;
    const speed = 230;
    this.monkeys.push(new MonkeyBomb(
      p.pos.x + Math.cos(p.aim) * 14, p.pos.y + Math.sin(p.aim) * 14,
      Math.cos(p.aim) * speed + p.vel.x * 0.4, Math.sin(p.aim) * speed + p.vel.y * 0.4,
      def,
    ));
    this._monkeyKills = 0;
    audio.shot('throw', 0);
  }

  /** Thunder Gun: a cone of concussive force, no hitscan. */
  fireShockwave(ox, oy, angle, def) {
    let hit = 0;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = z.pos.x - ox, dy = z.pos.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > def.shockRange) continue;
      let da = Math.atan2(dy, dx) - angle;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > def.shockAngle) continue;
      if (this.map.lineBlocked(ox, oy, z.pos.x, z.pos.y)) continue;
      const falloff = 1 - (d / def.shockRange) * 0.45;
      const res = z.hurt(def.shockDmg * falloff, false, this, Math.atan2(dy, dx));
      z.vel.x += Math.cos(Math.atan2(dy, dx)) * def.shockPush * falloff;
      z.vel.y += Math.sin(Math.atan2(dy, dx)) * def.shockPush * falloff;
      this.addPoints(POINTS_HIT, z.pos.x, z.pos.y - 8, 'rgba(245,180,92,0.9)');
      hit++;
      if (res === 2) this.onZombieKilled(z, false);
    }
    this.explosionLights.push({ x: ox + Math.cos(angle) * 80, y: oy + Math.sin(angle) * 80, r: 320, life: 0.35, max: 0.35 });
    this.shake(8, 0.32);
    audio.shot('thundergun', 0);
  }

  /** Shared explosion: grenades, Monkey Bombs, Ray Gun splashes. */
  explodeAt(x, y, r, dmg, opts = {}) {
    const p = this.player;
    audio.explosion();
    this.shake(opts.shake ?? 10, 0.4);
    this.explosionLights.push({ x, y, r: r * 2.6, life: 0.42, max: 0.42, colour: opts.colour });
    this.splat(x, y, r * 0.42, 0.22, '#1a1512');
    for (let i = 0; i < 16; i++) {
      this.particles.spark(x, y, randRange(0, TAU), 2, opts.colour ?? '#ffcf70');
    }

    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = dist(x, y, z.pos.x, z.pos.y);
      if (d > r) continue;
      if (opts.blast && this.tryCrawl(z)) continue;
      const falloff = 1 - d / r;
      const res = z.hurt(dmg * falloff, false, this, Math.atan2(z.pos.y - y, z.pos.x - x));
      if (res === 2) this.onZombieKilled(z, false, null, opts.fromPlayer ? 'monkey' : 'blast');
    }

    // self-damage: normal grenades hurt you, PhD Flopper says otherwise
    const pd = dist(x, y, p.pos.x, p.pos.y);
    if (pd < r && opts.fromPlayer !== false && !p.perkFx.splashImmune) {
      p.hurt(Math.round(75 * (1 - pd / r)), x, y, this);
    } else if (pd < r && p.perkFx.diveBlast) {
      p.heal(0);
    }
  }

  tryCraft(id) {
    const r = RECIPES[id];
    const why = this.workbench.canCraft(this, id);
    if (why !== 'ok') {
      audio.deny();
      this.popups.add(this.player.pos.x, this.player.pos.y - 28,
        why === 'salvage' ? 'NOT ENOUGH SCRAP' : 'NOT ENOUGH POINTS', '#c4463a', 10);
      return false;
    }
    this.workbench.craft(this, id);
    audio.buy();
    this.popups.add(this.player.pos.x, this.player.pos.y - 26, r.name.toUpperCase(), r.colour, 12);
    return true;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.time += dt;

    if (!this.started) {
      if (this.input.mouse.pressed || this.input.wasPressed('Space', 'Enter')) this.begin();
      return;
    }

    if (this.input.wasPressed('KeyM')) audio.setMuted(!audio.muted);

    if (this.gameOver) {
      this.overT += dt;
      this.particles.update(dt, this.map);
      this.popups.update(dt);
      if (this.overT > 1.1 && (this.input.wasPressed('KeyR') || this.input.mouse.pressed)) {
        this.reset();
        this.started = true;
        this.startRound(1);
      }
      return;
    }

    if (this.input.wasPressed('KeyP', 'Escape')) this.paused = !this.paused;
    if (this.paused) {
      if (this.input.wasPressed('KeyR')) { this.reset(); this.started = true; this.startRound(1); }
      return;
    }

    // ---- flow field refresh ------------------------------------------------
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.22;
      const lure = this.monkeys.find((m) => m.luring);
      if (lure) this.map.buildFlow(lure.pos.x, lure.pos.y);
      else this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    }

    // ---- player ------------------------------------------------------------
    this.player.update(dt, this, this.input);
    this.revealAround(this.player.pos.x, this.player.pos.y, 11);

    // ---- workbench craft menu (swallows the number keys while open) --------
    if (this.craftOpen) {
      for (let i = 0; i < RECIPE_ORDER.length; i++) {
        if (this.input.wasPressed(`Digit${i + 1}`)) this.tryCraft(RECIPE_ORDER[i]);
      }
      if (this.input.wasPressed('Escape', 'KeyE', 'KeyQ')) this.craftOpen = false;
      if (dist(this.player.pos.x, this.player.pos.y, this.workbench.x, this.workbench.y) > 56) {
        this.craftOpen = false;
      }
    } else {
      // 1 / 2 pick a carried slot, Q flips between them; the wheel and the
      // square brackets dig through the whole armoury (that takes a moment)
      if (this.input.wasPressed('Digit1')) this.player.setSlot(0);
      if (this.input.wasPressed('Digit2')) this.player.setSlot(1);
      if (this.input.wasPressed('KeyQ')) this.player.swapActive();
      if (this.input.wasPressed('BracketLeft')) this.player.cycle(-1);
      if (this.input.wasPressed('BracketRight')) this.player.cycle(1);
      if (this.input.wheel) this.player.cycle(this.input.wheel > 0 ? 1 : -1);

      // grenades
      if (this.input.wasPressed('KeyG') && this.player.grenades > 0 && !this.player.dead) {
        this.player.grenades--;
        throwGrenade(this, this.player.pos.x, this.player.pos.y, this.player.aim);
        this.player.vel.x -= Math.cos(this.player.aim) * 30;
        this.shake(2, 0.1);
      }
      // medkit
      if (this.input.wasPressed('KeyH')) {
        if (this.player.useMedkit()) {
          audio.chime();
          this.popups.add(this.player.pos.x, this.player.pos.y - 26, '+55 HEALTH', '#63c74d', 12);
        }
      }
    }

    this.updateInteraction();
    if (!this.craftOpen) {
      if (this.input.wasPressed('KeyE', 'KeyF')) this.doInteraction();
      if (this.input.isDown('KeyE')) this.rebuildTick(dt); else this._rebuildT = 0;
    } else this._rebuildT = 0;

    // ---- waves -------------------------------------------------------------
    if (this.roundActive) {
      const plan = this.roundPlan(this.round);
      const aliveCount = this.zombies.filter((z) => !z.dead).length;
      if (this.zombiesSpawned < this.zombiesTotal) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && aliveCount < plan.maxAlive) {
          this.spawnZombie();
          this.spawnTimer = plan.interval * randRange(0.7, 1.3);
        }
      }
      if (this.zombiesKilled >= this.zombiesTotal && aliveCount === 0) this.endRound();
    } else {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startRound(this.round + 1);
    }

    // ---- entities ----------------------------------------------------------
    for (const z of this.zombies) z.update(dt, this);
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      if (this.zombies[i].remove) {
        if (this.zombies[i].dead) this.zombies.splice(i, 1);
        else {
          // despawned because it was stuck: re-queue it for this round
          this.zombies.splice(i, 1);
          this.zombiesSpawned = Math.max(0, this.zombiesSpawned - 1);
        }
      }
    }
    // re-spawn queued zombies that despawned
    if (this.respawnQueue > 0 && this.roundActive) {
      if (this.spawnTimer <= 0) {
        this.respawnQueue--;
        this.zombiesSpawned++;
        const sp = this.pickSpawn();
        if (sp) this.zombies.push(this.makeZombie(sp));
        this.spawnTimer = 0.5;
      }
    }

    for (const g of this.grenades) g.update(dt, this);
    this.grenades = this.grenades.filter((g) => !g.remove);

    // ---- monkey bombs ------------------------------------------------------
    for (const m of this.monkeys) m.update(dt, this);
    for (const m of this.monkeys) {
      if (m.remove) {
        if (this._monkeyKills >= 10) this.achievements.unlock('monkey_business');
        this._monkeyKills = 0;
      }
    }
    this.monkeys = this.monkeys.filter((m) => !m.remove);

    // ---- power-ups ---------------------------------------------------------
    for (const pu of this.powerups) pu.update(dt);
    for (const pu of this.powerups) {
      if (dist(pu.x, pu.y, this.player.pos.x, this.player.pos.y) < 24) {
        pu.dead = true;
        this.collectPowerup(pu);
      }
    }
    this.powerups = this.powerups.filter((p) => !p.dead);

    // ---- timed power-ups ---------------------------------------------------
    for (const k of Object.keys(this.timers)) {
      if (this.timers[k] > 0) {
        this.timers[k] = Math.max(0, this.timers[k] - dt);
        if (this.timers[k] === 0 && k === 'deathmachine') this.player.dmTimer = 0;
      }
    }
    this.traps.update(dt, this);
    this.box.update(dt);
    this.egg.update(dt, this);
    this.achievements.update(dt);
    if (this.traps.kills >= 15) this.achievements.unlock('trap_master');
    if (this.powerSurge > 0) this.powerSurge = Math.max(0, this.powerSurge - dt);
    if (this.teleportFx > 0) this.teleportFx = Math.max(0, this.teleportFx - dt * 2);

    // ---- webs + lightning arcs --------------------------------------------
    for (let i = this.webBlasts.length - 1; i >= 0; i--) {
      this.webBlasts[i].life -= dt;
      if (this.webBlasts[i].life <= 0) this.webBlasts.splice(i, 1);
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].life -= dt;
      if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
    }
    for (let i = this.shriekRings.length - 1; i >= 0; i--) {
      const r = this.shriekRings[i];
      r.life -= dt;
      r.r = r.max * (1 - r.life / r.maxLife);
      if (r.life <= 0) this.shriekRings.splice(i, 1);
    }

    // ---- weather -----------------------------------------------------------
    const W = this.weather;
    W.wind += dt * 0.08;
    W.gust = damp(W.gust, 0.5 + Math.sin(W.wind * 1.7) * 0.5, 0.6, dt);
    const windX = 16 + W.gust * 46, windY = Math.sin(W.wind * 0.7) * 9;
    for (const l of W.leaves) {
      l.vx = damp(l.vx, windX, 1.2, dt);
      l.vy = damp(l.vy, windY + Math.sin(this.time * 2 + l.r) * 12, 1.2, dt);
      l.x += l.vx * dt * l.s;
      l.y += l.vy * dt * l.s;
      l.r += l.vr * dt;
      if (l.x > this.map.w * T) l.x -= this.map.w * T;
      if (l.y > this.map.h * T) l.y -= this.map.h * T;
      if (l.x < 0) l.x += this.map.w * T;
      if (l.y < 0) l.y += this.map.h * T;
    }

    for (const p of this.particles.items) {
      if (p.decal && p.age + dt >= p.life) {
        this.splat(p.x, p.y, p.size * randRange(1.2, 3.2), 0.35);
      }
    }
    this.particles.update(dt, this.map);
    this.popups.update(dt);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.flashLights.length - 1; i >= 0; i--) {
      this.flashLights[i].life -= dt;
      if (this.flashLights[i].life <= 0) this.flashLights.splice(i, 1);
    }
    for (let i = this.explosionLights.length - 1; i >= 0; i--) {
      this.explosionLights[i].life -= dt;
      if (this.explosionLights[i].life <= 0) this.explosionLights.splice(i, 1);
    }
    if (this.muzzleFlash) {
      this.muzzleFlash.t -= dt;
      if (this.muzzleFlash.t <= 0) this.muzzleFlash = null;
    }

    // ---- camera ------------------------------------------------------------
    const lookX = (this.input.mouse.x - VW / 2) * 0.22;
    const lookY = (this.input.mouse.y - VH / 2) * 0.22;
    const tx = clamp(this.player.pos.x + lookX - VW / 2, 0, this.map.w * T - VW);
    const ty = clamp(this.player.pos.y + lookY - VH / 2, 0, this.map.h * T - VH);
    this.cam.x = damp(this.cam.x, tx, 7, dt);
    this.cam.y = damp(this.cam.y, ty, 7, dt);

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) { this.shakeMag = 0; this.shakeT = 0; }
    }

    // ---- lamps flicker -----------------------------------------------------
    for (const l of LAMPS) {
      l.phase += dt * (2 + Math.sin(this.time * 3 + l.phase) * 1.5);
      const n = Math.sin(l.phase) * 0.5 + Math.sin(l.phase * 2.7) * 0.3 + Math.sin(l.phase * 0.31) * 0.2;
      l.flick = clamp(0.82 + n * 0.16, 0.45, 1.1);
      if (Math.random() < dt * 0.25) l.flick *= 0.35;
    }

    // ---- audio ambience ----------------------------------------------------
    const hpK = 1 - this.player.hp / this.player.maxHp;
    if (hpK > 0.55) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = lerp(1.15, 0.55, hpK);
        audio.heartbeat(clamp((hpK - 0.55) / 0.45, 0.3, 1));
      }
    }

    // ---- death -------------------------------------------------------------
    if (this.player.dead && !this.gameOver) {
      this.gameOver = true;
      this.overT = 0;
      audio.roundSting(false);
      const stamp = Date.now();
      this.board = submitScore({
        round: this.round, kills: this.stats.kills, headshots: this.stats.headshots,
        points: this.stats.points, time: Math.round(this.time), date: stamp,
      });
      this.rank = this.board.findIndex((e) => e.date === stamp);
    }

    this.hud.update(dt, this);
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
  }

  begin() {
    this.started = true;
    audio.init();
    audio.resume();
    this.startRound(1);
  }

  // ------------------------------------------------------------------ draw
  draw(ctx) {
    const { vw, vh } = this;
    ctx.imageSmoothingEnabled = false;

    let camX = Math.round(this.cam.x);
    let camY = Math.round(this.cam.y);
    if (this.shakeT > 0) {
      const k = this.shakeMag * (this.shakeT / this.shakeMax);
      camX += Math.round(randRange(-k, k));
      camY += Math.round(randRange(-k, k));
    }
    camX = clamp(camX, 0, this.map.w * T - vw);
    camY = clamp(camY, 0, this.map.h * T - vh);

    // 1. level + decals
    ctx.drawImage(this.map.staticCanvas, camX, camY, vw, vh, 0, 0, vw, vh);
    ctx.drawImage(this.decals, camX, camY, vw, vh, 0, 0, vw, vh);

    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawBarricades(ctx);
    this.drawDoors(ctx);
    this.drawSecretDoor(ctx);
    this.traps.draw(ctx, this.time);
    this.drawWallBuys(ctx);
    this.drawGrenadeCrates(ctx);
    this.drawPerkMachines(ctx);
    this.drawMysteryBox(ctx);
    this.drawPowerSwitch(ctx);
    this.drawWorkbench(ctx);
    this.drawPackAPunch(ctx);
    this.drawSecretSwitches(ctx);
    this.drawSecretLoot(ctx);
    this.drawPowerups(ctx);

    // 3. actors, sorted by feet depth
    const actors = this.zombies.filter((z) => !z.remove);
    const list = actors.map((z) => ({ y: z.pos.y, d: () => z.draw(ctx, this.art, this.time) }));
    list.push({ y: this.player.pos.y + 0.5, d: () => this.player.draw(ctx, this.art) });
    list.sort((a, b) => a.y - b.y);
    for (const l of list) l.d();

    // 4. tracers
    for (const t of this.tracers) {
      const k = t.life / t.max;
      ctx.save();
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = t.colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
      ctx.restore();
    }

    // 5. muzzle flash
    if (this.muzzleFlash) {
      const m = this.muzzleFlash;
      const k = m.t / 0.055;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(k, 0, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, m.size);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(0.4, 'rgba(255,170,60,0.55)');
      g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, m.size, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,235,190,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(m.size * 1.5, -3);
      ctx.lineTo(m.size * 1.9, 0);
      ctx.lineTo(m.size * 1.5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 6. monkey bombs + grenades
    for (const m of this.monkeys) m.draw(ctx, this.art);
    for (const g of this.grenades) {
      ctx.save();
      ctx.translate(g.pos.x, g.pos.y);
      ctx.rotate(g.rot);
      ctx.fillStyle = '#3c4a30';
      ctx.fillRect(-2, -3, 4, 6);
      ctx.fillStyle = '#586b45';
      ctx.fillRect(-2, -3, 4, 1);
      ctx.restore();
      if (g.fuse < 1.0 && Math.floor(g.fuse * 10) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,90,60,0.9)';
        ctx.fillRect(g.pos.x - 1, g.pos.y - 5, 2, 2);
      }
    }

    // 7. lightning arcs + web blasts
    for (const a of this.arcs) {
      const k = a.life / a.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = a.colour;
      ctx.globalAlpha = k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x0, a.y0);
      const segs = 5;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        ctx.lineTo(lerp(a.x0, a.x1, t) + randRange(-5, 5), lerp(a.y0, a.y1, t) + randRange(-5, 5));
      }
      ctx.lineTo(a.x1, a.y1);
      ctx.stroke();
      ctx.restore();
    }
    for (const r of this.shriekRings) {
      const k = r.life / r.maxLife;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // a soft body so the wave reads at a glance, plus a bright leading edge
      const grd = ctx.createRadialGradient(r.x, r.y, Math.max(0, r.r - 26), r.x, r.y, r.r);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(208,160,232,${(k * 0.16).toFixed(3)})`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = k * 0.75;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = 2 + k * 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = k * 0.3;
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, r.r - 14), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    for (const w of this.webBlasts) {
      const k = w.life / w.max;
      ctx.save();
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = '#e8e8f2';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.x + Math.cos(a) * w.r * (1 - k * 0.3), w.y + Math.sin(a) * w.r * (1 - k * 0.3));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. particles + popups
    this.particles.draw(ctx);
    this.popups.draw(ctx);

    // 8. faint eye glow for nearby zombies (pre-baked sprite, not a gradient)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowImg = this._eyeGlow();
    const gr = glowImg.width / 2;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const gx = z.pos.x - camX, gy = z.pos.y - camY - HEAD_OFF_Y;
      if (gx < -20 || gy < -20 || gx > vw + 20 || gy > vh + 20) continue;
      ctx.drawImage(glowImg, Math.round(z.pos.x - gr), Math.round(z.pos.y - HEAD_OFF_Y - gr));
    }
    ctx.restore();

    ctx.restore();     // <-- back to screen space

    // 9. weather: drifting leaves above the world
    this.drawWeather(ctx, camX, camY);

    // 10. lighting (screen space!)
    this.drawLighting(ctx, camX, camY);

    // 11. vignette + HUD
    drawVignette(ctx, vw, vh, 0.38);
    if (this.started) this.hud.draw(ctx, this, vw, vh);
    if (this.teleportFx > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.teleportFx * 0.45})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    this.achievements.drawBanner?.(ctx, vw, vh);

    if (!this.started) drawTitle(ctx, this, vw, vh);
    else if (this.gameOver) drawGameOver(ctx, this, vw, vh);
    else if (this.paused) drawPause(ctx, this, vw, vh);
  }

  /** All light positions are world-space; the layer itself is screen-space. */
  drawLighting(ctx, camX, camY) {
    const L = this.lighting;
    const sx = (wx) => wx - camX;
    const sy = (wy) => wy - camY;
    L.begin();

    // ceiling lamps -- the mains ones only burn once the generator is on
    for (const l of LAMPS) {
      if (l.mains && !this.powerOn) continue;
      const x = sx(l.x), y = sy(l.y);
      if (x < -220 || y < -220 || x > VW + 220 || y > VH + 220) continue;
      let f = l.flick;
      if (l.mains && this.powerSurge > 0) f *= 0.4 + Math.random() * 1.4;
      L.point(x, y, 152 * f, 1.0 * f, `rgba(255,182,96,${0.40 * f})`, 0.62 * f);
    }

    // perk machines glow their own colour
    if (this.powerOn) {
      for (const ps of this.map.perkSpots) {
        const def = PERKS[ps.id];
        const pulse = 0.75 + Math.sin(this.time * 2.4 + ps.x * 0.1) * 0.25;
        L.point(sx(ps.x), sy(ps.y), 96 * pulse, 0.85, hexA(def.colour, 0.30 * pulse), 0.45);
      }
      // the open box throws light
      const bs = this.box.spot;
      L.point(sx(bs.x), sy(bs.y), this.box.open ? 150 : 84, 0.8,
        'rgba(255,225,150,0.30)', this.box.open ? 0.55 : 0.22);
      // Pack-a-Punch drum
      {
        const pp = this.map.papSpot;
        const pulse = 0.8 + Math.sin(this.time * 2.2) * 0.2;
        L.point(sx(pp.x), sy(pp.y - 4), 130 * pulse, 0.85, 'rgba(130,235,110,0.30)', 0.55);
      }
      // the vault
      if (this.map.secretDoorOpen) {
        L.point(sx(this.map.secretLoot[0]?.x ?? 0), sy(this.map.secretLoot[0]?.y ?? 0), 120, 0.7,
          'rgba(240,220,150,0.28)', 0.4);
      }
    }

    // armed traps light their own corner of the map
    for (const t of this.traps.list) {
      if (!t.running) continue;
      const c = t.centre();
      const k = 0.7 + Math.sin(this.time * 11) * 0.3;
      L.point(sx(c.x), sy(c.y), Math.max(t.zw, t.zh) * 1.5, 0.7 * k,
        hexA(t.kind.colour, 0.34), 0.6 * k);
    }

    // player torch + personal bubble
    const p = this.player;
    L.point(sx(p.pos.x), sy(p.pos.y), 520, 0.52, 'rgba(104,134,186,0.16)', 0.30);
    L.cone(sx(p.pos.x), sy(p.pos.y - 6), p.aim, 215, 0.58, 0.95);
    L.point(sx(p.pos.x), sy(p.pos.y - 4), 76, 0.74, 'rgba(255,210,150,0.15)', 0.32);

    for (const f of this.flashLights) {
      L.point(sx(f.x), sy(f.y), f.r, 1, f.colour ? hexA(f.colour, 0.5) : 'rgba(255,190,110,0.55)', 0.9);
    }
    for (const f of this.explosionLights) {
      const k = f.life / f.max;
      L.point(sx(f.x), sy(f.y), f.r * (0.6 + (1 - k) * 0.6), k,
        f.colour ? hexA(f.colour, 0.65 * k) : `rgba(255,170,80,${0.7 * k})`, 0.9 * k);
    }
    // cold moonlight at every window -- brighter once the boards are off, which
    // is also the only warning you get that something is climbing in
    for (const b of this.map.barricades) {
      const bx = sx(b.cx), by = sy(b.cy);
      if (bx < -110 || by < -110 || bx > VW + 110 || by > VH + 110) continue;
      const broken = b.planks <= 0;
      L.point(bx, by, broken ? 96 : 62, broken ? 0.6 : 0.34,
        broken ? 'rgba(126,156,198,0.18)' : 'rgba(110,140,180,0.10)', broken ? 0.34 : 0.18);
    }
    L.composite(ctx, VW, VH);

    // lamp fixtures (drawn after the darkness so they stay visible)
    ctx.save();
    for (const l of LAMPS) {
      if (l.mains && !this.powerOn) continue;
      const lx = l.x - camX, ly = l.y - camY;
      if (lx < -20 || ly < -20 || lx > VW + 20 || ly > VH + 20) continue;
      ctx.globalAlpha = 0.55 * l.flick;
      ctx.fillStyle = '#20211f';
      ctx.fillRect(lx - 5, ly - 2, 10, 3);
      ctx.fillStyle = `rgba(255,205,130,${0.9 * l.flick})`;
      ctx.fillRect(lx - 3, ly - 1, 6, 2);
      ctx.globalAlpha = 0.20 * l.flick;
      ctx.fillStyle = '#ffcf80';
      ctx.fillRect(lx - 7, ly - 5, 14, 9);
    }
    ctx.restore();
  }

  // ------------------------------------------------------- level furniture
  drawBarricades(ctx) {
    for (const b of this.map.barricades) {
      if (!this._vis(b.cx, b.cy, 70)) continue;
      const minX = Math.min(...b.tiles.map((t) => t % this.map.w));
      const maxX = Math.max(...b.tiles.map((t) => t % this.map.w));
      const minY = Math.min(...b.tiles.map((t) => (t / this.map.w) | 0));
      const maxY = Math.max(...b.tiles.map((t) => (t / this.map.w) | 0));
      const x = minX * T, y = minY * T;
      const w = (maxX - minX + 1) * T, h = (maxY - minY + 1) * T;

      // dark opening
      ctx.fillStyle = '#14161b';
      ctx.fillRect(x, y, w, h);
      // frame
      ctx.fillStyle = '#3f2a17';
      if (b.horizontal) {
        ctx.fillRect(x - 1, y - 1, w + 2, 3);
        ctx.fillRect(x - 1, y + h - 2, w + 2, 3);
      } else {
        ctx.fillRect(x - 1, y - 1, 3, h + 2);
        ctx.fillRect(x + w - 2, y - 1, 3, h + 2);
      }

      // planks
      const n = b.planks;
      if (n > 0) {
        const gap = 1.4;
        for (let i = 0; i < n; i++) {
          let px, py, pw, ph;
          if (b.horizontal) {
            const slot = h / b.maxPlanks;
            py = y + i * slot + 0.5;
            px = x - 2;
            pw = w + 4;
            ph = slot - gap;
          } else {
            const slot = w / b.maxPlanks;
            px = x + i * slot + 0.5;
            py = y - 2;
            pw = slot - gap;
            ph = h + 4;
          }
          ctx.fillStyle = '#6a4a2a';
          ctx.fillRect(px, py, pw, ph);
          ctx.fillStyle = '#8a6338';
          ctx.fillRect(px, py, b.horizontal ? pw : 1, b.horizontal ? 1 : ph);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          if (b.horizontal) ctx.fillRect(px, py + ph - 1, pw, 1);
          else ctx.fillRect(px + pw - 1, py, 1, ph);
          // nails
          ctx.fillStyle = '#2c2c30';
          if (b.horizontal) { ctx.fillRect(px + 2, py + ph / 2 - 0.5, 1, 1); ctx.fillRect(px + pw - 3, py + ph / 2 - 0.5, 1, 1); }
          else { ctx.fillRect(px + pw / 2 - 0.5, py + 2, 1, 1); ctx.fillRect(px + pw / 2 - 0.5, py + ph - 3, 1, 1); }
        }
      }
      if (b.hurt > 0 && n > 0) {
        ctx.save();
        ctx.globalAlpha = b.hurt / 0.55 * 0.25;
        ctx.fillStyle = '#ff6a4a';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        ctx.restore();
      }
    }
  }

  drawDoors(ctx) {
    for (const d of this.map.doors) {
      if (!this._vis(d.cx, d.cy, 60)) continue;
      const x = d.tx * T, y = d.ty * T;
      if (d.open) {
        // doorway: just a dark threshold
        ctx.fillStyle = 'rgba(10,10,14,0.55)';
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = '#3f2a17';
        if (d.horizontal) { ctx.fillRect(x, y - 1, T, 2); ctx.fillRect(x, y + T - 1, T, 2); }
        else { ctx.fillRect(x - 1, y, 2, T); ctx.fillRect(x + T - 1, y, 2, T); }
        continue;
      }
      // boarded up
      ctx.fillStyle = '#241a12';
      ctx.fillRect(x, y, T, T);
      const planks = 4;
      for (let i = 0; i < planks; i++) {
        if (d.horizontal) {
          const slot = T / planks;
          const py = y + i * slot + 0.5;
          ctx.fillStyle = '#5a3f24';
          ctx.fillRect(x - 2, py, T + 4, slot - 1.2);
          ctx.fillStyle = '#7a5730';
          ctx.fillRect(x - 2, py, T + 4, 1);
        } else {
          const slot = T / planks;
          const px = x + i * slot + 0.5;
          ctx.fillStyle = '#5a3f24';
          ctx.fillRect(px, y - 2, slot - 1.2, T + 4);
          ctx.fillStyle = '#7a5730';
          ctx.fillRect(px, y - 2, 1, T + 4);
        }
      }
      // price tag
      const p = this.player;
      if (dist(p.pos.x, p.pos.y, d.cx, d.cy) < 90) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(`${d.price}`, d.cx + 1, d.cy + 4);
        ctx.fillStyle = this.points >= d.price ? '#f0d98a' : '#8a8371';
        ctx.fillText(`${d.price}`, d.cx, d.cy + 3);
        ctx.restore();
      }
    }
  }

  drawWallBuys(ctx) {
    for (const wb of this.map.wallBuys) {
      if (!this._vis(wb.wallCX, wb.wallCY, 60)) continue;
      const def = WEAPONS[wb.weapon];
      const gun = this.art.guns[wb.weapon];
      const cx = wb.wallCX, cy = wb.wallCY + (wb.facing === 'up' ? 7 : -7);
      ctx.save();
      // wall shadow behind the gun
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 17, cy - 5, 34, 10);
      ctx.globalAlpha = 1;
      ctx.drawImage(gun.img, Math.round(cx - 10), Math.round(cy - 4));
      ctx.restore();

      const slot = this.player.loadout[wb.weapon];
      const price = slot.owned ? def.ammoPrice : def.price;
      const afford = this.points >= price;
      ctx.save();
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      const ly = cy + (wb.facing === 'up' ? 18 : -10);
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(`${price}`, cx + 1, ly + 1);
      ctx.fillStyle = afford ? '#f0d98a' : '#6f6a5c';
      ctx.fillText(`${price}`, cx, ly);
      ctx.restore();
    }
  }

  // ------------------------------------------------------- new level gear --
  drawPerkMachines(ctx) {
    for (const ps of this.map.perkSpots) {
      if (!this._vis(ps.x, ps.y, 60)) continue;
      const def = PERKS[ps.id];
      const owned = this.player.hasPerk(ps.id);
      const lit = this.powerOn;
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(ps.x, ps.y + 14, 12, 4, 0, 0, TAU);
      ctx.fill();
      // cabinet
      ctx.fillStyle = lit ? '#3a3f46' : '#2a2d33';
      ctx.fillRect(ps.x - 11, ps.y - 16, 22, 30);
      ctx.fillStyle = lit ? '#4b525b' : '#35383f';
      ctx.fillRect(ps.x - 11, ps.y - 16, 22, 4);
      ctx.fillStyle = '#1b1d21';
      ctx.fillRect(ps.x - 11, ps.y + 10, 22, 4);
      // bottle window
      ctx.fillStyle = '#0d0f12';
      ctx.fillRect(ps.x - 7, ps.y - 11, 14, 16);
      ctx.fillStyle = lit ? def.colour : '#3a3a3a';
      ctx.globalAlpha = lit ? 0.85 : 0.4;
      ctx.fillRect(ps.x - 5, ps.y - 7, 4, 9);
      ctx.fillRect(ps.x + 1, ps.y - 5, 4, 7);
      ctx.fillRect(ps.x - 1, ps.y + 2, 4, 4);
      ctx.globalAlpha = 1;
      // lettering
      ctx.fillStyle = lit ? def.colour : '#6a6a6a';
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(owned ? 'SOLD' : def.short, ps.x, ps.y + 8);
      ctx.restore();

      if (!owned && dist(this.player.pos.x, this.player.pos.y, ps.x, ps.y) < 90) {
        ctx.save();
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = 'center';
        const afford = this.points >= def.price && this.powerOn;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(`${def.price}`, ps.x + 1, ps.y + 25);
        ctx.fillStyle = afford ? '#f0d98a' : '#6f6a5c';
        ctx.fillText(`${def.price}`, ps.x, ps.y + 24);
        ctx.restore();
      }
      if (owned) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = def.colour;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ps.x, ps.y - 2, 15, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawMysteryBox(ctx) {
    this.box.draw(ctx, this.art);
    const s = this.box.spot;
    const price = this.box.price();
    const showPrice = this.box.state === 'closed'
      && dist(this.player.pos.x, this.player.pos.y, s.x, s.y) < 90;
    if (showPrice) {
      ctx.save();
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      const afford = this.powerOn && this.points >= price;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(`${price}`, s.x + 1, s.y + 26);
      ctx.fillStyle = afford ? '#f0d98a' : '#6f6a5c';
      ctx.fillText(`${price}`, s.x, s.y + 25);
      if (!this.powerOn) {
        ctx.fillStyle = '#c4463a';
        ctx.fillText('NO POWER', s.x, s.y + 35);
      }
      ctx.restore();
    }
  }

  drawPowerSwitch(ctx) {
    const sw = this.map.powerSwitch;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sw.x, sw.y + 12, 11, 4, 0, 0, TAU); ctx.fill();
    // generator cabinet
    ctx.fillStyle = '#3d3a33';
    ctx.fillRect(sw.x - 10, sw.y - 14, 20, 26);
    ctx.fillStyle = '#4e4a41';
    ctx.fillRect(sw.x - 10, sw.y - 14, 20, 4);
    ctx.fillStyle = '#22201c';
    ctx.fillRect(sw.x - 10, sw.y + 8, 20, 4);
    // lever
    ctx.fillStyle = this.powerOn ? '#8fe05a' : '#c4463a';
    ctx.fillRect(sw.x - 3, this.powerOn ? sw.y - 8 : sw.y - 1, 6, 9);
    ctx.fillStyle = '#20201c';
    ctx.fillRect(sw.x - 1, this.powerOn ? sw.y - 6 : sw.y + 1, 2, 5);
    // lamp
    const glow = this.powerOn ? 1 : 0.25;
    ctx.fillStyle = `rgba(${this.powerOn ? '140,230,110' : '150,60,50'},${glow})`;
    ctx.beginPath(); ctx.arc(sw.x, sw.y - 18, 3, 0, TAU); ctx.fill();
    ctx.restore();

    if (!this.powerOn) {
      ctx.save();
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText('POWER', sw.x + 1, sw.y + 19);
      ctx.fillStyle = '#f0d98a';
      ctx.fillText('POWER', sw.x, sw.y + 18);
      ctx.restore();
    }
  }

  drawWorkbench(ctx) {
    this.workbench.draw(ctx);
    ctx.save();
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText('WORKBENCH  [E]', this.workbench.x + 1, this.workbench.y + 22);
    ctx.fillStyle = '#f0d98a';
    ctx.fillText('WORKBENCH  [E]', this.workbench.x, this.workbench.y + 21);
    ctx.restore();
  }

  drawPackAPunch(ctx) {
    const { x, y } = this.map.papSpot;
    const t = this.time;
    const lit = this.powerOn;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 16, 15, 5, 0, 0, TAU); ctx.fill();

    // cabinet: a squat green machine with a glowing drum
    ctx.fillStyle = lit ? '#2c3a2a' : '#22261f';
    ctx.fillRect(x - 14, y - 20, 28, 36);
    ctx.fillStyle = lit ? '#3b4d36' : '#2b2f27';
    ctx.fillRect(x - 14, y - 20, 28, 5);
    ctx.fillStyle = '#171a14';
    ctx.fillRect(x - 14, y + 12, 28, 4);
    ctx.strokeStyle = '#12150f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 14.5, y - 20.5, 29, 37);

    // the drum: light pours out of it and it slowly turns
    ctx.fillStyle = '#0c0f0a';
    ctx.beginPath(); ctx.arc(x, y - 4, 9, 0, TAU); ctx.fill();
    if (lit) {
      const pulse = 0.65 + Math.sin(t * 2.2) * 0.25;
      const g = ctx.createRadialGradient(x, y - 4, 0, x, y - 4, 9);
      g.addColorStop(0, `rgba(150,240,110,${0.95 * pulse})`);
      g.addColorStop(0.6, `rgba(90,200,80,${0.5 * pulse})`);
      g.addColorStop(1, 'rgba(40,120,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - 4, 9, 0, TAU); ctx.fill();
      // spinning vanes
      ctx.save();
      ctx.translate(x, y - 4);
      ctx.rotate(t * 1.4);
      ctx.strokeStyle = `rgba(210,255,180,${0.5 * pulse})`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
        ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.stroke();
      }
      ctx.restore();
    }
    // hopper slot + crank
    ctx.fillStyle = '#15180f';
    ctx.fillRect(x - 8, y + 4, 16, 5);
    ctx.fillStyle = lit ? '#8fbf6a' : '#4a4f42';
    ctx.fillRect(x + 9, y - 12, 3, 9);
    ctx.fillRect(x + 6, y - 13, 9, 3);

    // label
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = lit ? '#8fe05a' : '#5a5f52';
    ctx.fillText('PACK-A-PUNCH', x, y - 24);
    ctx.restore();

    if (dist(this.player.pos.x, this.player.pos.y, x, y) < 100) {
      ctx.save();
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      const ok = this.powerOn && !this.player.packed.has(this.player.current)
        && this.points >= PAP_PRICE;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(`${PAP_PRICE}`, x + 1, y + 25);
      ctx.fillStyle = ok ? '#8fe05a' : '#6f6a5c';
      ctx.fillText(`${PAP_PRICE}`, x, y + 24);
      ctx.restore();
    }
  }

  drawSecretSwitches(ctx) {
    for (const sw of this.map.secretSwitches) {
      if (!this._vis(sw.x, sw.y, 40)) continue;
      ctx.save();
      ctx.fillStyle = '#2b2b30';
      ctx.fillRect(sw.x - 4, sw.y - 7, 8, 14);
      ctx.fillStyle = sw.found ? '#8fe05a' : '#6b6b73';
      ctx.fillRect(sw.x - 2, sw.found ? sw.y - 4 : sw.y + 1, 4, 4);
      ctx.strokeStyle = '#15161a';
      ctx.lineWidth = 1;
      ctx.strokeRect(sw.x - 4.5, sw.y - 7.5, 9, 15);
      if (!sw.found) {
        ctx.globalAlpha = 0.35 + Math.sin(this.time * 3 + sw.x) * 0.2;
        ctx.strokeStyle = '#9fd0e0';
        ctx.beginPath(); ctx.arc(sw.x, sw.y, 12, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawSecretDoor(ctx) {
    const d = this.map.secretDoorIdx;
    if (d == null) return;
    const tx = d % this.map.w, ty = (d / this.map.w) | 0;
    const x = tx * T, y = ty * T;
    if (!this.map.secretDoorOpen) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 2) * 0.12;
      ctx.strokeStyle = '#9fd0e0';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 16, 0, TAU); ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(12,14,18,0.75)';
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = 'rgba(240,220,150,0.35)';
      ctx.fillRect(x + 2, y + 2, T - 4, 2);
    }
  }

  drawSecretLoot(ctx) {
    if (!this.map.secretDoorOpen) return;
    for (const l of this.map.secretLoot) {
      if (l.taken) continue;
      ctx.save();
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(l.x - 9, l.y - 7, 18, 14);
      ctx.fillStyle = '#5d4a2e';
      ctx.fillRect(l.x - 9, l.y - 7, 18, 3);
      ctx.fillStyle = 'rgba(240,217,138,' + (0.4 + Math.sin(this.time * 3) * 0.25) + ')';
      ctx.fillRect(l.x - 5, l.y - 2, 10, 4);
      ctx.restore();
    }
  }

  drawPowerups(ctx) {
    for (const pu of this.powerups) {
      if (this._vis(pu.x, pu.y, 40)) pu.draw(ctx);
    }
  }

  /** Cull helper: is this world point anywhere near the visible viewport? */
  _vis(x, y, pad = 60) {
    return x > this.cam.x - pad && y > this.cam.y - pad
      && x < this.cam.x + VW + pad && y < this.cam.y + VH + pad;
  }

  /** Baked once: the soft green eye-glow blobs zombies carry. */
  _eyeGlow() {
    if (this.__eyeGlow) return this.__eyeGlow;
    const c = document.createElement('canvas');
    c.width = 18; c.height = 18;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(9, 9, 0, 9, 9, 9);
    g.addColorStop(0, 'rgba(180,220,110,0.38)');
    g.addColorStop(1, 'rgba(120,180,60,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 18, 18);
    this.__eyeGlow = c;
    return c;
  }

  drawWeather(ctx, camX, camY) {
    ctx.save();
    for (const l of this.weather.leaves) {
      const sx = l.x - camX, sy = l.y - camY;
      if (sx < -10 || sy < -10 || sx > VW + 10 || sy > VH + 10) continue;
      if (sx < -10 || sy < -10 || sx > VW + 10 || sy > VH + 10) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(l.r);
      ctx.globalAlpha = l.a;
      ctx.fillStyle = '#6a5a38';
      ctx.fillRect(-1.5, -0.75, 3, 1.5);
      ctx.fillStyle = '#8a7550';
      ctx.fillRect(-1.5, -0.75, 2, 1);
      ctx.restore();
    }
    ctx.restore();
  }

  drawGrenadeCrates(ctx) {
    for (const g of this.map.grenadeCrates) {
      if (!this._vis(g.x, g.y, 50)) continue;
      ctx.save();
      ctx.fillStyle = '#3f3a2c';
      ctx.fillRect(g.x - 8, g.y - 6, 16, 11);
      ctx.fillStyle = '#57503c';
      ctx.fillRect(g.x - 8, g.y - 6, 16, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(g.x - 8, g.y + 3, 16, 2);
      ctx.fillStyle = '#2f3a2c';
      for (let i = 0; i < 3; i++) ctx.fillRect(g.x - 5 + i * 4, g.y - 8, 3, 4);
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.points >= GRENADE_PRICE ? '#f0d98a' : '#6f6a5c';
      ctx.fillText(`${GRENADE_PRICE}`, g.x, g.y + 12);
      ctx.restore();
    }
  }
}
