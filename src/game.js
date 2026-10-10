// Game state: rounds, spawning, interactions, camera and the frame renderer.
import { T, buildArt } from './art.js';
import { GameMap } from './map.js';
import {
  Player, Zombie, Particles, Popups, throwGrenade, MonkeyBomb, HEAD_OFF_Y, ENEMY_TYPES, ZSTATE,
} from './entities.js';
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, GRENADE_MAX, PAP_PRICE, defFor, packedTracer } from './weapons.js';
import { PERKS } from './perks.js';
import { MysteryBox } from './mysterybox.js';
import { Powerup, rollPowerup } from './powerups.js';
import { Workbench, RECIPES, RECIPE_ORDER } from './crafting.js';
import { Achievements, EasterEgg, submitScore } from './achievements.js';
import { Traps, TRAP_PRICE } from './traps.js';
import { settings, SETTING_DEFS } from './settings.js';
import { Net, textEntry, defaultRelay, relayURL } from './net.js';
import { Lighting, drawVignette } from './lighting.js';
import {HUD, drawTitle, drawPause, drawGameOver, drawSettings, drawMenu, menuRows, menuHitTest, text, drawCursor, drawControls, drawDebug, debugHitTest} from './hud.js';
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

function hslToRgb(h, s, l) {
  if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/**
 * '#rrggbb' -> 'rgba(r,g,b,a)'. Also takes 'hsl(...)' and 'rgb(...)', which
 * matters more than it sounds: a punched gun's tracer is an hsl rainbow, and
 * this used to run it through parseInt(base 16) and hand the renderer
 * rgba(NaN,NaN,NaN) -- which is to say, no muzzle light at all, on exactly
 * the shots that are supposed to be the loudest in the game.
 */
export function hexA(hex, a) {
  const c = String(hex).trim();
  if (c[0] === '#') {
    const h = c.slice(1);
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    if (!Number.isFinite(n)) return `rgba(255,255,255,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const hsl = c.match(/^hsla?\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) {
    const [r, g, b] = hslToRgb(((+hsl[1] % 360) + 360) % 360 / 360, +hsl[2] / 100, +hsl[3] / 100);
    return `rgba(${r},${g},${b},${a})`;
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return `rgba(${+rgb[1]},${+rgb[2]},${+rgb[3]},${a})`;
  return `rgba(255,255,255,${a})`;
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

let activeGame = null;
let settingsHooked = false;

// --- the decal layer -------------------------------------------------------
// Blood and scorch used to live on one full-size canvas per storey --
// 1728x1200 -- and every frame blitted an 800x500 window out of it whether
// or not there was any blood in view. Half resolution is invisible on a
// splatter (it only softens the edges) and a quarter of the pixels to move;
// the dirty box means a clean stretch of floor costs nothing at all; and
// the wash keeps a long session from flooding the map solid red.
// --- the loudspeaker -------------------------------------------------------
// Somebody else is in this building, and from round ten they say so. Short,
// dry, and always about what just happened rather than about the plot.
const VOICE_LINES = {
  round: [
    'You are still here. They have noticed.',
    'They learn where you stand. Stop standing there.',
    'The generator will not hold forever.',
    'Something on the roof is walking about.',
    'Do not let them pile up in a doorway.',
  ],
  medic: ['That one was putting them back together.', 'Leave it dead this time.'],
  amalgam: ['Three of them went in. One came out. That is worse.'],
  breach: ['They are inside. That window is gone.'],
  hurt: ['Get up. Get up.'],
};

const DECAL_SCALE = 0.5;
const DECAL_MAX = 260;
const DECAL_WASH = 0.22;

export class Game {
  constructor(input) {
    this.input = input;
    activeGame = this;
    if (!settingsHooked) {
      settingsHooked = true;
      settings.onChange(() => activeGame?.applySettings());
    }
    this.vw = VW;
    this.vh = VH;
    this.map = new GameMap();
    this.art = buildArt();
    this.lighting = new Lighting(VW, VH, 0.5);
    this.hud = new HUD();
    this.achievements = new Achievements();
    this.net = new Net(this);
    this.net.onStatus = (n) => this._onNetStatus(n);
    // anything holding a Game should be able to read the player's settings
    // without importing the singleton itself (src/main.js and src/touch.js do)
    this.settings = settings;
    // the front door: SOLO / MULTIPLAYER / SETTINGS before anything else runs
    this.scene = 'menu';
    this.menuIndex = 0;
    this.menuHover = -1;
    this.mpIndex = 0;
    this.netMsg = null;

    // performance state: what the player asked for, and how far the automatic
    // governor has backed off from it while frames are slow.
    this.stepRate = 60;
    this._userLighting = 2;
    this._perfStage = 0;
    this._slowFrames = 0;
    this._fastFrames = 0;

    this._clearDecals();
    this.decals = this._decalFor(0);
    this.decalCtx = this._decalCtx[0];

    this.reset();
  }

  reset() {
    this.map = new GameMap();
    this._clearDecals();
    this.decals = this._decalFor(this.map.floor);
    this.decalCtx = this._decalCtx[this.map.floor];
    this.player = new Player(this.map, this.map.playerStart.x, this.map.playerStart.y);
    this.player.game = this;
    this.player.netId = 0;
    this.player.name = this.net?.name || 'PLAYER';
    this.player.floor = this.map.floor;
    // every body in the round, local one first: the host simulates all of
    // them, a guest only ever draws them
    this.players = [this.player];
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
    this.fires = [];
    this.gases = [];
    this.inFire = 0;
    this.inGas = 0;
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
    this._fusionCd = 6;          // no amalgams in the first seconds of a round
    this.intermission = 3.0;
    this.roundActive = false;
    this.started = false;
    this.paused = false;
    this.gameOver = false;
    this.overT = 0;
    this.banner = null;
    this.interaction = null;
    this.muzzleFlash = null;
    this.settingsOpen = false;
    // A panel for testing: god mode, all the perks, jump storey. It is not
    // part of the game -- it opens on the backquote key, or, on a phone that
    // has no such key, on five taps of the round counter.
    this.debugOpen = false;
    this.debugIndex = 0;
    this.debug = { god: false, ammo: false, paths: false };
    this._dbgTaps = 0;
    this._dbgTapT = -9;
    this.settingsIndex = 0;
    this.fps = 60;
    this.tension = 0;
    this.aimOnTarget = false;
    this.aimOnHead = false;
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

    this.rebuildFlow();
    this.cam.x = clamp(this.player.pos.x - VW / 2, 0, this.map.w * T - VW);
    this.cam.y = clamp(this.player.pos.y - VH / 2, 0, this.map.h * T - VH);
    this.revealAround(this.player.pos.x, this.player.pos.y, 14);
  }

  /**
   * Rebuilds the dijkstra field on every storey that currently matters. With
   * four of you scattered over three floors there is no single target, so a
   * storey points at whoever its own horde is mostly after, and empty
   * storeys aim at the stairwell that leads to the nearest living body.
   */
  rebuildFlow() {
    const live = (this.players ?? [this.player]).filter((pl) => pl && !pl.dead);
    if (!live.length) return;
    const floorOf = (pl) => pl.floor ?? this.map.floor;
    const done = new Set();

    for (let f = 0; f < this.map.floors.length; f++) {
      const lure = this.monkeys.find((m) => m.luring && (m.floor ?? f) === f);
      if (lure) {
        this.map.buildFlowOn(f, lure.pos.x, lure.pos.y);
        done.add(f);
        continue;
      }
      const on = live.filter((pl) => floorOf(pl) === f);
      if (!on.length) continue;
      done.add(f);
      let best = on[0], bestN = -1;
      for (const pl of on) {
        let n = 0;
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== f) continue;
          if (this.pickTarget(z) === pl) n++;
        }
        if (n > bestN) { bestN = n; best = pl; }
      }
      this.map.buildFlowOn(f, best.pos.x, best.pos.y);
    }

    for (let f = 0; f < this.map.floors.length; f++) {
      if (done.has(f)) continue;
      let target = null, bd = Infinity;
      for (const pl of live) {
        const d = Math.abs(floorOf(pl) - f);
        if (d < bd) { bd = d; target = pl; }
      }
      if (!target) continue;
      const hop = this.map.hopTowards(f, floorOf(target));
      if (!hop) continue;
      const exit = this.map.linkPos(hop.link, f);
      this.map.buildFlowOn(f, exit.x, exit.y);
    }
  }

  /** Blood and scorch marks are per storey -- what happens upstairs stays upstairs. */
  _clearDecals() {
    this._decals = [];
    this._decalCtx = [];
    this._decalCount = [];
    this._decalBox = [];
  }

  _decalFor(floor) {
    if (this._decals[floor]) return this._decals[floor];
    const c = document.createElement('canvas');
    c.width = Math.ceil(this.map.w * T * DECAL_SCALE);
    c.height = Math.ceil(this.map.h * T * DECAL_SCALE);
    const ctx = c.getContext('2d');
    // scale once, at creation: everything drawn on this layer can then keep
    // thinking in world pixels
    ctx.scale(DECAL_SCALE, DECAL_SCALE);
    this._decals[floor] = c;
    this._decalCtx[floor] = ctx;
    return c;
  }

  /** Fade the whole layer a little, so old blood goes with the new. */
  _washDecals(floor) {
    const c = this._decalCtx[floor];
    if (!c) return;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = `rgba(0,0,0,${DECAL_WASH})`;
    c.fillRect(0, 0, this.map.w * T, this.map.h * T);
    c.restore();
    this._decalCount[floor] = 0;
  }

  useFloor(floor) {
    this.decals = this._decalFor(floor);
    this.decalCtx = this._decalCtx[floor];
    // the mystery box has a spot on every storey: follow the one we are on,
    // or it keeps the ground floor's and stands inside a wall upstairs
    this._boxOnFloor();
  }

  /** Is any decal inside this world-space box? Used to skip the blit. */
  _decalsIn(x0, y0, x1, y1) {
    const b = this._decalBox[this.map.floor];
    if (!b) return false;
    return b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
  }

  // ------------------------------------------------------------------ utils
  screenToWorld(sx, sy) { return { x: sx + this.cam.x, y: sy + this.cam.y }; }

  /** Stats for a weapon, upgraded if the player has punched it. */
  packedDef(id) { return defFor(id, this.player.packed.has(id)); }
  worldToScreen(wx, wy) { return { x: wx - this.cam.x, y: wy - this.cam.y }; }

  shake(mag, dur) {
    mag *= (settings.get('shake') ?? 100) / 100;
    if (mag <= 0.01) return;
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
    this.shakeMax = Math.max(this.shakeT, 0.001);
  }

  bannerShow(title, sub, opts = {}) {
    this.banner = { title, sub, t: opts.dur ?? 2.2, max: opts.dur ?? 2.2, big: !!opts.big, colour: opts.colour };
    // guests see the same banner: rounds, perks, the power coming on
    this.net?.emit('banner', { title, sub, colour: opts.colour, dur: opts.dur ?? 2.2 });
  }

  /** Points belong to a body, not to the match -- four of you, four wallets. */
  get points() { return this.player ? this.player.points : 0; }
  set points(v) { if (this.player) this.player.points = v; }

  addPoints(n, x, y, colour, who) {
    const t = who ?? this.player;
    if (t) t.points = (t.points ?? 0) + n;
    if (t === this.player) {
      this.stats.points += Math.max(0, n);
      if (n > 0) this.hud.pointPulse = 1;
    }
    if (x !== undefined) this.popups.add(x, y, (n > 0 ? '+' : '') + n, colour);
  }

  // ------------------------------------------------------------------ co-op
  /** Who a given walker is currently interested in. */
  pickTarget(z) {
    let best = null, bd = Infinity;
    for (const p of this.players ?? [this.player]) {
      if (!p || p.dead) continue;
      let d = dist2(z.pos.x, z.pos.y, p.pos.x, p.pos.y);
      if ((p.floor ?? this.map.floor) !== (z.floor ?? 0)) d *= 5;   // same storey first
      if (p.downed) d *= 2.4;                                        // finish the standing first
      if (d < bd) { bd = d; best = p; }
    }
    return best ?? this.player;
  }

  checkLinksFor(p, rec) {
    const on = this.map.linksOn(p.floor ?? this.map.floor).find((l) => {
      const at = this.map.linkPos(l, p.floor ?? this.map.floor);
      return Math.abs(p.pos.x - at.x) <= 14 && Math.abs(p.pos.y - at.y) <= 14;
    });
    const entered = on && !rec.linkOn;
    rec.linkOn = on;
    if (!entered || rec.linkCd > 0) return;
    rec.linkCd = 0.6;
    const other = on.a.floor === (p.floor ?? this.map.floor) ? on.b : on.a;
    const to = { x: (other.tx + 0.5) * T, y: (other.ty + 0.5) * T };
    const from = { x: p.pos.x, y: p.pos.y };
    p.floor = other.floor;
    p.pos.x = to.x; p.pos.y = to.y;
    p.vel.x = 0; p.vel.y = 0;
    this.particles.dust(to.x, to.y, randRange(0, TAU), 6);
    this.onPlayerTeleport(from, to);
  }

  /** Stand some poor soul back up. Co-op only exists for this. */
  revive(downed, by) {
    if (!downed?.downed) return;
    downed.downed = false;
    downed._downTold = 0;
    downed.hp = Math.round(downed.maxHp * 0.5);
    downed.invuln = 1.6;
    downed.bleedT = 0;
    audio.chime();
    this.popups.add(downed.pos.x, downed.pos.y - 30, 'REVIVED', '#7fd75a', 12);
    if (by && by !== this.player) this.bannerShow(`${by.name} REVIVED ${downed.name}`, null, { dur: 2, colour: '#7fd75a' });
    this.net?.emit('revive', { name: downed.name });
  }

  throwFor(p) {
    if (!p || p.dead || p.downed) return;
    if ((p.grenades ?? 0) <= 0) return;
    p.grenades--;
    throwGrenade(this, p.pos.x, p.pos.y, p.aim);
    p.vel.x -= Math.cos(p.aim) * 30;
    this.shake(2, 0.1);
  }

  medkitFor(p) {
    if (!p || p.dead || p.downed) return;
    if (p.useMedkit?.()) {
      audio.chime();
      this.popups.add(p.pos.x, p.pos.y - 26, '+55 HEALTH', '#63c74d', 12);
    }
  }

  /** Host only: hand the guests a thing worth seeing. */
  netEmit(kind, data) { this.net?.emit(kind, data); }

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
    // more bodies in the room, more of them at the windows: not a straight
    // multiplication, or a four-player round ten becomes a spreadsheet
    const crowd = 1 + 0.32 * Math.max(0, (this.players?.length ?? 1) - 1);
    const total = Math.round((dog
      ? Math.min(10 + Math.round(round * 1.6), 46)
      : Math.round(6 + round * 3.5)) * crowd);
    const maxAlive = dog
      ? Math.min(MAX_ALIVE_BASE + Math.floor(round / 3) * 3, 40)
      : Math.min(MAX_ALIVE_BASE + Math.floor(round / 4) * 3 + 6, 40);
    const hp = dog ? Math.min(80 + (round - 1) * 30, 1600) : Math.min(120 + (round - 1) * 46, 2600);
    const speed = Math.min(52 + (round - 1) * 1.6, 96);
    const interval = dog ? Math.max(0.22, 0.75 - round * 0.02) : Math.max(0.3, 1.35 - round * 0.05);
    return { total, maxAlive, hp, speed, interval, dog };
  }

  /** Roll which enemy archetype the next spawn is. */
  rollEnemyType() {
    if (this.dogRound) return 'dog';
    const r = this.round;
    // The plain walker has to stay the majority all the way to the cap --
    // specials are seasoning, not the meal. Everything together tops out at
    // about 70 %, and each type arrives on its own round so the escalation
    // is something you can feel happening.
    // Room was made for the item-B types by trimming the others. Everything
    // together tops out at about 60 %, so the plain walker stays the single
    // biggest group at every round, and each type arrives on its own round
    // so the escalation is something you can feel happening.
    const runnerChance = Math.min(0.17, Math.max(0, (r - 5) * 0.021));
    const bruteChance = Math.min(0.09, Math.max(0, (r - 9) * 0.012));
    const shriekChance = Math.min(0.045, Math.max(0, (r - 11) * 0.008));
    const helmetChance = Math.min(0.065, Math.max(0, (r - 11) * 0.011));
    const gasChance = Math.min(0.035, Math.max(0, (r - 13) * 0.007));
    const napalmChance = Math.min(0.04, Math.max(0, (r - 14) * 0.008));
    const minerChance = Math.min(0.065, Math.max(0, (r - 11) * 0.010));
    const medicChance = Math.min(0.05, Math.max(0, (r - 12) * 0.009));
    const mimicChance = Math.min(0.04, Math.max(0, (r - 14) * 0.007));
    const x = Math.random();
    let acc = 0;
    for (const [type, chance] of [
      ['shrieker', shriekChance], ['helmet', helmetChance], ['gasbag', gasChance],
      ['napalm', napalmChance], ['brute', bruteChance], ['runner', runnerChance],
      ['miner', minerChance], ['medic', medicChance], ['mimic', mimicChance],
    ]) {
      acc += chance;
      if (x < acc) return type;
    }
    return 'walker';
  }

  makeZombie(sp, forceType = null) {
    const plan = this.roundPlan(this.round);
    const type = forceType ?? this.rollEnemyType();
    const at = sp.s ?? sp;
    const floor = sp.floor ?? this.map.floor;
    const jitter = type === 'brute' ? 4 : 10;
    const z = new Zombie(this.map, at.x + randRange(-jitter, jitter), at.y + randRange(-jitter, jitter), {
      hp: Math.round(plan.hp * randRange(0.85, 1.15)),
      speed: plan.speed * randRange(0.88, 1.12),
      dmg: 34,
      type,
    });
    z.floor = floor;
    return z;
  }

  startRound(n) {
    this.round = n;
    this.stats.round = n;
    // Co-op: a body that went down comes back when the next round does. You
    // keep what you bought and you come back where the others are.
    for (const pl of this.players ?? []) {
      if (!pl || !pl.dead) continue;
      const spot = pl === this.player
        ? this.map.playerStart
        : (this.net?._spawnSpot?.() ?? this.map.playerStart);
      pl.dead = false;
      pl.downed = false;
      pl._deathTold = 0;
      pl._downTold = 0;
      pl.hp = pl.maxHp;
      pl.bleedT = 0;
      pl.invuln = 2;
      pl.pos.x = spot.x; pl.pos.y = spot.y;
      pl.vel.x = 0; pl.vel.y = 0;
      pl.points = Math.max(pl.points ?? 0, 500);
      if (pl === this.player) {
        if (this.map.floor !== 0) { this.map.setFloor(0); this.useFloor(0); }
        pl.floor = 0;
        this.bannerShow('BACK IN', 'you lose the round you died in, nothing else', { dur: 2.4, colour: '#9fd0e0' });
      }
    }
    const plan = this.roundPlan(n);
    this.dogRound = plan.dog;
    this.zombiesTotal = plan.total;
    this.zombiesSpawned = 0;
    this.zombiesKilled = 0;
    this.roundDamageTaken = 0;
    if (n >= 10) this.say('round');
    this.roundActive = true;
    this.intermission = 0;
    this.spawnTimer = 0.35;
    this._fusionCd = 6;
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

  /**
   * Item B: the amalgam. Walkers that have been standing on top of each other
   * for a few seconds stop queueing and become one large one. It is the horde
   * solving its own traffic problem, and it punishes a player who lets a knot
   * build up in a doorway instead of thinning it out.
   */
  _updateFusion(dt) {
    this._fusionCd = (this._fusionCd ?? 0) - dt;
    // Not from the start: on round one a knot of three walkers is just the
    // spawn point, and an amalgam there would be the whole round. It is a
    // thing that happens to a crowd you let build up, from round 8 on.
    if (this.round < 8 || this.dogRound) return;
    const live = this.zombies.filter((z) => !z.dead && !z.remove && !z.hidden
      && z.floor === this.map.floor && (z.type === 'walker' || z.type === 'runner'));
    // how long each one has been part of a knot
    for (const z of live) {
      let n = 0;
      for (const o of live) {
        if (o === z) continue;
        if (dist2(z.pos.x, z.pos.y, o.pos.x, o.pos.y) < 46 * 46) n++;
      }
      z.clusterT = n >= 2 ? z.clusterT + dt : Math.max(0, z.clusterT - dt * 2);
    }
    if (this._fusionCd > 0 || live.length < 3) return;
    let seed = null;
    for (const z of live) if (!seed || z.clusterT > seed.clusterT) seed = z;
    if (!seed || seed.clusterT < 5) return;

    const group = [seed];
    for (const o of live) {
      if (o === seed) continue;
      if (dist2(seed.pos.x, seed.pos.y, o.pos.x, o.pos.y) < 52 * 52) group.push(o);
    }
    if (group.length < 3) return;

    let cx = 0, cy = 0, hp = 0;
    for (const g of group) { cx += g.pos.x; cy += g.pos.y; hp += g.maxHp; }
    cx /= group.length; cy /= group.length;

    const fused = this.makeZombie({ x: cx, y: cy, floor: this.map.floor }, 'fusion');
    fused.maxHp = Math.round(hp * 1.15);
    fused.hp = fused.maxHp;
    fused.state = 0;                 // CLIMB: a moment of it heaving itself together
    fused.climbT = 0.6; fused.climbMax = 0.6;
    for (const g of group) { g.dead = true; g.remove = true; g.deadT = 99; }
    this.zombies.push(fused);
    // it counts as the ones it replaced, or the round would never end
    this.zombiesKilled += group.length - 1;
    this._fusionCd = 14;
    this.shake(5, 0.3);
    this.popups.add(cx, cy - 34, 'AMALGAM', '#c8a0e0', 13);
    this.particles.chunk(cx, cy, randRange(0, TAU), 9);
    this.particles.blood(cx, cy, randRange(0, TAU), 10, 1.4);
    audio.zombieDie();
  }

  // ------------------------------------------------- V. atmosphere & sound --
  /**
   * Three layers of music answer the fight, the room answers the shots, the
   * house makes noises of its own, and from round ten somebody talks to you.
   * All of it is cheap: nothing here runs more than three times a second.
   */
  _atmosphere(dt) {
    // music -- four times a second is plenty for a 0.9 s cross-fade
    this._musicT = (this._musicT ?? 0) - dt;
    if (this._musicT <= 0) {
      this._musicT = 0.25;
      let alive = 0;
      for (const z of this.zombies) if (!z.dead) alive++;
      const fighting = alive > 0 && this.roundActive;
      audio.setMusic({
        // the drone ducks out of the way while the fight layer comes up
        calm: fighting ? 0.4 : 0.7,
        combat: fighting ? this._combatLevel() : 0,
        // `tension` is the last-couple-of-zombies breath, not the fight; the
        // high scrape belongs to it and nothing else
        last: this.tension ?? 0,
      });
    }

    // which room are we standing in
    this._revT = (this._revT ?? 0) - dt;
    if (this._revT <= 0) {
      this._revT = 0.4;
      const zone = this._reverbZone();
      if (zone !== this._reverbNow) { this._reverbNow = zone; audio.setReverb(zone); }
    }

    // the house: boards settling and water finding its way down, on a
    // schedule loose enough that you cannot learn it
    this._houseT = (this._houseT ?? 4) - dt;
    if (this._houseT <= 0) {
      this._houseT = randRange(4, 13);
      const z = this._reverbNow;
      if (z === 'room' || z === 'corridor') {
        if (Math.random() < 0.6) audio.creak(0.9); else audio.drip(0.8);
      } else if (z === 'yard') audio.creak(0.3);
    }

    if (this.voice && this.voice.left > 0) this.voice.left -= dt;
    if (this._voiceCd > 0) this._voiceCd -= dt;
  }

  /**
   * How much of a fight is this? Not the round number and not how many are
   * still to come -- just: how close are they, and how many of them are
   * within reach. That is what the middle layer of the music follows.
   */
  _combatLevel() {
    const p = this.player.pos;
    let n = 0, closest = Infinity;
    for (const z of this.zombies) {
      if (z.dead || z.floor !== this.map.floor) continue;
      const d = dist(z.pos.x, z.pos.y, p.x, p.y);
      if (d < 420) n++;
      if (d < closest) closest = d;
    }
    if (!n) return 0;
    const byNumber = Math.min(1, n / 6);
    const byRange = 1 - clamp((closest - 60) / 360, 0, 1);
    return clamp(Math.max(byNumber, byRange), 0, 1);
  }

  /** room | corridor | yard | roof, from where the player is standing. */
  _reverbZone() {
    const f = this.map.floor;
    if (f >= 2) return 'roof';
    const tx = Math.floor(this.player.pos.x / T), ty = Math.floor(this.player.pos.y / T);
    if (this.map.tileOn(f, tx, ty) === 0) return 'yard';   // EXTERIOR
    // a corridor is a tile with walls on most sides; a room has air around it
    let walls = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (this.map.solidTileOn(f, tx + dx, ty + dy)) walls++;
      }
    }
    return walls >= 5 ? 'corridor' : 'room';
  }

  /**
   * The loudspeaker. Not a narrator -- somebody who is also in this
   * building, who has been watching you do this for a while.
   */
  say(key) {
    if (this.round < 10 || !VOICE_LINES[key]) return;
    if (this.voice && this.voice.left > 0) return;        // do not talk over it
    if ((this._voiceCd ?? 0) > 0) return;
    const pool = VOICE_LINES[key];
    const line = pool[randInt(0, pool.length - 1)];
    this._voiceCd = key === 'round' ? 8 : 22;
    const hold = audio.voice(line);
    this.voice = { text: line, left: hold };
  }

  _drawVoice(ctx, vw, vh) {
    if (!this.voice || this.voice.left <= 0) return;
    // fade the last half second out
    const a = Math.min(1, this.voice.left / 0.5);
    const y = vh - 74;
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(vw / 2 - 220, y - 16, 440, 30);
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(150,190,220,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vw / 2 - 220, y - 16, 440, 30);
    ctx.restore();
    text(ctx, 'LOUDSPEAKER', vw / 2 - 210, y - 6, {
      font: 'bold 9px "Courier New", monospace', colour: '#7f9cb5', align: 'left', alpha: a,
    });
    text(ctx, this.voice.text, vw / 2, y + 6, {
      font: 'bold 12px "Courier New", monospace', colour: '#cfe0ee', align: 'center', alpha: a,
    });
  }

  /** Pick a spawn point outside the building that can actually reach the player. */
  /**
   * Which storey should the next one come from? They climb the outside of
   * the bunker from about round 8, and start hauling themselves onto the
   * roof a few rounds after that -- so no floor is ever a safe room.
   */
  pickSpawnFloor() {
    const r = this.round;
    const upper = Math.min(0.22, Math.max(0, (r - 7) * 0.022));
    const roof = Math.min(0.12, Math.max(0, (r - 13) * 0.014));
    const x = Math.random();
    if (x < roof) return 2;
    if (x < roof + upper) return 1;
    return 0;
  }

  pickSpawn() {
    const floor = this.pickSpawnFloor();
    const pts = (floor === this.map.floor ? this.map : this.map.floors[floor])?.spawnPoints ?? [];
    const cands = [];
    for (const s of pts) {
      if (this.map.solidTileOn(floor, s.tx, s.ty)) continue;
      // on another storey "far from the player" means nothing, so just spread out
      const d = floor === this.map.floor
        ? dist2(s.x, s.y, this.player.pos.x, this.player.pos.y)
        : Math.random() * 1e6;
      cands.push({ s, d, floor });
    }
    if (!cands.length) {
      const fb = this.map.spawnPoints;
      return { s: fb[randInt(0, fb.length - 1)], floor: this.map.floor };
    }
    cands.sort((a, b) => a.d - b.d);
    // How much of the ring to draw from. The far side of the field is a
    // twenty-second walk on round one, which just looks like zombies
    // jogging about behind the fence; open it up as the rounds climb.
    const lo = Math.floor(cands.length * Math.max(0, 0.25 - this.round * 0.03));
    const hi = Math.floor(cands.length * Math.min(1, 0.56 + this.round * 0.06));
    return cands[randInt(lo, Math.max(lo, hi - 1))];
  }

  spawnZombie() {
    const pick = this.pickSpawn();
    const sp = pick.s ?? pick;
    if (!sp) return;
    this.zombies.push(this.makeZombie({ x: sp.x, y: sp.y, floor: pick.floor }));
    this.zombiesSpawned++;
  }

  onZombieKilled(z, head, ptsOverride = null, source = 'bullet') {
    this.zombiesKilled++;
    const who = z._by ?? this.player;
    if (z.type === 'medic') this.say('medic');
    else if (z.type === 'fusion') this.say('amalgam');
    this.stats.kills++;
    if (head) this.stats.headshots++;
    const pts = ptsOverride
      ?? Math.round((POINTS_KILL + (head ? POINTS_HEAD : 0)) * z.pointsMul
        * (this.timers.doublepoints > 0 ? 2 : 1));
    this.addPoints(pts, z.pos.x, z.pos.y - 24,
      ptsOverride ? '#a8d06a' : head ? '#f0d98a' : '#e6dcc2', who);
    this.netEmit('kill', { x: Math.round(z.pos.x), y: Math.round(z.pos.y), pts, head: !!head });
    this.splat(z.pos.x, z.pos.y, 9 + Math.random() * 7, 0.5);

    // salvage
    const dropChance = SALVAGE_DROP + (z.type === 'brute' ? 0.55 : 0);
    if (Math.random() < dropChance) {
      const n = z.type === 'brute' ? randInt(2, 4) : 1;
      who.salvage = (who.salvage ?? 0) + n;
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

  /** Napalm zombies go up in a pool of burning fuel. */
  addFire(x, y, r, life) {
    this.fires.push({ x, y, r, life, max: life, tick: 0, puff: 0, f: this.fxFloor });
    this.particles.spark(x, y, -Math.PI / 2, 22, '#f07a2a');
    this.particles.smoke(x, y, 10);
  }

  /** Gasbags burst into a thick, choking cloud. */
  addGas(x, y, r, life) {
    this.gases.push({ x, y, r, life, max: life, puff: 0, drift: randRange(0, TAU), f: this.fxFloor });
    this.particles.smoke(x, y, 16);
  }

  /**
   * Damage over time that is not a hit: no knockback, no shake, no i-frames.
   * It does hold the regen timer open, which is the point -- you cannot stand
   * in a fire and heal through it.
   */
  scorchPlayer(dmg, game) {
    const p = this.player;
    if (p.dead || this.gameOver) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    p.hurtFlash = Math.max(p.hurtFlash ?? 0, 0.25);
    if (p.hp <= 0) { p.hp = 0; p.dead = true; this.gameOver = true; this.overT = 0; }
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
    this.powerups.push(new Powerup(x, y, id, this.fxFloor));
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
        this.explosionLights.push({ x: p.pos.x, y: p.pos.y, r: 900, life: 0.7, max: 0.7, f: this.fxFloor });
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
    this.say('breach');
    audio.wood(false);
    this.particles.dust(b.cx, b.cy, randRange(0, TAU), 10);
    this.map.buildFlow(this.player.pos.x, this.player.pos.y);
  }

  explosion(x, y, r) {
    audio.explosion();
    this.shake(11, 0.42);
    this.explosionLights.push({ x, y, r: r * 2.4, life: 0.4, max: 0.4, f: this.fxFloor });
    this.splat(x, y, r * 0.5, 0.25, '#1a1512');
  }

  splat(x, y, r, alpha = 0.5, colour = '#4d1214') {
    if (!settings.get('blood')) return;
    const f = this.map.floor;
    const box = this._decalBox[f]
      ?? (this._decalBox[f] = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    // remember where the mess is, so a clean stretch of floor costs nothing
    if (x - r * 2 < box.x0) box.x0 = x - r * 2;
    if (y - r * 2 < box.y0) box.y0 = y - r * 2;
    if (x + r * 2 > box.x1) box.x1 = x + r * 2;
    if (y + r * 2 > box.y1) box.y1 = y + r * 2;
    this._decalCount[f] = (this._decalCount[f] ?? 0) + 1;
    if (this._decalCount[f] > DECAL_MAX) this._washDecals(f);
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

  /** Cheap version of the hitscan test, run every frame for the crosshair. */
  updateAimTarget() {
    const p = this.player;
    const m = this.input.mouse;
    const ox = p.pos.x, oy = p.pos.y;
    let dx = m.x - ox, dy = m.y - oy;
    const d = Math.hypot(dx, dy);
    if (d < 1) { this.aimOnTarget = false; return; }
    dx /= d; dy /= d;
    const def = p.def;
    const wall = this.map.rayWall(ox, oy, ox + dx * def.range, oy + dy * def.range);
    const wallT = wall ? wall.t : def.range;
    let hit = false, head = false;
    for (const z of this.zombies) {
      if (z.dead) continue;
      if ((z.floor ?? 0) !== this.map.floor) continue;
      const hx = z.pos.x, hy = z.pos.y - HEAD_OFF_Y * (z.def.headOff ?? 1);
      const low = z.def.low ? 0.72 : 1;
      let res = pointSegDist2(hx, hy, ox, oy, ox + dx * def.range, oy + dy * def.range);
      const headR = 5.2 * low;
      if (res.d2 > headR * headR) {
        res = pointSegDist2(z.pos.x, z.pos.y, ox, oy, ox + dx * def.range, oy + dy * def.range);
        const bodyR = (8.4 + (z.def.smash ? 3.4 : 0)) * (z.def.low ? 0.8 : 1);
        if (res.d2 > bodyR * bodyR) continue;
      } else head = true;
      if (Math.hypot(res.cx - ox, res.cy - oy) > wallT) continue;
      hit = true;
      break;
    }
    this.aimOnTarget = hit;
    this.aimOnHead = head;
  }

  // -------------------------------------------------------------- shooting
  fireHitscan(ox, oy, angle, def, muzzle, by = null) {
    this.stats.shots++;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const ex = ox + dx * def.range, ey = oy + dy * def.range;
    const wall = this.map.rayWall(ox, oy, ex, ey);
    const wallT = wall ? wall.t : def.range;

    const hits = [];
    const magnet = this.player.perkFx.headMagnet;
    for (const z of this.zombies) {
      if (z.dead) continue;
      if ((z.floor ?? 0) !== this.map.floor) continue;   // different storey
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
      const res = h.z.hurt(def.dmg * mul, h.head, this, angle, by);
      if (!wasAlive) continue;
      anyHit = true;
      if (!firstHit) firstHit = h;
      this.stats.hits++;
      // the hit pays the hands that made it, and the marker lights up on that
      // player's screen only -- it used to light up the host's, whoever fired
      this.addPoints(POINTS_HIT, h.x, h.y - 8, h.head ? '#f0d98a' : 'rgba(230,220,194,0.9)',
        by ?? this.player);
      if (!by || by === this.player) this.hud.hit(h.head);
      this.net?.emit('hit', {
        x: Math.round(h.x), y: Math.round(h.y), a: Math.round(angle * 100) / 100,
        head: !!h.head, by: by?.netId ?? 0,
      });
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
    // a punched gun fires a rainbow; everything else keeps its own tracer
    const tc = def.packed ? packedTracer(this.time + this.stats.shots * 0.013) : def.tracer;
    this.tracers.push({
      x0: muzzle.x, y0: muzzle.y, x1: hx, y1: hy,
      life: def.packed ? 0.085 : 0.055, max: def.packed ? 0.085 : 0.055,
      colour: tc, packed: !!def.packed, f: this.fxFloor,
    });
    // Nobody but the host simulates this shot, so nobody but the host can tell
    // anybody about it: a guest's bullets were invisible to everybody.
    this.net?.emit('shot', {
      x0: Math.round(muzzle.x), y0: Math.round(muzzle.y),
      x1: Math.round(hx), y1: Math.round(hy),
      c: tc, w: def.id, p: def.packed ? 1 : 0, by: by?.netId ?? 0,
    });
  }

  /** Ray Gun splash / DG-2 chain / Winter's Howl frost. */
  applySpecial(def, x, y, source, insta = 1) {
    // a wonder weapon belongs to the storey the shot came from: a guest
    // firing upstairs does not blow the floor below apart
    const sf = source?.floor ?? this.map.floor;
    if (def.special === 'splash') {
      this.explosionLights.push({ x, y, r: def.splashR * 3.2, life: 0.28, max: 0.28, colour: def.splashColor, f: sf });
      for (const z of this.zombies) {
        if (z.dead) continue;
        const d = dist(x, y, z.pos.x, z.pos.y);
        if (d > def.splashR) continue;
        if ((z.floor ?? 0) !== sf) continue;
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
          // the arc crawls along the storey it started on -- it does not
          // climb the stairs to find the next thing to burn
          if (z.dead || hitSet.has(z)) continue;
          if ((z.floor ?? 0) !== sf) continue;
          const d2 = dist2(from.x, from.y, z.pos.x, z.pos.y);
          if (d2 < bd) { bd = d2; best = z; }
        }
        if (!best) break;
        this.arcs.push({
          x0: from.x, y0: from.y - 6, x1: best.pos.x, y1: best.pos.y - 6,
          life: 0.22, max: 0.22, colour: def.chainColor, f: sf,
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
      this.explosionLights.push({ x, y, r: def.freezeR * 3, life: 0.3, max: 0.3, colour: def.freezeColor, f: this.fxFloor });
    }
  }

  // ---------------------------------------------------------- interactions
  /** What a given body could reach right now: prices and reach are per
   *  player, since four of you are carrying four wallets. */
  interactionFor(p = this.player) {
    let best = null;
    const offer = (o) => { if (!best || o.d < best.d) best = o; };

    for (const wb of this.map.wallBuys) {
      const d = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (d >= 30) continue;
      const def = WEAPONS[wb.weapon];
      const owned = p.loadout[wb.weapon].owned;
      const price = owned ? def.ammoPrice : def.price;
      offer({ type: 'wallbuy', weapon: wb.weapon, price, affordable: p.points >= price, d, wb });
    }

    for (const g of this.map.grenadeCrates) {
      const d = dist(p.pos.x, p.pos.y, g.x, g.y);
      if (d < 30) {
        offer({
          type: 'grenade', price: GRENADE_PRICE, d,
          affordable: p.points >= GRENADE_PRICE && p.grenades < 9,
        });
      }
    }

    for (const dr of this.map.doors) {
      if (dr.open) continue;
      const d = dist(p.pos.x, p.pos.y, dr.cx, dr.cy);
      if (d < 34) offer({ type: 'door', door: dr, price: dr.price, affordable: p.points >= dr.price, d });
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
        affordable: !owned && !full && p.points >= def.price && this.powerOn,
      });
    }

    const bs = this.box.spot;
    const db = dist(p.pos.x, p.pos.y, bs.x, bs.y);
    if (db < 42) {
      const price = this.box.price();
      offer({
        type: 'box', d: db, price,
        affordable: this.powerOn && p.points >= price
          && (this.box.state === 'closed' || this.box.state === 'offering'),
      });
    }

    if (this.map.powerSwitch) {
      const dps = dist(p.pos.x, p.pos.y, this.map.powerSwitch.x, this.map.powerSwitch.y);
      if (dps < 36) offer({ type: 'power', d: dps, price: 0, affordable: !this.powerOn });
    }

    const wb = this.map.workbench;
    if (wb) {
      const dwb = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (dwb < 40) offer({ type: 'workbench', d: dwb, price: 0, affordable: true });
    }

    for (const c of this.map.cacheSpots ?? []) {
      if (c.taken) continue;
      const d = dist(p.pos.x, p.pos.y, c.x, c.y);
      if (d < 34) offer({ type: 'cache', cache: c, d, price: 0, affordable: true });
    }

    const nt = this.traps.nearest(p.pos.x, p.pos.y, 46, this.map.floor);
    if (nt) {
      offer({
        type: 'trap', i: nt.i, d: dist(p.pos.x, p.pos.y, nt.x, nt.y),
        price: TRAP_PRICE, ready: nt.ready, affordable: p.points >= TRAP_PRICE && nt.ready,
      });
    }

    const dpp = this.map.papSpot ? dist(p.pos.x, p.pos.y, this.map.papSpot.x, this.map.papSpot.y) : 1e9;
    if (dpp < 44) {
      const id = p.current;
      const already = p.packed.has(id);
      offer({
        type: 'pap', d: dpp, price: PAP_PRICE, id,
        affordable: this.powerOn && !already && p.points >= PAP_PRICE && !p.dead,
        already,
      });
    }

    for (const sw of this.map.secretSwitches ?? []) {
      const d = dist(p.pos.x, p.pos.y, sw.x, sw.y);
      if (d < 32) offer({ type: 'switch', sw, d, price: 0, affordable: !sw.found });
    }

    if (this.map.secretDoorOpen) {
      for (const l of this.map.secretLoot) {
        const d = dist(p.pos.x, p.pos.y, l.x, l.y);
        if (d < 30) offer({ type: 'loot', loot: l, d, price: 0, affordable: true });
      }
    }

    return best;
  }

  updateInteraction() { this.interaction = this.interactionFor(this.player); }

  doInteraction(p = this.player, it = null) {
    it = it ?? this.interactionFor(p);
    if (!it || !p || p.dead || p.downed) return;

    if (it.type === 'wallbuy') {
      const def = WEAPONS[it.weapon];
      const slot = p.loadout[it.weapon];
      const price = slot.owned ? def.ammoPrice : def.price;
      if (p.points < price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      if (slot.owned && slot.reserve >= def.maxReserve && slot.mag >= def.mag) {
        audio.deny();
        this.popups.add(p.pos.x, p.pos.y - 26, 'FULL AMMO', '#9a917c');
        return;
      }
      p.points -= price;
      const kind = p.giveWeapon(it.weapon);
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, kind === 'ammo' ? 'AMMO' : def.name.toUpperCase(), '#f0d98a', 12);
      if (p.ownedWeapons().length >= 6) this.achievements.unlock('walking_armoury');
      return;
    }

    if (it.type === 'door') {
      if (p.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= it.price;
      it.door.open = true;
      this.stats.doors++;
      audio.buy();
      audio.door();
      this.popups.add(p.pos.x, p.pos.y - 26, 'DOOR OPEN', '#f0d98a', 12);
      // not buildFlow: whoever opened it may not be on the storey the map is
      // currently showing, and a co-op door opens the route for everybody
      this.rebuildFlow();
      return;
    }

    if (it.type === 'grenade') {
      if (p.points < it.price || p.grenades >= 9) { audio.deny(); return; }
      p.points -= it.price;
      p.grenades += 2;
      audio.buy();
      this.popups.add(p.pos.x, p.pos.y - 26, 'FRAG GRENADES', '#f0d98a', 12);
      return;
    }

    if (it.type === 'perk') {
      if (it.owned) { audio.deny(); return; }
      if (!this.powerOn) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POWER', '#c4463a'); return; }
      if (p.perks.size >= 6) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'PERK LIMIT', '#c4463a'); return; }
      if (p.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= it.price;
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
      if (p.points < price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= price;
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
      if (p !== this.player) { audio.deny(); return; }
      this.craftOpen = !this.craftOpen;
      audio.reload(2);
      return;
    }

    if (it.type === 'trap') {
      const t = this.traps.list[it.i];
      if (!t.ready) { audio.deny(); return; }
      if (p.points < TRAP_PRICE) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= TRAP_PRICE;
      t.arm();
      audio.trap(t.kind.id);
      this.shake(4, 0.3);
      this.popups.add(p.pos.x, p.pos.y - 26, t.name.toUpperCase(), t.kind.colour, 12);
      return;
    }

    if (it.type === 'cache') {
      const c = it.cache;
      if (c.taken) return;
      c.taken = true;
      const first = !(this._cacheOpened ?? 0);
      this._cacheOpened = (this._cacheOpened ?? 0) + 1;
      const salvage = randInt(3, 6);
      p.salvage += salvage;
      this.addPoints(first ? 1200 : 350, c.x, c.y - 14, '#f0d98a', p);
      audio.chime();
      this.shake(3, 0.3);
      this.popups.add(c.x, c.y - 26, `+${salvage} SCRAP`, '#f0d98a', 12);
      if (first) {
        p.medkits = (p.medkits ?? 0) + 1;
        if (p.armor < 60) p.armor = 60;
        this.popups.add(c.x, c.y - 40, '+MEDKIT  +ARMOUR', '#7fd75a', 12);
        this.bannerShow('SUPPLY CACHE', 'scrap, a medkit and a plate', { dur: 2.8, colour: '#f2e26a' });
      }
      this.achievements.unlock('cache_raider');
      return;
    }

    if (it.type === 'pap') {
      if (it.already) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'ALREADY PUNCHED', '#9a917c', 11); return; }
      if (!this.powerOn) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POWER', '#c4463a'); return; }
      if (p.points < PAP_PRICE) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      const oldName = p.def.name.toUpperCase();
      p.points -= PAP_PRICE;
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
      p.points += 3000;
      p.salvage += 25;
      const pool = ['raygun', 'wunderwaffe', 'thundergun', 'winterhowl', 'monkeybomb'];
      const id = pool[randInt(0, pool.length - 1)];
      p.giveWeapon(id);
      this.bannerShow('CACHE FOUND', `${WEAPONS[id].name.toUpperCase()}  +3000 POINTS`, { dur: 3.4, colour: '#f2e26a' });
      this.achievements.unlock('egg_hunter');
      return;
    }
  }

  /** Hold E next to a broken window to nail planks back on, one at a time. */
  rebuildTick(dt, p = this.player, it = null) {
    it = it ?? this.interactionFor(p);
    if (!it || it.type !== 'barricade') { this._rebuildT = 0; return; }
    const b = it.barricade;
    if (b.planks >= b.maxPlanks) { this._rebuildT = 0; return; }
    this._rebuildT = (this._rebuildT || 0) + dt;
    if (this._rebuildT >= 0.3) {
      this._rebuildT = 0;
      b.planks++;
      this.stats.planks++;
      this.addPoints(POINTS_PLANK, b.cx + randRange(-6, 6), b.cy - 6, '#f0d98a', p);
      audio.wood(true);
      this.particles.dust(b.cx, b.cy, randRange(0, TAU), 3);
      if (this.stats.planks >= 50) this.achievements.unlock('handy');
      if (b.planks === 1) this.rebuildFlow();
    }
  }

  /** Called by the EasterEgg once the broadcast finishes. */
  onEasterEggComplete() {
    this.map.secretDoorOpen = true;
    this.shake(6, 0.7);
    audio.powerUp();
    this.rebuildFlow();
    this.bannerShow('A WALL GIVES WAY', 'something opened in the east wall', { dur: 3.6, colour: '#f2e26a' });
  }

  /**
   * Walk onto a staircase tile and you change storey: same tile coordinates,
   * different floor, so you come out directly above (or below) where you
   * stepped in. The whole map swaps under you.
   */
  checkLevelLinks(dt) {
    this._linkCd = Math.max(0, (this._linkCd ?? 0) - dt);
    const p = this.player;
    let on = null;
    for (const l of this.map.linksOn(this.map.floor)) {
      const at = this.map.linkPos(l, this.map.floor);
      if (Math.abs(p.pos.x - at.x) <= 14 && Math.abs(p.pos.y - at.y) <= 14) { on = l; break; }
    }
    // Stepping ONTO a staircase is what carries you up. Standing on one does
    // nothing until you step off and come back, and you always arrive on the
    // tile *beside* it -- so a horde jostling you on the landing cannot bounce
    // you up and down the building all night.
    const entered = on && !this._linkOn;
    this._linkOn = on;
    if (!entered || this._linkCd > 0) return;
    const other = on.a.floor === this.map.floor ? on.b : on.a;
    const to = { x: (other.tx + 0.5) * T, y: (other.ty + 0.5) * T };
    this.goToFloor(other.floor, to, on);
  }

  // the nearest spot on the far side of a staircase tile: you arrive next to
  // the flight, not on it
  _besideTile(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    let best = null, bd = 1e9;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = tx + dx, ny = ty + dy;
      if (this.map.solidTileOn(this.map.floor, nx, ny)) continue;
      const d = Math.hypot(nx + 0.5 - x / T, ny + 0.5 - y / T);
      if (d < bd) { bd = d; best = { x: (nx + 0.5) * T, y: (ny + 0.5) * T }; }
    }
    return best ?? { x, y };
  }

  goToFloor(n, to, link) {
    const from = { x: this.player.pos.x, y: this.player.pos.y };
    this.map.setFloor(n);
    this.player.floor = n;
    this.useFloor(n);
    // step off the staircase itself -- land on the tile beside it, so standing
    // still at the top never sends you straight back down
    const spot = this._besideTile(to.x, to.y);
    this.player.pos.x = spot.x;
    this.player.pos.y = spot.y;
    this.player.vel.x = 0; this.player.vel.y = 0;
    this._linkCd = 0.9;
    // remember whether we are standing on a link at the landing spot, so a
    // cramped landing cannot immediately send us back down again
    this._linkOn = this.map.linksOn(this.map.floor).find((l) => {
      const at = this.map.linkPos(l, this.map.floor);
      return Math.abs(spot.x - at.x) <= 14 && Math.abs(spot.y - at.y) <= 14;
    }) ?? null;
    this.teleportFx = 1;
    this.particles.dust(spot.x, spot.y, randRange(0, TAU), 8);
    this.revealAround(spot.x, spot.y, 13);
    if (this.hud) this.hud._miniDirty = true;
    this.onPlayerTeleport(from, spot);
    this.cam.x = clamp(spot.x - VW / 2, 0, this.map.w * T - VW);
    this.cam.y = clamp(spot.y - VH / 2, 0, this.map.h * T - VH);
    this.bannerShow(this.map.floorName, link?.name ?? '', { dur: 1.7, colour: '#9fd0f0' });
    if (n === 2) this.achievements.unlock('up_on_the_roof');
    if (n === 1) this.achievements.unlock('upstairs');
    this.rebuildFlow();
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
      def, p.floor ?? this.map.floor,
    ));
    this._monkeyKills = 0;
    audio.shot('throw', 0);
  }

  /** Thunder Gun: a cone of concussive force, no hitscan. */
  fireShockwave(ox, oy, angle, def, by = null) {
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
      const res = z.hurt(def.shockDmg * falloff, false, this, Math.atan2(dy, dx), by);
      z.vel.x += Math.cos(Math.atan2(dy, dx)) * def.shockPush * falloff;
      z.vel.y += Math.sin(Math.atan2(dy, dx)) * def.shockPush * falloff;
      this.addPoints(POINTS_HIT, z.pos.x, z.pos.y - 8, 'rgba(245,180,92,0.9)', by);
      hit++;
      if (res === 2) this.onZombieKilled(z, false);
    }
    this.explosionLights.push({ x: ox + Math.cos(angle) * 80, y: oy + Math.sin(angle) * 80, r: 320, life: 0.35, max: 0.35, f: this.fxFloor });
    this.shake(8, 0.32);
    audio.shot('thundergun', 0);
  }

  /** Shared explosion: grenades, Monkey Bombs, Ray Gun splashes. */
  explodeAt(x, y, r, dmg, opts = {}) {
    const p = this.player;
    audio.explosion();
    this.shake(opts.shake ?? 10, 0.4);
    this.explosionLights.push({ x, y, r: r * 2.6, life: 0.42, max: 0.42, colour: opts.colour, f: this.fxFloor });
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
      if ((z.floor ?? 0) !== this.map.floor) continue;
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

  /** The debug panel as data, so the HUD can draw it and the mouse can hit it. */
  debugRows() {
    const on = (b) => (b ? 'ON' : 'OFF');
    const d = this.debug, p = this.player;
    return [
      { id: 'god', label: 'GOD MODE', value: on(d.god) },
      { id: 'ammo', label: 'INFINITE AMMO', value: on(d.ammo) },
      { id: 'paths', label: 'SHOW WALLS & PATHS', value: on(d.paths) },
      { id: 'points', label: '+5000 POINTS', value: 'GO' },
      { id: 'perks', label: 'EVERY PERK', value: `${p?.perks?.size ?? 0}/6` },
      { id: 'armour', label: 'REFILL ARMOUR', value: String(Math.round(p?.armor ?? 0)) },
      { id: 'pack', label: 'PACK THE CURRENT GUN', value: p?.packed?.has(p.current) ? 'DONE' : 'GO' },
      { id: 'ray', label: 'GIVE RAY GUN', value: 'GO' },
      { id: 'power', label: 'THE POWER', value: on(this.powerOn) },
      { id: 'doors', label: 'OPEN EVERY DOOR', value: 'GO' },
      { id: 'floor', label: 'STOREY (teleport)', value: String(this.map.floor) },
      { id: 'drop', label: 'DROP A POWER-UP', value: 'GO' },
      { id: 'kill', label: 'KILL EVERYTHING HERE', value: 'GO' },
      { id: 'round', label: 'END THE ROUND', value: 'GO' },
    ];
  }

  /** Do the thing on that row. */
  _debugRun(id) {
    const p = this.player;
    switch (id) {
      case 'god': this.debug.god = !this.debug.god; break;
      case 'ammo': this.debug.ammo = !this.debug.ammo; break;
      case 'paths': this.debug.paths = !this.debug.paths; break;
      case 'points':
        this.addPoints(5000, p.pos.x, p.pos.y - 26, '#f0d98a');
        break;
      case 'perks':
        this.powerOn = true;
        for (const k of Object.keys(PERKS)) p.addPerk(k);
        this.bannerShow('EVERY PERK', 'debug', { dur: 1.6, colour: '#f0d98a' });
        break;
      case 'armour': p.armor = 120; break;
      case 'pack':
        p.packed.add(p.current);
        this.bannerShow('PACK-A-PUNCHED', p.current.toUpperCase(), { dur: 1.6, colour: '#c8a0e0' });
        break;
      case 'ray': p.giveWeapon('raygun'); break;
      case 'power':
        if (this.powerOn) { this.powerOn = false; }
        else { this.powerOn = true; this.powerSurge = 1.4; audio.powerUp(); }
        break;
      case 'doors':
        for (const d of this.map.doors) {
          if (d.open) continue;
          d.open = true; d.planks = 0; this.stats.doors++;
        }
        for (const b of this.map.barricades) b.planks = 0;
        this.flowTimer = 0;
        break;
      case 'floor': {
        const n = (this.map.floor + 1) % 3;
        const lk = (this.map.links ?? []).find((l) => l.a.floor === n)
          ?? (this.map.links ?? []).find((l) => l.b.floor === n);
        if (!lk) break;
        const dest = lk.a.floor === n ? lk.a : lk.b;
        this.goToFloor(n, { x: (dest.tx + 0.5) * T, y: (dest.ty + 0.5) * T }, lk);
        break;
      }
      case 'drop': this.dropPowerup(p.pos.x + 26, p.pos.y); break;
      case 'kill':
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== this.map.floor) continue;
          if (z.hurt(99999, false, this, 0) === 2) this.onZombieKilled(z, false);
        }
        break;
      case 'round':
        for (const z of this.zombies) { z.dead = true; z.remove = true; }
        this.zombiesKilled = this.zombiesTotal;
        this.endRound();
        break;
    }
    audio.dryFire();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.time += dt;

    // ---- settings overlay (works anywhere, pauses the game behind it) -----
    // `wasPressed` stays true for the whole step, so a single O used to open
    // the panel and then immediately read as the "close" press further down.
    // Remember which way this press went and let the close check skip O.
    const oPressed = this.input.wasPressed('KeyO');
    let openedByO = false;
    if (oPressed) {
      const was = this.settingsOpen;
      this.settingsOpen = !this.settingsOpen;
      openedByO = !was;
      if (this.settingsOpen) { this._wasPaused = this.paused; this.paused = true; }
      else this.paused = this._wasPaused || false;
    }
    if (this.controlsOpen) {
      if (this.input.wasPressed('Escape', 'KeyP', 'KeyO', 'Enter', 'Space')
        || this.input.mouse.pressed) {
        this.controlsOpen = false;
        audio.dryFire();
      }
      this.hud.update(dt, this);
      return;
    }

    if (this.settingsOpen) {
      const S = settings;
      if (this.input.wasPressed('ArrowUp', 'KeyW')) {
        this.settingsIndex = (this.settingsIndex - 1 + SETTING_DEFS.length) % SETTING_DEFS.length;
        audio.dryFire();
      }
      if (this.input.wasPressed('ArrowDown', 'KeyS')) {
        this.settingsIndex = (this.settingsIndex + 1) % SETTING_DEFS.length;
        audio.dryFire();
      }
      if (this.input.wasPressed('ArrowLeft', 'KeyA')) S.nudge(SETTING_DEFS[this.settingsIndex].id, -1);
      if (this.input.wasPressed('ArrowRight', 'KeyD')) S.nudge(SETTING_DEFS[this.settingsIndex].id, 1);
      if (this.input.wasPressed('Enter', 'Space')) {
        if (SETTING_DEFS[this.settingsIndex].id === 'reset') S.reset();
        else S.activate(SETTING_DEFS[this.settingsIndex].id);
      }
      if (this.input.wasPressed('Escape', 'KeyP') || (oPressed && !openedByO)) {
        this.settingsOpen = false;
        this.paused = this._wasPaused || false;
      }
      this.hud.update(dt, this);
      return;
    }

    // ---- debug panel (a testing tool, not a part of the game) -------------
    // the same care as the settings key: one press must not open and close
    const bq = this.input.wasPressed('Backquote');
    let openedByBq = false;
    if (bq) {
      const was = this.debugOpen;
      this.debugOpen = !this.debugOpen;
      openedByBq = !was;
      if (this.debugOpen) { this._dbgWasPaused = this.paused; this.paused = true; }
      else this.paused = this._dbgWasPaused || false;
    }
    // and on a phone, where there is no backquote key at all: five taps on
    // the round counter. Only while paused -- during a round, the corner with
    // the round in it is exactly where you aim and click at whatever is
    // coming through the window, and five of those must not open a menu.
    if (!this.debugOpen && this.paused && this.started && !this.gameOver
      && this.input.mouse.pressed
      && this.input.mouse.x < 132 && this.input.mouse.y < 46) {
      this._dbgTaps = (this.time - this._dbgTapT < 0.7) ? this._dbgTaps + 1 : 1;
      this._dbgTapT = this.time;
      if (this._dbgTaps >= 5) {
        this._dbgTaps = 0;
        this.debugOpen = true;
        this._dbgWasPaused = this.paused;
        this.paused = true;
        audio.dryFire();
      }
    }
    if (this.debugOpen) {
      const rows = this.debugRows();
      const n = rows.length;
      if (this.input.wasPressed('ArrowUp', 'KeyW')) {
        this.debugIndex = (this.debugIndex - 1 + n) % n; audio.dryFire();
      }
      if (this.input.wasPressed('ArrowDown', 'KeyS')) {
        this.debugIndex = (this.debugIndex + 1) % n; audio.dryFire();
      }
      const hit = debugHitTest(this, VW, VH, this.input.mouse.x, this.input.mouse.y);
      if (hit >= 0 && hit !== this.debugIndex) { this.debugIndex = hit; audio.dryFire(); }
      if (this.input.wasPressed('Enter', 'Space') || (this.input.mouse.pressed && hit >= 0)) {
        this._debugRun(rows[this.debugIndex].id);
      }
      if (this.input.wasPressed('Escape', 'KeyP') || (bq && !openedByBq)) {
        this.debugOpen = false;
        this.paused = this._dbgWasPaused || false;
      }
      this.hud.update(dt, this);
      return;
    }

    // ---- a guest runs no simulation at all: it draws what the host says ---
    if (this.net?.role === 'guest' && this.net.active) { this._guestUpdate(dt); return; }

    if (!this.started) { this._menuUpdate(dt); return; }

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
      // the controls are worth looking up in the middle of a round too, not
      // only from the front page
      if (this.input.wasPressed('KeyC')) { this.controlsOpen = true; this._wasPaused = true; }
      return;
    }

    // ---- flow field refresh ------------------------------------------------
    // One field per storey: the player's own floor points at the player, and
    // every other floor that has zombies on it points at whichever staircase
    // leads towards him. That is what lets a horde spread over three storeys
    // all converge on the same room.
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.22;
      this.rebuildFlow();
    }

    // ---- furniture you cannot walk through ---------------------------------
    this._refreshProps();

    // ---- player ------------------------------------------------------------
    this._fxOn(this.player);
    this.player.update(dt, this, this.input);
    if (this.debug.ammo) {
      for (const id in this.player.loadout) {
        const sl = this.player.loadout[id], w = WEAPONS[id];
        if (!sl.owned || !w) continue;
        sl.mag = w.mag; sl.reserve = w.maxReserve;
      }
      this.player.grenades = Math.max(this.player.grenades, 4);
    }
    this.revealAround(this.player.pos.x, this.player.pos.y, 11);

    // ---- co-op: the host also drives every body that joined ---------------
    this._fxOn(this.player);
    if (this.net?.active) this.net.step(dt);

    // ---- workbench craft menu (swallows the number keys while open) --------
    if (this.craftOpen) {
      for (let i = 0; i < RECIPE_ORDER.length; i++) {
        if (this.input.wasPressed(`Digit${i + 1}`)) this.tryCraft(RECIPE_ORDER[i]);
      }
      if (this.input.wasPressed('Escape', 'KeyE', 'KeyQ')) this.craftOpen = false;
      if (!this.map.workbench
        || dist(this.player.pos.x, this.player.pos.y, this.workbench.x, this.workbench.y) > 56) {
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

    this.checkLevelLinks(dt);
    this.updateAimTarget();
    this.updateInteraction();
    // ---- co-op: pick somebody up, or get on with buying things ------------
    const fallen = this.players.find((o) => o !== this.player && o.downed && !o.dead
      && dist(this.player.pos.x, this.player.pos.y, o.pos.x, o.pos.y) < 40);
    this.reviveTarget = fallen ?? null;
    if (fallen && !this.player.downed && !this.player.dead && this.input.isDown('KeyF')) {
      this._reviveT = (this._reviveT ?? 0) + dt;
      this.player.vel.x *= 0.86; this.player.vel.y *= 0.86;
      if (this._reviveT >= 1.3) { this._reviveT = 0; this.revive(fallen, this.player); }
    } else {
      this._reviveT = 0;
      if (!this.craftOpen) {
        if (this.input.wasPressed('KeyE', 'KeyF')) this.doInteraction();
        if (this.input.isDown('KeyE')) this.rebuildTick(dt); else this._rebuildT = 0;
      } else this._rebuildT = 0;
    }

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

    // ---- item B: three of them get tired of queueing ----------------------
    this._updateFusion(dt);

    // ---- entities ----------------------------------------------------------
    // Once a round is down to its last few, nothing is allowed to wait under
    // the soil or lie down among the dead any more -- a miner that only digs
    // out when you walk over it can stall a round forever.
    const standing = this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
    this.lastCall = this.roundActive && this.zombiesTotal > 0
      && standing <= Math.max(1, Math.ceil(this.zombiesTotal * 0.10));
    if (this.lastCall && !this._lastCallPing) {
      const hiding = this.zombies.some((z) => !z.dead
        && (z.state === ZSTATE.BURIED || z.state === ZSTATE.HIDDEN || z.hidden));
      if (hiding) {
        this._lastCallPing = true;
        audio.growl(0.6, 0.85);
        this.popups.add(this.player.pos.x, this.player.pos.y - 44, 'THE GROUND MOVES', '#c8a86b', 12);
      }
    }
    if (!this.lastCall) this._lastCallPing = false;

    this._fxOn(this.player);        // anything the world itself does is here
    for (const z of this.zombies) { this._fxOn(z); z.update(dt, this); }
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
        const pick = this.pickSpawn();
        const sp = pick?.s ?? pick;
        if (sp) this.zombies.push(this.makeZombie({ x: sp.x, y: sp.y, floor: pick.floor ?? this.map.floor }));
        this.spawnTimer = 0.5;
      }
    }

    for (const g of this.grenades) { this._fxOn(g); g.update(dt, this); }
    this.grenades = this.grenades.filter((g) => !g.remove);

    // ---- monkey bombs ------------------------------------------------------
    for (const m of this.monkeys) { this._fxOn(m); m.update(dt, this); }
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
      if ((pu.f ?? 0) !== this.map.floor) continue;
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
    this._fxOn(this.player);       // ...and back again for the traps and box
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

    // ---- fire and gas -----------------------------------------------------
    this.inFire = 0;
    this.inGas = 0;
    const p = this.player;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      // cooks zombies properly, and you if you stand in it
      f.tick += dt;
      const stepT = 0.25;
      while (f.tick >= stepT) {
        f.tick -= stepT;
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== this.map.floor) continue;
          if (dist(f.x, f.y, z.pos.x, z.pos.y) > f.r + z.r) continue;
          const res = z.hurt(90 * stepT, false, this, randRange(0, TAU));
          z.burning = Math.max(z.burning ?? 0, 2.2);
          z.burnDmg = 30;
          if (res === 2) this.onZombieKilled(z, false, null, 'fire');
        }
      }
      if (!p.dead && dist(f.x, f.y, p.pos.x, p.pos.y) < f.r + p.r) {
        this.inFire = 1;
        this.scorchPlayer(20 * dt, this);
      }
      f.puff -= dt;
      if (f.puff <= 0) {
        f.puff = 0.05;
        const a = randRange(0, TAU), d = Math.sqrt(Math.random()) * f.r;
        this.particles.spark(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d,
          -Math.PI / 2, 1, Math.random() < 0.5 ? '#f07a2a' : '#f6c04a');
      }
    }
    for (let i = this.gases.length - 1; i >= 0; i--) {
      const g = this.gases[i];
      g.life -= dt;
      if (g.life <= 0) { this.gases.splice(i, 1); continue; }
      g.drift += dt * 0.3;
      // zombies choke in it; it is not what kills them
      for (const z of this.zombies) {
        if (z.dead || (z.floor ?? 0) !== this.map.floor) continue;
        if (dist(g.x, g.y, z.pos.x, z.pos.y) > g.r + z.r) continue;
        z.webbed = Math.max(z.webbed ?? 0, 0.45);
      }
      if (!p.dead && dist(g.x, g.y, p.pos.x, p.pos.y) < g.r + p.r) {
        this.inGas = 1;
        this.scorchPlayer(11 * dt, this);
      }
      g.puff -= dt;
      if (g.puff <= 0) {
        g.puff = 0.11;
        const a = randRange(0, TAU), d = Math.sqrt(Math.random()) * g.r;
        this.particles.smoke(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, 1);
      }
    }

    // ---- the last few: the map goes quiet and starts breathing -------------
    const aliveNow = this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
    const allSpawned = this.zombiesSpawned >= this.zombiesTotal;
    const wantTension = (this.roundActive && allSpawned && aliveNow > 0 && aliveNow <= 2) ? 1 : 0;
    this.tension = damp(this.tension ?? 0, wantTension, wantTension ? 0.9 : 1.6, dt);
    audio.setTension(this.tension);
    this._atmosphere(dt);
    if (this.tension > 0.35) {
      this._whimperT = (this._whimperT ?? 0) - dt;
      if (this._whimperT <= 0) {
        this._whimperT = randRange(2.4, 6.5);
        audio.whimper();
      }
    } else this._whimperT = 1.5;

    // ---- fps ----------------------------------------------------------------
    this.fps = this.fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

    // ---- weather -----------------------------------------------------------
    const W = this.weather;
    const weatherOn = settings.get('weather');
    W.wind += dt * 0.08;
    W.gust = damp(W.gust, 0.5 + Math.sin(W.wind * 1.7) * 0.5, 0.6, dt);
    const windX = 16 + W.gust * 46, windY = Math.sin(W.wind * 0.7) * 9;
    if (weatherOn) for (const l of W.leaves) {
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
        if (weatherOn) this.splat(p.x, p.y, p.size * randRange(1.2, 3.2), 0.35);
      }
    }
    this.particles.update(dt, this.map);
    this.popups.update(dt);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    if (!settings.get('flash')) { this.explosionLights.length = 0; this.flashLights.length = 0; }
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

    // ---- death -------------------------------------------------------------
    // In co-op you are only finished when the last body goes down: until then
    // a corpse waits for the next round to be let back in.
    const anyAlive = (this.players ?? [this.player]).some((pl) => pl && !pl.dead);
    if (!anyAlive && !this.gameOver) {
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

    this._lateUpdate(dt);
  }

  /** Camera, lamps, HUD and banners: a guest needs all of it too. */
  _lateUpdate(dt) {
    // ---- camera ------------------------------------------------------------
    const lookX = ((this.input?.mouse?.x ?? VW / 2) - VW / 2) * 0.22;
    const lookY = ((this.input?.mouse?.y ?? VH / 2) - VH / 2) * 0.22;
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
    const hpK = this.player ? 1 - this.player.hp / (this.player.maxHp || 100) : 0;
    if (hpK > 0.55) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = lerp(1.15, 0.55, hpK);
        audio.heartbeat(clamp((hpK - 0.55) / 0.45, 0.3, 1));
        if (hpK < 0.3) this.say('hurt');
      }
    }

    this.hud.update(dt, this);
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
  }

  /** Push the persisted settings into the engine. Runs at boot and on change. */
  applySettings() {
    audio.setVolumes({
      master: settings.get('master'),
      sfx: settings.get('sfx'),
      ambient: settings.get('ambient'),
      music: settings.get('music'),
    });
    this.stepRate = settings.get('simRate') ? 120 : 60;
    // the player moved the slider themselves, so drop whatever auto had dialled in
    const want = settings.get('lighting') ?? 2;
    if (this._userLighting !== want) {
      this._userLighting = want;
      this._perfStage = 0;
      this._slowFrames = 0;
      this._fastFrames = 0;
    }
    if (this.lighting) this._applyLightScale();
  }

  /** Lighting resolution = the player's pick, minus however far auto backed off. */
  _applyLightScale() {
    const SCALES = [0.25, 0.375, 0.5];
    const i = Math.max(0, Math.min(SCALES.length - 1, (this._userLighting ?? 2) - this._perfStage));
    // DLSS5 cuts the darkness finer as well. The edge of a shadow is the first
    // place you notice the staircase, and a sharper cut is the difference
    // between "lit by a lamp" and "a grey circle on the floor".
    const scale = SCALES[i] * (this._dlss ? 1.5 : 1);
    this.lighting.setScale(Math.min(0.75, scale));
  }

  /**
   * DLSS5, as far as the renderer is concerned: a finer darkness layer plus
   * the soft light pass over the top of it. src/main.js owns the switch and
   * turns it off by itself if the machine cannot keep up.
   */
  setDlss(on) {
    if (this._dlss === !!on) return;
    this._dlss = !!on;
    this._applyLightScale();
  }

  /**
   * The performance governor. `workMs` is what the last frame really spent
   * updating and drawing -- not the wall clock gap, which on a healthy machine
   * is nearly all vsync idle. Sustained slow frames walk the lighting
   * resolution down a step at a time; a long calm stretch walks it back up.
   */
  tickPerf(workMs) {
    if (!settings.get('autoQuality')) { this._slowFrames = 0; this._fastFrames = 0; return; }
    if (workMs > 20) { this._slowFrames++; this._fastFrames = 0; }
    else if (workMs < 11) { this._fastFrames++; this._slowFrames = 0; }
    else { this._slowFrames = 0; this._fastFrames = 0; }

    const ceil = this._userLighting ?? 2;
    if (this._slowFrames >= 90 && this._perfStage < ceil) {
      this._perfStage++; this._slowFrames = 0; this._applyLightScale();
    } else if (this._fastFrames >= 900 && this._perfStage > 0) {
      this._perfStage--; this._fastFrames = 0; this._applyLightScale();
    }
  }

  begin() {
    this.started = true;
    this.scene = null;
    this.applySettings();
    audio.init();
    audio.resume();
    this.startRound(1);
  }

  // ------------------------------------------------------------------ menus
  /**
   * The front door. Solo behaves exactly as it always did; multiplayer opens
   * a room on the relay and then simply starts playing, because somebody
   * walking in halfway through round nine is the whole point.
   */
  _menuUpdate(dt) {
    const inp = this.input;
    if (!inp) return;
    if (this.scene === 'waiting') { this._waitUpdate(dt); return; }
    // keep the room list alive while it is on screen, and re-ask whenever the
    // link comes up -- the first request is usually sent before the socket is
    this._roomT = (this._roomT ?? 0) - dt;
    if ((this.scene === 'rooms' || this.scene === 'mp') && this._roomT <= 0 && this.net.active) {
      this._roomT = 1.5;
      this.net.askForRooms();
    }
    const rows = menuRows(this.scene, this);
    const n = rows.length;
    const up = inp.wasPressed('ArrowUp', 'KeyW');
    const down = inp.wasPressed('ArrowDown', 'KeyS');
    const click = inp.mouse.pressed;
    const enter = inp.wasPressed('Enter', 'Space') || click;
    const esc = inp.wasPressed('Escape', 'Backspace');

    // the mouse picks an entry outright; the keyboard walks the list
    const hit = menuHitTest(this.scene, inp.mouse.x, inp.mouse.y, this);
    if (hit >= 0 && hit !== this.menuIndex) { this.menuIndex = hit; audio.dryFire(); }
    if (up || down) {
      this.menuIndex = (this.menuIndex + (down ? 1 : n - 1)) % Math.max(1, n);
      audio.dryFire();
    }
    if (this.menuIndex >= n) this.menuIndex = 0;
    if (!enter && !esc) return;
    if (esc && this.scene === 'menu') return;

    const row = rows[this.menuIndex];
    if (row?.id === 'refresh') { this.net.askForRooms(); return; }
    if (row?.id === 'none') return;
    if (esc) { this.scene = this.scene === 'mp' || this.scene === 'rooms' ? 'menu' : 'menu'; audio.dryFire(); return; }
    if (!row) return;
    audio.reload(2);
    switch (row.id) {
      case 'solo': this.net.role = 'off'; this.begin(); break;
      case 'mp':
        this.scene = 'mp'; this.menuIndex = 0; this._roomT = 0;
        this._ensureRelay();
        break;
      case 'controls': this.controlsOpen = true; this._wasPaused = false; break;
      case 'settings': this.settingsOpen = true; this._wasPaused = false; break;
      case 'host': this._startHost(); break;
      case 'join':
        this.scene = 'rooms'; this.menuIndex = 0; this._roomT = 0;
        this._ensureRelay();
        break;
      case 'name': this._askName(); break;
      case 'addr': this._askAddress(); break;
      case 'back': this.scene = 'menu'; this.menuIndex = 1; break;
      case 'waiting': break;
      default:
        if (row.room) this._joinRoom(row.room);
        break;
    }
  }

  /**
   * Talk to the relay, so the multiplayer screen has a room list before
   * anybody has to press anything. Returns false when there is nothing to
   * talk to -- which, for a page served by `python3 -m http.server`, is
   * always, and the player deserves to be told why rather than left staring
   * at an empty list.
   */
  _ensureRelay() {
    const net = this.net;
    if (net.active || net.state === 'connecting') return true;
    const addr = net.addr ?? defaultRelay();
    const url = net.url || relayURL(addr);
    if (!url) {
      this.netMsg = 'NO RELAY — RUN THE GAME WITH:  node server.mjs';
      return false;
    }
    net.url = url;
    net.open(url);
    return true;
  }

  _onNetStatus(net) {
    if (net.error === 'SOMEBODY ELSE IS HOSTING' && this.scene !== 'waiting') {
      this.netMsg = net.error;
      return;
    }
    if (net.state === 'error') {
      this.netMsg = net.error === 'CANNOT REACH'
        ? 'CANNOT REACH THE RELAY — RUN IT WITH:  node server.mjs'
        : (net.error ?? null);
    } else if (net.state === 'open') {
      this.netMsg = null;
      if (this._pendingRoom) {
        const room = this._pendingRoom;
        this._pendingRoom = null;
        this._joinRoom(room);
        return;
      }
      if (this.scene === 'rooms' || this.scene === 'mp') net.askForRooms();
    } else if (net.state === 'closed') {
      this.netMsg = null;
    }
  }

  _askName() {
    const host = document.getElementById?.('stage') ?? document.body;
    textEntry(host, {
      value: this.net.name || 'PLAYER', placeholder: 'YOUR NAME',
      onDone: (v) => { if (v) { this.net.name = v.slice(0, 10).toUpperCase(); this.player.name = this.net.name; } },
    });
  }

  _askAddress() {
    const host = document.getElementById?.('stage') ?? document.body;
    textEntry(host, {
      value: this.net.addr ?? defaultRelay(), placeholder: 'HOST:PORT  e.g.  192.168.1.5:8080',
      onDone: (v) => {
        if (!v) return;
        this.net.addr = v;
        this.net.url = relayURL(v);
        this.net.state = 'idle';
        this.net.open(this.net.url);
      },
    });
  }

  /** Open a room and start playing -- people can walk in at any time. */
  _startHost() {
    const net = this.net;
    const linked = this._ensureRelay();
    net.hostGame('NACHT', net.name || 'PLAYER');
    // hosting without a relay is not fatal: you just play by yourself, and
    // the HUD says so rather than pretending a room is open
    if (!linked) this.bannerShow('NO RELAY', 'run with node server.mjs to let people join',
      { dur: 4, colour: '#c4463a' });
    this.begin();
  }

  /** The box has spots on every storey; follow the one you are standing on. */
  _boxOnFloor() {
    const spots = this.map.boxSpots;
    if (spots?.length) this.box.useSpots(spots);
  }

  _joinRoom(room) {
    const net = this.net;
    if (!this._ensureRelay()) { this._pendingRoom = room; return; }
    net.joinGame(room.id, net.name || 'PLAYER');
    this.scene = 'waiting';
    this.netMsg = null;
    this._joinT = 0;
    this._pendingRoom = null;
  }

  /** Waiting to be let in: the host answers with the world as it stands. */
  _waitUpdate(dt) {
    this._joinT = (this._joinT ?? 0) + dt;
    if (this.net.state === 'closed' || this.net.error) {
      this.scene = 'rooms';
      this.netMsg = this.net.error ?? 'COULD NOT JOIN';
      return;
    }
    // eight seconds of nothing is not a slow host, it is a broken one
    if (this._joinT > 8) {
      this.scene = 'rooms';
      this.netMsg = 'NO ANSWER FROM THE HOST — TRY AGAIN';
      return;
    }
    if (this.input.wasPressed('Escape')) { this.net.close(); this.scene = 'rooms'; }
  }

  // ----------------------------------------------------------------- guest --
  /** No simulation at all: interpolate what the host sent and draw it. */
  _guestUpdate(dt) {
    const net = this.net;
    net.step(dt);
    const pl = this.player;
    if (pl && pl.floor !== undefined && pl.floor !== this.map.floor) {
      this.map.setFloor(pl.floor);
      this.useFloor(pl.floor);
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
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) { this.shakeMag = 0; this.shakeT = 0; }
    }
    if (this.gameOver) this.overT += dt;
    this._lateUpdate(dt);
  }

  // ------------------------------------------------------------------ draw
  draw(ctx) {
    const { vw, vh } = this;
    // `smooth` is DLSS5's doing (see src/main.js): when the frame is being
    // supersampled the sprites want filtering, and when it is not they want
    // to stay as hard little pixels as they were drawn.
    ctx.imageSmoothingEnabled = !!this.smooth;

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
    if (this._decalsIn(camX, camY, camX + vw, camY + vh)) {
      const s = DECAL_SCALE;
      ctx.drawImage(this.decals, camX * s, camY * s, vw * s, vh * s, 0, 0, vw, vh);
    }

    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawBarricades(ctx);
    this.drawDoors(ctx);
    this.drawSecretDoor(ctx);
    this.drawStairs(ctx);
    // 2b. hazards live on the floor: gas first, then fire on top of it
    for (const g of this.gases) {
      if ((g.f ?? this.map.floor) !== this.map.floor) continue;
      const k = Math.min(1, g.life / g.max);
      const a = 0.30 * Math.min(1, k * 1.6);
      const wob = Math.sin(this.time * 1.6 + g.drift) * 3;
      ctx.save();
      const rr = Math.max(3, g.r);
      const grd = ctx.createRadialGradient(g.x, g.y, rr * 0.15, g.x, g.y, rr);
      grd.addColorStop(0, `rgba(150,205,90,${a})`);
      grd.addColorStop(0.6, `rgba(110,170,70,${a * 0.7})`);
      grd.addColorStop(1, 'rgba(90,140,60,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(g.x + wob, g.y, rr, rr * 0.86, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const f of this.fires) {
      if ((f.f ?? 0) !== this.map.floor) continue;
      const k = Math.min(1, f.life / f.max);
      const flick = 0.86 + Math.sin(this.time * 13 + f.x) * 0.14;
      const r = Math.max(3, f.r * (0.55 + 0.45 * k) * flick);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, r);
      grd.addColorStop(0, `rgba(255,196,90,${0.42 * k})`);
      grd.addColorStop(0.45, `rgba(240,120,42,${0.30 * k})`);
      grd.addColorStop(1, 'rgba(180,50,10,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.restore();
      // a charred ring so the ground reads as scorched once it burns out
      ctx.save();
      ctx.globalAlpha = 0.30 * (1 - k * 0.4);
      ctx.strokeStyle = '#2a1a12';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, Math.max(2, f.r * 0.8), Math.max(2, f.r * 0.64), 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    this.traps.draw(ctx, this.time, this.map.floor);
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
    const actors = this.zombies.filter((z) => !z.remove && (z.floor ?? 0) === this.map.floor);
    const list = actors.map((z) => ({ y: z.pos.y, d: () => z.draw(ctx, this.art, this.time) }));
    for (const pl of (this.players ?? [this.player])) {
      if (!pl || (pl.floor ?? this.map.floor) !== this.map.floor) continue;
      list.push({ y: pl.pos.y + 0.5, d: () => pl.draw(ctx, this.art) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const l of list) l.d();

    // 4. tracers -- a punched gun's round is a ribbon of light, not a hairline
    for (const t of this.tracers) {
      if ((t.f ?? this.map.floor) !== this.map.floor) continue;
      const k = t.life / t.max;
      ctx.save();
      ctx.lineCap = 'round';
      if (t.packed) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = t.colour;
        ctx.globalAlpha = k * 0.20;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(t.x0, t.y0);
        ctx.lineTo(t.x1, t.y1);
        ctx.stroke();
        ctx.globalAlpha = k * 0.55;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = k;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(t.x0, t.y0);
        ctx.lineTo(t.x1, t.y1);
        ctx.stroke();
      } else {
        ctx.globalAlpha = k * 0.85;
        ctx.strokeStyle = t.colour;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t.x0, t.y0);
        ctx.lineTo(t.x1, t.y1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. muzzle flash -- the same for every gun, punched or not
    if (this.muzzleFlash) {
      const m = this.muzzleFlash;
      const k = m.t / 0.055;
      const size = m.size;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(k, 0, 1) * 0.9;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(0.4, 'rgba(255,170,60,0.55)');
      g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,235,190,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 1.5, -3);
      ctx.lineTo(size * 1.9, 0);
      ctx.lineTo(size * 1.5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 6. monkey bombs + grenades
    for (const m of this.monkeys) {
      if ((m.floor ?? this.map.floor) !== this.map.floor) continue;
      m.draw(ctx, this.art);
    }
    for (const g of this.grenades) {
      if ((g.floor ?? this.map.floor) !== this.map.floor) continue;
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
      if ((a.f ?? this.map.floor) !== this.map.floor) continue;
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
      if ((r.f ?? 0) !== this.map.floor) continue;
      const k = r.life / r.maxLife;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // a soft body so the wave reads at a glance, plus a bright leading edge
      const outer = Math.max(2, r.r);
      const grd = ctx.createRadialGradient(r.x, r.y, Math.max(0, outer - 26), r.x, r.y, outer);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(208,160,232,${(k * 0.16).toFixed(3)})`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(r.x, r.y, outer, 0, TAU); ctx.fill();
      ctx.globalAlpha = k * 0.75;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = 2 + k * 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, outer, 0, TAU); ctx.stroke();
      ctx.globalAlpha = k * 0.3;
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, r.r - 14), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    for (const w of this.webBlasts) {
      if ((w.f ?? 0) !== this.map.floor) continue;
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
    this.particles.draw(ctx, this.map.floor);
    this.popups.draw(ctx, this.map.floor);

    // 8. faint eye glow for nearby zombies (pre-baked sprite, not a gradient)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowImg = this._eyeGlow();
    const gr = glowImg.width / 2;
    for (const z of this.zombies) {
      // the storey matters here: every pair of glowing eyes on another floor
      // used to drift over your walls, plain as day, while they walked about
      // upstairs. The bodies themselves were culled -- the glow was not.
      if (z.dead || (z.floor ?? 0) !== this.map.floor) continue;
      const gx = z.pos.x - camX, gy = z.pos.y - camY - HEAD_OFF_Y;
      if (gx < -20 || gy < -20 || gx > vw + 20 || gy > vh + 20) continue;
      ctx.drawImage(glowImg, Math.round(z.pos.x - gr), Math.round(z.pos.y - HEAD_OFF_Y - gr));
    }
    ctx.restore();

    if (this.debug.paths) this.drawDebugWorld(ctx, camX, camY);

    ctx.restore();     // <-- back to screen space

    // 9. weather: drifting leaves above the world
    // the governor only reaches for the weather once the lights are already low
    if (settings.get('weather') && this._perfStage < 2) this.drawWeather(ctx, camX, camY);

    // 10. lighting (screen space!)
    this.drawLighting(ctx, camX, camY);

    // 11. vignette + HUD
    drawVignette(ctx, vw, vh, 0.38);
    if (this.inFire) {
      ctx.save();
      const a = 0.16 + Math.sin(this.time * 14) * 0.05;
      const grd = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.22, vw / 2, vh / 2, vh * 0.72);
      grd.addColorStop(0, 'rgba(255,140,40,0)');
      grd.addColorStop(1, `rgba(255,120,30,${a})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }
    if (this.inGas) {
      ctx.save();
      ctx.globalAlpha = 0.20 + Math.sin(this.time * 2.2) * 0.04;
      ctx.fillStyle = '#6ea03c';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }
    if (this.started) this.hud.draw(ctx, this, vw, vh);
    this._drawVoice(ctx, vw, vh);
    if (this.teleportFx > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.teleportFx * 0.45})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    this.achievements.drawBanner?.(ctx, vw, vh);

    if (this.controlsOpen) drawControls(ctx, this, vw, vh);
    else if (this.debugOpen) drawDebug(ctx, this, vw, vh);
    else if (this.settingsOpen) drawSettings(ctx, this, vw, vh);
    else if (!this.started) drawMenu(ctx, this, vw, vh);
    else if (this.gameOver) drawGameOver(ctx, this, vw, vh);
    else if (this.paused) drawPause(ctx, this, vw, vh);

    // A menu you cannot see your own pointer in is a menu you cannot use, and
    // a phone has never had one: draw it over everything, wherever the mouse
    // or the last finger is. In the game itself the crosshair does this job.
    if (this.controlsOpen || this.settingsOpen || this.craftOpen || this.debugOpen
      || this.paused || !this.started) {
      drawCursor(ctx, this);
    }
  }

  /**
   * The furniture that has a body: the mystery box, the perk machines, the
   * Pack-a-Punch and the workbench. None of it is a tile, so without this
   * list you can walk straight through all of it -- the box especially,
   * which is a crate sitting in the middle of a room.
   */
  _refreshProps() {
    const out = this.map.solidProps ?? (this.map.solidProps = []);
    out.length = 0;
    const f = this.map.floor;
    // A machine standing in a one-tile doorway would seal the route: the horde
    // is not smart enough to route round a thing the tile map has never heard
    // of, so those particular ones stay walk-through-able. Everything pressed
    // against a wall, which is most of them, gets a proper body.
    const add = (x, y, hw, hh, hb) => {
      if (this.map.propsWouldSeal(x - hw, y - hh, x + hw, y + hb, f)) return;
      out.push({ x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hb, floor: f });
    };
    const bs = this.box.spot;
    if (bs && this.box.state !== 'gone') add(bs.x, bs.y, 13, 8, 8);
    for (const ps of this.map.perkSpots ?? []) add(ps.x, ps.y, 10, 13, 13);
    if (this.map.papSpot) add(this.map.papSpot.x, this.map.papSpot.y, 13, 16, 16);
    if (this.map.workbench) add(this.map.workbench.x, this.map.workbench.y, 12, 7, 9);

    // and tell the flow field about them, so the horde walks round the box
    // instead of pressing its face into it for the rest of the round
    const blocked = this.map._flowBlocked ?? (this.map._flowBlocked = new Map());
    const set = new Set();
    for (const p of out) {
      for (let ty = Math.floor(p.y0 / T); ty <= Math.floor(p.y1 / T); ty++) {
        for (let tx = Math.floor(p.x0 / T); tx <= Math.floor(p.x1 / T); tx++) {
          set.add(ty * this.map.w + tx);
        }
      }
    }
    blocked.set(f, set);
  }

  /**
   * The storey the next effect belongs to. Everything that sprays, flashes or
   * floats is spawned from a body that knows which floor it is standing on,
   * and following that body is cheaper -- and far more reliable -- than
   * threading a storey number through every call that makes a spark.
   */
  get fxFloor() { return this._fxFloor ?? this.map.floor; }

  /** Aim the effect streams at one body before it is updated. */
  _fxOn(body) {
    const f = body?.floor ?? this.map.floor;
    this._fxFloor = f;
    this.particles.floor = f;
    this.popups.floor = f;
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
        if (!pp) return;
        const pulse = 0.8 + Math.sin(this.time * 2.2) * 0.2;
        L.point(sx(pp.x), sy(pp.y - 4), 130 * pulse, 0.85, 'rgba(130,235,110,0.30)', 0.55);
      }
      // the vault
      if (this.map.secretDoorOpen) {
        L.point(sx(this.map.secretLoot[0]?.x ?? 0), sy(this.map.secretLoot[0]?.y ?? 0), 120, 0.7,
          'rgba(240,220,150,0.28)', 0.4);
      }
    }

    // burning ground lights the room
    for (const f of this.fires) {
      if ((f.f ?? 0) !== this.map.floor) continue;
      const k = Math.min(1, f.life / f.max);
      const flick = 0.8 + Math.sin(this.time * 15 + f.x) * 0.2;
      L.point(sx(f.x), sy(f.y), f.r * 2.6, 0.85 * k * flick, hexA('#f0913a', 0.5), 0.55 * k);
    }

    // armed traps light their own corner of their own storey
    for (const t of this.traps.on(this.map.floor)) {
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
      if ((f.f ?? this.map.floor) !== this.map.floor) continue;
      L.point(sx(f.x), sy(f.y), f.r, 1, f.colour ? hexA(f.colour, 0.5) : 'rgba(255,190,110,0.55)', 0.9);
    }
    for (const f of this.explosionLights) {
      if ((f.f ?? this.map.floor) !== this.map.floor) continue;
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
    L.composite(ctx, VW, VH, this._dlss ? 1 : 0);

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
      const side = wb.facing === 'left' || wb.facing === 'right';
      const cx = wb.wallCX;
      const cy = wb.wallCY + (wb.facing === 'up' ? 7 : wb.facing === 'down' ? -7 : 0);
      ctx.save();
      // wall shadow behind the gun
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000';
      if (side) ctx.fillRect(cx - 5, cy - 17, 10, 34);
      else ctx.fillRect(cx - 17, cy - 5, 34, 10);
      ctx.globalAlpha = 1;
      if (side) {
        // hung along the wall it is bolted to, muzzle down, the way a gun
        // actually hangs
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(gun.img, -10, -4);
      } else {
        ctx.drawImage(gun.img, Math.round(cx - 10), Math.round(cy - 4));
      }
      ctx.restore();

      const slot = this.player.loadout[wb.weapon];
      const price = slot.owned ? def.ammoPrice : def.price;
      const afford = this.points >= price;
      ctx.save();
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      // the price sits where the player is standing, not inside the wall
      const lx = side ? cx + (wb.facing === 'right' ? -16 : 16) : cx;
      const ly = cy + (wb.facing === 'up' ? 18 : wb.facing === 'down' ? -10 : 3);
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(`${price}`, lx + 1, ly + 1);
      ctx.fillStyle = afford ? '#f0d98a' : '#6f6a5c';
      ctx.fillText(`${price}`, lx, ly);
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
    if (!this.map.powerSwitch) return;
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
    if (!this.map.workbench) return;
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
    if (!this.map.papSpot) return;
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
    for (const sw of this.map.secretSwitches ?? []) {
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

  /**
   * A staircase is just a differently shaded floor tile, and the first two
   * players to reach the second floor both found them by accident. So mark
   * them: a frame, an arrow pointing the way the stair takes you, and its
   * name and destination once you are near enough to be deciding.
   */
  drawStairs(ctx) {
    const f = this.map.floor;
    const pulse = 0.55 + Math.sin(this.time * 2.6) * 0.25;
    for (const l of this.map.linksOn(f)) {
      const here = l.a.floor === f ? l.a : l.b;
      const there = l.a.floor === f ? l.b : l.a;
      const up = there.floor > f;
      const x = (here.tx + 0.5) * T, y = (here.ty + 0.5) * T;
      if (!this._vis(x, y, 70)) continue;

      ctx.save();
      ctx.strokeStyle = `rgba(240,217,138,${0.3 + pulse * 0.4})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(here.tx * T + 1.5, here.ty * T + 1.5, T - 3, T - 3);

      // arrow bobbing over the tile, pointing where it takes you
      ctx.fillStyle = `rgba(240,217,138,${0.5 + pulse * 0.45})`;
      const ax = x, ay = y - 15 + Math.sin(this.time * 3) * 1.5;
      ctx.beginPath();
      if (up) { ctx.moveTo(ax, ay - 6); ctx.lineTo(ax - 5, ay + 3); ctx.lineTo(ax + 5, ay + 3); }
      else { ctx.moveTo(ax, ay + 4); ctx.lineTo(ax - 5, ay - 5); ctx.lineTo(ax + 5, ay - 5); }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (dist(this.player.pos.x, this.player.pos.y, x, y) < 96) {
        const dest = this.map.floors[there.floor]?.def?.name ?? (up ? 'UPSTAIRS' : 'DOWNSTAIRS');
        text(ctx, `${l.name} — ${up ? 'UP' : 'DOWN'} TO ${dest}`, x, y - 24, {
          font: 'bold 10px "Courier New", monospace', colour: '#f0d98a', align: 'center',
        });
        text(ctx, 'step on to climb', x, y + T / 2 + 13, {
          font: 'bold 9px "Courier New", monospace', colour: 'rgba(230,220,180,0.75)', align: 'center',
        });
      }
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
      if ((pu.f ?? 0) !== this.map.floor) continue;
      if (this._vis(pu.x, pu.y, 40)) pu.draw(ctx);
    }
  }

  /** Cull helper: is this world point anywhere near the visible viewport? */
  _vis(x, y, pad = 60) {
    return x > this.cam.x - pad && y > this.cam.y - pad
      && x < this.cam.x + VW + pad && y < this.cam.y + VH + pad;
  }

  /**
   * The walls and the paths, drawn over the world so you can see what the
   * dead are walking into: solid tiles in red, the way every walker means to
   * go in green, spawn points in yellow, and the furniture with a body in
   * blue. It costs a screenful of strokes, so it is debug-only.
   */
  drawDebugWorld(ctx, camX, camY) {
    const m = this.map, T2 = T;
    const tx0 = Math.max(0, Math.floor(camX / T2) - 1);
    const ty0 = Math.max(0, Math.floor(camY / T2) - 1);
    const tx1 = Math.min(m.w - 1, Math.ceil((camX + VW) / T2));
    const ty1 = Math.min(m.h - 1, Math.ceil((camY + VH) / T2));
    ctx.save();
    ctx.lineWidth = 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!m.solidAt(tx, ty)) continue;
        ctx.strokeStyle = 'rgba(230,70,60,0.55)';
        ctx.strokeRect(tx * T2 + 0.5, ty * T2 + 0.5, T2 - 1, T2 - 1);
      }
    }
    // the furniture that has a body
    ctx.strokeStyle = 'rgba(110,170,240,0.85)';
    for (const pr of m.solidProps ?? []) {
      if ((pr.floor ?? 0) !== this.map.floor) continue;
      ctx.strokeRect(pr.x0, pr.y0, pr.x1 - pr.x0, pr.y1 - pr.y0);
    }
    // where they come in
    const here = (m.floor === this.map.floor ? m : m.floors[m.floor]);
    ctx.strokeStyle = 'rgba(240,217,138,0.9)';
    for (const sp of here?.spawnPoints ?? []) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 7, 0, TAU);
      ctx.stroke();
    }
    // and where each of them means to go next
    ctx.strokeStyle = 'rgba(120,230,120,0.9)';
    ctx.beginPath();
    for (const z of this.zombies) {
      if (z.dead || (z.floor ?? 0) !== this.map.floor) continue;
      const st = m.flowStep(z.pos.x, z.pos.y, this.map.floor);
      if (!st) continue;
      ctx.moveTo(z.pos.x, z.pos.y);
      ctx.lineTo(st.x, st.y);
      ctx.moveTo(st.x - 2, st.y - 2); ctx.lineTo(st.x + 2, st.y + 2);
      ctx.moveTo(st.x + 2, st.y - 2); ctx.lineTo(st.x - 2, st.y + 2);
    }
    ctx.stroke();
    // the storey you are on, in the corner of the world
    ctx.fillStyle = 'rgba(240,217,138,0.9)';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(`FLOOR ${this.map.floor}  ${this.zombies.filter((z) => !z.dead).length} UP  `
      + `${this.zombies.filter((z) => !z.dead && (z.floor ?? 0) === this.map.floor).length} HERE`,
      camX + 8, camY + 16);
    ctx.restore();
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
