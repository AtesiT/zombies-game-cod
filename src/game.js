// Game state: rounds, spawning, interactions, camera and the frame renderer.
import { T, buildArt } from './art.js';
import { GameMap } from './map.js';
import { Player, Zombie, Particles, Popups, throwGrenade, HEAD_OFF_Y } from './entities.js';
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, GRENADE_MAX } from './weapons.js';
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

const MAX_ALIVE_BASE = 24;

// three ceiling lamps per room so every window has some spill light
const LAMPS = [
  { x: 11, y: 7 }, { x: 7, y: 11 }, { x: 18, y: 11 },
  { x: 30, y: 8 }, { x: 36, y: 11 }, { x: 40, y: 8 },
  { x: 11, y: 19 }, { x: 7, y: 22 }, { x: 18, y: 22 },
  { x: 30, y: 19 }, { x: 36, y: 22 }, { x: 40, y: 19 },
].map((l) => ({ x: (l.x + 0.5) * T, y: (l.y + 0.5) * T, phase: Math.random() * TAU, flick: 1 }));

export class Game {
  constructor(input) {
    this.input = input;
    this.vw = VW;
    this.vh = VH;
    this.map = new GameMap();
    this.art = buildArt();
    this.lighting = new Lighting(VW, VH, 0.5);
    this.hud = new HUD();

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
    this.zombies = [];
    this.grenades = [];
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

    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    this.cam.x = clamp(this.player.pos.x - VW / 2, 0, this.map.w * T - VW);
    this.cam.y = clamp(this.player.pos.y - VH / 2, 0, this.map.h * T - VH);
    this.revealAround(this.player.pos.x, this.player.pos.y, 14);
  }

  // ------------------------------------------------------------------ utils
  screenToWorld(sx, sy) { return { x: sx + this.cam.x, y: sy + this.cam.y }; }
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
        m.seen[ay * m.w + ax] = 1;
      }
    }
  }

  // ------------------------------------------------------------------ waves
  roundPlan(round) {
    const total = Math.round(6 + round * 3.5);
    const maxAlive = Math.min(MAX_ALIVE_BASE + Math.floor(round / 4) * 3, 34);
    const hp = Math.min(120 + (round - 1) * 46, 2600);
    const speed = Math.min(44 + (round - 1) * 1.5, 88);
    const interval = Math.max(0.3, 1.35 - round * 0.05);
    return { total, maxAlive, hp, speed, interval };
  }

  startRound(n) {
    this.round = n;
    this.stats.round = n;
    const plan = this.roundPlan(n);
    this.zombiesTotal = plan.total;
    this.zombiesSpawned = 0;
    this.zombiesKilled = 0;
    this.roundActive = true;
    this.intermission = 0;
    this.spawnTimer = 0.35;
    this.bannerShow(`ROUND ${n}`, n === 1 ? 'they are coming' : null, { dur: 2.4, big: true });
    audio.roundSting(true);
      }

  endRound() {
    this.roundActive = false;
    this.intermission = 6;
    this.respawnQueue = 0;
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
    const plan = this.roundPlan(this.round);
    const sp = this.pickSpawn();
    if (!sp) return;
    const jitter = 10;
    const z = new Zombie(this.map, sp.x + randRange(-jitter, jitter), sp.y + randRange(-jitter, jitter), {
      hp: Math.round(plan.hp * randRange(0.85, 1.15)),
      speed: plan.speed * randRange(0.88, 1.12),
      dmg: 34,
    });
    // zombies that arrive later in a round are a bit tougher
    this.zombies.push(z);
    this.zombiesSpawned++;
  }

  onZombieKilled(z, head, ptsOverride = null) {
    this.zombiesKilled++;
    this.stats.kills++;
    if (head) this.stats.headshots++;
    const pts = ptsOverride ?? (POINTS_KILL + (head ? POINTS_HEAD : 0));
    this.addPoints(pts, z.pos.x, z.pos.y - 24, ptsOverride ? '#a8d06a' : head ? '#f0d98a' : '#e6dcc2');
    // blood decal
    this.splat(z.pos.x, z.pos.y, 9 + Math.random() * 7, 0.5);
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
    for (const z of this.zombies) {
      if (z.dead) continue;
      const hx = z.pos.x, hy = z.pos.y - HEAD_OFF_Y;
      let res = pointSegDist2(hx, hy, ox, oy, ox + dx * def.range, oy + dy * def.range);
      let head = false;
      if (res.d2 > 3.9 * 3.9) {
        res = pointSegDist2(z.pos.x, z.pos.y, ox, oy, ox + dx * def.range, oy + dy * def.range);
        if (res.d2 > 7.2 * 7.2) continue;
      } else head = true;
      const t = Math.hypot(res.cx - ox, res.cy - oy);
      if (t > wallT) continue;
      hits.push({ z, t, head, x: res.cx, y: res.cy });
    }
    hits.sort((a, b) => a.t - b.t);

    let pierce = def.pierce;
    let endT = wallT;
    let anyHit = false;
    for (const h of hits) {
      const wasAlive = !h.z.dead;
      const mul = h.head ? def.headMul : 1;
      const res = h.z.hurt(def.dmg * mul, h.head, this, angle);
      if (!wasAlive) continue;
      anyHit = true;
      this.stats.hits++;
      this.addPoints(POINTS_HIT, h.x, h.y - 8, h.head ? '#f0d98a' : 'rgba(230,220,194,0.9)');
      this.hud.hit(h.head);
      if (res === 2) { this.onZombieKilled(h.z, h.head); }
      if (pierce > 0) { pierce--; endT = Math.max(endT, h.t + 8); }
      else { endT = h.t; break; }
    }

    if (!anyHit && wall) {
      this.particles.spark(wall.x, wall.y, Math.atan2(-wall.ny, -wall.nx), 5, '#d8c9a8');
      this.particles.dust(wall.x, wall.y, Math.atan2(-wall.ny, -wall.nx), 3);
      audio.impact(false, false);
    }

    const hx = ox + dx * endT, hy = oy + dy * endT;
    this.tracers.push({ x0: muzzle.x, y0: muzzle.y, x1: hx, y1: hy, life: 0.055, max: 0.055, colour: def.tracer });
  }

  // ---------------------------------------------------------- interactions
  updateInteraction() {
    const p = this.player;
    let best = null;

    for (const wb of this.map.wallBuys) {
      const d = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (d < 30) {
        const def = WEAPONS[wb.weapon];
        const owned = p.loadout[wb.weapon].owned;
        const price = owned ? def.ammoPrice : def.price;
        best = { type: 'wallbuy', weapon: wb.weapon, price, affordable: this.points >= price, d, wb };
      }
    }
    for (const g of this.map.grenadeCrates) {
      const d = dist(p.pos.x, p.pos.y, g.x, g.y);
      if (d < 30 && (!best || d < best.d)) {
        best = {
          type: 'grenade', price: GRENADE_PRICE, d,
          affordable: this.points >= GRENADE_PRICE && p.grenades < GRENADE_MAX,
        };
      }
    }
    for (const dr of this.map.doors) {
      if (dr.open) continue;
      const d = dist(p.pos.x, p.pos.y, dr.cx, dr.cy);
      if (d < 34 && (!best || d < best.d)) {
        best = { type: 'door', door: dr, price: dr.price, affordable: this.points >= dr.price, d };
      }
    }
    const nearB = this.map.nearestBarricade(p.pos.x, p.pos.y, 34, false);
    if (nearB) {
      const d = dist(p.pos.x, p.pos.y, nearB.cx, nearB.cy);
      if (d < 34 && (!best || d < best.d)) {
        best = { type: 'barricade', barricade: nearB, d, affordable: true, price: 0 };
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
      if (slot.owned && slot.reserve >= def.reserveMax && slot.mag >= def.magSize) {
        audio.deny();
        this.popups.add(p.pos.x, p.pos.y - 26, 'FULL AMMO', '#9a917c');
        return;
      }
      this.points -= price;
      const kind = p.giveWeapon(it.weapon);
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, kind === 'ammo' ? 'AMMO' : def.name.toUpperCase(), '#f0d98a', 12);
    } else if (it.type === 'door') {
      if (this.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      this.points -= it.price;
      it.door.open = true;
      this.stats.doors++;
      audio.buy();
      audio.door();
      this.popups.add(p.pos.x, p.pos.y - 26, 'DOOR OPEN', '#f0d98a', 12);
      this.map.buildFlow(p.pos.x, p.pos.y);
    } else if (it.type === 'grenade') {
      if (this.points < it.price || p.grenades >= GRENADE_MAX) { audio.deny(); return; }
      this.points -= it.price;
      p.grenades = GRENADE_MAX;
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, 'FRAG GRENADES', '#f0d98a', 12);
    }
  }

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
      if (b.planks === 1) this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    }
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
      this.map.buildFlow(this.player.pos.x, this.player.pos.y);
    }

    // ---- player ------------------------------------------------------------
    this.player.update(dt, this, this.input);
    this.revealAround(this.player.pos.x, this.player.pos.y, 11);

    if (this.input.wasPressed('Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5')) {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].findIndex((k) => this.input.wasPressed(k));
      const id = WEAPON_ORDER[n];
      if (id) this.player.switchTo(id);
    }
    if (this.input.wheel) this.player.cycle(this.input.wheel > 0 ? 1 : -1);

    // grenades
    if (this.input.wasPressed('KeyG') && this.player.grenades > 0 && !this.player.dead) {
      this.player.grenades--;
      throwGrenade(this, this.player.pos.x, this.player.pos.y, this.player.aim);
      this.player.vel.x -= Math.cos(this.player.aim) * 30;
      this.shake(2, 0.1);
    }

    this.updateInteraction();
    if (this.input.wasPressed('KeyE', 'KeyF')) this.doInteraction();
    if (this.input.isDown('KeyE')) this.rebuildTick(dt); else this._rebuildT = 0;

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
        if (sp) {
          const plan = this.roundPlan(this.round);
          this.zombies.push(new Zombie(this.map, sp.x + randRange(-8, 8), sp.y + randRange(-8, 8), {
            hp: Math.round(plan.hp * randRange(0.85, 1.15)),
            speed: plan.speed * randRange(0.9, 1.1),
            dmg: 34,
          }));
        }
        this.spawnTimer = 0.5;
      }
    }

    for (const g of this.grenades) g.update(dt, this);
    this.grenades = this.grenades.filter((g) => !g.remove);

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
    this.drawWallBuys(ctx);
    this.drawGrenadeCrates(ctx);

    // 3. actors, sorted by feet depth
    const actors = this.zombies.filter((z) => !z.remove);
    const list = actors.map((z) => ({ y: z.pos.y, d: () => z.draw(ctx, this.art) }));
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

    // 6. grenades
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

    // 7. particles + popups
    this.particles.draw(ctx);
    this.popups.draw(ctx);

    // 8. faint eye glow for nearby zombies
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const z of this.zombies) {
      if (z.dead) continue;
      const sx = z.pos.x - camX, sy = z.pos.y - camY;
      if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
      const g = ctx.createRadialGradient(z.pos.x, z.pos.y - HEAD_OFF_Y, 0, z.pos.x, z.pos.y - HEAD_OFF_Y, 7);
      g.addColorStop(0, 'rgba(180,220,110,0.35)');
      g.addColorStop(1, 'rgba(120,180,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(z.pos.x - 8, z.pos.y - HEAD_OFF_Y - 8, 16, 16);
    }
    ctx.restore();

    ctx.restore();     // <-- back to screen space

    // 9. lighting (screen space!)
    this.drawLighting(ctx, camX, camY);

    // 10. vignette + HUD
    drawVignette(ctx, vw, vh, 0.42);
    if (this.started) this.hud.draw(ctx, this, vw, vh);

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

    // ceiling lamps
    for (const l of LAMPS) {
      const x = sx(l.x), y = sy(l.y);
      if (x < -220 || y < -220 || x > VW + 220 || y > VH + 220) continue;
      L.point(x, y, 132 * l.flick, 0.92 * l.flick, `rgba(255,178,90,${0.30 * l.flick})`, 0.55 * l.flick);
    }
    // player torch + personal bubble
    const p = this.player;
    L.point(sx(p.pos.x), sy(p.pos.y), 470, 0.44, 'rgba(96,126,178,0.12)', 0.26);
    L.cone(sx(p.pos.x), sy(p.pos.y - 6), p.aim, 195, 0.52, 0.9);
    L.point(sx(p.pos.x), sy(p.pos.y - 4), 76, 0.74, 'rgba(255,210,150,0.15)', 0.32);

    for (const f of this.flashLights) {
      L.point(sx(f.x), sy(f.y), f.r, 1, 'rgba(255,190,110,0.55)', 0.9);
    }
    for (const f of this.explosionLights) {
      const k = f.life / f.max;
      L.point(sx(f.x), sy(f.y), f.r * (0.6 + (1 - k) * 0.6), k, `rgba(255,170,80,${0.7 * k})`, 0.9 * k);
    }
    // cold moonlight at every window -- brighter once the boards are off, which
    // is also the only warning you get that something is climbing in
    for (const b of this.map.barricades) {
      const broken = b.planks <= 0;
      L.point(sx(b.cx), sy(b.cy), broken ? 96 : 62, broken ? 0.6 : 0.34,
        broken ? 'rgba(126,156,198,0.18)' : 'rgba(110,140,180,0.10)', broken ? 0.34 : 0.18);
    }
    L.composite(ctx, VW, VH);

    // lamp fixtures (drawn after the darkness so they stay visible)
    ctx.save();
    for (const l of LAMPS) {
      const sx = l.x - camX, sy = l.y - camY;
      if (sx < -20 || sy < -20 || sx > VW + 20 || sy > VH + 20) continue;
      ctx.globalAlpha = 0.55 * l.flick;
      ctx.fillStyle = '#20211f';
      ctx.fillRect(sx - 5, sy - 2, 10, 3);
      ctx.fillStyle = `rgba(255,205,130,${0.9 * l.flick})`;
      ctx.fillRect(sx - 3, sy - 1, 6, 2);
      ctx.globalAlpha = 0.20 * l.flick;
      ctx.fillStyle = '#ffcf80';
      ctx.fillRect(sx - 7, sy - 5, 14, 9);
    }
    ctx.restore();
  }

  // ------------------------------------------------------- level furniture
  drawBarricades(ctx) {
    for (const b of this.map.barricades) {
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
      const def = WEAPONS[wb.weapon];
      const artKey = def.art === 'kar98k' ? 'rifle' : def.art === 'trenchgun' ? 'shotgun'
        : def.art === 'm1911' ? 'pistol' : 'smg';
      const img = this.art.plaques[artKey];
      const px = wb.wallCX - img.width / 2;
      const py = wb.wallCY - img.height / 2 + (wb.facing === 'up' ? 6 : -6);
      ctx.drawImage(img, Math.round(px), Math.round(py));

      // price
      const slot = this.player.loadout[wb.weapon];
      const price = slot.owned ? def.ammoPrice : def.price;
      const afford = this.points >= price;
      ctx.save();
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      const ly = py + (wb.facing === 'up' ? img.height + 2 : -4);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(`${price}`, wb.wallCX + 1, ly + 1);
      ctx.fillStyle = afford ? '#f0d98a' : '#6f6a5c';
      ctx.fillText(`${price}`, wb.wallCX, ly);
      ctx.restore();
    }
  }

  drawGrenadeCrates(ctx) {
    for (const g of this.map.grenadeCrates) {
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
