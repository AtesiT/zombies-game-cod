import { SOUNDTRACKS, musicTime } from './soundtracks.js';
import { newRoundMetrics, recordRound } from './roundReport.js';
// Game state: rounds, spawning, interactions, camera and the frame renderer.
import { T, TILE, buildArt } from './art.js';
import { GameMap } from './map.js';
import {
  Player, Zombie, Particles, Popups, throwGrenade, MonkeyBomb, HEAD_OFF_Y, ENEMY_TYPES, ZSTATE,
  throwPocket, bossForRound, BOSS_ORDER,
} from './entities.js';
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, GRENADE_MAX, PAP_PRICE, defFor, packedTracer } from './weapons.js';
import { PERKS } from './perks.js';
import { SKILLS, SKILLS_ENABLED, DRAFT_TIME, DRAFT_EVERY, makeDraft, NO_SKILLS } from './skills.js';
import { MysteryBox } from './mysterybox.js';
import { Powerup, rollPowerup } from './powerups.js';
import { Totem, Grave, Hive, Thread, Arrow, ZThrow } from './haunts.js';
import { Workbench, recipe, recipeIds, craftRefusal } from './crafting.js';
import { Achievements, EasterEgg, submitScore, ACHIEVEMENTS } from './achievements.js';
import { loadLifetime, bankRun } from './lifetime.js';
import { SKINS, SKIN_ORDER, loadSkin, saveSkin, skinOwned } from './skins.js';
import { Traps, TRAP_PRICE } from './traps.js';
import { settings, SETTING_DEFS } from './settings.js';
import { Net, textEntry, defaultRelay, relayURL } from './net.js';
import { Lighting, drawVignette, postgrade } from './lighting.js';
import {HUD, achVisible, drawTitle, drawPause, drawGameOver, drawSettings, settingsRowAt, settingsSliderRect, settingsLayout, drawMenu, menuRows, menuHitTest, pauseHitTest, text, drawCursor, drawControls, drawDebug, debugHitTest, debugTabHit, DEBUG_TABS, DEBUG_MUSIC_TAB, skillCardAt, drawAchievements, drawStats, drawOutfits, outfitRowAt, outfitIdAt, outfitsLayout, craftRowAt, craftLayout, backChipAt, drawBackChip, PAUSE_ROWS, pauseChipAt, pauseChipShown, pauseTitleAt} from './hud.js';
import { audio } from './audio.js';
import {
  clamp, lerp, damp, dist, dist2, randRange, randInt, TAU, pointSegDist2,
} from './util.js';

export const VW = 800;
export const VH = 500;
// Roughly 7 tiles of travel on an unobstructed floor, regardless of cursor distance.
export const MAX_THROW_SPEED = 280;

const POINTS_HIT = 10;
const POINTS_KILL = 60;
const POINTS_HEAD = 40;
const POINTS_PLANK = 10;
const SALVAGE_DROP = 0.16;      // chance a kill drops salvage

const MAX_ALIVE_BASE = 24;
const DOG_ROUND_EVERY = 5;      // every 5th round is a hellhound round
// The plain walker must stay the single biggest group at every round, so the
// specials never take more than this much of the spawn table between them.
const SPECIAL_CAP = 0.52;

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
/**
 * Every storey has its own night. The ground floor is the deepest room in the
 * building; the barracks has windows along two walls; the roof is outside,
 * under the moon, and pretending otherwise makes it a black rectangle.
 * (alpha is how much darkness is laid over the scene: lower is brighter.)
 */
const AMBIENT = [
  { rgb: [19, 25, 40], alpha: 0.66 },     // ground floor: the deepest room
  { rgb: [25, 31, 49], alpha: 0.42 },     // second floor: windows on two walls
  { rgb: [36, 44, 66], alpha: 0.20 },     // roof: outdoors, under the moon
];

/**
 * How much of the night is taken back off each storey. The darkness layer
 * only ever subtracts, so a moonlit roof is a hole punched in it *plus* a
 * little light of its own -- upstairs the boards and the tar paper are far
 * darker than the ground floor to begin with, and laying the same night over
 * them turned two whole storeys into a cave.
 */
const SKY_LIGHT = [
  null,                                                        // ground floor: no sky
  { power: 0.40, colour: 'rgba(124,154,208,0.12)', glow: 0.20 },  // barracks: windows both sides
  { power: 0.88, colour: 'rgba(152,184,238,0.24)', glow: 0.54 },  // roof: open sky and moon
];

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
export const VOICE_LINES = {
  round: [
    'You are still here. They have noticed.',
    'They learn where you stand. Stop standing there.',
    'The generator will not hold forever.',
    'Something on the roof is walking about.',
    'Do not let them pile up in a doorway.',
    'Between us: I stopped counting the rounds. You should too.',
    'The east wall is thinner than it looks. So is the west. That is the joke.',
  ],
  medic: ['That one was putting them back together.', 'Leave it dead this time.'],
  amalgam: ['Three of them went in. One came out. That is worse.'],
  breach: ['They are inside. That window is gone.'],
  hurt: ['Get up. Get up.', 'Breathe. You have done this eleven times already.',
    'That was closer than the last one. Do not make it a habit.'],
  // ---- the haunt round: what he says when the house changes shape ----------
  door: [
    'I would not open that door.',
    'Every door you buy, they can use too. Sit with that.',
    'That one leads nowhere good. Nowhere with fewer of them, I mean.',
  ],
  totem: [
    'That thing is drinking the light. Put it down.',
    'Do not let it hum. Shoot the humming.',
    'It is darker because of that stick. That is not weather.',
  ],
  totemdown: ['Better. The house exhales.', 'Light comes back. So do they, eventually.'],
  grave: [
    'Somebody is being buried out there. That is not a funeral, it is a door.',
    'Bells. I hate the bells. Shoot the headstone.',
    'What walks out of that grave is not counted. Shoot the grave.',
  ],
  gravedown: ['The bells stop. Walkers fade. Someone had a proper funeral once, probably not that one.'],
  storm: [
    'Sky is going green. That is not rain, that is a mood.',
    'Storm covers the sound of them digging. Stay sharp.',
  ],
  fog: [
    'Fog. Do not shoot what you cannot see. Do not let it touch you, either.',
    'The house is breathing out. Walk inside the breath, not outside it.',
  ],
  witch: ['That one throws bottles. Do not breathe what comes out.', 'Green glass. It was green glass.'],
  snowman: ['Is that thing making snowballs?', 'It is cold all of a sudden, and it is not the weather.'],
  arsonist: ['Fire in a bottle. Somebody taught them that. Run.', 'The floor remembers every bottle. So will your boots.'],
  knight: ['Big one. Armour. Aim for the head like it owes you money.', 'That is not a zombie, that is a monument. Chip the monument.'],
  shocker: ['Something out there is carrying lightning. Keep moving or keep smoking.', 'Blue one on a rod. Shoot it while it winds up.'],
  bearer: ['Purple one with a bundle. It is going to plant something. Do not let it.', 'That one kneels. When it kneels, the house changes. Interrupt the kneeling.'],
  mourner: ['Grey one with a spade. It digs, and then the bells start.', 'Do not let it finish the hole. Nobody should be buried here tonight.'],
  // ---- the apiary, the barrow and the web --------------------------------
  beekeeper: ['It is carrying a box. Whatever is in the box, do not let it open the box.',
    'A keeper. It wants somewhere quiet to put the hive down. Do not give it one.'],
  hive: ['That is a hive. The bees are not the problem and they never were.',
    'Shoot the box. Not the bees. The box.'],
  archer: ['It has a bow. It draws slowly on purpose -- watch the draw and step off the line.',
    'Something out there is aiming. When you see the string come back, move.'],
  bulwark: ['One with a plank for a face. You are not getting through the plank -- go round it.',
    'Shield. Aim at the hand, not the wood.'],
  drummer: ['Listen. That is a drum, and everything dead in earshot is keeping time with it.',
    'Kill the drummer. The room gets slower when you do.'],
  sapper: ['Crawling with a bundle of charges. Shoot it from a distance and it takes the rest with it.',
    'If that gets to your boots, the whole bundle is yours. Do not let it get to your boots.'],
  first: ['That one has a crown of ribs. It has died before. It will die again.',
    'Bones on bones. Every time you put it down it gets up quicker.'],
  weaver: ['Spider. Whatever it leaves on the floor takes your legs -- shoot it or cut it.',
    'Silk on the ground. A dash started outside it tears straight through.'],
  widow: ['Pale cross on its back. That bite keeps working after it lets go.',
    'Widow. Nine seconds of it in your blood. A medkit ends it early, nothing else does.'],
  porter: ['Fat one carrying something. It is not loot, it is brood.'],
  boss: ['Something bigger than the rest just walked in. Deal with it.',
    'That is the warden of this round. It is not in the count -- it is the count.'],
};

// The droplets on the glass after a storm: one baked sheet per frame size,
// blitted while the screen dries. Baked because ninety little arcs a frame is
// ninety little arcs too many.
let WET_SHEET = null;
function wetSheet(w, h) {
  if (WET_SHEET && WET_SHEET.w === w && WET_SHEET.h === h) return WET_SHEET.canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const dx = Math.random() * w, dy = Math.random() * h, r = 1 + Math.random() * 2.4;
    x.fillStyle = 'rgba(210,228,244,0.5)';
    x.beginPath(); x.arc(dx, dy, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(120,140,160,0.35)';
    x.beginPath(); x.arc(dx + r * 0.3, dy + r * 0.35, r * 0.6, 0, Math.PI * 2); x.fill();
  }
  WET_SHEET = { w, h, canvas: c };
  return c;
}

const DECAL_SCALE = 0.5;
const DECAL_MAX = 260;
const DECAL_WASH = 0.22;

// ---- the helicopter ending: pad, beacons, and the radio's night ------------
// The pad sits on the south roof block of the campaign's top storey; each of
// the four secret dials downstairs lights one beacon at the roof corners.
const HELI_PAD = { x: 18.5 * T, y: 15.5 * T, f: 2 };
const HELI_BEACONS = [
  { x: 15.5 * T, y: 10.5 * T },
  { x: 44.5 * T, y: 10.5 * T },
  { x: 15.5 * T, y: 30.5 * T },
  { x: 31.5 * T, y: 30.5 * T },
];
// heli.phase: 0 off, 1 armed (four beacons lit, the board has a bearing),
// 2 inbound, 3 landed, 4 wheels up, 5 gone (the run ended EVACUATED)
const HELI_PHASE_NAMES = ['OFF', 'ARMED', 'INBOUND', 'LANDED', 'LEAVING', 'GONE'];
// the roof radio station: scrap fixes it, then every second round a crate
// comes down on the pad. It sits on the east roof block, clear of the pad.
const ROOF_RADIO = { x: 40.5 * T, y: 12.5 * T, f: 2 };
const ROOF_RADIO_PRICE = 25;
// where the four dials hide, in the radio's careful words (switch order)
const SWITCH_HINTS = [
  'the west end, by the stair that climbs',
  'the east wing, past the long room',
  'the southeast yard, beyond the shed',
  'the north wall, at the tree line',
];
// Every 5-7 rounds somebody finds your frequency. No repeats back to back;
// two of these are not flavour at all: the forecast binds the next round's
// sky, and the crate really lands somewhere by the boxes.
const RADIO_EVENTS = [
  { id: 'sitrep1', text: () => 'Sector D is lost. Repeat: sector D is lost. If you can hear this, you are further than the army got.' },
  { id: 'sitrep2', text: () => 'They are counting your rounds over the wire. Every magazine that answers is one more night somebody else gets to see.' },
  { id: 'sitrep3', text: () => 'The convoy turned back at the bridge. We are not coming in. But we are not leaving you either -- keep talking to us.' },
  { id: 'rollcall', text: (g) => `${(g.player?.name ?? '') || 'Survivor'}, this is actual. We have you on the board, alone and lit up like a fuse. Keep burning.` },
  { id: 'numbers', text: () => 'Four. Nine. One. Seven. Zero. ... The numbers do not mean anything. Or they mean everything. We stopped asking at midnight.' },
  { id: 'quiet', text: () => 'A moment for the ones who did not reach morning. The wire remembers every name, even the ones we never learned.' },
  {
    id: 'hint',
    cond: (g) => !g.rangeMode && !g.egg?.complete && (g.map.secretSwitches?.some((sw) => !sw.found) ?? false),
    text: (g) => {
      const open = (g.map.secretSwitches ?? []).filter((sw) => !sw.found);
      const one = open[randInt(0, open.length - 1)];
      const where = SWITCH_HINTS[one?.id ?? 0] ?? 'somewhere in the house';
      return `One of the four dials is awake tonight -- ${where}. Four lit beacons and the board can give you a bearing. That is all we are allowed to say.`;
    },
  },
  {
    id: 'stormwarn',
    cond: (g) => !g.rangeMode && settings.get('weather'),
    text: () => 'Barometer is falling hard out here. Whatever you planned for the next round -- plan it wet, and plan it loud.',
    fx: (g) => { g.wx.forecast = 'storm'; },
  },
  {
    id: 'supply',
    cond: (g) => !g.rangeMode,
    text: () => 'We pushed a crate out of the bird ten minutes ago. Red flare, look for the smoke by the boxes. It will not wait all night.',
    fx: (g) => g.dropSupply(),
  },
];

export class Game {
  constructor(input) {
    this.input = input;
    activeGame = this;
    if (!settingsHooked) {
      settingsHooked = true;
      settings.onChange(() => activeGame?.applySettings());
    }
    // The game draws in its own units; `vw`/`vh` are how many of them fit on
    // the screen right now. They used to be the constants 800x500 and the
    // canvas was letterboxed into whatever the device was; main.js now picks
    // the view from the shape of the screen, so a phone in portrait gets a
    // tall view instead of a small box with two black bars around it.
    this.vw = VW;
    this.vh = VH;
    this.map = new GameMap();
    this.art = buildArt();
    this.lighting = new Lighting(this.vw, this.vh, 0.5);
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
    audio.stopSoundtrack();
    this._evacAudioPlayed = false;
    this.roundMetrics = newRoundMetrics();
    this.runMetrics = newRoundMetrics();
    // the run-skill switch (see src/skills.js). It survives a reset, so a
    // test or a future settings row can turn it on for one session.
    if (this.skillsEnabled === undefined) this.skillsEnabled = SKILLS_ENABLED;
    this._banked = false;
    this.lifetime = loadLifetime();
    this.map = new GameMap();
    this._clearDecals();
    this.decals = this._decalFor(this.map.floor);
    this.decalCtx = this._decalCtx[this.map.floor];
    this.player = new Player(this.map, this.map.playerStart.x, this.map.playerStart.y);
    this.player.game = this;
    this.player.netId = 0;
    this.player.name = this.net?.name || 'PLAYER';
    // the outfit is a wardrobe, not a run: whatever was on before is on now.
    // loadSkin refuses a coat whose badge is not earned, so a wiped list
    // cannot leave a body wearing something it never unlocked.
    this.player.setSkin(loadSkin(this.achievements));
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
    this.pThrows = [];
    this.monkeys = [];
    this.powerups = [];
    this.webBlasts = [];
    this.arcs = [];
    this.shriekRings = [];
    this.fires = [];
    // ---- the haunt round: what the new creatures leave behind and throw ----
    this.totems = [];       // dusk on a stick: shoot it or the house stays bold
    this.graves = [];       // bells, and the wraiths that answer them
    // ---- the apiary, the barrow and the web --------------------------------
    this.hives = [];        // the beekeeper's nest, and the bees it keeps
    this.threads = [];      // a weaver's knots of silk: the floor, made hostile
    this.arrows = [];       // the archer's fan, still in the air
    this.arrowSticks = [];  // the ones that stopped in a wall, for a while
    this.boss = null;       // the warden of this round, if it has one
    this.zThrows = [];      // snowballs, fire bottles, stink potions in flight
    this.bolts = [];        // the Shocker's lightning, purely to look at
    this._hauntId = 0;
    this.hordeThin = false; // half the round is gone: nobody hides any more
    // ---- weather: a roll of the sky, once per round ------------------------
    this.wx = { kind: null, t: 0, flash: 0, strikeT: 4, thunderAt: -1, wet: 0, drops: [], forecast: null };
    this._storySaid = {};   // the survivors outside say each thing only once
    // ---- the radio's night and the bird waiting behind it -------------------
    this.heli = { phase: 0, t: 0, roofRounds: 0, sorry: false, flare: false };
    this.roofRadio = { fixed: false };
    this.supplies = [];        // crates the radio drops: real, walkable loot
    this.radioNext = 9;        // the first broadcast: a fixed round, so booting
                               // a run never moves the dice the world rolls on
    this._radioLast = '';
    this._radioHeard = 0;
    this.evacuated = false;    // the run ended aboard the helicopter
    this._heliSnd = false;
    this.rifts = [];      // Rift Splitter floor hazards
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
    this.debugTab = 0;      // 0 = cheats, 1 = the zoo, 2 = local music library
    this._dbgWhere = 'front';   // where the zoo tab drops what it spawns
    this.debugIndex = 0;
    this.debug = { god: false, ammo: false, paths: false };
    this._dbgTaps = 0;
    this._dbgTapT = -9;
    this.settingsIndex = 0;
    this.outfitIndex = 0;    // the wardrobe's cursor: row 0 is the standard kit
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
      // creature + crafting tallies, for the newer achievements
      crafted: 0, knifeKills: 0, skeletonKills: 0, grenadeBest: 0,
      teddyDraws: 0, darkKills: 0, darkRound: true,
    };
    this.floorsVisited = new Set();   // storeys touched this run, for Grand Tour

    // --- systems ---------------------------------------------------------
    this.powerOn = false;
    this.powerSurge = 0;
    this.powerOnAt = -99;   // when the generator caught: lamps warm up in turn
    this.box = new MysteryBox(this.map.boxSpots);
    this.box._now = () => this.time;
    this.workbench = new Workbench(this.map.workbench);
    this.egg = new EasterEgg(this.map.secretSwitches);
    this._beaconTold = 0;   // the 'four beacons' explanation, said once
    // (the bench menu lives on each body now -- see the craftOpen proxy below)
    this.dogRound = false;
    this.timers = { instakill: 0, doublepoints: 0, firesale: 0, deathmachine: 0 };
    this.jamT = 0;            // seconds of radio silence a Jammer has bought
    this.jamSrc = null;
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
    this.cam.x = clamp(this.player.pos.x - this.vw / 2, 0, this.map.w * T - this.vw);
    this.cam.y = clamp(this.player.pos.y - this.vh / 2, 0, this.map.h * T - this.vh);
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
    this.map.trail = this.trail ?? null;
    this.map.trailT = this.time;
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
    // the bench is in the attic: it exists on the top storey and nowhere else
    this.workbench?.useSpot(this.map.workbench);
    // the mystery box does NOT come along: it has one home floor -- the
    // ground -- and the storeys above no longer grow their own copy of it
    // ("a box per floor" was exactly how people ended up counting several)
  }

  /** Is any decal inside this world-space box? Used to skip the blit. */
  _decalsIn(x0, y0, x1, y1) {
    const b = this._decalBox[this.map.floor];
    if (!b) return false;
    return b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
  }

  // ------------------------------------------------------------------ utils
  screenToWorld(sx, sy) { return { x: sx + this.cam.x, y: sy + this.cam.y }; }

  /**
   * How much of the world is on the screen, in world units.
   *
   * Called by main.js on every resize (and when the PICTURE SIZE setting
   * moves). Everything that lays itself out -- the HUD, every panel, the
   * camera clamp, the lighting layer -- reads `vw`/`vh`, so this is the one
   * place that decides what "the screen" means.
   */
  setViewport(w, h) {
    const mw = this.map ? this.map.w * T : 0;
    const mh = this.map ? this.map.h * T : 0;
    const vw = Math.round(Math.max(320, mw ? Math.min(mw, w) : w));
    const vh = Math.round(Math.max(240, mh ? Math.min(mh, h) : h));
    if (vw === this.vw && vh === this.vh) return false;
    this.vw = vw;
    this.vh = vh;
    this.lighting?.setSize?.(vw, vh);
    this.input?.setLogicalSize?.(vw, vh);
    this._clampCam();
    return true;
  }

  /** Keep the camera inside the map after the window (or the storey) changes size. */
  _clampCam() {
    if (!this.map) return;
    const maxX = Math.max(0, this.map.w * T - this.vw);
    const maxY = Math.max(0, this.map.h * T - this.vh);
    this.cam.x = clamp(this.cam.x, 0, maxX);
    this.cam.y = clamp(this.cam.y, 0, maxY);
  }

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
    // guests see the same banner: rounds, perks, the power coming on. A note
    // about *this machine's* speakers is local -- it is not news downstairs.
    if (!opts.local) this.net?.emit('banner', { title, sub, colour: opts.colour, dur: opts.dur ?? 2.2 });
  }

  /**
   * A Jammer has got its set close enough to take your markers away: the
   * minimap, the prices on the doors, the machines and the crosshair telling
   * you that you are on target. Ten seconds, refreshed for as long as one is
   * still standing near you -- kill it and the picture comes back at once.
   *
   * Your guns still work, and so do your ears. That is the whole counter.
   */
  jam(dur = 10, src = null) {
    const was = this.jamT > 0;
    this.jamT = Math.max(this.jamT, dur);
    if (src) this.jamSrc = src;
    if (!was) {
      this.bannerShow('SIGNAL JAMMED', 'no markers -- find the radio', { dur: 2.6, colour: '#9fd0e0' });
      audio.shriek(0.6);
      this.shake(2.5, 0.2);
    }
  }

  /** Is the player's picture being jammed right now? */
  get jammed() { return this.jamT > 0; }

  /** Points belong to a body, not to the match -- four of you, four wallets. */
  get points() { return this.player ? this.player.points : 0; }
  set points(v) { if (this.player) this.player.points = v; }

  /**
   * Same story for the bench menu: it used to be one flag on the game, so the
   * workbench belonged to whoever the game was -- the host. A guest pressing E
   * at the bench was told no, and had no menu of its own to open anyway. Each
   * body keeps its own flag; `game.craftOpen` means "mine", which is what the
   * HUD, the touch panel and the cursor have always wanted.
   */
  get craftOpen() { return !!(this.player && this.player.craftOpen); }
  set craftOpen(v) { if (this.player) this.player.craftOpen = !!v; }

  recordRound(key, n = 1) { recordRound(this, key, n); }

  addPoints(n, x, y, colour, who) {
    const t = who ?? this.player;
    // Scavenger counts every point earned a little higher -- on the body that
    // earned it, not on the host's purse.
    const mul = n > 0 ? (t?.skillFx?.pointsMul ?? 1) : 1;
    if (n > 0) n = Math.round(n * mul);
    if (n > 0) this.recordRound('points', n);
    if (t) t.points = (t.points ?? 0) + n;
    if (t === this.player) {
      this.stats.points += Math.max(0, n);
      if (n > 0) this.hud.pointPulse = 1;
      if (t.points >= 10000) this.achievements.unlock('big_spender');
    }
    if (x !== undefined) this.popups.add(x, y, (n > 0 ? '+' : '') + n, colour);
  }

  // ------------------------------------------------------------------ co-op
  /** Who a given walker is currently interested in. */
  pickTarget(z) {
    let best = null, bd = Infinity;
    for (const p of this.players ?? [this.player]) {
      if (!p || p.dead || p.evac) continue;
      let d = dist2(z.pos.x, z.pos.y, p.pos.x, p.pos.y);
      if ((p.floor ?? this.map.floor) !== (z.floor ?? 0)) d *= 5;   // same storey first
      if (p.downed) d *= 2.4;                                        // finish the standing first
      if (d < bd) { bd = d; best = p; }
    }
    return best ?? this.player;
  }

  checkLinksFor(p, rec, dt = 0) {
    rec.linkCd = Math.max(0, (rec.linkCd ?? 0) - dt);
    const on = this.map.linksOn(p.floor ?? this.map.floor).find((l) => {
      const at = this.map.linkPos(l, p.floor ?? this.map.floor);
      return Math.abs(p.pos.x - at.x) <= 14 && Math.abs(p.pos.y - at.y) <= 14;
    });
    const entered = on && !rec.linkOn;
    rec.linkOn = on;
    if (entered) this._noteLinkTrail(on);
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

  fallenNear(p) {
    return this.players.find((o) => o !== p && o.downed && !o.dead && !o.evac
      && (o.floor ?? this.map.floor) === (p.floor ?? this.map.floor)
      && dist(p.pos.x, p.pos.y, o.pos.x, o.pos.y) < 40);
  }

  /** Stand some poor soul back up. Co-op only exists for this. */
  revive(downed, by) {
    if (!downed?.downed || downed.dead || !by || by.dead || by.downed || by.evac
      || this.fallenNear(by) !== downed) return;
    this.recordRound('revives');
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

  /**
   * Throw whatever is in the one throwing hand. `kind` is accepted for old
   * guest messages and harnesses: if that pocket still has something in it,
   * that is what leaves the hand; otherwise the hand decides.
   */
  throwFor(p, kind) {
    if (!p || p.dead || p.downed || p.evac) return;
    if (kind) {
      const pocket = throwPocket(kind);
      if ((p[pocket] ?? 0) > 0) {
        p[pocket]--;
        p.throwKind = kind;
        this.throwAtCursor(p, kind, p.aim);
        this.shake(2, 0.1);
        return;
      }
    }
    const k = p.takeThrowable?.() ?? null;
    if (!k) return;
    this.throwAtCursor(p, k, p.aim);
    this.shake(2, 0.1);
  }

  medkitFor(p) {
    if (!p || p.dead || p.downed) return;
    if (p.useMedkit?.()) {
      this.recordRound('medkits');
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
    // ---- the nine wardens: one on every fifth round from ten -------------
    // A warden round is shorter than the round it replaces -- the point of it
    // is the thing in the middle of the room, not the queue outside it -- and
    // the warden is not part of the tally, so the round ends when it does.
    const boss = bossForRound(round);
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
    if (boss) {
      // the escort, not the army: about half the bodies, arriving no faster
      return {
        total: Math.max(4, Math.round(total * (dog ? 0.55 : 0.5))),
        maxAlive: Math.min(maxAlive, 22), hp, speed, interval,
        dog, boss, bossIndex: BOSS_ORDER.indexOf(boss),
      };
    }
    return { total, maxAlive, hp, speed, interval, dog, boss: null };
  }

  /**
   * Roll which enemy archetype the next spawn is.
   *
   * One table, five columns: the type, the round it starts arriving on, how
   * much its share grows per round, the ceiling on that share, and an optional
   * multiplier for the weather. The plain walker has to stay the single
   * biggest group at every round -- specials are seasoning -- so the whole
   * special side of the table is scaled down whenever it would grow past
   * `SPECIAL_CAP`. That way a new creature can be added here without
   * arithmetic and without eating the walker alive.
   */
  rollEnemyType() {
    if (this.dogRound) return 'dog';
    const r = this.round;
    const storm = this.wx?.kind === 'storm' ? 2 : 1;
    const SP = [
      ['runner', 5, 0.020, 0.115],
      ['brute', 9, 0.011, 0.060],
      ['shrieker', 11, 0.007, 0.033],
      ['helmet', 11, 0.010, 0.043],
      ['gasbag', 13, 0.006, 0.026],
      ['napalm', 14, 0.007, 0.029],
      ['miner', 11, 0.009, 0.043],
      ['medic', 12, 0.008, 0.037],
      ['mimic', 14, 0.006, 0.029],
      ['bonewright', 5, 0.006, 0.037],
      ['swarmling', 17, 0.009, 0.047],
      ['jammer', 24, 0.007, 0.037],
      // the haunt round
      ['snowman', 11, 0.004, 0.019, storm],
      ['arsonist', 12, 0.004, 0.015],
      ['witch', 13, 0.004, 0.013],
      ['bearer', 14, 0.003, 0.010],
      ['mourner', 15, 0.003, 0.010],
      ['shocker', 17, 0.0035, 0.013],
      ['knight', 19, 0.0035, 0.011],
      // ---- the apiary, the barrow and the web ---------------------------
      // the spiders are the commonest of the new lot: they are the cheapest
      // to draw and the most fun to have on the floor
      ['weaver', 8, 0.006, 0.030],
      ['beekeeper', 7, 0.003, 0.018],
      ['archer', 9, 0.005, 0.026],
      ['bulwark', 11, 0.004, 0.020],
      ['widow', 12, 0.004, 0.016],
      ['drummer', 13, 0.003, 0.014],
      ['sapper', 14, 0.003, 0.018],
      ['porter', 16, 0.003, 0.013],
      ['first', 18, 0.002, 0.007],
    ];
    const share = ([, from, per, cap, wx = 1]) => Math.min(cap, Math.max(0, (r - from) * per)) * wx;
    let sum = 0;
    for (const row of SP) sum += share(row);
    const k = sum > SPECIAL_CAP ? SPECIAL_CAP / sum : 1;
    const x = Math.random();
    let acc = 0;
    for (const row of SP) {
      acc += share(row) * k;
      if (x < acc) return row[0];
    }
    return 'walker';
  }

  /**
   * The warden of round n. It arrives on the far side of the house with its
   * name on the screen, it is not part of the round's tally -- the round ends
   * when it is dead, not when the counter runs out -- and it leaves a gap of a
   * second before it starts walking, so you get to see what you are facing.
   */
  _spawnBoss(type) {
    const pick = this.pickSpawn();
    const sp = pick?.s ?? pick;
    const floor = pick?.floor ?? this.map.floor;
    if (!sp || sp.x == null) return null;
    const z = this.makeZombie({ x: sp.x, y: sp.y, floor }, type);
    z.boss = true;
    z.bossName = z.def.name ? z.def.name.toUpperCase() : String(type).toUpperCase();
    // nine of them in a cycle, and they get heavier every time round it comes
    const cycle = Math.floor(Math.max(0, this.round - 10) / 45);
    z.hp = z.maxHp = Math.round(z.maxHp * (1 + cycle * 0.35));
    z.bossMaxHp = z.maxHp;
    z.state = ZSTATE.EMERGE;
    z.emergeT = 0.8;
    if (type === 'first') z.revivesLeft = 2;
    this.zombies.push(z);
    this.boss = z;
    this.bannerShow(z.bossName, 'it has been waiting for you', {
      dur: 4, big: true, colour: '#e0705a',
    });
    audio.growl(0.45, 1);
    this.shake(5, 0.5);
    this.say('boss');
    return z;
  }

  /** Is the warden of this round still standing? */
  get bossAlive() {
    const b = this.boss;
    return !!(b && !b.dead && !b.remove);
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
    // the loudspeaker notices the new arrivals once each (round ten onwards,
    // its own cooldown -- sometimes the house just does not comment)
    if (!forceType && VOICE_LINES[type]) this.say(type);
    return z;
  }

  startRound(n) {
    this.roundMetrics = newRoundMetrics();
    this.round = n;
    this.stats.round = n;
    // One throwing hand: the kind you carry comes back two at a time, and it
    // stops at the same cap the crates use. Owning two kinds no longer means
    // two pockets -- buying the second one replaced the first.
    for (const pl of this.players ?? []) {
      if (!pl) continue;
      // THE VETERAN arrives dressed and kitted: the plate is handed out at the
      // top of a night, not every wave (that would be a free armour refill)
      if (n === 1 && pl.skinFx?.startArmor) {
        pl.armor = Math.max(pl.armor ?? 0, pl.skinFx.startArmor);
      }
      // a new wave is a clean slate for anything that happens once per wave
      pl._windUsed = false;
      pl.windT = 0;
      pl.skillDraft = null;   // a draft never survives into the wave it delays
      if (!pl.ownThrow) continue;
      const give = 2 + (pl.skillFx?.refillBonus ?? 0) + (pl.skinFx?.refillBonus ?? 0);
      if (pl.refillThrowable) pl.refillThrowable(give);
      else if (pl.ownThrow.frag) pl.grenades = Math.min(GRENADE_MAX, pl.grenades + give);
    }
    // Co-op: a body that went down comes back when the next round does. You
    // keep what you bought and you come back where the others are.
    for (const pl of this.players ?? []) {
      if (!pl || !pl.dead) continue;
      const spot = pl === this.player
        ? this.map.playerStart
        : (this.net?._spawnSpot?.() ?? this.map.playerStart);
      pl.dead = false;
      pl.downed = false;
      pl.evac = false;
      pl.evacVote = false;
      pl._deathTold = 0;
      pl._downTold = 0;
      if ((this.players?.length ?? 1) > 1 && pl !== this.player) {
        // bled out last round: you come back with your sidearm and nothing
        // else -- the good guns stay where you dropped them
        const d = WEAPONS.m1911;
        pl.loadout = { m1911: { owned: true, mag: d.mag, reserve: d.maxReserve } };
        pl.slots = ['m1911', null];
        pl.active = 0;
        pl.reloading = false;
        pl.reloadTimer = 0;
      }
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
    this.bossRound = plan.boss ?? null;
    this.boss = null;
    if (plan.boss) this._spawnBoss(plan.boss);
    // the range never "finishes" a round: there is nothing to finish
    this.zombiesTotal = this.rangeMode ? 0x3fffffff : plan.total;
    this.zombiesSpawned = 0;
    this.zombiesKilled = 0;
    this.hordeThin = false;
    this.roundDamageTaken = 0;
    if (n >= 10) this.say('round');
    this.roundActive = true;
    this.intermission = 0;
    this.spawnTimer = 0.35;
    this._fusionCd = 6;
    this.workbench.onRoundStart();
    if (this.roofRadio?.fixed && n % 2 === 0 && !this.rangeMode) this.dropRoofSupply();
    if (plan.dog) {
      this.bannerShow(`ROUND ${n}`, 'something is out there', { dur: 2.6, big: true, colour: '#e0705a' });
      audio.dogRound();
    } else {
      this.bannerShow(`ROUND ${n}`, n === 1 ? 'they are coming' : null, { dur: 2.4, big: true });
      audio.roundSting(true);
    }
    this.rollWeather(n);
    // the survivors outside: the loudspeaker stops being a stranger
    if (n === 25 || n === 35) this.sayStory(n);
    this._radioNight(n);
    // round 30 belongs to the board itself: with four beacons it gives you a
    // bearing, without them it apologises -- either way it has more to say
    // than the old story beat, so that one only speaks if the board stayed
    // silent (the bird is already spoken for, or this is the range)
    this._heliArmCheck();          // 25 + four dials: the pad arms with the round
    if (n === 30 && !this._heliRoundStart(n)) this.sayStory(30);
    if (n >= 10) this.achievements.unlock('round_10');
    if (n >= 20) this.achievements.unlock('round_20');
    if (n >= 30) this.achievements.unlock('round_30');
    if (n >= 40) this.achievements.unlock('round_40');
    if (n >= 10 && this.stats.doors === 0) this.achievements.unlock('recluse');
  }

  endRound() {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.intermission = 12;
    this.respawnQueue = 0;
    this.setWeatherKind(null);   // the sky clears while you catch your breath
    if (this.roundDamageTaken === 0) this.achievements.unlock('untouchable');
    // just the number, and a breath: the ledger this used to open is on the
    // end-of-run screen now, where a reader has time for it
    this.bannerShow(`ROUND ${this.round} CLEARED`, null, { dur: 2.2, colour: '#f0d98a' });
    audio.roundSting(false);
    // every fifth wave: a personal upgrade, offered to every body in the
    // room. The whole system is behind one switch (src/skills.js) and is off
    // while the pool is being rebalanced.
    if (this.skillsEnabled && this.round % DRAFT_EVERY === 0 && !this.rangeMode) this._offerSkillDrafts();
  }

  // ------------------------------------------------------- all-time diary --
  /**
   * Write this night into the machine's lifetime totals. Once per run: a death
   * and a restart must not bank the same night twice, and quitting to the menu
   * banks exactly what was earned.
   */
  _bankRun() {
    if (this._banked || !this.started || this.rangeMode) return;
    this._banked = true;
    this.lifetime = bankRun(this.lifetime, {
      round: this.round, evac: !!this.evacuated, metrics: this.runMetrics,
    });
  }

  // ------------------------------------------------------------ run skills --
  /** Deal three cards to everyone who is still standing in this night. */
  _offerSkillDrafts() {
    if (!this.skillsEnabled || this.rangeMode || this.gameOver) return;
    for (const p of this.players ?? [this.player]) {
      if (!p || p.skillDraft) continue;
      const ids = makeDraft(p.skills, 3);
      if (!ids.length) continue;
      p.skillDraft = { round: this.round, ids, index: 0, t: DRAFT_TIME };
      // the panel itself is the announcement; the ROUND N CLEARED banner from
      // endRound gets to finish its line first
      if (p === this.player) audio.ready && audio.roundSting?.(true);
    }
  }

  /** Is anybody still holding an open draft? The next wave waits for them. */
  _draftOpen() { return (this.players ?? [this.player]).some((p) => !!p?.skillDraft); }

  /** Keep every open draft's clock running; pick for a body that went idle. */
  _skillDraftTick(dt) {
    if (!this.started || this.gameOver) return;
    // a guest's draft lives on the host; only the host runs the clock
    if (this.net?.playing && !this.net.isHost) return;
    for (const p of this.players ?? []) {
      const d = p?.skillDraft;
      if (!d) continue;
      d.t = (d.t ?? DRAFT_TIME) - dt;
      if (d.t <= 0) {
        const id = d.ids[Math.min(d.ids.length - 1, Math.floor(Math.random() * d.ids.length))];
        this.pickSkill(p, id);
      }
    }
  }

  /** Arrows / 1-2-3 / the mouse: one card, one press, one skill. */
  _skillDraftUpdate() {
    const d = this.player?.skillDraft;
    if (!d) return;
    const inp = this.input;
    const n = d.ids.length;
    const idx = Math.min(Math.max(0, d.index ?? 0), n - 1);
    // the cards are a row, but all four arrows move: a player who reaches for
    // up and down should not find dead keys in a menu that is asking them to
    // choose
    if (inp.wasPressed('ArrowRight', 'KeyD', 'ArrowDown', 'KeyS')) {
      d.index = (idx + 1) % n; audio.dryFire?.();
    } else if (inp.wasPressed('ArrowLeft', 'KeyA', 'ArrowUp', 'KeyW')) {
      d.index = (idx - 1 + n) % n; audio.dryFire?.();
    }
    const m = inp.mouse;
    const hit = skillCardAt(this.vw, this.vh, m.x, m.y, n);
    if (hit >= 0) d.index = hit;
    // The digits are also weapon-slot keys on the wire. Take the press out of
    // the frame's set once the card has used it, or a guest would both pick a
    // skill and swap guns with the same keystroke.
    const digit = (code, id) => {
      if (!inp.wasPressed(code)) return false;
      inp.pressed?.delete?.(code);
      this.chooseSkill(id);
      return true;
    };
    if (digit('Digit1', d.ids[0]) || digit('Digit2', d.ids[1]) || digit('Digit3', d.ids[2])) return;
    else if (inp.wasPressed('Enter', 'Space', 'KeyE') || (m.pressed && hit >= 0)) {
      // E is the interact key on the wire, like the digits above
      if (inp.wasPressed('KeyE')) inp.pressed?.delete?.('KeyE');
      this.chooseSkill(d.ids[Math.min(d.index ?? 0, n - 1)]);
    }
  }

  /** The player's answer. A guest's answer travels to the body that owns it. */
  chooseSkill(id) {
    const d = this.player?.skillDraft;
    if (!d || !d.ids?.includes(id)) return false;
    if (this.net?.playing && !this.net.isHost) {
      this.net.send(this.net.hostId, { m: 'skill', id });
      audio.perk?.();
      return true;
    }
    return this.pickSkill(this.player, id);
  }

  /** Host: validate the card, put it in the hand, close the draft. */
  pickSkill(p, id) {
    const d = p?.skillDraft;
    if (!p || !d || !d.ids?.includes(id)) return false;
    if (!p.addSkill?.(id)) return false;
    p.skillDraft = null;
    const def = SKILLS[id];
    if (!def) return false;
    if (p === this.player) {
      this.bannerShow(`SKILL: ${def.name.toUpperCase()}`, def.desc,
        { dur: 3.4, colour: def.colour, local: true });
      audio.perk?.();
    }
    this.popups.add?.(p.pos.x, p.pos.y - 32, def.short, def.colour, 12);
    // guests hear about it either way; this is not a local secret like a
    // blocked speaker, it is a new number in the world
    this.net?.emit?.('skill', { name: p.name || 'PLAYER', id });
    return true;
  }


  get zombiesLeft() {
    return Math.max(0, this.zombiesTotal - this.zombiesKilled);
  }

  /** Is a totem humming anywhere in the house? The horde can feel it. */
  get totemPower() {
    for (const t of this.totems) if (!t.dead) return 1;
    return 0;
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

    // The average of several open tiles can land inside a crate between them;
    // an amalgam born in the wall would never move again. Nudge it onto floor.
    if (this.map.solidTileOn(this.map.floor, Math.floor(cx / T), Math.floor(cy / T))) {
      const at = this._besideTile(cx, cy);
      cx = at.x; cy = at.y;
    }

    const fused = this.makeZombie({ x: cx, y: cy, floor: this.map.floor }, 'fusion');
    // makeZombie jitters the body a little; that nudge can shove a fusion born
    // at the edge of a crate back into it. Pin the result to open floor.
    if (this.map.solidTileOn(this.map.floor,
      Math.floor(fused.pos.x / T), Math.floor(fused.pos.y / T))) {
      const at = this._besideTile(fused.pos.x, fused.pos.y);
      fused.pos.x = at.x; fused.pos.y = at.y;
    }
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
    // once the bird is coming the victory cue owns the mix (audio.victory)
    if (this._musicT <= 0 && this.heli.phase < 4) {
      this._musicT = 0.25;
      let alive = 0;
      for (const z of this.zombies) if (!z.dead) alive++;
      const fighting = alive > 0 && this.roundActive;
      audio.setMusic({
        // the drone ducks out of the way while the fight layer comes up
        calm: fighting ? 0.4 : 0.45,
        combat: fighting ? this._combatLevel() : 0,
        // `tension` is the last-couple-of-zombies breath, not the fight; the
        // high scrape belongs to it and nothing else
        last: this.tension ?? 0,
        // the piano and the violin own the quiet: full between rounds, and a
        // thin thread under a storm so the weather has a soundtrack too
        elegy: fighting ? (this.wx?.kind === 'storm' ? 0.18 : 0) : 0.55,
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
    // broadcasts are sentences now, not call-signs: wrap them to the box
    // (12px Courier is ~7.2px a character; the box is 440 wide, 420 usable)
    // The box was a fixed 440 wide, which is wider than a phone held upright
    // and wider than the picture at MAX PICTURE SIZE: the broadcast ran off
    // both edges of the glass. It is measured from the view now, and the wrap
    // is worked out from that -- 12px Courier is about 7.2 a character.
    const bw = Math.min(440, vw - 16);
    const cols = Math.max(18, Math.floor((bw - 20) / 7.2));
    const words = String(this.voice.text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const t = cur ? `${cur} ${wd}` : wd;
      if (t.length > cols && cur) { lines.push(cur); cur = wd; } else cur = t;
      while (cur.length > cols) { lines.push(cur.slice(0, cols)); cur = cur.slice(cols); }
    }
    if (cur) lines.push(cur);
    // The box lives between the boss bar and the bottom of the HUD. On a very
    // short view there is not room for three lines of it, and a broadcast that
    // runs over the round counter is worse than a shorter one.
    const boss = this.hud?._bossRect;
    const top = (boss ? boss.y + boss.h + 8 : 0) + 18;
    const bottom = vh - 78;
    const room = Math.max(0, bottom - top);
    const maxLines = Math.max(1, Math.min(3, Math.floor((room - 6) / 14)));
    const shown = lines.slice(0, maxLines);
    let y = Math.max(top, Math.min(vh - 96, bottom - shown.length * 14 - 6));
    const bh = 20 + shown.length * 14;
    const bLeft = vw / 2 - bw / 2;
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(bLeft, y - 16, bw, bh);
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(150,190,220,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bLeft, y - 16, bw, bh);
    ctx.restore();
    text(ctx, 'LOUDSPEAKER', bLeft + 10, y - 6, {
      font: 'bold 9px "Courier New", monospace', colour: '#7f9cb5', align: 'left', alpha: a,
    });
    shown.forEach((ln, i) => {
      text(ctx, ln, vw / 2, y + 10 + i * 14, {
        font: 'bold 12px "Courier New", monospace', colour: '#cfe0ee', align: 'center', alpha: a,
      });
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
      // a map with no spawn points at all (the test range) must not
      // conjure a body out of thin air -- return nothing instead
      const fb = this.map.spawnPoints;
      if (!fb.length) return null;
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
    if (!pick) return;
    const sp = pick.s ?? pick;
    if (!sp || sp.x == null) return;
    this.zombies.push(this.makeZombie({ x: sp.x, y: sp.y, floor: pick.floor }));
    this.zombiesSpawned++;
  }

  onZombieKilled(z, head, ptsOverride = null, source = 'bullet') {
    // Skeletons and the pieces that come off a swarm are not part of the
    // round's tally -- they are made during it. They do not bring the round
    // closer to done; they only hold it open until you have killed them too.
    if (z.boss) {
      // the warden was never in the tally: killing it is what ends the round
      this.boss = null;
      this.recordRound('bosses');
      this.bannerShow('WARDEN DOWN', 'whatever it was holding open is closed',
        { dur: 3.4, colour: '#f0d98a' });
      audio.chime?.();
    } else if (!z.summoned) this.zombiesKilled++;
    const who = z._by ?? this.player;
    // the set goes off the air the moment the thing carrying it does
    if (z.def.jams && this.jamT > 0) { this.jamT = Math.min(this.jamT, 0.45); this.jamSrc = null; }
    if (z.type === 'medic') this.say('medic');
    else if (z.type === 'fusion') this.say('amalgam');
    this.recordRound('kills');
    if (head) this.recordRound('headshots');
    if (z.summoned) this.recordRound('summonedKills');
    if (!['walker', 'runner', 'crawler', 'dog', 'skeleton'].includes(z.type)) this.recordRound('specialKills');
    if (source === 'knife') this.recordRound('knifeKills');
    if (source === 'trap') this.recordRound('trapKills');
    this.stats.kills++;
    if (head) this.stats.headshots++;
    const pts = ptsOverride
      ?? Math.round((POINTS_KILL + (head ? POINTS_HEAD : 0)) * z.pointsMul
        * (this.timers.doublepoints > 0 ? 2 : 1));
    this.addPoints(pts, z.pos.x, z.pos.y - 24,
      ptsOverride ? '#a8d06a' : head ? '#f0d98a' : '#e6dcc2', who);
    this.netEmit('kill', { x: Math.round(z.pos.x), y: Math.round(z.pos.y), pts, head: !!head });
    this.splat(z.pos.x, z.pos.y, 9 + Math.random() * 7, 0.5);

    // salvage -- an outfit can make the pockets of the dead more generous
    const dropChance = (SALVAGE_DROP + (z.type === 'brute' ? 0.55 : 0))
      * (who.skinFx?.salvageMul ?? 1);
    if (Math.random() < dropChance) {
      const n = z.type === 'brute' ? randInt(2, 4) : 1;
      who.salvage = (who.salvage ?? 0) + n;
      this.recordRound('salvage', n);
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
    if (source === 'monkey') this._monkeyKills = (this._monkeyKills ?? 0) + 1;
    if (source === 'trap') this.traps.kills++;
    // the creature shortlist, tallied by kind
    if (z.type === 'bonewright') this.achievements.unlock('bone_collector');
    if (z.type === 'swarmling') this.achievements.unlock('swarm_season');
    if (z.def.jams) this.achievements.unlock('off_the_air');
    if (z.type === 'skeleton') {
      this.stats.skeletonKills++;
      if (this.stats.skeletonKills >= 10) this.achievements.unlock('skeleton_key');
    }
    // knife work
    if (source === 'knife') {
      this.stats.knifeKills++;
      if (this.stats.knifeKills >= 25) this.achievements.unlock('knife_work');
    }
    // a kill taken before the power ever came on
    if (!this.powerOn) {
      this.stats.darkKills++;
      if (this.stats.darkKills >= 15) this.achievements.unlock('lights_out');
    }
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

  // ------------------------------------------------------- the haunt round --
  /**
   * Timers and flight paths only. Called from the host's update *and* from
   * _guestUpdate: everything inside is safe to run twice over the wire, and
   * anything with consequences checks isAuth() on its own.
   */
  _stepHaunts(dt) {
    for (let i = this.totems.length - 1; i >= 0; i--) {
      this.totems[i].update(dt, this);
      if (this.totems[i].dead) this.totems.splice(i, 1);
    }
    for (let i = this.graves.length - 1; i >= 0; i--) {
      this.graves[i].update(dt, this);
      if (this.graves[i].dead) this.graves.splice(i, 1);
    }
    for (let i = this.hives.length - 1; i >= 0; i--) {
      this.hives[i].update(dt, this);
      if (this.hives[i].dead) this.hives.splice(i, 1);
    }
    for (let i = this.threads.length - 1; i >= 0; i--) {
      this.threads[i].update(dt, this);
      if (this.threads[i].dead) this.threads.splice(i, 1);
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      this.arrows[i].update(dt, this);
      if (this.arrows[i].dead) this.arrows.splice(i, 1);
    }
    for (let i = this.arrowSticks.length - 1; i >= 0; i--) {
      this.arrowSticks[i].life -= dt;
      if (this.arrowSticks[i].life <= 0) this.arrowSticks.splice(i, 1);
    }
    for (let i = this.zThrows.length - 1; i >= 0; i--) {
      this.zThrows[i].update(dt, this);
      if (this.zThrows[i].dead) this.zThrows.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].life -= dt;
      if (this.bolts[i].life <= 0) this.bolts.splice(i, 1);
    }
    this._updateWeather(dt);
  }

  /** A Bearer or a Mourner kneels and leaves something behind. False = house full. */
  placeHaunt(z) {
    const floor = z.floor ?? this.map.floor;
    if (z.def.places === 'hive') {
      // two hives at most in the house, and never two from the same keeper
      if (this.hives.filter((h) => !h.dead).length >= (z.boss ? 2 : 1)) return false;
      if (this.hives.some((h) => !h.dead && h.ownerId === z.id)) return false;
      const hv = new Hive(z.pos.x, z.pos.y, floor, ++this._hauntId);
      hv.ownerId = z.id;
      this.hives.push(hv);
      audio.wood(true);
      this.particles.spark(hv.x, hv.y - 8, -Math.PI / 2, 8, '#e0b04a');
      this.bannerShow('A HIVE IS SET DOWN', 'the humming starts -- shoot the box, not the bees',
        { dur: 3, colour: '#e0b04a' });
      this.say('hive');
      return true;
    }
    if (z.def.places === 'totem') {
      if (this.totems.some((t) => !t.dead)) return false;   // one dusk at a time
      const tt = new Totem(z.pos.x, z.pos.y, floor, ++this._hauntId);
      this.totems.push(tt);
      audio.totemRaise();
      this.shake(2.2, 0.3);
      this.explosionLights.push({ x: tt.x, y: tt.y - 10, r: 170, life: 0.6, max: 0.6, colour: '#8a4ad0', f: floor });
      this.bannerShow('A TOTEM RISES', 'the dusk is theirs now -- shoot it', { dur: 3, colour: '#b07ae0' });
      this.say('totem');
      return true;
    }
    if (this.graves.filter((g) => !g.dead).length >= 2) return false;
    const gv = new Grave(z.pos.x, z.pos.y, floor, ++this._hauntId);
    this.graves.push(gv);
    audio.graveDug();
    this.bannerShow('A GRAVE IS DUG', 'the bells and the walkers belong to it', { dur: 3, colour: '#9fb4c8' });
    this.say('grave');
    return true;
  }

  /** Snowman / Arsonist / Witch: the arm comes back and something flies. */
  throwZombieProjectile(z, target, kind) {
    const p = target ?? this.player;
    if (!p) return;
    const scatter = kind === 'snow' ? 54 : kind === 'bottle' ? 44 : 50;
    const a = randRange(0, TAU), r = Math.sqrt(Math.random()) * scatter;
    const tx = p.pos.x + Math.cos(a) * r, ty = p.pos.y + Math.sin(a) * r;
    this.zThrows.push(new ZThrow(z.pos.x, z.pos.y - 10, tx, ty, kind, z.floor ?? this.map.floor));
    audio.growl(kind === 'snow' ? 1.3 : 0.95, (z.floor ?? 0) === this.map.floor ? 0.8 : 0.3);
  }

  /** The Shocker's bolt. Walls eat it; you do not. */
  zapPlayer(z, p) {
    if (!p || (p.floor ?? 0) !== (z.floor ?? 0)) return;
    const tx = p.pos.x, ty = p.pos.y - 6;
    const wall = this.map.rayWall(z.pos.x, z.pos.y - 12, tx, ty, Infinity, z.floor ?? this.map.floor);
    const ex = wall ? wall.x : tx, ey = wall ? wall.y : ty;
    const floor = z.floor ?? this.map.floor;
    this.bolts.push({
      x0: z.pos.x, y0: z.pos.y - 14, x1: ex, y1: ey,
      life: 0.22, max: 0.22, f: floor, seed: Math.random() * 100,
    });
    audio.zap(wall ? 0.6 : 1);
    this.particles.spark(ex, ey, randRange(0, TAU), 12, '#bfe0ff');
    this.explosionLights.push({ x: ex, y: ey, r: 150, life: 0.18, max: 0.18, colour: '#9fd0ff', f: floor });
    if (!wall && !p.dead) {
      this.shake(3, 0.25);
      if (p.hurt(12, z.pos.x, z.pos.y, this)) {
        p.stunT = Math.max(p.stunT ?? 0, 0.75);
        this.popups.add(p.pos.x, p.pos.y - 40, 'SHOCKED', '#bfe0ff', 12);
      }
    }
  }

  /** A hive lets one out. Small, quick, and worth almost nothing on its own. */
  spawnBee(hive) {
    const a = randRange(0, TAU), r = randRange(8, 18);
    const z = this.makeZombie({
      x: hive.x + Math.cos(a) * r, y: hive.y + Math.sin(a) * r, floor: hive.f,
    }, 'bee');
    z.hiveUid = hive.uid;
    z.summoned = true;
    this.zombies.push(z);
    this.particles.spark(z.pos.x, z.pos.y - 8, a, 3, '#e0c060');
    audio.silk?.(0.35);
  }

  /** The archer's fan: three arrows, the middle one where you were standing. */
  archerVolley(z, p) {
    const floor = z.floor ?? this.map.floor;
    const tx = p?.pos.x ?? z.pos.x, ty = p?.pos.y ?? z.pos.y;
    const base = Math.atan2(ty - 12 - (z.pos.y - 12), tx - z.pos.x);
    const dmg = (this.roundPlan?.(this.round)?.hp ?? 120) * 0.055;
    for (const [off, fast, heavy] of [[0, 520, true], [-0.245, 380, false], [0.245, 380, false]]) {
      const ang = base + off;
      this.arrows.push(new Arrow(z.pos.x + Math.cos(base) * 10, z.pos.y - 12 + Math.sin(base) * 6,
        ang, fast, heavy ? dmg : dmg * 0.6, floor, heavy));
    }
    audio.bow?.(0.8);
    this.particles.spark(z.pos.x, z.pos.y - 12, base, 3, '#cfc9b4');
  }

  /** A weaver sets a knot of silk down. It is not a projectile: it stays. */
  addThread(x, y, floor) {
    if (this.threads.length >= 26) return;
    // do not stack them on top of each other -- a mat of silk is not a wall
    for (const t of this.threads) {
      if (t.dead || (t.f ?? 0) !== floor) continue;
      if (dist2(t.x, t.y, x, y) < 24 * 24) return;
    }
    this.threads.push(new Thread(x, y, floor));
    audio.silk?.(0.5);
    this.particles.dust(x, y, randRange(0, TAU), 2);
  }

  /** An arrow that stopped in a wall. Kept, because it is a nice thing to see. */
  stickArrow(x, y, ang, f) {
    if (this.arrowSticks.length > 40) this.arrowSticks.shift();
    this.arrowSticks.push({ x, y, ang, f, life: 14, max: 14 });
  }

  /**
   * The floor under your feet, made hostile. A knot of silk takes a little
   * over half your legs and refuses the dash; a dash that starts outside one
   * tears straight through it, which is the move the whole creature is for.
   */
  threadTick(dt) {
    const p = this.player;
    if (!p || p.dead) return;
    const floor = p.floor ?? this.map.floor;
    let inSilk = false;
    for (const t of this.threads) {
      if (t.dead || (t.f ?? 0) !== floor) continue;
      if (dist2(t.x, t.y, p.pos.x, p.pos.y) < 17 * 17) { inSilk = true; break; }
    }
    if (inSilk) {
      if (!p._silkTold || this.time - p._silkTold > 4) {
        p._silkTold = this.time;
        this.popups.add(p.pos.x, p.pos.y - 34, 'SILK', '#e8e4d2', 10);
      }
      p.silkT = 0.14;
    }
  }

  /** A dash tears every knot it passes through. */
  tearThreads(p) {
    if (!this.threads.length) return;
    const floor = p.floor ?? this.map.floor;
    for (const t of this.threads) {
      if (t.dead || (t.f ?? 0) !== floor) continue;
      if (dist2(t.x, t.y, p.pos.x, p.pos.y) < 30 * 30) {
        t.tear(this);
        this.particles.spark(t.x, t.y - 3, randRange(0, TAU), 5, '#e8e4d2');
      }
    }
  }

  /**
   * The sapper's bundle. Killing it is the gift: the blast takes everything
   * dead within ninety units with it and does nothing at all to you. Letting
   * it reach you is the other case, and that one hurts.
   */
  sapperBoom(z, onContact = false) {
    if (z._boomed) return;
    z._boomed = true;
    const floor = z.floor ?? this.map.floor;
    const R = 96;
    this.explosionLights.push({ x: z.pos.x, y: z.pos.y - 6, r: 150, life: 0.35, max: 0.35, colour: '#f0a03c', f: floor });
    this.particles.spark(z.pos.x, z.pos.y - 6, randRange(0, TAU), 26, '#f0c060');
    this.particles.smoke(z.pos.x, z.pos.y - 4, 10);
    this.shake(4, 0.3);
    if (audio.explosion) audio.explosion(); else audio.zombieDie();
    let killed = 0;
    for (const o of this.zombies) {
      if (o === z || o.dead) continue;
      if ((o.floor ?? 0) !== floor) continue;
      const d = dist(z.pos.x, z.pos.y, o.pos.x, o.pos.y);
      if (d > R) continue;
      const mul = 1 - (d / R) * 0.6;
      if (o.hurt(260 * mul, false, this, randRange(0, TAU)) === 2) {
        this.onZombieKilled(o, false, null, 'blast');
        killed++;
      }
    }
    if (killed) this.addPoints(killed * 40, z.pos.x, z.pos.y - 22, '#f0d98a', this.player);
    if (onContact) {
      const p = this.player;
      if (p && !p.dead && (p.floor ?? 0) === floor && dist(z.pos.x, z.pos.y, p.pos.x, p.pos.y) < R) {
        if (p.hurt(55, z.pos.x, z.pos.y, this)) {
          this.popups.add(p.pos.x, p.pos.y - 34, 'SAPPER', '#e0896a', 12);
        }
      }
    }
    // if it is still standing (it reached you), put it down here; if the
    // bullet already did that, `die` has been and gone and only the blast
    // was ever missing
    if (!z.dead) {
      z.hp = 0;
      z.dead = true;
      z.deadT = 0;
      z.state = ZSTATE.DEAD;
      this.particles.chunk(z.pos.x, z.pos.y, randRange(0, TAU), 6);
    }
  }

  /** A porter sets its brood down. They belong to it, so they are not counted. */
  spawnBrood(z, n = 2) {
    const floor = z.floor ?? this.map.floor;
    for (let i = 0; i < n; i++) {
      const a = randRange(0, TAU), r = randRange(12, 26);
      const b = this.makeZombie({
        x: z.pos.x + Math.cos(a) * r, y: z.pos.y + Math.sin(a) * r, floor,
      }, 'porter' === z.type || z.type === 'mother' ? 'swarmlet' : 'swarmlet');
      b.summoned = true;
      b.summonedBy = z.id;
      this.zombies.push(b);
      this.particles.dust(b.pos.x, b.pos.y, a, 4);
    }
    audio.silk?.(0.4);
  }

  /** The warden blows a whistle; the colonel gets knights. */
  bossSummon(z) {
    const floor = z.floor ?? this.map.floor;
    const type = z.def.summons ?? 'walker';
    const n = type === 'knight' ? 1 : 2;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + randRange(0, 1);
      const spot = this.map.blockedAt(z.pos.x + Math.cos(a) * 40, z.pos.y + Math.sin(a) * 40, 8, floor)
        ? null : { x: z.pos.x + Math.cos(a) * 40, y: z.pos.y + Math.sin(a) * 40 };
      if (!spot) continue;
      const o = this.makeZombie({ x: spot.x, y: spot.y, floor }, type);
      o.summoned = true;
      o.state = ZSTATE.EMERGE;
      o.emergeT = 0.5;
      this.zombies.push(o);
      this.particles.dust(spot.x, spot.y, a, 8);
      made++;
    }
    if (made) {
      this.shake(2, 0.2);
      this.popups?.add?.(z.pos.x, z.pos.y - 40,
        type === 'knight' ? 'IT WHISTLES' : 'IT CALLS THEM IN', '#e0896a', 11);
      audio.growl?.(0.6, 0.9);
    }
  }

  /** The organist's ring: it staggers you and it is heard across the floor. */
  bossShock(z, radius = 220) {
    const floor = z.floor ?? this.map.floor;
    this.shriekRings.push({
      x: z.pos.x, y: z.pos.y, r: 10, max: radius, life: 0.9, maxLife: 0.9,
      f: floor, colour: '#c8a0e8',
    });
    audio.shriek();
    this.shake(4, 0.3);
    const p = this.player;
    if (p && !p.dead && (p.floor ?? 0) === floor
      && dist(z.pos.x, z.pos.y, p.pos.x, p.pos.y) < radius && p.hurt(16, z.pos.x, z.pos.y, this)) {
      p.stunT = Math.max(p.stunT ?? 0, 0.45);
      this.popups.add(p.pos.x, p.pos.y - 34, 'STAGGERED', '#c8a0e8', 12);
    }
    for (const o of this.zombies) {
      if (o === z || o.dead) continue;
      if (dist2(z.pos.x, z.pos.y, o.pos.x, o.pos.y) < radius * radius) o.rally = 5;
    }
  }

  /** The grave lets one out: half-seen, quick, and not part of the round's tally. */
  spawnWraith(x, y, floor, uid) {
    const a = randRange(0, TAU), r = randRange(26, 52);
    const z = this.makeZombie({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, floor }, 'wraith');
    z.graveUid = uid;
    z.summoned = true;
    this.zombies.push(z);
    this.particles.smoke(z.pos.x, z.pos.y, 8);
    audio.whimper();
  }

  /** Grenades, monkey bombs and traps are allowed to break the furniture too. */
  hurtHaunts(x, y, R, dmg, floor) {
    for (const tt of this.totems) {
      if (tt.dead || (tt.f ?? 0) !== floor) continue;
      const d = dist(x, y, tt.x, tt.y);
      if (d < R) tt.hurt(dmg * (1 - d / R * 0.5), this);
    }
    for (const gv of this.graves) {
      if (gv.dead || (gv.f ?? 0) !== floor) continue;
      const d = dist(x, y, gv.x, gv.y);
      if (d < R) gv.hurt(dmg * (1 - d / R * 0.5), this);
    }
    for (const hv of this.hives) {
      if (hv.dead || (hv.f ?? 0) !== floor) continue;
      const d = dist(x, y, hv.x, hv.y);
      if (d < R) hv.hurt(dmg * (1 - d / R * 0.5), this);
    }
    for (const th of this.threads) {
      if (th.dead || (th.f ?? 0) !== floor) continue;
      if (dist(x, y, th.x, th.y) < R) th.tear(this);
    }
  }

  // ---------------------------------------------------------------- weather --
  /** Once per round the sky is rolled: storm, fog, or business as usual. */
  rollWeather(n) {
    if (this.rangeMode || !settings.get('weather') || n < 3) { this.setWeatherKind(null); return; }
    // the radio called it last round: the sky keeps its promise
    if (this.wx.forecast) {
      const k = this.wx.forecast;
      this.wx.forecast = null;
      this.setWeatherKind(k);
      return;
    }
    const stormP = Math.min(0.26, 0.14 + n * 0.003);
    const r = Math.random();
    if (r < stormP) this.setWeatherKind('storm');
    else if (r < stormP + 0.13) this.setWeatherKind('fog');
    else this.setWeatherKind(null);
  }

  setWeatherKind(kind) {
    const W = this.wx;
    if (W.kind === kind) return;
    W.kind = kind;
    W.t = 0; W.flash = 0; W.strikeT = randRange(2.5, 6); W.thunderAt = -1;
    audio.rain(kind === 'storm');
    if (kind === 'storm') {
      W.drops = [];
      for (let i = 0; i < 110; i++) {
        W.drops.push({ x: Math.random() * this.vw, y: Math.random() * this.vh, s: randRange(340, 620), l: randRange(7, 16) });
      }
      this.say('storm');
    }
    if (kind === 'fog') this.say('fog');
  }

  _updateWeather(dt) {
    const W = this.wx;
    if (!W) return;
    if (W.kind === 'storm') {
      W.t += dt;
      W.flash = Math.max(0, W.flash - dt * 2.6);
      W.wet = Math.min(1, W.wet + dt * 0.25);
      W.strikeT -= dt;
      if (W.strikeT <= 0) {
        W.strikeT = randRange(3.5, 8.5);
        W.flash = 1;
        W.thunderAt = W.t + randRange(0.3, 1.1);
        this.shake(1.6, 0.3);
      }
      if (W.thunderAt > 0 && W.t >= W.thunderAt) { W.thunderAt = -1; audio.thunder(0.9); }
      for (const d of W.drops) {
        d.y += d.s * dt;
        d.x -= 160 * dt;                      // the rain comes in slanted
        if (d.y > this.vh) { d.y = -12; d.x = Math.random() * (this.vw + 80); }
        if (d.x < -20) d.x += this.vw + 40;
      }
    } else if (W.wet > 0) {
      W.wet = Math.max(0, W.wet - dt * 0.05); // the glass dries slowly
    }
  }

  /** The loudspeaker is not a stranger any more. */
  sayStory(n) {
    if (this._storySaid[n]) return;
    this._storySaid[n] = true;
    const lines = {
      25: 'This is not the loudspeaker. We are outside the wire, and we can see your roof. Keep going.',
      30: 'Copy that, survivor. The bird wants twenty quiet minutes after this. Give us thirty, and be on the roof.',
      35: 'We are circling. When the roof is clear, look up. Do not make us come back for you.',
    };
    const line = lines[n];
    if (!line) return;
    const hold = audio.voice(line, { pitch: 0.9 });
    this.voice = { text: line, left: hold };
  }

  /** One line over the wire, with the subtitle channel and a cooldown to match. */
  _speak(text, pitch = 0.9) {
    const hold = audio.voice(text, { pitch });
    this.voice = { text, left: hold };
    this._voiceCd = Math.max(this._voiceCd ?? 0, 10);
  }

  /**
   * The radio's night: every 5-7 rounds somebody finds your frequency --
   * sitreps, a roll call by name, the numbers station, a careful hint at one
   * of the four dials, a storm forecast that binds the next round's sky, or a
   * crate really pushed out of a bird. It never talks over the story rounds.
   */
  _radioNight(n) {
    if (this.rangeMode || n < 8 || n < this.radioNext) return;
    if (n === 25 || n === 30 || n === 35) { this.radioNext = n + 1; return; }
    if (this.heli.phase >= 2) return;      // inbound or landed: the crew talks now
    this.radioNext = n + 5 + randInt(0, 2);
    const pool = RADIO_EVENTS.filter((e) => e.id !== this._radioLast && (!e.cond || e.cond(this)));
    if (!pool.length) return;
    const ev = pool[randInt(0, pool.length - 1)];
    this._radioLast = ev.id;
    this._radioHeard++;
    audio.radioStart();
    this._speak(ev.text(this));
    if (ev.fx) ev.fx(this);
    this.bannerShow('THE RADIO', 'somebody out there still transmits', { dur: 2.8, colour: '#9fd0e0' });
  }

  /**
   * Round 30: the board either has a bearing on you, or it apologises.
   * Returns true when it took the wire (so the old story beat stays quiet).
   */
  _heliRoundStart(n) {
    if (this.rangeMode) return false;
    const H = this.heli;
    if (n !== 30 || H.phase !== 0) return false;
    if (this.egg?.complete) return false;   // the arm check in _heliStep owns it now
    if (!H.sorry) {
      H.sorry = true;
      this._speak('The bird was fuelled and ready. Then the board went dark -- too few beacons, no bearing on this house. Find the four dials, survivor. We are sorry.');
      return true;
    }
    return false;
  }

  /**
   * Round 25 with four lit dials arms the pad -- no calendar ritual, no three
   * rounds of holding the roof. Whatever order you did it in, this notices.
   */
  _heliArmCheck() {
    const H = this.heli;
    if (this.rangeMode || H.phase !== 0) return;
    if (!this.egg?.complete || this.round < 25) return;
    H.phase = 1; H.t = 0;
    this._speak('Four beacons lit and the round counter past twenty-five -- we have a bearing and a bird. There is a flare locker at the centre of the pad. Light it: green smoke is what the crew homes on.');
    this.bannerShow('THE PAD IS ARMED', 'light the green flare at the centre of the pad', { dur: 4.4, colour: '#f0d98a' });
  }

  /**
   * The bird and the crates, ticked on both sides of the wire: the phases
   * themselves advance only on the authority, but the guest runs the same
   * timers so the rotor and the inbound glide stay smooth between snapshots.
   */
  _heliStep(dt) {
    const H = this.heli;
    const auth = !this.net?.playing || this.net.isHost;
    H.t += dt;
    this._heliArmCheck();
    if (H.phase === 2) {
      // two minutes of green smoke: the bird is a dot for most of it, then
      // the smoke thins as the wings come in over the west trees
      const thin = H.t < 108 ? 1 : Math.max(0, (116 - H.t) / 8);
      if (H.flare && thin > 0 && Math.random() < dt * 26 * thin) {
        this.particles.smoke(HELI_PAD.x + randRange(-5, 5), HELI_PAD.y - 4 + randRange(-4, 4), 1);
      }
      this._heliSnd = H.t > 108;
      if (this._heliSnd) audio.heli(Math.min(1, 0.25 + (H.t - 108) / 12));
      if (H.t >= 60 && !H._said60 && auth) {
        H._said60 = 1;
        this._speak('One minute out. That smoke is on our scope the whole way in -- keep the pad clear.');
      }
      if (H.t >= 108 && !H._said108 && auth) {
        H._said108 = 1;
        this._speak('Smoke is thinning, wings on the west trees -- it comes in loud and low, keep your head down.');
        this.bannerShow('INBOUND', 'the smoke clears, the bird comes in', { dur: 3.6, colour: '#f0d98a' });
        this.shake(3, 1.2);
      }
      if (H.t >= 120 && auth) {
        H.phase = 3; H.t = 0;
        this.shake(5, 0.9);
        this.bannerShow('THE BIRD IS DOWN', 'walk over and press E to vote yourself aboard', { dur: 3.6, colour: '#f0d98a' });
      }
    } else if (H.phase === 3) {
      this._heliSnd = true;
      audio.heli(0.5);
    } else if (H.phase === 4) {
      this._heliSnd = true;
      audio.heli(Math.min(1, 0.5 + H.t * 0.16));
      if (H.t >= 4.5 && auth) { H.phase = 5; this._finishEvac(); }
    } else if (this._heliSnd) {
      this._heliSnd = false;
      audio.heliOff();
    }
    for (let i = this.supplies.length - 1; i >= 0; i--) {
      const s = this.supplies[i];
      s.t += dt;
      if (s.taken) { this.supplies.splice(i, 1); continue; }
      if (s.t <= s.fall) continue;                 // still under the canopy
      s.life -= dt;
      if (Math.random() < dt * 5) this.particles.smoke(s.x + randRange(-6, 6), s.y - 6, 1);
      if (s.life <= 0) { this.supplies.splice(i, 1); continue; }   // the night takes it back
      if (!auth) continue;                          // the host hands out the contents
      for (const pl of this.players ?? [this.player]) {
        if (!pl || pl.dead || pl.downed || (pl.floor ?? 0) !== (s.f ?? 0)) continue;
        if (dist(pl.pos.x, pl.pos.y, s.x, s.y) < 24) { this._takeSupply(s, pl); break; }
      }
      if (s.taken) this.supplies.splice(i, 1);      // gone the moment it is opened
    }
  }

  /** The crate the radio promised: it lands by the boxes and it is real. */
  dropSupply() {
    const spots = this.map.floors?.[0]?.boxSpots ?? [];
    const spot = spots.length ? spots[randInt(0, spots.length - 1)] : this.map.playerStart;
    this.supplies.push({
      x: clamp(spot.x + randRange(-30, 30), T, this.map.w * T - T),
      y: clamp(spot.y + randRange(-30, 30), T, this.map.h * T - T),
      f: 0, t: 0, fall: 2.6, life: 100, taken: false, seed: Math.random() * 100,
    });
  }

  _takeSupply(s, pl) {
    s.taken = true;
    pl.points = (pl.points ?? 0) + 1500;
    pl.salvage = (pl.salvage ?? 0) + 12;
    pl.refillAllReserve?.();
    this.popups.add(pl.pos.x, pl.pos.y - 40, '+1500 CARE PACKAGE', '#f2e26a', 13);
    this.bannerShow('CARE PACKAGE', 'points, salvage, every magazine topped up', { dur: 2.8, colour: '#f2e26a' });
    audio.powerUp();
    if (pl === this.player) this.achievements.unlock('care_package');
  }

  /** E at the landed bird: the ending the whole radio night was for. */
  evacuate(p) {
    const H = this.heli;
    if (this.rangeMode || H.phase !== 3) return;
    if (this.net?.playing && !this.net.isHost) {
      // the guest's E already travelled over the wire and the host ran this
      // very method on this very body (net._remoteInteract); the flip here is
      // only so the pad answers instantly -- the snapshot is the authority
      p.evacVote = !p.evacVote;
      return;
    }
    // E at the bird is a VOTE, not a seat: a hand raised can be taken back,
    // and nobody is bundled aboard until the room has actually agreed
    p.evacVote = !p.evacVote;
    const alive = (this.players ?? []).filter((o) => o && !o.dead);
    const yes = alive.filter((o) => o.evacVote).length;
    const need = Math.floor(alive.length / 2) + 1;      // strictly more than half
    if (alive.length > 1 && yes < need) {
      const nay = alive.filter((o) => !o.evacVote).map((o) => o.name).join(', ');
      this.bannerShow(`EVAC VOTE ${yes}/${alive.length}`,
        `${p.evacVote ? 'you are in' : 'you are out'} -- ${need} hands needed${nay ? `, ${nay} not yet` : ''}`,
        { dur: 2.6, colour: '#f0d98a' });
      audio.deny();
      return;
    }
    H.phase = 4; H.t = 0;
    this.playEvacuationAudio();
    this.shake(6, 1.4);
    this.bannerShow('WHEELS UP', 'the room agreed -- everybody aboard', { dur: 3.4, colour: '#f0d98a' });
    this._speak('We have them. Deck is clear, going up. Somebody put the kettle on.');
    this.achievements.unlock('leaving_tonight');
    // everybody still standing came aboard: from here on they are not on the
    // roof any more -- they are in the cabin, watching the house shrink
    for (const pl of this.players ?? []) { if (pl && !pl.dead) pl.evac = true; }
  }

  /** Green smoke over the roof: the two-minute burn begins. */
  _lightFlare(p) {
    const H = this.heli;
    if (this.rangeMode || H.phase !== 1) return;
    H.phase = 2; H.t = 0; H.flare = true; H._said60 = 0; H._said108 = 0;
    this.shake(3, 0.8);
    audio.powerUp();
    this.particles.smoke(HELI_PAD.x, HELI_PAD.y - 4, 1);
    this.bannerShow('FLARE LIT', 'green smoke over the roof -- the bird lands in 2:00', { dur: 4.2, colour: '#8fdc6a' });
    this._speak('Green over the roof, we see it. Two minutes out -- keep the pad clear and your heads down.');
    this.net?.emit('flare', {});
  }

  /**
   * The roof radio: scrap now, supply crates every second round forever.
   * It is a roof fixture from night one, dead silent until somebody pays.
   */
  _fixRoofRadio(p) {
    if (this.roofRadio?.fixed) return;
    if ((p.salvage ?? 0) < ROOF_RADIO_PRICE) {
      this.popups.add(p.pos.x, p.pos.y - 34, `NEED ${ROOF_RADIO_PRICE} SCRAP`, '#9fd0e0', 12);
      return;
    }
    p.salvage -= ROOF_RADIO_PRICE;
    this.roofRadio.fixed = true;
    audio.powerUp();
    this.bannerShow('THE ROOF RADIO LIVES', 'a crate will fall every second round', { dur: 3.6, colour: '#9fd0e0' });
    this._speak('Somebody got the roof set talking again. Mark it: every second round from here, a crate comes down on your pad.');
    this.net?.emit('radiofix', {});
  }

  /** The crate the roof radio called in: it lands on the pad, under canopy. */
  dropRoofSupply() {
    this.supplies.push({
      x: HELI_PAD.x + randRange(-46, 46),
      y: HELI_PAD.y + randRange(-30, 30),
      f: HELI_PAD.f, t: 0, fall: 3.2, life: 110, taken: false, seed: Math.random() * 100,
    });
    this.bannerShow('SUPPLY RUN', 'the roof radio called it in -- crate on the pad', { dur: 2.8, colour: '#f2e26a' });
    audio.radioStart();
  }

  /** The bird is a star over the west trees: the run ends, the board remembers. */
  playEvacuationAudio() {
    if (this._evacAudioPlayed) return;
    this._evacAudioPlayed = true;
    audio.victory();
  }

  _finishEvac() {
    this.playEvacuationAudio();
    this.gameOver = true;
    this.evacuated = true;
    this.overT = 0;
    this._bankRun();
    audio.heliOff();
    if (this.net?.playing && !this.net.isHost) return;   // a guest gets its screen off the snapshot
    const stamp = Date.now();
    this.board = submitScore({
      round: this.round, kills: this.stats.kills, headshots: this.stats.headshots,
      points: this.stats.points, time: Math.round(this.time), evac: true, date: stamp,
    });
    this.rank = this.board.findIndex((e) => e.date === stamp);
  }

  /** Keep the settings window over the row the arrows just landed on. */
  _viewFollow() {
    const L = settingsLayout(this, this.vw, this.vh);
    if (!L.over) { this.settingsView = 0; return; }
    // a half-scrolled window is snapped to a whole row when the *keyboard*
    // moves the selection: the finger leaves it wherever it likes
    let v = Math.round(this.settingsView ?? L.top);
    if (this.settingsIndex < v) v = this.settingsIndex;
    else if (this.settingsIndex >= v + L.shown) v = this.settingsIndex - L.shown + 1;
    this.settingsView = clamp(v, 0, L.over);
  }

  /**
   * A new night from scratch. The old one is banked first -- restarting from
   * the pause screen is the same decision as quitting to the menu and walking
   * back in, and it must not quietly erase the diary entry the quit would
   * have written.
   */
  _restartRun() {
    this._bankRun();
    this.reset();
    this.started = true;
    this.startRound(1);
  }

  /** The pause menu's last row: leave the run and stand at the front door. */
  _quitToMenu() {
    // quitting mid-night still counts: the diary takes what was earned
    this._bankRun();
    if (this.net?.playing || this.net?.active) this.net.close();
    audio.heliOff();
    // A quit is a full stop, not a pause. Without the reset the front door's
    // SOLO row walked back into the half-played map with the old guns, doors,
    // points and tallies -- and with `_banked` still set, so the next night
    // was never written to the diary at all.
    this.reset();
    this.controlsOpen = false;
    this.debugOpen = false;
    this.craftOpen = false;
    this.scene = 'menu';
  }

  /** Where the bird is right now: inbound glide, on the pad, or climbing out. */
  _heliPos() {
    const H = this.heli;
    const pad = HELI_PAD;
    let x = pad.x, y = pad.y, scale = 1, alpha = 1, light = 0;
    if (H.phase === 2) {
      const k = Math.max(0, Math.min(1, (H.t - 111) / 9));
      if (k <= 0) return { x: pad.x, y: pad.y, scale: 0.35, alpha: 0, light: 0 };
      x = pad.x - (1 - k) * 1500;
      y = pad.y - (1 - k) * 520;
      scale = 0.35 + k * 0.65;      // altitude reads as size from straight up
      light = k;
    } else if (H.phase === 3) {
      light = 0.5;
    } else if (H.phase === 4) {
      const k = Math.min(1, H.t / 4.5);
      y = pad.y - k * 560;
      scale = 1 - k * 0.6;
      alpha = 1 - k * 0.85;
      light = 1 - k;
    }
    return { x, y, scale, alpha, light };
  }

  /** Debug: drop whatever is happening and stand in round n instead. */
  jumpToRound(n) {
    n = clamp(Math.round(n) || 1, 1, 99);
    for (const z of this.zombies) { z.dead = true; z.remove = true; }
    this.zombies = [];
    this.totems = []; this.graves = []; this.zThrows = []; this.bolts = [];
    this.hives = []; this.threads = []; this.arrows = []; this.arrowSticks = [];
    this.boss = null;
    this.fires = []; this.gases = []; this.rifts = [];
    this.heli = { phase: 0, t: 0, roofRounds: 0, sorry: false, flare: false };
    this.supplies = [];
    audio.heliOff();
    this.respawnQueue = 0;
    this.intermission = 0;
    this.startRound(n);
    this.bannerShow('DEBUG', `jumped to round ${n}`, { dur: 1.6, colour: '#8fa8bd' });
  }

  /**
   * Damage over time that is not a hit: no knockback, no shake, no i-frames.
   * It does hold the regen timer open, which is the point -- you cannot stand
   * in a fire and heal through it.
   */
  scorchPlayer(dmg, game, owner, p = this.player) {
    if (p.dead || this.gameOver) return;
    if (p.evac || p.downed) return;               // aboard, or already on the floor
    if (this.debug?.god || p.god) return;         // god mode means ALL of it
    // your own fire and your own gas know you, if you own the flopper
    if (owner && owner === p && p.perks?.has('phdflopper')) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    p.hurtFlash = Math.max(p.hurtFlash ?? 0, 0.25);
    if (p.hp <= 0) {
      p.hp = 0;
      const coop = (this.players?.length ?? 1) > 1;
      if (coop) {
        p.downed = true; p.bleedT = 60; p.invuln = 1.2;
        this.popups?.add?.(p.pos.x, p.pos.y - 34, 'DOWN', '#c4463a', 13);
      } else { p.dead = true; this.gameOver = true; this.overT = 0; this._bankRun(); }
    }
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

  collectPowerup(pu, who) {
    const p = who || this.player;
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
          if (z.hurt(1e9, false, this, Math.atan2(z.pos.y - p.pos.y, z.pos.x - p.pos.x)) !== 2) continue;
          this.onZombieKilled(z, false, 0);
          n++;
        }
        this.shake(9, 0.5);
        this.explosionLights.push({ x: p.pos.x, y: p.pos.y, r: 900, life: 0.7, max: 0.7, f: this.fxFloor });
        // the white-out is the loudest picture in the game: a guest used to
        // read about it and see nothing
        this.netEmit('boom', { x: Math.round(p.pos.x), y: Math.round(p.pos.y), r: 220, f: this.fxFloor });
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
    // the guest used to watch a grenade go off in silence: no flash, no shake
    this.netEmit('boom', { x: Math.round(x), y: Math.round(y), r: Math.round(r), f: this.fxFloor });
  }

  splat(x, y, r, alpha = 0.5, colour = '#4d1214') {
    if (!settings.get('blood')) return;
    const f = this.fxFloor;
    this._decalFor(f);
    const box = this._decalBox[f]
      ?? (this._decalBox[f] = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    // remember where the mess is, so a clean stretch of floor costs nothing
    if (x - r * 2 < box.x0) box.x0 = x - r * 2;
    if (y - r * 2 < box.y0) box.y0 = y - r * 2;
    if (x + r * 2 > box.x1) box.x1 = x + r * 2;
    if (y + r * 2 > box.y1) box.y1 = y + r * 2;
    this._decalCount[f] = (this._decalCount[f] ?? 0) + 1;
    if (this._decalCount[f] > DECAL_MAX) this._washDecals(f);
    const c = this._decalCtx[f];
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
    const cursor = this.screenToWorld(m.x, m.y);
    let dx = cursor.x - ox, dy = cursor.y - oy;
    const d = Math.hypot(dx, dy);
    if (d < 1) { this.aimOnTarget = false; this.aimOnHead = false; return; }
    dx /= d; dy /= d;
    const def = p.def;
    const wall = this.map.rayWall(ox, oy, ox + dx * def.range, oy + dy * def.range);
    const wallT = wall ? wall.t : def.range;
    let hit = false, head = false;
    for (const z of this.zombies) {
      if (z.dead) continue;
      if ((z.floor ?? 0) !== (p.floor ?? this.map.floor)) continue;
      const hx = z.pos.x, hy = z.pos.y - HEAD_OFF_Y * (z.def.headOff ?? 1);
      const low = z.def.low ? 0.72 : 1;
      // a hound is drawn bigger than a human crouch, so its boxes are too
      const hs = z.def.hitScale ?? 1;
      let res = pointSegDist2(hx, hy, ox, oy, ox + dx * def.range, oy + dy * def.range);
      const headR = 5.2 * low * hs;
      let isHead = false;
      // no head on a skeleton: there is nothing to aim at but the ribs
      if (z.def.headless || res.d2 > headR * headR) {
        res = pointSegDist2(z.pos.x, z.pos.y, ox, oy, ox + dx * def.range, oy + dy * def.range);
        const bodyR = (8.4 + (z.def.smash ? 3.4 : 0)) * (z.def.low ? 0.8 : 1) * hs;
        if (res.d2 > bodyR * bodyR) continue;
      } else isHead = true;
      if (Math.hypot(res.cx - ox, res.cy - oy) > wallT) continue;
      hit = true; head = isHead;
      break;
    }
    this.aimOnTarget = hit;
    this.aimOnHead = head;
  }

  // -------------------------------------------------------------- shooting
  fireHitscan(ox, oy, angle, def, muzzle, by = null, doSpecial = true) {
    this.stats.shots++;
    this.recordRound('rays');
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const ex = ox + dx * def.range, ey = oy + dy * def.range;
    const shooter = by ?? this.player;
    const floor = shooter.floor ?? this.map.floor;
    const wall = this.map.rayWall(ox, oy, ex, ey, Infinity, floor);
    const wallT = wall ? wall.t : def.range;

    const hits = [];
    const magnet = shooter.perkFx.headMagnet;
    for (const z of this.zombies) {
      if (z.dead) continue;
      if ((z.floor ?? 0) !== floor) continue;   // different storey
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
      const hs = z.def.hitScale ?? 1;   // the big ones are easier to hit
      const headR = (3.9 + (magnet > 0 ? 1.6 : 0)) * low * hs;
      const bodyR = (7.2 + (z.def.smash ? 3.4 : 0)) * (z.def.low ? 0.78 : 1) * hs;
      if (z.def.headless || res.d2 > headR * headR) {
        res = pointSegDist2(z.pos.x, z.pos.y, ox, oy, ox + dx * def.range, oy + dy * def.range);
        if (res.d2 > bodyR * bodyR) continue;
      } else head = true;
      const t = Math.hypot(res.cx - ox, res.cy - oy);
      if (t > wallT) continue;
      hits.push({ z, t, head, x: res.cx, y: res.cy });
    }
    // the planted haunts take bullets too -- shooting the totem or the
    // headstone is the whole point of them
    for (const arr of [this.totems, this.graves, this.hives, this.threads]) {
      for (const st of arr) {
        if (st.dead || (st.f ?? 0) !== floor) continue;
        const lift = st.kind === 'thread' ? 2 : 10;
        const rad = st.kind === 'thread' ? 11 : 13;
        const res = pointSegDist2(st.x, st.y - lift, ox, oy, ex, ey);
        if (res.d2 > rad * rad) continue;
        const t = Math.hypot(res.cx - ox, res.cy - oy);
        if (t > wallT) continue;
        hits.push({ st, t, head: false, x: res.cx, y: res.cy });
      }
    }
    hits.sort((a, b) => a.t - b.t);

    const insta = this.timers.instakill > 0 ? 9999 : 1;
    // Run skills that live on the shot itself. Cold Blood is loaded by
    // standing still and spent by the next trigger pull, hit or miss.
    const sfx = shooter.skillFx ?? NO_SKILLS;
    const cool = sfx.coolhead && shooter._coolReady ? sfx.coolheadMul : 1;
    const last = shooter.hp <= shooter.maxHp * sfx.laststandHp ? sfx.lastStandMul : 1;
    const skillMul = (sfx.dmgMul ?? 1) * cool * last;
    shooter._coolReady = false;
    let pierce = def.pierce;
    let endT = wallT;
    let anyHit = false;
    let firstHit = null;
    for (const h of hits) {
      if (h.st) {
        // furniture: pays like a body, breaks like a promise
        this.stats.hits++;
        this.addPoints(POINTS_HIT, h.x, h.y - 8, 'rgba(230,220,194,0.9)', by ?? this.player);
        if (!by || by === this.player) this.hud.hit(false);
        this.net?.emit('hit', {
          x: Math.round(h.x), y: Math.round(h.y), a: Math.round(angle * 100) / 100,
          head: false, by: by?.netId ?? 0,
        });
        const broke = h.st.hurt(def.dmg * insta * skillMul, this);
        if (broke) {
          const prize = h.st.kind === 'totem' ? 250 : h.st.kind === 'thread' ? 20 : 200;
          this.addPoints(prize, h.st.x, h.st.y - 30, '#f0d98a', by ?? this.player);
        }
        anyHit = true;
        if (!firstHit) firstHit = { x: h.x, y: h.y, z: null };
        endT = h.t;
        break;
      }
      const wasAlive = !h.z.dead;
      const mul = (h.head ? def.headMul : 1) * insta * skillMul
        * (h.head ? (sfx.headMul ?? 1) * (shooter.skinFx?.headMul ?? 1) : 1);
      const res = h.z.hurt(def.dmg * mul, h.head, this, angle, by);
      if (!wasAlive) continue;
      anyHit = true;
      if (!firstHit) firstHit = h;
      this.stats.hits++;
      if (this.stats.shots >= 100 && this.stats.hits / this.stats.shots >= 0.5) {
        this.achievements.unlock('marksman');
      }
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

    if (anyHit) this.recordRound('hitRays');

    // wonder-weapon extras fire once per shot, at the point of impact --
    // a multi-pellet gun only lets the first pellet carry the extra, or a
    // rift shotgun would tear six floors open per trigger pull
    if (doSpecial && def.special && def.special !== 'shock' && def.special !== 'lure') {
      const ix = firstHit ? firstHit.x : ox + dx * endT;
      const iy = firstHit ? firstHit.y : oy + dy * endT;
      this.applySpecial(def, ix, iy, firstHit ? firstHit.z : null, insta, floor, shooter);
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
      // the spark on a guest's screen points down the barrel: send the angle
      // or it always faces east (m.a ?? 0)
      a: +Math.atan2(hy - muzzle.y, hx - muzzle.x).toFixed(2),
      c: tc, w: def.id, p: def.packed ? 1 : 0, by: by?.netId ?? 0,
    });
  }

  /** Ray Gun splash / DG-2 chain / Winter's Howl frost. */
  applySpecial(def, x, y, source, insta = 1, floor = null, by = null) {
    // a wonder weapon belongs to the storey the shot came from: a guest
    // firing upstairs does not blow the floor below apart
    const sf = floor ?? source?.floor ?? this.fxFloor;
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

    if (def.special === 'lob') {
      // the launcher's round ends the way a grenade does, just ruder
      this.explodeAt(x, y, def.lobR, def.lobDmg, { blast: true, colour: '#f0a050', floor: sf, owner: by });
      return;
    }

    if (def.special === 'flame') {
      // whatever the jet touched keeps cooking; the floor pool does the rest
      if (source && !source.dead) {
        source.burning = Math.max(source.burning ?? 0, def.burnTime);
        source.burnDmg = def.burnDmg;
      }
      for (const z of this.zombies) {
        if (z.dead || z === source) continue;
        if ((z.floor ?? 0) !== sf) continue;
        if (dist(x, y, z.pos.x, z.pos.y) > def.flameR * 1.6) continue;
        z.burning = Math.max(z.burning ?? 0, def.burnTime * 0.7);
        z.burnDmg = def.burnDmg;
      }
      // one fuel pool where the jet lands -- and only if the floor there is
      // not already alight, or a held trigger would carpet the whole hallway
      let near = false;
      for (const f of this.fires) {
        if ((f.f ?? 0) === sf && dist(f.x, f.y, x, y) < 24) { near = true; break; }
      }
      if (!near) {
        this.fires.push({ x, y, r: def.flameR, life: 1.1, max: 1.1, tick: 0, puff: 0, f: sf, owner: by });
        this.particles.smoke(x, y, 3);
      }
      return;
    }

    if (def.special === 'rift') {
      // the floor tears open and chews on whatever stands over the crack
      this.rifts.push({
        x, y, r: def.riftR, dmg: def.riftDmg, life: def.riftTime, max: def.riftTime,
        tick: 0, seed: (x * 13 + y * 7) | 0, f: sf,
      });
      this.explosionLights.push({ x, y, r: def.riftR * 2.4, life: 0.3, max: 0.3, colour: '#c080ff', f: sf });
      this.particles.spark(x, y, randRange(0, TAU), 10, '#c080ff');
      this.shake(3, 0.25);
      return;
    }

    if (def.special === 'freeze') {
      let frozen = 0;
      for (const z of this.zombies) {
        if (z.dead || (z.floor ?? 0) !== sf) continue;
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
    const floor = p.floor ?? this.map.floor;
    const F = this.map.floors[floor];
    let best = null;
    const offer = (o) => { if (!best || o.d < best.d) best = o; };

    for (const wb of F.wallBuys) {
      const d = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (d >= 30) continue;
      const def = WEAPONS[wb.weapon];
      const owned = p.loadout[wb.weapon].owned;
      const price = owned ? def.ammoPrice : def.price;
      offer({ type: 'wallbuy', weapon: wb.weapon, price, affordable: p.points >= price, d, wb });
    }

    for (const pd of F.rangePads ?? []) {
      const d = dist(p.pos.x, p.pos.y, pd.x, pd.y);
      if (d < 30) {
        offer({ type: 'pad', pad: pd, d, price: 0, affordable: true });
      }
    }

    for (const g of F.grenadeCrates) {
      const d = dist(p.pos.x, p.pos.y, g.x, g.y);
      if (d < 30) {
        const kind = g.kind ?? 'frag';
        // a crate of a different kind can replace what is in the hand: the
        // one slot is the point, so only "already full of this" is a refusal
        const same = (p.throwableKind?.() ?? 'frag') === kind;
        const have = p.throwableCount?.() ?? 0;
        offer({
          type: 'grenade', kind, price: GRENADE_PRICE, d,
          affordable: p.points >= GRENADE_PRICE && !(same && have >= GRENADE_MAX),
        });
      }
    }

    for (const dr of F.doors) {
      if (dr.open) continue;
      const d = dist(p.pos.x, p.pos.y, dr.cx, dr.cy);
      if (d < 34) offer({ type: 'door', door: dr, price: dr.price, affordable: p.points >= dr.price, d });
    }

    const nearB = this.map.nearestBarricade(p.pos.x, p.pos.y, 34, false, floor);
    if (nearB) {
      const d = dist(p.pos.x, p.pos.y, nearB.cx, nearB.cy);
      if (d < 34) offer({ type: 'barricade', barricade: nearB, d, affordable: true, price: 0 });
    }

    for (const ps of F.perkSpots) {
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
    if ((p.floor ?? 0) === 0 && db < 42) {   // the crate only answers on its own floor
      const price = this.box.price();
      offer({
        type: 'box', d: db, price,
        affordable: this.powerOn && p.points >= price
          && (this.box.state === 'closed' || this.box.state === 'offering'),
      });
    }

    if (F.powerSwitch) {
      const dps = dist(p.pos.x, p.pos.y, F.powerSwitch.x, F.powerSwitch.y);
      if (dps < 36) offer({ type: 'power', d: dps, price: 0, affordable: !this.powerOn });
    }

    const wb = F.workbench;
    if (wb) {
      const dwb = dist(p.pos.x, p.pos.y, wb.x, wb.y);
      if (dwb < 40) offer({ type: 'workbench', d: dwb, price: 0, affordable: true });
    }

    for (const c of F.cacheSpots ?? []) {
      if (c.taken) continue;
      const d = dist(p.pos.x, p.pos.y, c.x, c.y);
      if (d < 34) offer({ type: 'cache', cache: c, d, price: 0, affordable: true });
    }

    const nt = this.traps.nearest(p.pos.x, p.pos.y, 46, floor);
    if (nt) {
      offer({
        type: 'trap', i: nt.i, d: dist(p.pos.x, p.pos.y, nt.x, nt.y),
        price: TRAP_PRICE, ready: nt.ready, affordable: p.points >= TRAP_PRICE && nt.ready,
      });
    }

    const dpp = F.papSpot ? dist(p.pos.x, p.pos.y, F.papSpot.x, F.papSpot.y) : 1e9;
    if (dpp < 44) {
      const id = p.current;
      const already = p.packed.has(id);
      offer({
        type: 'pap', d: dpp, price: PAP_PRICE, id,
        affordable: this.powerOn && !already && p.points >= PAP_PRICE && !p.dead,
        already,
      });
    }

    for (const sw of F.secretSwitches ?? []) {
      const d = dist(p.pos.x, p.pos.y, sw.x, sw.y);
      if (d < 32) offer({ type: 'switch', sw, d, price: 0, affordable: !sw.found });
    }

    if (this.heli.phase === 3 && !this.rangeMode && (p.floor ?? 0) === HELI_PAD.f) {
      const d = dist(p.pos.x, p.pos.y, HELI_PAD.x, HELI_PAD.y);
      if (d < 58) offer({ type: 'heli', d, price: 0, affordable: true });
    }
    if (this.heli.phase === 1 && !this.rangeMode && (p.floor ?? 0) === HELI_PAD.f) {
      const d = dist(p.pos.x, p.pos.y, HELI_PAD.x, HELI_PAD.y);
      if (d < 46) offer({ type: 'flare', d, price: 0, affordable: true });
    }
    if (!this.rangeMode && !this.roofRadio?.fixed && (p.floor ?? 0) === ROOF_RADIO.f) {
      const d = dist(p.pos.x, p.pos.y, ROOF_RADIO.x, ROOF_RADIO.y);
      if (d < 40) offer({ type: 'radio', d, price: ROOF_RADIO_PRICE, affordable: (p.salvage ?? 0) >= ROOF_RADIO_PRICE });
    }

    if (this.map.secretDoorOpen) {
      for (const l of F.secretLoot) {
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

    if (it.type === 'heli') { this.evacuate(p); return; }
    if (it.type === 'flare') { this._lightFlare(p); return; }
    if (it.type === 'radio') { this._fixRoofRadio(p); return; }

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
      return;
    }

    if (it.type === 'door') {
      if (p.points < it.price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= it.price;
      it.door.open = true;
      this.stats.doors++;
      this.recordRound('doors');
      this.say('door');   // round ten onwards, on its own cooldown: sometimes he begs
      audio.buy();
      audio.door();
      this.popups.add(p.pos.x, p.pos.y - 26, 'DOOR OPEN', '#f0d98a', 12);
      // not buildFlow: whoever opened it may not be on the storey the map is
      // currently showing, and a co-op door opens the route for everybody
      this.rebuildFlow();
      return;
    }

    if (it.type === 'pad') {
      const pd = it.pad;
      if (pd.pad === 'clear') {
        this.zombies = [];
        this.arcs = [];
        this.bannerShow('RANGE CLEAR', 'the hall is yours again', { dur: 1.6, colour: '#8fa0b0' });
        audio.door();
        return;
      }
      if (pd.pad === 'freeze') {
        this._dbgFreeze = !this._dbgFreeze;
        for (const z of this.zombies) z.frozen = this._dbgFreeze ? 9999 : 0;
        this.popups.add(p.pos.x, p.pos.y - 26, this._dbgFreeze ? 'HELD' : 'GO', '#8fa0b0', 11);
        audio.dryFire();
        return;
      }
      const ax = 36 * T + randRange(-70, 70), ay = 16 * T + randRange(-50, 50);
      this.zombies.push(this.makeZombie({ x: ax, y: ay, floor: this.map.floor }, pd.type));
      this.popups.add(p.pos.x, p.pos.y - 26, (ENEMY_TYPES[pd.type]?.name ?? pd.type).toUpperCase(), '#c46a4a', 11);
      audio.door();
      return;
    }

    if (it.type === 'grenade') {
      const kind = it.kind ?? 'frag';
      const same = (p.throwableKind?.() ?? 'frag') === kind;
      const have = p.throwableCount?.() ?? 0;
      // A different kind is a replacement, so a full hand does not block it.
      // Only a full hand of the SAME kind has nothing left to sell.
      if (p.points < it.price || (same && have >= GRENADE_MAX)) { audio.deny(); return; }
      p.points -= it.price;
      if (p.giveThrowable) p.giveThrowable(kind, 2);
      else p[throwPocket(kind)] = Math.min(GRENADE_MAX, (p[throwPocket(kind)] ?? 0) + 2);
      if (p.ownThrow) p.ownThrow[kind] = true;
      audio.buy();
      const name = { frag: 'FRAG GRENADES', molotov: 'MOLOTOVS', gas: 'GAS BOMBS' }[kind];
      this.popups.add(p.pos.x, p.pos.y - 26,
        have > 0 && !same ? `${name} — REPLACED` : name, '#f0d98a', 12);
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
        if (WEAPONS[id].wonder) {
          this.achievements.unlock('wonder_seeker');
          if ((this.stats.teddyDraws ?? 0) === 0) this.achievements.unlock('lucky_pull');
        }
        if (kind === 'weapon') {
          this.stats.boxTakes = (this.stats.boxTakes ?? 0) + 1;
          if (this.stats.boxTakes >= 8) this.achievements.unlock('walking_armoury');
        }
        return;
      }
      if (this.box.state !== 'closed') return;
      if (p.points < price) { audio.deny(); this.popups.add(p.pos.x, p.pos.y - 26, 'NO POINTS', '#c4463a'); return; }
      p.points -= price;
      const res = this.box.spin();
      audio.boxSpin();
      if (res === 'teddy') {
        this.stats.teddyDraws++;
        this.bannerShow('THE BOX MOVES', 'you hear a faint giggle', { dur: 2.4, colour: '#f0a0d0' });
      }
      return;
    }

    if (it.type === 'power') {
      if (this.powerOn) return;
      this.powerOn = true;
      this.powerOnAt = this.time;
      this.powerSurge = 1.4;
      this.shake(4, 0.5);
      audio.powerUp();
      this.bannerShow('POWER RESTORED', 'the lights buzz back on', { dur: 3.0, colour: '#f2e26a' });
      this.achievements.unlock('power_on');
      return;
    }

    if (it.type === 'workbench') {
      // Every body gets its own bench. It used to be the host's alone: a guest
      // who climbed to the roof and pressed E was told "no" for no reason at
      // all. The menu is now each client's own business -- a guest opens its
      // copy in _guestUpdate and sends what it wants built (net.js, m:'craft')
      // -- so the host deliberately keeps no copy of a remote body's flag.
      // Nothing to fall out of sync, and no body left unable to fire because
      // somebody else's menu went stale.
      if (p !== this.player) return;
      p.craftOpen = !p.craftOpen;
      p.craftRow = clamp(p.craftRow ?? 0, 0, Math.max(0, recipeIds().length - 1));
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
      // four lit beacons: say plainly what happens next, so nobody stands
      // on the roof at round 25 wondering whether the game forgot them
      if (this.egg.found >= 4 && !this._beaconTold) {
        this._beaconTold = 1;
        this.bannerShow('FOUR BEACONS LIT',
          'reach round 25 and the pad arms -- then light the green flare',
          { dur: 4.2, colour: '#9fd0e0' });
        this._speak('Four beacons on the deck and still counting. Get to round twenty-five and the board cuts a bearing -- then light the green flare on the pad and hold on for two minutes.');
      }
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
    if (this._rebuildT >= 0.3 * (p.skillFx?.buildTimeMul ?? 1)) {
      this._rebuildT = 0;
      b.planks++;
      this.stats.planks++;
      this.recordRound('planks');
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
    this._noteLinkTrail(on);
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
    this._noteLinkTrail(link);
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
    this.cam.x = clamp(spot.x - this.vw / 2, 0, this.map.w * T - this.vw);
    this.cam.y = clamp(spot.y - this.vh / 2, 0, this.map.h * T - this.vh);
    this.bannerShow(this.map.floorName, link?.name ?? '', { dur: 1.7, colour: '#9fd0f0' });
    if (n === 2) this.achievements.unlock('up_on_the_roof');
    if (n === 1) this.achievements.unlock('upstairs');
    this.floorsVisited?.add(n);
    if (this.floorsVisited?.size >= 3) this.achievements.unlock('tourist');
    this.rebuildFlow();
  }

  /**
   * The horde reads your footsteps: every hatch you drop through and every
   * window you climb goes into this trail, and the flow field prefers it for
   * a while -- so fleeing through the east hatch does not send them west.
   */
  noteTrail(floor, tx, ty) {
    const tr = this.trail ?? (this.trail = new Map());
    tr.set(`${floor}:${ty * this.map.w + tx}`, this.time);
    if (tr.size > 96) for (const [k, t] of tr) if (this.time - t > 60) tr.delete(k);
  }

  _noteLinkTrail(link) {
    if (!link) return;
    this.noteTrail(link.a.floor, link.a.tx, link.a.ty);
    this.noteTrail(link.b.floor, link.b.tx, link.b.ty);
  }

  onPlayerTeleport(from, to) {
    this.teleportFx = 1;
    this.particles.dust(to.x, to.y, randRange(0, TAU), 8);
    this.revealAround(to.x, to.y, 12);
    audio.door();
  }

  /**
   * A throwable leaves toward the pointer: the further the cursor, the harder
   * the throw, so what you point at is roughly what you hit. Remote bodies
   * have no pointer on this machine, so they throw along their aim instead.
   */
  throwAtCursor(p, kind, aimOverride, distOverride) {
    let aim = p.aim ?? 0;
    let d = 200;
    if (distOverride != null) { aim = aimOverride ?? aim; d = distOverride; }
    else if (aimOverride == null) {
      const mw = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
      const dx = mw.x - p.pos.x, dy = mw.y - p.pos.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 8) { aim = Math.atan2(dy, dx); d = dd; }
    }
    this.recordRound('throws');
    const reach = Math.max(150, Math.min(MAX_THROW_SPEED, Number.isFinite(d) ? d * 1.64 : MAX_THROW_SPEED));
    // Strong Arm: the same aim, a harder throw -- the arc (and the grenade)
    // still land where the cursor is, they just get there with more pace
    const speed = Math.min(MAX_THROW_SPEED, reach * (p.skillFx?.throwSpeedMul ?? 1));
    const floor = p.floor ?? this.map.floor;
    p.vel.x -= Math.cos(aim) * 26;
    p.vel.y -= Math.sin(aim) * 26;
    if (kind === 'frag') {
      throwGrenade(this, p.pos.x, p.pos.y, aim, speed, floor, p);
      audio.shot?.('throw', 0);
      return;
    }
    this.pThrows.push({
      kind, x: p.pos.x + Math.cos(aim) * 10, y: p.pos.y + Math.sin(aim) * 10,
      vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed,
      floor, t: 0, rot: 0, owner: p,
    });
    audio.shot?.('throw', 0);
  }

  /** Throw a Monkey Bomb from the player's hands -- whoever that player is. */
  throwMonkey(by) {
    this.recordRound('throws');
    const p = by || this.player;
    const def = WEAPONS.monkeybomb;
    p.slot.mag--;
    p.fireTimer = def.delay;
    const speed = 230;
    this.monkeys.push(new MonkeyBomb(
      p.pos.x + Math.cos(p.aim) * 14, p.pos.y + Math.sin(p.aim) * 14,
      Math.cos(p.aim) * speed + p.vel.x * 0.4, Math.sin(p.aim) * speed + p.vel.y * 0.4,
      def, p.floor ?? this.map.floor,
    ));
    this.monkeys[this.monkeys.length - 1].owner = p;
    this._monkeyKills = 0;
    audio.shot('throw', 0);
  }

  /** Thunder Gun: a cone of concussive force, no hitscan. */
  fireShockwave(ox, oy, angle, def, by = null) {
    const floor = by?.floor ?? this.map.floor;
    let hit = 0;
    for (const z of this.zombies) {
      if (z.dead || (z.floor ?? 0) !== floor) continue;
      const dx = z.pos.x - ox, dy = z.pos.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > def.shockRange) continue;
      let da = Math.atan2(dy, dx) - angle;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > def.shockAngle) continue;
      if (this.map.lineBlocked(ox, oy, z.pos.x, z.pos.y, floor)) continue;
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
    const p = opts.owner ?? this.player;
    const floor = opts.floor ?? this.fxFloor;
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
      if ((z.floor ?? 0) !== floor) continue;
      if (opts.blast && this.tryCrawl(z)) continue;
      const falloff = 1 - d / r;
      const res = z.hurt(dmg * falloff, false, this, Math.atan2(z.pos.y - y, z.pos.x - x));
      if (res === 2) this.onZombieKilled(z, false, null, opts.fromPlayer ? 'monkey' : 'blast');
    }

    // the furniture takes its share: a totem or a headstone near a blast
    // does not get to sit it out
    this.hurtHaunts(x, y, r, Math.min(dmg, 320), floor);

    // self-damage: normal grenades hurt you, PhD Flopper says otherwise
    const pd = dist(x, y, p.pos.x, p.pos.y);
    if ((p.floor ?? 0) === floor && pd < r && opts.fromPlayer !== false && !p.perkFx.splashImmune) {
      p.hurt(Math.round(75 * (1 - pd / r)), x, y, this);
    } else if (pd < r && p.perkFx.diveBlast) {
      p.heal(0);
    }
  }

  /**
   * Build something at the bench.
   *
   * `p` is the body doing the building, which in co-op is not necessarily the
   * host's: a guest picks a card on its own screen and the host runs this for
   * it (net.js, `m:'craft'`). Everything here -- the purse, the popup, the
   * tally -- belongs to that body.
   */
  tryCraft(id, p = this.player) {
    const r = recipe(id);
    if (!r || !p || p.dead || p.downed) return false;
    const why = this.workbench.canCraft(this, id, p);
    if (why !== 'ok') {
      // the reason goes over the head of whoever asked, not over the host's
      audio.deny();
      this.popups.add(p.pos.x, p.pos.y - 28, craftRefusal(id, why), '#c4463a', 10);
      return false;
    }
    this.workbench.craft(this, id, p);
    this.recordRound('crafted');
    if (p === this.player) {
      this.stats.crafted++;
      if (this.stats.crafted >= 5) this.achievements.unlock('master_crafter');
      if (id === 'medkit') this.achievements.unlock('field_medic');
    }
    audio.buy();
    const name = (r.name ?? id).toUpperCase();
    this.popups.add(p.pos.x, p.pos.y - 26, name, r.colour ?? '#f0d98a', 12);
    // and the rest of the house hears the hammer: what one body builds at the
    // bench is team news, the same way a bought perk is
    this.netEmit('craft', {
      x: Math.round(p.pos.x), y: Math.round(p.pos.y), name, c: r.colour ?? '#f0d98a',
      by: p.netId ?? 0,
    });
    return true;
  }

  /**
   * The bench menu's own input, for one body. The host path and the guest path
   * both run it, because a guest has a menu too -- only the building itself
   * travels over the wire (`remote`).
   *
   * Returns true when this step consumed the menu: built something, or shut
   * it. The caller keeps `craftWasOpen` from the top of the frame and leaves E
   * and F alone if it was set -- without that, the same press that stepped
   * away from the bench is read again by the interaction code underneath and
   * the menu snaps straight back open. It used to, which is why the only way
   * out of the bench was Q or walking off.
   */
  _craftInput(dt, p, remote) {
    if (!p) return false;
    if (!p.craftOpen) return false;
    const inp = this.input;
    const ids = recipeIds();
    let touched = false;

    const build = (id) => {
      if (!id) return;
      if (remote) { this.net?.requestCraft?.(id); return; }
      this.tryCraft(id, p);
    };

    // numbers still work, for as many cards as there are digits
    for (let i = 0; i < ids.length && i < 9; i++) {
      if (inp?.wasPressed(`Digit${i + 1}`)) { build(ids[i]); return true; }
    }

    // The pointer: hover picks a card, a click builds it. On a phone this is
    // not a convenience, it is the entire menu -- a touchscreen has no digits.
    // A key pressed in the same frame wins over a pointer that is merely
    // resting on a card, or the arrows cannot move away from wherever the
    // mouse happens to be parked (the settings panel has the same rule for
    // its wheel).
    const m = inp?.mouse;
    const keyed = !!inp && inp.wasPressed(
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
    );
    if (m && ids.length) {
      const hover = craftRowAt(this, this.vw, this.vh, m.x, m.y);
      if (!keyed && hover >= 0 && hover !== p.craftRow) { p.craftRow = hover; audio.dryFire(); }
      if (m.pressed && hover >= 0) { build(ids[hover]); return true; }
    }

    // arrows and WASD walk the grid, Enter builds what is lit
    if (ids.length) {
      const n = ids.length;
      const cols = craftLayout(this, this.vw, this.vh).cols;
      const move = (d) => {
        p.craftRow = clamp(((p.craftRow ?? 0) + d + n) % n, 0, n - 1);
        audio.dryFire();
      };
      if (inp?.wasPressed('ArrowUp', 'KeyW')) move(-cols);
      if (inp?.wasPressed('ArrowDown', 'KeyS')) move(cols);
      if (inp?.wasPressed('ArrowLeft', 'KeyA')) move(-1);
      if (inp?.wasPressed('ArrowRight', 'KeyD')) move(1);
      if (inp?.wasPressed('Enter', 'Space')) { build(ids[clamp(p.craftRow ?? 0, 0, n - 1)]); return true; }
    }

    // stepping away: E is what the world uses for the bench and F is what a
    // phone has instead. Q used to be one of these, but Q also swaps guns and
    // a guest's Q travels, so closing the menu changed your weapon.
    if (inp?.wasPressed('Escape', 'KeyE', 'KeyF')) {
      p.craftOpen = false;
      audio.dryFire();
      return true;
    }
    // ...as is walking off, or taking the stairs: the bench is on one storey
    // and the menu must not follow you down it
    if (!this.map.workbench
      || dist(p.pos.x, p.pos.y, this.workbench.x, this.workbench.y) > 56
      || (p.floor ?? this.map.floor) !== this.map.floor) {
      p.craftOpen = false;
      return true;
    }
    return false;
  }

  /** The debug panel as data, so the HUD can draw it and the mouse can hit it. */
  /**
   * A tab for the cheats and a tab for the zoo. The zoo lists every creature
   * in the game -- including the ones that never spawn on their own -- so you
   * can put one in front of you and find out what it does.
   */
  _zooRows() {
    const alive = (t) => this.zombies.reduce((n, z) => n + (!z.dead && z.type === t ? 1 : 0), 0);
    const rows = Object.keys(ENEMY_TYPES).map((t) => ({
      id: `spawn:${t}`,
      label: `SPAWN  ${ENEMY_TYPES[t].name.toUpperCase()}`,
      value: alive(t) > 0 ? `${alive(t)} LOOSE` : 'GO',
    }));
    rows.push({ id: 'where', label: 'DROP THEM (toggle)', value: this._dbgWhere === 'front' ? 'IN FRONT OF ME' : 'AT A WINDOW' });
    rows.push({ id: 'freeze', label: 'HOLD THEM STILL', value: this._dbgFreeze ? 'HELD' : 'GO' });
    rows.push({ id: 'clear', label: 'CLEAR THE HORDE', value: 'GO' });
    return rows;
  }

  /** Put one of anything in front of you, on an open tile. */
  _debugSpawn(type) {
    let x, y;
    const floor = this.map.floor;
    if (this._dbgWhere === 'window') {
      const pick = this.pickSpawn();
      const sp = pick?.s ?? pick;
      if (sp) { x = sp.x; y = sp.y; }
    }
    if (x === undefined) {
      const p = this.player;
      for (const r of [72, 96, 120, 56, 150]) {
        const tx = Math.floor((p.pos.x + Math.cos(p.aim) * r) / T);
        const ty = Math.floor((p.pos.y + Math.sin(p.aim) * r) / T);
        if (!this.map.solidTileOn(floor, tx, ty)) { x = (tx + 0.5) * T; y = (ty + 0.5) * T; break; }
      }
      if (x === undefined) { x = p.pos.x + Math.cos(p.aim) * 72; y = p.pos.y + Math.sin(p.aim) * 72; }
    }
    const z = this.makeZombie({ x, y, floor }, type);
    this.zombies.push(z);
    if (this._dbgFreeze) z.frozen = 9999;
    this.bannerShow('SPAWNED', (ENEMY_TYPES[type]?.name ?? type).toUpperCase(),
      { dur: 1.4, colour: '#c8a86b' });
    audio.growl(0.8, 0.8);
  }

  /**
   * The wardrobe tab. One row per coat, and pressing it grants *that coat's
   * badge* -- the same one the game would hand you for doing the thing -- and
   * puts the coat on, so a locked outfit can be checked in ten seconds instead
   * of a night.
   */
  _skinRows() {
    const wearing = this.player?.skin ?? null;
    const rows = SKIN_ORDER.map((id) => {
      const skin = SKINS[id];
      const owned = skinOwned(id, this.achievements);
      return {
        id: `skin:${id}`,
        label: `${skin.name}  ${skin.short}`,
        value: owned ? (wearing === id ? 'ON' : 'GRANTED') : 'GRANT',
        local: true,
      };
    });
    rows.push({ id: 'skin:none', label: 'STANDARD KIT', value: wearing ? 'WEAR' : 'ON', local: true });
    rows.push({ id: 'skins:all', label: 'GRANT EVERY OUTFIT', value: 'ALL', local: true });
    return rows;
  }

  /** Grant one coat's badge (and wear it), from the debug panel. */
  _debugSkin(id) {
    if (id === 'skins:all') {
      for (const key of SKIN_ORDER) this.achievements.unlock(SKINS[key].ach);
      this.bannerShow('EVERY OUTFIT', 'all ten badges granted', { dur: 1.8, colour: '#f0d98a' });
      return;
    }
    if (id === 'skin:none') {
      this.equipSkin(null);
      this.bannerShow('STANDARD KIT', 'nothing on', { dur: 1.4, colour: '#8fa8bd' });
      return;
    }
    const key = id.slice(5);
    const skin = SKINS[key];
    if (!skin) return;
    const before = skinOwned(key, this.achievements);
    // the badge, not just the coat: `unlock` is the same call the game makes
    // when you actually do the thing, so the wall and the wardrobe agree
    this.achievements.unlock(skin.ach);
    this.equipSkin(key);
    this.bannerShow(before ? 'OUTFIT' : 'BADGE GRANTED',
      `${skin.name} \u00b7 ${skin.buff}`, { dur: 1.8, colour: skin.colour });
  }

  debugRows() {
    if (this.debugTab === 1) return this._zooRows();
    if (this.debugTab === 2) return this._skinRows();
    if (this.debugTab === DEBUG_MUSIC_TAB) return [
      // every one of these is local: a sound audition belongs to the machine
      // whose speakers it comes out of, never to the host
      { id: 'music:stop', label: 'STOP / ADAPTIVE SCORE', value: 'STOP', local: true },
      { id: 'music:mode', label: 'AFTER THE TRACK', value: (audio.musicMode ?? 'repeat').toUpperCase(), local: true },
      { id: 'music:volume', label: 'MUSIC VOLUME (cycle)', value: `${settings.get('music')}%`, local: true },
      { id: 'music:victory', label: 'EVACUATION FANFARE', value: '0:18', local: true },
      { id: 'music:forward', label: 'SEEK FORWARD 60 SECONDS', value: '+1:00', local: true },
      { id: 'music:back', label: 'SEEK BACK 60 SECONDS', value: '-1:00', local: true },
      ...SOUNDTRACKS.map((t, i) => ({ id: `music:${t.id}`, label: `${String(i + 1).padStart(2, '0')} ${t.title}`,
        value: audio.soundtrack?.current?.id === t.id ? `${musicTime(audio.soundtrack.elapsed)} / ${musicTime(t.duration)}` : musicTime(t.duration),
        local: true })),
    ];
    const on = (b) => (b ? 'ON' : 'OFF');
    const d = this.debug, p = this.player;
    return [
      { id: 'god', label: 'GOD MODE', value: on(d.god || this.player?.god) },
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
      { id: 'roundpick', label: 'PICK A ROUND (enter: +1)', value: String(this._dbgRound ?? this.round) },
      { id: 'roundgo', label: 'JUMP TO THE PICKED ROUND', value: 'GO' },
      { id: 'callbird', label: 'CALL THE BIRD', value: HELI_PHASE_NAMES[this.heli?.phase ?? 0] },
      { id: 'supply', label: 'DROP A SUPPLY CRATE', value: 'GO' },
    ];
  }

  /** Do the thing on that row. `remote` is a guest's body: the row runs on
   *  the host, but the buff belongs to whoever pressed it. */
  _debugRun(id, remote) {
    if (id.startsWith('music:')) {
      if (remote) return; // auditions are always local, never a remote cheat
      const choice = id.slice(6);
      if (choice === 'stop') audio.stopSoundtrack();
      else if (choice === 'victory') { audio.resume(); audio.victory(); }
      else if (choice === 'forward' || choice === 'back') {
        audio.soundtrack?.seek(audio.soundtrack.elapsed + (choice === 'forward' ? 60 : -60));
      } else if (choice === 'mode') {
        const modes = ['repeat', 'playlist', 'once'];
        audio.musicMode = modes[(modes.indexOf(audio.musicMode ?? 'repeat') + 1) % modes.length];
        if (audio.soundtrack) audio.soundtrack.mode = audio.musicMode;
      } else if (choice === 'volume') {
        settings.set('music', (Math.floor(settings.get('music') / 25) * 25 + 25) % 125);
        audio.setVolumes({ music: settings.get('music') });
      } else audio.playSoundtrack(choice);
      return;
    }
    const p = remote ?? this.player;
    if (id.startsWith('spawn:')) { this._debugSpawn(id.slice(6)); return; }
    // the wardrobe is local storage, not world state: it runs wherever the
    // player is standing, host or guest
    if (id.startsWith('skin:') || id === 'skins:all') { this._debugSkin(id); return; }
    switch (id) {
      case 'where':
        this._dbgWhere = this._dbgWhere === 'front' ? 'window' : 'front';
        break;
      case 'freeze':
        this._dbgFreeze = !this._dbgFreeze;
        for (const z of this.zombies) z.frozen = this._dbgFreeze ? 9999 : 0;
        break;
      case 'clear':
        for (const z of this.zombies) { z.dead = true; z.remove = true; }
        this.zombies = [];
        break;
      case 'roundpick':
        this._dbgRound = ((this._dbgRound ?? this.round) % 60) + 1;
        break;
      case 'roundgo':
        this.jumpToRound(this._dbgRound ?? this.round);
        break;
      case 'callbird':
        if (this.heli.phase !== 4) {
          this.heli.phase = 2; this.heli.t = 0; this.heli.flare = true;
          this.heli._said60 = 0; this.heli._said108 = 0;
          this.bannerShow('DEBUG', 'flare burning, bird inbound', { dur: 1.6, colour: '#8fa8bd' });
        }
        break;
      case 'supply':
        this.dropSupply();
        this.bannerShow('DEBUG', 'crate on the wire', { dur: 1.6, colour: '#8fa8bd' });
        break;
      case 'god': this.debug.god = !this.debug.god; break;
      case 'ammo': this.debug.ammo = !this.debug.ammo; break;
      case 'paths': this.debug.paths = !this.debug.paths; break;
      case 'points':
        this.addPoints(5000, p.pos.x, p.pos.y - 26, '#f0d98a', p);
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
        else { this.powerOn = true; this.powerOnAt = this.time; this.powerSurge = 1.4; audio.powerUp(); }
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
        if (remote) {
          // a guest's body hops the link itself; goToFloor is the host's chair
          const n = ((p.floor ?? 0) + 1) % this.map.floors.length;
          const lk = (this.map.links ?? []).find((l) => l.a.floor === n || l.b.floor === n);
          if (!lk) break;
          const dest = lk.a.floor === n ? lk.a : lk.b;
          p.floor = n;
          p.pos.x = (dest.tx + 0.5) * T; p.pos.y = (dest.ty + 0.5) * T;
          p.vel.x = 0; p.vel.y = 0;
          this.rebuildFlow();
          break;
        }
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
  /**
   * The way out of a full-screen panel for a device with no ESC. It is one
   * press on the chip in the corner, and it is read before every other
   * handler: the press that closes the panel must not also land on whatever
   * row was underneath it.
   */
  _backChipPressed() {
    const m = this.input?.mouse;
    if (!m || !m.pressed) return false;
    return backChipAt(this.vw, this.vh, m.x, m.y);
  }

  _closePanel() {
    if (this.debugOpen) {
      this.debugOpen = false;
      this.paused = this._dbgWasPaused || false;
    } else if (this.settingsOpen) {
      this.settingsOpen = false;
      this._resetArmT = 0;
      this.paused = this._wasPaused || false;
    } else if (!this.started && (this.scene === 'achievements' || this.scene === 'stats'
      || this.scene === 'outfits')) {
      const back = this.scene;
      this.scene = 'menu';
      this.menuIndex = this._menuRowIndex(back);
    }
    audio.dryFire();
  }

  /** Run the pause row the player picked. Indices follow PAUSE_ROWS. */
  _pauseChoose(i) {
    audio.dryFire();
    if (i === 0) this.paused = false;
    else if (i === 1) { this.settingsOpen = true; this._wasPaused = true; }
    else if (i === 2) { this.controlsOpen = true; this._wasPaused = true; }
    else if (i === 3) this._restartRun();
    else if (i === 4) { this.debugOpen = true; this._dbgWasPaused = true; }
    else if (i === 5) this._quitToMenu();
  }

  update(dt) {
    this.time += dt;

    // the corner chip, before anything else can eat the press
    if ((this.settingsOpen || this.debugOpen
      || (!this.started && (this.scene === 'achievements' || this.scene === 'stats' || this.scene === 'outfits')))
      && this._backChipPressed()) {
      this.input.mouse.pressed = false;
      this.input.mouse.down = false;
      this._closePanel();
    }

    // ---- settings overlay (works anywhere, pauses the game behind it) -----
    // `wasPressed` stays true for the whole step, so a single O used to open
    // the panel and then immediately read as the "close" press further down.
    // Remember which way this press went and let the close check skip O.
    const oPressed = this.input.wasPressed('KeyO');
    let openedByO = false;
    if (oPressed) {
      const was = this.settingsOpen;
      this.settingsOpen = !this.settingsOpen;
      if (this.settingsOpen) { this.settingsView = null; this._resetArmT = 0; }
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
      // the second press of RESTORE DEFAULTS has a few seconds to arrive
      this._resetArmT = Math.max(0, (this._resetArmT ?? 0) - dt);
      // the mouse and the wheel are first-class citizens here too: hover
      // picks a row, a click flips or drags it, the wheel scrolls the window
      // (the selection keeps its place while the list moves under it)
      const m = this.input.mouse;
      const wheeled = !!this.input.wheel;
      const SL = settingsLayout(this, this.vw, this.vh);
      if (wheeled) {
        if (SL.over > 0) {
          // a list taller than the panel: the wheel scrolls the window and
          // the selection keeps its place
          const cur = this.settingsView ?? SL.top;
          this.settingsView = clamp(cur + this.input.wheel, 0, SL.over);
        } else {
          // everything fits: the wheel walks the selection, as it always did
          this.settingsIndex = clamp(this.settingsIndex + this.input.wheel, 0, SETTING_DEFS.length - 1);
        }
        audio.dryFire();
      }
      // A finger has no wheel. Dragging the list scrolls it -- and a press
      // that turned into a drag must not also land on a row, or scrolling a
      // toggle row flips it.
      if (m?.down && SL.over > 0) {
        if (this._setDragY === undefined) { this._setDragY = m.y; this._setDragged = false; }
        const dy = m.y - this._setDragY;
        if (dy !== 0) {
          // the list moves exactly as far as the finger did -- one design row
          // of pitch, whatever the picture's scale -- so a slow drag creeps
          // and a flick lands where the hand left it, not three rows past it
          const pitch = Math.max(1, SL.PITCH);
          this.settingsView = clamp((this.settingsView ?? SL.top) - dy / pitch, 0, SL.over);
          this._setDragY = m.y;
          if (Math.abs(dy) > 4) this._setDragged = true;
        }
      } else if (!m?.down) {
        this._setDragY = undefined;
      }
      // hover only picks a row while the pointer is actually moving: a hand
      // resting on the panel must not pin the keyboard's selection
      const moved = m.x !== (this._smx ?? -999) || m.y !== (this._smy ?? -999);
      this._smx = m.x; this._smy = m.y;
      const hover = settingsRowAt(this, this.vw, this.vh, m.x, m.y);
      if (!wheeled && moved && hover >= 0 && hover !== this.settingsIndex) {
        this.settingsIndex = hover;
        this._viewFollow();
        audio.dryFire();
      }
      if (m.pressed && hover >= 0 && !this._setDragged) {
        const d = SETTING_DEFS[hover];
        if (d.type === 'range') {
          const { bx, bw } = settingsSliderRect(this, this.vw, this.vh);
          if (m.x >= bx - 8 && m.x <= bx + bw + 8) {
            const k = clamp((m.x - bx) / bw, 0, 1);
            const raw = d.min + k * (d.max - d.min);
            S.set(d.id, Math.round(raw / d.step) * d.step);
          } else S.nudge(d.id, 1);
        } else if (d.id === 'reset') this._settingsReset();
        else S.activate(d.id);
      }
      // The finger came off: the press has been used, so the *next* one is a
      // tap again. (Clearing this on `m.pressed` cleared the flag before the
      // line above could read it, which made every tap after a drag dead.)
      if (!m.down) this._setDragged = false;
      if (this.input.wasPressed('ArrowUp', 'KeyW')) {
        this.settingsIndex = (this.settingsIndex - 1 + SETTING_DEFS.length) % SETTING_DEFS.length;
        this._viewFollow();
        audio.dryFire();
      }
      if (this.input.wasPressed('ArrowDown', 'KeyS')) {
        this.settingsIndex = (this.settingsIndex + 1) % SETTING_DEFS.length;
        this._viewFollow();
        audio.dryFire();
      }
      if (this.input.wasPressed('ArrowLeft', 'KeyA')) S.nudge(SETTING_DEFS[this.settingsIndex].id, -1);
      if (this.input.wasPressed('ArrowRight', 'KeyD')) S.nudge(SETTING_DEFS[this.settingsIndex].id, 1);
      if (this.input.wasPressed('Enter', 'Space')) {
        if (SETTING_DEFS[this.settingsIndex].id === 'reset') this._settingsReset();
        else S.activate(SETTING_DEFS[this.settingsIndex].id);
      }
      if (this.input.wasPressed('Escape', 'KeyP') || (oPressed && !openedByO)) {
        this.settingsOpen = false;
        this._resetArmT = 0;
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
    // the word PAUSED. It used to be a corner of the picture -- which is now
    // the pause chip, and which you are also shooting at during a round. The
    // PAUSE MENU also carries a DEBUG PANEL row, so this is the shortcut
    // rather than the only door.
    if (!this.debugOpen && this.paused && this.started && !this.gameOver
      && this.input.mouse.pressed
      && pauseTitleAt(this.vw, this.vh, this.input.mouse.x, this.input.mouse.y)) {
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
      let rows = this.debugRows();
      const n = rows.length;
      if (this.input.wasPressed('ArrowUp', 'KeyW')) {
        this.debugIndex = (this.debugIndex - 1 + n) % n; audio.dryFire();
      }
      if (this.input.wasPressed('ArrowDown', 'KeyS')) {
        this.debugIndex = (this.debugIndex + 1) % n; audio.dryFire();
      }
      // left and right move between the tabs, and reset the cursor with them
      const tabs = DEBUG_TABS.length;
      if (this.input.wasPressed('ArrowLeft', 'KeyQ')) {
        this.debugTab = (this.debugTab - 1 + tabs) % tabs;
        this.debugIndex = 0; audio.dryFire();
      }
      if (this.input.wasPressed('ArrowRight', 'KeyE')) {
        this.debugTab = (this.debugTab + 1) % tabs;
        this.debugIndex = 0; audio.dryFire();
      }
      // a mouse on the list expects the wheel to walk it, exactly as it walks
      // the settings page
      const dwheel = this.input.wheel ?? 0;
      if (dwheel) {
        this.debugIndex = clamp(this.debugIndex + Math.sign(dwheel), 0, n - 1);
        audio.dryFire();
      }
      const tabHit = debugTabHit(this, this.vw, this.vh, this.input.mouse.x, this.input.mouse.y);
      if (this.input.mouse.pressed && tabHit >= 0 && tabHit !== this.debugTab) {
        this.debugTab = tabHit;
        this.debugIndex = 0;
        audio.dryFire();
      }
      const hit = (this.input.mouse.pressed && tabHit >= 0)
        ? -1
        : debugHitTest(this, this.vw, this.vh, this.input.mouse.x, this.input.mouse.y);
      if (hit >= 0 && hit !== this.debugIndex) { this.debugIndex = hit; audio.dryFire(); }
      if (this.input.wasPressed('Enter', 'Space') || (this.input.mouse.pressed && hit >= 0)) {
        rows = this.debugRows();
        const row = rows[this.debugIndex] ?? rows[0];
        if (row) {
          if (this.net?.playing && !this.net.isHost && !row.local) {
            // the guest's panel is a remote control: the world lives on the
            // host, so the row runs there (GOD arms your own body only)
            this.net.send(this.net.hostId, { m: 'dbg', id: row.id });
            audio.dryFire();
          } else this._debugRun(row.id);
        }
      }
      if (this.input.wasPressed('Escape', 'KeyP') || (bq && !openedByBq)) {
        this.debugOpen = false;
        this.paused = this._dbgWasPaused || false;
      }
      this.hud.update(dt, this);
      return;
    }

    if (!this.started) { this._menuUpdate(dt); return; }

    // The skill cards are dealt between waves. Their clocks run first, then
    // the hand that is holding the cards gets the whole input for itself.
    this._skillDraftTick(dt);

    if (this.input.wasPressed('KeyM')) {
      audio.setMuted(!audio.muted);
      this.bannerShow(audio.muted ? 'SOUND OFF' : 'SOUND ON', audio.muted ? 'M again to unmute' : null,
        { dur: 1.6, colour: audio.muted ? '#c4463a' : '#7fbf5f', local: true });
    }

    if (this.gameOver) {
      this.overT += dt;
      // the ending -- death or EVACUATED -- is something the other machine
      // has to see too: keep pumping snapshots while this screen is up
      if (this.net?.active && this.net.isHost) this.net.step(dt);
      this.particles.update(dt, this.map);
      this.popups.update(dt);
      if (this.overT > 1.1) {
        // the one screen with no way back to the front door used to be this
        // one: a player who wanted to stop had to start a run first. A phone
        // gets the chip in the corner, because a thumb anywhere else means
        // "again" and there was nothing that meant "enough".
        if (this.input.wasPressed('Escape', 'Backspace')) { this._quitToMenu(); return; }
        const m = this.input.mouse;
        if (m.pressed && backChipAt(this.vw, this.vh, m.x, m.y)) {
          m.pressed = false; m.down = false;
          this._quitToMenu();
          return;
        }
        if (this.input.wasPressed('KeyR') || this.input.mouse.pressed) {
          if (this.net?.playing && !this.net.isHost) this.net.close();
          this._restartRun();
        }
      }
      return;
    }

    if (this.player?.skillDraft && !this.paused) {
      this._skillDraftUpdate();
      this.input.menuLock = true;
      // a guest's answer comes back as a snapshot; keep the wire turning even
      // while the cards cover the middle of the screen
      if (this.net?.active) this.net.step(dt);
      this.hud.update(dt, this);
      return;
    }

    // ---- a guest runs no simulation at all: it draws what the host says ---
    if (this.net?.role === 'guest' && this.net.active) { this._guestUpdate(dt); return; }

    // Escape belongs to whatever full-screen list is up: at the bench it steps
    // away from the bench, and only then -- on the next press -- does it pause.
    // It used to pause straight through the menu, so the one key the footer
    // advertised never did what it said.
    if (this.input.wasPressed('KeyP')) this.paused = !this.paused;
    else if (this.input.wasPressed('Escape') && !this.craftOpen) this.paused = !this.paused;
    if (this.paused) {
      // The pause screen is a menu you can click, thumb *and* walk with the
      // arrows: it used to answer only to the mouse and to five shortcut
      // keys, so a phone had no way to reach the debug panel from a round and
      // a keyboard could not move the highlight at all.
      const m = this.input.mouse;
      const n = PAUSE_ROWS.length;
      const hit = m.pressed ? pauseHitTest(this, this.vw, this.vh, m.x, m.y) : -1;
      const up = this.input.wasPressed('ArrowUp', 'KeyW', 'Numpad8');
      const down = this.input.wasPressed('ArrowDown', 'KeyS', 'Numpad2');
      if (hit >= 0) this.pauseIndex = hit;
      else if (up || down) {
        this.pauseIndex = ((this.pauseIndex ?? 0) + (down ? 1 : n - 1)) % n;
        audio.dryFire();
      }
      let chosen = -1;
      if (hit >= 0) chosen = hit;
      else if (this.input.wasPressed('Enter', 'Space', 'NumpadEnter')) chosen = this.pauseIndex ?? 0;
      if (chosen >= 0) this._pauseChoose(chosen);
      if (this.input.wasPressed('KeyR')) this._restartRun();
      // the controls are worth looking up in the middle of a round too, not
      // only from the front page
      if (this.input.wasPressed('KeyC')) { this.controlsOpen = true; this._wasPaused = true; }
      return;
    }

    // ---- the pause chip, top left ----------------------------------------
    // Read here, before the body updates: the press that stops the world must
    // not also put a bullet through the window. (The touch layer has its own
    // button in the same corner, so this is for the mouse and the pad.)
    if (pauseChipShown(this) && this.input.mouse.pressed
      && pauseChipAt(this.vw, this.vh, this.input.mouse.x, this.input.mouse.y)) {
      this.input.mouse.pressed = false;
      this.input.mouse.down = false;
      this.paused = true;
      audio.dryFire();
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
    // The bench menu owns the movement keys while it is up: you navigate
    // blueprints, you do not wander off the roof in the middle of choosing.
    if (this.input) this.input.menuLock = this.craftOpen;
    this._fxOn(this.player);
    this.player.update(dt, this, this.input);
    // the floor is a thing the weavers own: a knot of silk under the boots is
    // a little over half speed and no dash, and it is checked here because
    // the player has no idea threads exist
    this.threadTick(dt);
    // footprints through the openings: whichever window or hatch a living body
    // is standing in goes on the trail the horde reads when it paths to you
    for (const pl of this.players ?? []) {
      if (!pl || pl.dead) continue;
      const f = pl.floor ?? this.map.floor;
      const tx = Math.floor(pl.pos.x / T), ty = Math.floor(pl.pos.y / T);
      if (this.map.tileOn(f, tx, ty) === TILE.WINDOW) this.noteTrail(f, tx, ty);
    }
    for (const pl of this.players ?? [this.player]) {
      if (!pl || !(this.debug.ammo || pl._dbgAmmo)) continue;
      for (const id in pl.loadout) {
        const sl = pl.loadout[id], w = WEAPONS[id];
        if (!sl.owned || !w) continue;
        sl.mag = w.mag; sl.reserve = w.maxReserve;
      }
      if (pl.giveThrowable) pl.giveThrowable(pl.throwableKind?.() ?? 'frag', 4);
      else pl.grenades = Math.max(pl.grenades ?? 0, 4);
    }
    this.revealAround(this.player.pos.x, this.player.pos.y, 11);

    // ---- co-op: the host also drives every body that joined ---------------
    this._fxOn(this.player);
    if (this.net?.active) this.net.step(dt);
    this._fxOn(this.player);

    // ---- workbench craft menu ---------------------------------------------
    // While it is up it swallows the digits, the arrows and the pointer, so
    // the weapon slots and the wheel below wait their turn. `craftWasOpen` is
    // what the interaction code further down needs: an E that closed the menu
    // must not be read a second time by the bench itself, or the menu you just
    // stepped away from is open again before you can see it close.
    const craftWasOpen = this.craftOpen;
    if (craftWasOpen) this._craftInput(dt, this.player, false);
    if (!craftWasOpen) {
      // 1 / 2 pick a carried slot, Q flips between them; the wheel and the
      // square brackets dig through the whole armoury (that takes a moment)
      if (this.input.wasPressed('Digit1')) this.player.setSlot(0);
      if (this.input.wasPressed('Digit2')) this.player.setSlot(1);
      if (this.input.wasPressed('KeyQ')) this.player.swapActive();
      if (this.input.wasPressed('BracketLeft')) this.player.cycle(-1);
      if (this.input.wasPressed('BracketRight')) this.player.cycle(1);
      if (this.input.wheel) this.player.cycle(this.input.wheel > 0 ? 1 : -1);

      // ONE throwing hand: G throws whatever was bought last -- frag, molotov
      // or gas. X and B stay as quiet aliases for the same slot, so a player
      // with the old muscle memory does not throw nothing.
      if (this.input.wasPressed('KeyG', 'KeyX', 'KeyB') && !this.player.dead) {
        this.throwFor(this.player);
      }
      // medkit
      if (this.input.wasPressed('KeyH')) {
        if (this.player.useMedkit()) {
          this.recordRound('medkits');
          audio.chime();
          this.popups.add(this.player.pos.x, this.player.pos.y - 26, '+55 HEALTH', '#63c74d', 12);
        }
      }
    }

    this.checkLevelLinks(dt);
    this.updateAimTarget();
    this.updateInteraction();
    // ---- co-op: pick somebody up, or get on with buying things ------------
    const fallen = this.fallenNear(this.player);
    if (this.reviveTarget !== fallen) this._reviveT = 0;
    this.reviveTarget = fallen ?? null;
    if (fallen && !this.player.downed && !this.player.dead && this.input.isDown('KeyF')) {
      this._reviveT = (this._reviveT ?? 0) + dt;
      this.player.vel.x *= 0.86; this.player.vel.y *= 0.86;
      this.reviveNeed = this.player.perks?.has('quickrevive') ? 5 : 10;
      this.reviveTarget = fallen;
      if (this._reviveT >= this.reviveNeed) { this._reviveT = 0; this.revive(fallen, this.player); }
    } else {
      this._reviveT = 0;
      // not "is the menu shut" but "was it shut when the frame started": the
      // E that shut it is still held in `pressed`, and reading it again here
      // is what used to open the bench straight back up
      if (!this.craftOpen && !craftWasOpen) {
        if (this.input.wasPressed('KeyE', 'KeyF')) this.doInteraction();
        if (this.input.isDown('KeyE')) this.rebuildTick(dt); else this._rebuildT = 0;
      } else this._rebuildT = 0;
    }

    // ---- waves -------------------------------------------------------------
    if (this.roundActive) {
      this.recordRound('seconds', dt);
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
    } else if (!this._draftOpen()) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startRound(this.round + 1);
    }
    // else: somebody is still looking at three cards. The next wave can wait;
    // the 20-second clock in _skillDraftTick will answer for them.

    // ---- item B: three of them get tired of queueing ----------------------
    this._updateFusion(dt);

    // ---- entities ----------------------------------------------------------
    // Once a round is down to its last few, nothing is allowed to wait under
    // the soil or lie down among the dead any more -- a miner that only digs
    // out when you walk over it can stall a round forever.
    const standing = this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
    this.lastCall = this.roundActive && this.zombiesTotal > 0
      && standing <= Math.max(1, Math.ceil(this.zombiesTotal * 0.10));
    // half the round already in the ground: whatever is sulking under the
    // soil comes up now -- you have earned an honest fight
    this.hordeThin = this.roundActive && this.zombiesTotal > 0
      && this.zombiesKilled >= this.zombiesTotal * 0.5;
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
          // despawned because it was stuck: re-queue it for this round. A
          // summoned body was never in the tally, so it must not give the
          // round a free replacement.
          const gone = this.zombies[i];
          this.zombies.splice(i, 1);
          if (!gone.summoned) this.zombiesSpawned = Math.max(0, this.zombiesSpawned - 1);
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

    // ---- the players' own bottles and pots, in flight ----------------------
    for (let i = this.pThrows.length - 1; i >= 0; i--) {
      const th = this.pThrows[i];
      th.t += dt;
      const tmp = { x: th.x, y: th.y };
      this.map.moveCircle(tmp, th.vx * dt, th.vy * dt, 3, th.floor);
      th.x = tmp.x; th.y = tmp.y;
      const f = Math.max(0, 1 - 1.7 * dt);
      th.vx *= f; th.vy *= f;
      th.rot += dt * 10;
      const slow = Math.hypot(th.vx, th.vy) < 26;
      if (slow || th.t > 2.6) {
        this.pThrows.splice(i, 1);
        if (th.kind === 'molotov') {
          this.fires.push({ x: th.x, y: th.y, r: 46, life: 4.5, max: 4.5, tick: 0, puff: 0, f: th.floor, owner: th.owner });
          audio.explode?.(0.4);
          this.explosionLights?.push?.({ x: th.x, y: th.y, r: 90, life: 0.35, max: 0.35, colour: '#f07a2a' });
          this.shake(3, 0.2);
        } else {
          this.gases.push({ x: th.x, y: th.y, r: 54, life: 7, max: 7, puff: 0, drift: randRange(0, TAU), f: th.floor, owner: th.owner });
          audio.growl?.(0.7, 0.5);
        }
      }
    }

    // ---- power-ups ---------------------------------------------------------
    for (const pu of this.powerups) pu.update(dt);
    for (const pu of this.powerups) {
      if (pu.dead) continue;
      for (const pl of this.players ?? []) {
        if (!pl || pl.dead || pl.downed || pl.evac) continue;
        if ((pl.floor ?? 0) !== (pu.f ?? 0)) continue;
        if (dist(pu.x, pu.y, pl.pos.x, pl.pos.y) < 24) {
          pu.dead = true;
          this._fxOn(pl);
          this.collectPowerup(pu, pl);
          break;
        }
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
    this._watchBox();
    this.egg.update(dt, this);
    this.achievements.update(dt);
    if (this.traps.kills >= 15) this.achievements.unlock('trap_master');
    if (this.powerSurge > 0) this.powerSurge = Math.max(0, this.powerSurge - dt);
    // a jammer that has been shot stops jamming: it only holds while it lives
    if (this.jamT > 0) {
      if (this.jamSrc && (this.jamSrc.dead || this.jamSrc.remove)) this.jamSrc = null;
      const held = this.jamT - dt;
      this.jamT = Math.max(0, (this.jamSrc && !this.jamSrc.dead) ? Math.min(held, 10) : held);
    }
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

    // ---- rifts ------------------------------------------------------------
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i];
      r.life -= dt;
      if (r.life <= 0) { this.rifts.splice(i, 1); continue; }
      this._fxOn({ floor: r.f ?? 0 });
      r.tick += dt;
      if (r.tick >= 0.4) {
        r.tick -= 0.4;
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== (r.f ?? 0)) continue;
          if (dist(r.x, r.y, z.pos.x, z.pos.y) > r.r + z.r) continue;
          const res = z.hurt(r.dmg, false, this, randRange(0, TAU));
          if (res === 2) this.onZombieKilled(z, false);
        }
      }
    }

    // ---- fire and gas -----------------------------------------------------
    this.inFire = 0;
    this.inGas = 0;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      this._fxOn({ floor: f.f ?? 0 });
      // cooks zombies properly, and you if you stand in it
      f.tick += dt;
      const stepT = 0.25;
      while (f.tick >= stepT) {
        f.tick -= stepT;
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== (f.f ?? 0)) continue;
          if (dist(f.x, f.y, z.pos.x, z.pos.y) > f.r + z.r) continue;
          const res = z.hurt(90 * stepT, false, this, randRange(0, TAU));
          z.burning = Math.max(z.burning ?? 0, 2.2);
          z.burnDmg = 30;
          if (res === 2) this.onZombieKilled(z, false, null, 'fire');
        }
      }
      for (const p of this.players) {
        if (!p.dead && (p.floor ?? 0) === (f.f ?? 0) && dist(f.x, f.y, p.pos.x, p.pos.y) < f.r + p.r) {
          if (p === this.player) this.inFire = 1;
          this.scorchPlayer(20 * dt, this, f.owner, p);
        }
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
      this._fxOn({ floor: g.f ?? 0 });
      g.drift += dt * 0.3;
      // zombies choke in it; a thrown pot also bites a little
      g.tick = (g.tick ?? 0) + dt;
      while (g.tick >= 0.5) {
        g.tick -= 0.5;
        for (const z of this.zombies) {
          if (z.dead || (z.floor ?? 0) !== (g.f ?? 0)) continue;
          if (dist(g.x, g.y, z.pos.x, z.pos.y) > g.r + z.r) continue;
          z.webbed = Math.max(z.webbed ?? 0, 0.45);
          if (g.owner) {
            const res = z.hurt(7, false, this, randRange(0, TAU));
            if (res === 2) this.onZombieKilled(z, false, null, 'gas');
          }
        }
      }
      for (const p of this.players) {
        if (!p.dead && (p.floor ?? 0) === (g.f ?? 0) && dist(g.x, g.y, p.pos.x, p.pos.y) < g.r + p.r) {
          if (p === this.player) this.inGas = 1;
          this.scorchPlayer(11 * dt, this, g.owner, p);
        }
      }
      g.puff -= dt;
      if (g.puff <= 0) {
        g.puff = 0.11;
        const a = randRange(0, TAU), d = Math.sqrt(Math.random()) * g.r;
        this.particles.smoke(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, 1);
      }
    }

    this._fxOn(this.player);
    this._stepHaunts(dt);
    this._heliStep(dt);

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
      this._bankRun();       // the last body is down: the diary takes the night
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
    const lookX = ((this.input?.mouse?.x ?? this.vw / 2) - this.vw / 2) * 0.22;
    const lookY = ((this.input?.mouse?.y ?? this.vh / 2) - this.vh / 2) * 0.22;
    const tx = clamp(this.player.pos.x + lookX - this.vw / 2, 0, this.map.w * T - this.vw);
    const ty = clamp(this.player.pos.y + lookY - this.vh / 2, 0, this.map.h * T - this.vh);
    this.cam.x = damp(this.cam.x, tx, 7, dt);
    this.cam.y = damp(this.cam.y, ty, 7, dt);

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) { this.shakeMag = 0; this.shakeT = 0; }
    }

    // ---- lamps flicker -----------------------------------------------------
    for (const l of this.lampsHere()) {
      if (!Number.isFinite(l.phase)) l.phase = Math.random() * TAU;
      l.phase += dt * (2 + Math.sin(this.time * 3 + l.phase) * 1.5);
      const n = Math.sin(l.phase) * 0.5 + Math.sin(l.phase * 2.7) * 0.3 + Math.sin(l.phase * 0.31) * 0.2;
      l.flick = Number.isFinite(n) ? clamp(0.82 + n * 0.16, 0.45, 1.1) : 1;
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
    if (!settings.get('autoQuality')) {
      // the player took the wheel: whatever auto had dialled back is restored
      // at once, and nothing may be dialled back again until they hand it over
      this._slowFrames = 0; this._fastFrames = 0; this._grainOff = false;
      if (this._perfStage !== 0) { this._perfStage = 0; this._applyLightScale(); }
      return;
    }
    if (workMs > 33) { this._slowFrames += 3; this._fastFrames = 0; }
    else if (workMs > 20) { this._slowFrames++; this._fastFrames = 0; }
    else if (workMs < 11) { this._fastFrames++; this._slowFrames = 0; }
    else { this._slowFrames = 0; this._fastFrames = 0; }

    const ceil = this._userLighting ?? 2;
    if (this._slowFrames >= 45 && this._perfStage < ceil) {
      this._perfStage++; this._slowFrames = 0; this._applyLightScale();
    } else if (this._fastFrames >= 600 && this._perfStage > 0) {
      this._perfStage--; this._fastFrames = 0; this._applyLightScale();
    }
    // once the governor has had to step the lights down, the machine is not
    // happy: the film grain goes too (see postgrade), unless the player
    // switched AUTO PERFORMANCE off and asked for the full picture
    this._grainOff = settings.get('autoQuality') && this._perfStage > 0;
  }

  /**
   * Swap the world under the player: campaign building <-> test polygon.
   * Everything downstream reads through this.map, so one fresh GameMap is
   * the whole trick; the box and the player just need to be told.
   */
  _loadMap(range) {
    this.rangeMode = range;
    this.map = new GameMap(range ? 'range' : 'campaign');

    // map-bound systems are rebuilt exactly the way the constructor builds
    // them, so switching worlds never drags state across with it
    this.box = new MysteryBox(this.map.boxSpots ?? []);
    this.box._now = () => this.time;
    this.workbench = new Workbench(this.map.workbench);
    this.egg = new EasterEgg(this.map.secretSwitches ?? []);
    this.traps = new Traps();
    // the roof finale belongs to the campaign night it was earned in: a new
    // map (including the range) never inherits a bird, a tally or a crate
    this.heli = { phase: 0, t: 0, roofRounds: 0, sorry: false, flare: false };
    this.roofRadio = { fixed: false };
    this.supplies = [];
    this._heliSnd = false;
    audio.heliOff();

    // a brand new body: the range must not lend its racks, perks or god-mode
    // to a campaign run, nor the campaign its wounds to the range
    const fresh = new Player(this.map, this.map.playerStart.x, this.map.playerStart.y);
    fresh.points = 500;
    this.player = fresh;
    this.players = [fresh];

    this.zombies = [];
    this.fires = [];
    this.rifts = [];
    this.grenades = [];
    this.monkeys = [];
    this.gases = [];
    this.powerups = [];
    this.tracers = [];
    this.totems = [];
    this.graves = [];
    this.zThrows = [];
    this.bolts = [];
    this.hives = [];
    this.threads = [];
    this.arrows = [];
    this.arrowSticks = [];
    this.boss = null;
    this.hordeThin = false;
    this.setWeatherKind(null);
    this.wx.wet = 0;
    this._storySaid = {};
    this.decals = this._decalFor(0);
    this.stats = {
      round: 0, kills: 0, headshots: 0, points: 0, shots: 0, hits: 0, planks: 0, doors: 0,
      crafted: 0, knifeKills: 0, skeletonKills: 0, grenadeBest: 0,
      teddyDraws: 0, darkKills: 0, darkRound: true,
    };
    this.floorsVisited = new Set();
    this.timers = { instakill: 0, doublepoints: 0, firesale: 0, deathmachine: 0 };
    this.dogRound = false;
    this.intermission = 0;
    this.round = 0;
    this.roundActive = false;

    if (range) {
      this._savedUnlock ??= this.achievements.unlock;
    } else {
      // everything the range borrowed is handed back
      if (this._savedUnlock) { this.achievements.unlock = this._savedUnlock; this._savedUnlock = null; }
      this.debug.god = false;
      this.debug.ammo = false;
      this._dbgFreeze = false;
      this.powerOn = false;
      this.powerSurge = 0;
      this.powerOnAt = -99;
    }

    this.cam.x = clamp(fresh.pos.x - this.vw / 2, 0, this.map.w * T - this.vw);
    this.cam.y = clamp(fresh.pos.y - this.vh / 2, 0, this.map.h * T - this.vh);
    this.rebuildFlow();
    if (this.hud) this.hud._miniDirty = true;
  }

  /** The polygon is a sandbox: power on, pockets full, no dying, no scores. */
  _rangeSetup() {
    this.powerOn = true;
    this.powerOnAt = -99;
    this.player.points = 1000000;
    this.debug.god = true;
    this.debug.ammo = true;
    this.achievements.unlock = () => {};   // sandbox kills earn nothing
    this.bannerShow('TEST RANGE', 'every gun on the walls, a button per creature',
      { dur: 3.2, colour: '#9fd0f0' });
  }

  begin() {
    this.started = true;
    this.scene = null;
    // whichever door led here -- the front page, the test range, a hosted
    // room -- a run starts with an empty ledger and an unbanked entry
    this.runMetrics = newRoundMetrics();
    this._banked = false;
    this.applySettings();
    audio.init();
    audio.resume();
    this.startRound(1);
    // After the round banner, not before it: startRound announces ROUND 1 and
    // would overwrite a warning shown a line earlier. If the browser still has
    // not let the audio clock run, the player is told why the game is mute
    // instead of believing it lost its voice for good.
    if (!audio.running) {
      this.bannerShow('SOUND IS BLOCKED', 'tap or click anywhere to let the game speak',
        { dur: 4.5, colour: '#e0a040', local: true });
    }
  }

  /**
   * RESTORE DEFAULTS is the one row in this panel that throws work away, and
   * on a phone a thumb can land on it while scrolling the list. Ask twice:
   * the first press arms the row for a few seconds and the second one, on
   * the same row, is the one that resets. Anything else -- moving away,
   * closing the panel -- disarms it.
   */
  _settingsReset() {
    if ((this._resetArmT ?? 0) > 0) {
      this._resetArmT = 0;
      settings.reset();
      return true;
    }
    this._resetArmT = 4;
    audio.deny();
    return false;
  }

  /**
   * The player looked away from a solo run. The window keeps drawing while
   * another app has the focus, so without this a coffee break is a death
   * sentence; a co-op world belongs to the host, though, and freezing it
   * would stop everyone else, so a shared game is deliberately left alone.
   * Menus, the bench and the death screen are already not live rounds.
   */
  pauseForFocusLoss() {
    if (!this.started || this.gameOver || this.paused) return false;
    if (this.net?.playing) return false;
    if (this.player?.skillDraft) return false;
    this.paused = true;
    return true;
  }

  // ------------------------------------------------------------------ menus
  /**
   * The front-door row with this id. Closing a page should put the cursor
   * back on the row that opened it -- and a new row must not silently move
   * it, which is what a hard-coded number does.
   */
  _menuRowIndex(id) {
    const i = menuRows('menu', this).findIndex((r) => r.id === id);
    return i >= 0 ? i : 0;
  }

  /**
   * Wear an outfit -- or `null` to put the standard kit back on.
   *
   * Refused for a coat whose badge is not earned: the wardrobe is drawn from
   * the achievements, and this is the one function that has to agree with the
   * drawing, whoever calls it (the menu, the debug panel, a test).
   */
  equipSkin(id) {
    if (id && !skinOwned(id, this.achievements)) return false;
    const saved = saveSkin(id);
    const changed = this.player?.setSkin(saved) ?? false;
    // the coat has to reach the host as well, or a guest changes in their own
    // mirror and nobody else ever sees it
    this.net?.sendSkin?.(saved);
    return changed || (this.player?.skin ?? null) === (saved ?? null);
  }

  /**
   * The front door. Solo behaves exactly as it always did; multiplayer opens
   * a room on the relay and then simply starts playing, because somebody
   * walking in halfway through round nine is the whole point.
   */
  _menuUpdate(dt) {
    const inp = this.input;
    if (!inp) return;
    if (this.scene === 'waiting') { this._waitUpdate(dt); return; }
    // the achievements list is its own little screen: it scrolls, and ESC leaves
    if (this.scene === 'achievements') { this._achUpdate(dt); return; }
    // the all-time page fits without scrolling; a tap or ESC leaves it
    if (this.scene === 'stats') { this._lifeUpdate(dt); return; }
    // the wardrobe: a list, like the achievements, but every row is a choice
    if (this.scene === 'outfits') { this._outfitUpdate(dt); return; }
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

    // leaving is never the row's business: ESC has to work even when the
    // selection happens to sit on REFRESH or on the empty-list notice
    if (esc) {
      this.scene = 'menu';
      // ...and it lands back on MULTIPLAYER, not on whatever row a submenu
      // happened to have selected
      this.menuIndex = this._menuRowIndex('mp');
      audio.dryFire();
      return;
    }
    const row = rows[this.menuIndex];
    if (!row) return;
    if (row.id === 'refresh') { this.net.askForRooms(); return; }
    if (row.id === 'none') return;
    audio.reload(2);
    switch (row.id) {
      case 'solo':
        this.net.role = 'off';
        if (this.rangeMode) this._loadMap(false);
        this.begin();
        break;
      case 'range':
        this.net.role = 'off';
        this._loadMap(true);
        this.begin();
        this._rangeSetup();
        break;
      case 'mp':
        this.scene = 'mp'; this.menuIndex = 0; this._roomT = 0;
        this._ensureRelay();
        break;
      case 'controls': this.controlsOpen = true; this._wasPaused = false; break;
      case 'settings': this.settingsOpen = true; this._wasPaused = false; break;
      case 'achievements': this.scene = 'achievements'; this.achScroll = 0; break;
      case 'outfits':
        this.scene = 'outfits';
        // start with the coat you are wearing under the cursor
        this.outfitIndex = Math.max(0, SKIN_ORDER.indexOf(this.player?.skin) + 1);
        break;
      case 'stats': this.scene = 'stats'; break;
      case 'host': this._startHost(); break;
      case 'join':
        this.scene = 'rooms'; this.menuIndex = 0; this._roomT = 0;
        this._ensureRelay();
        break;
      case 'name': this._askName(); break;
      case 'addr': this._askAddress(); break;
      case 'back': this.scene = 'menu'; this.menuIndex = this._menuRowIndex('mp'); break;
      case 'waiting': break;
      default:
        if (row.room) this._joinRoom(row.room);
        break;
    }
  }

  /**
   * The wardrobe. Row 0 takes everything off; rows 1..10 are SKIN_ORDER.
   *
   * A locked row is still a row -- it tells you which badge opens it, and
   * pressing it does nothing but say so. The pointer picks and wears in one
   * press (a phone has no Enter), the keyboard picks with W/S and wears with
   * Enter, and ESC or a tap on the empty margin goes back to the front door.
   */
  _outfitUpdate(dt) {
    const inp = this.input;
    if (!inp) return;
    const L = outfitsLayout(this, this.vw, this.vh);
    const n = L.rows;
    const m = inp.mouse;
    const hover = m ? outfitRowAt(this, this.vw, this.vh, m.x, m.y) : -1;

    if (hover >= 0 && hover !== this.outfitIndex) {
      this.outfitIndex = hover;
      audio.dryFire();
    }
    // all four arrows: this is a column of coats, but a player who tries the
    // horizontal pair should not find a dead key in a menu about clothes
    if (inp.wasPressed('ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA')) {
      this.outfitIndex = (this.outfitIndex - 1 + n) % n; audio.dryFire();
    }
    if (inp.wasPressed('ArrowDown', 'KeyS', 'ArrowRight', 'KeyD')) {
      this.outfitIndex = (this.outfitIndex + 1) % n; audio.dryFire();
    }
    if (inp.wasPressed('Home')) { this.outfitIndex = 0; audio.dryFire(); }
    if (inp.wasPressed('End')) { this.outfitIndex = n - 1; audio.dryFire(); }
    const wheel = inp.wheel ?? 0;
    if (wheel) {
      this.outfitIndex = clamp(this.outfitIndex + Math.sign(wheel), 0, n - 1);
      audio.dryFire();
    }

    const wear = () => {
      const id = outfitIdAt(this, this.outfitIndex);
      if (id && !skinOwned(id, this.achievements)) {
        // nothing to wear yet: say so, and leave the cursor where it is
        audio.deny?.();
        const badge = SKINS[id] ? ACHIEVEMENTS.find((a) => a.id === SKINS[id].ach) : null;
        this.bannerShow('NOT EARNED YET', badge ? badge.name : null,
          { dur: 2.2, colour: '#c4463a', local: true });
        return;
      }
      if (this.equipSkin(id) && id) audio.perk?.();
      else audio.reload?.(2);
    };

    if (inp.wasPressed('Enter', 'Space')) wear();
    else if (m?.pressed) {
      if (hover >= 0) { this.outfitIndex = hover; wear(); }
      else { this.scene = 'menu'; this.menuIndex = this._menuRowIndex('outfits'); audio.dryFire(); }
    }
    if (inp.wasPressed('Escape', 'Backspace')) {
      this.scene = 'menu';
      this.menuIndex = this._menuRowIndex('outfits');
      audio.dryFire();
    }
  }

  /**
   * The achievements list: scrolls with the arrow keys and the wheel, and
   * leaves on ESC or a press of the close line. Nothing here runs the game.
   */
  _achUpdate(dt) {
    const inp = this.input;
    // `update()` advanced the clock already; adding it again made the page
    // blink at double speed

    // the count comes from the panel painter (hud.js), so the scroll can never
    // stop short of the last badge or run past the end of the list
    const visible = achVisible(this.vw, this.vh);
    const total = this.achievements?.total ?? 0;
    const maxScroll = Math.max(0, total - visible);
    this.achScroll = Math.max(0, Math.min(this.achScroll ?? 0, maxScroll));
    const step = (d) => { this.achScroll = Math.max(0, Math.min(maxScroll, this.achScroll + d)); audio.dryFire(); };
    // all four arrows scroll it: the list is a column, so left and right mean
    // the same as up and down rather than nothing at all
    if (inp.wasPressed('ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA')) step(-1);
    if (inp.wasPressed('ArrowDown', 'KeyS', 'ArrowRight', 'KeyD')) step(1);
    if (inp.wasPressed('PageUp')) step(-visible);
    if (inp.wasPressed('PageDown')) step(visible);
    const wheel = inp.wheel ?? 0;
    // one row a notch: `input.wheel` is a count of rows now, not the raw
    // deltaY, so multiplying it again scrolled the list twice as fast as the
    // hand moved -- which is what "the menus fly past" always meant
    if (wheel) { this.achScroll = Math.max(0, Math.min(maxScroll, this.achScroll + wheel)); audio.dryFire(); }

    // A phone has no wheel and no ESC: a drag scrolls the list, and a tap that
    // did not drag closes it. Without this the page was a trap on the one
    // device that cannot press Escape.
    const m = inp.mouse;
    if (m?.down) {
      if (this._achDragY === undefined) { this._achDragY = m.y; this._achDragged = false; }
      const dy = m.y - this._achDragY;
      if (Math.abs(dy) >= 14) {
        this.achScroll = Math.max(0, Math.min(maxScroll,
          this.achScroll + Math.sign(-dy) * Math.max(1, Math.round(Math.abs(dy) / 24))));
        this._achDragY = m.y;
        this._achDragged = true;
      }
    } else {
      this._achDragY = undefined;
    }
    if (m?.pressed) {
      if (this._achDragged) this._achDragged = false;
      else { this.scene = 'menu'; this.menuIndex = this._menuRowIndex('achievements'); audio.dryFire(); return; }
    }
    if (inp.wasPressed('Escape', 'Backspace', 'Enter')) {
      this._achDragY = undefined; this._achDragged = false;
      this.scene = 'menu'; this.menuIndex = this._menuRowIndex('achievements'); audio.dryFire();
    }
  }

  /**
   * The all-time screen. It fits on one page -- two columns, no scrolling --
   * so leaving is the only thing it has to listen for: ESC on a keyboard, a
   * tap on a phone.
   */
  _lifeUpdate(dt) {
    const inp = this.input;
    // `update()` already advanced the clock, so no `this.time += dt` here: the
    // page would blink at double speed for no reason
    if (inp.wasPressed('Escape', 'Backspace', 'Enter', 'Space')
      || inp.mouse.pressed) {
      this.scene = 'menu';
      this.menuIndex = this._menuRowIndex('stats');   // where the player left
      audio.dryFire();
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
    net.hostGame(net.makeRoomCode(), net.name || 'PLAYER');
    // hosting without a relay is not fatal: you just play by yourself, and
    // the HUD says so rather than pretending a room is open
    if (!linked) this.bannerShow('NO RELAY', 'run with node server.mjs to let people join',
      { dur: 4, colour: '#c4463a' });
    this.begin();
  }

  /**
   * The crate has one home at a time but several to choose from, and when the
   * teddy bear takes it away it turns up somewhere else entirely -- which
   * reads, quite reasonably, as "there are several mystery boxes". Say so out
   * loud when it happens, so it is a rule of the map instead of a glitch.
   */
  _watchBox() {
    const s = this.box.spot;
    if (!s) return;
    const key = `${this.map.floor}:${s.x}:${s.y}`;
    if (this._boxKey === undefined) { this._boxKey = key; return; }
    if (key === this._boxKey) return;
    const sameFloor = this._boxKey.startsWith(`${this.map.floor}:`);
    this._boxKey = key;
    if (sameFloor && this.round > 0) {
      this.bannerShow('THE BOX MOVED', 'follow the arrow at the edge of the screen',
        { dur: 2.6, colour: '#f0d98a' });
      audio.door?.();
    }
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
    const pl = this.player;
    // the bench menu owns the movement keys here too, exactly as it does for
    // the host's own body: nobody drifts off the roof in the middle of a choice
    if (this.input) this.input.menuLock = this.craftOpen;
    net.step(dt);
    // bells, hums, snowballs and the rain on the glass: the timers and the
    // kinematics are the guest's to run, the consequences are not (isAuth)
    this._fxOn(this.player);
    this._stepHaunts(dt);
    this._heliStep(dt);
    if (pl && pl.floor !== undefined && pl.floor !== this.map.floor) {
      this.map.setFloor(pl.floor);
      this.useFloor(pl.floor);
    }
    // What is under hand. Without this a guest gets no prompt at all -- no
    // price on a door, no "the box is spinning", no bench -- and presses E on
    // faith while the host does the work somewhere off screen.
    this.updateInteraction();
    this.updateAimTarget();
    // The bench is the one thing a guest drives for itself: the menu is local,
    // so it opens the instant E goes down with no round trip, and only the
    // building travels (net.js, `m:'craft'`).
    // kneeling over a friend: the host owns the revive, the guest owns the bar
    if (pl && !pl.dead && !pl.downed && this.input?.isDown('KeyF')) {
      const fallen = this.fallenNear(pl);
      if (this.reviveTarget !== fallen) this._reviveT = 0;
      if (fallen) {
        this.reviveTarget = fallen;
        this.reviveNeed = pl.perks?.has('quickrevive') ? 5 : 10;
        this._reviveT = Math.min(this.reviveNeed, (this._reviveT ?? 0) + dt);
      } else { this._reviveT = 0; this.reviveTarget = null; }
    } else if (this.net?.role === 'guest') { this._reviveT = 0; this.reviveTarget = null; }
    const craftWasOpen = this.craftOpen;
    if (craftWasOpen) this._craftInput(dt, pl, true);
    if (!craftWasOpen && pl && !pl.dead && !pl.downed
      && this.input?.wasPressed('KeyE', 'KeyF')
      && this.interaction?.type === 'workbench') {
      pl.craftOpen = true;
      audio.reload(2);
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
    if (this.gameOver) {
      this.overT += dt;
      if (this.overT > 1.1 && (this.input?.wasPressed('KeyR') || this.input?.mouse?.pressed)) {
        this.net?.close?.();
        this.reset();
        this.started = true;
        this.startRound(1);
      }
    }
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

    // what the night left in the fields: painted on the ground, under everybody
    if (!this.rangeMode && this.map.floor === 0) this.drawWrecks(ctx);
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
    for (const r of this.rifts) {
      if ((r.f ?? 0) !== this.map.floor) continue;
      const k = Math.min(1, r.life / r.max);
      const open = Math.min(1, (r.max - r.life) * 6 + 0.4);   // tears open fast
      ctx.save();
      // the crack itself: jagged dark line with a violet throat
      ctx.translate(r.x, r.y);
      ctx.rotate((r.seed % 7) * 0.4);
      ctx.fillStyle = `rgba(12,6,20,${0.8 * k + 0.2})`;
      ctx.beginPath();
      ctx.moveTo(-r.r * open, 0);
      for (let i = 1; i <= 6; i++) {
        const jx = -r.r * open + (2 * r.r * open * i) / 6;
        const jy = ((r.seed >> i) & 1 ? -1 : 1) * (2 + (r.seed % 3));
        ctx.lineTo(jx, jy);
      }
      for (let i = 6; i >= 0; i--) {
        const jx = -r.r * open + (2 * r.r * open * i) / 6;
        const jy = ((r.seed >> i) & 1 ? 1 : -1) * (2 + ((r.seed >> 2) % 3));
        ctx.lineTo(jx, jy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.6 + Math.sin(this.time * 9 + r.seed) * 0.4;
      ctx.strokeStyle = `rgba(192,128,255,${(0.5 + 0.4 * pulse) * k})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      const grd = ctx.createRadialGradient(0, 0, 1, 0, 0, r.r * 1.2);
      grd.addColorStop(0, `rgba(160,90,255,${0.25 * k * pulse})`);
      grd.addColorStop(1, 'rgba(120,60,220,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(0, 0, r.r * 1.2, r.r, 0, 0, TAU); ctx.fill();
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
    // 2c. the planted haunts, what flies through the air, and the lightning
    // the silk goes down first: it is on the floor, and everything else is
    // standing on it
    for (const th of this.threads) {
      if (!th.dead && (th.f ?? 0) === this.map.floor) th.draw(ctx, this.art, this.time);
    }
    for (const hv of this.hives) {
      if (!hv.dead && (hv.f ?? 0) === this.map.floor) hv.draw(ctx, this.art, this.time);
    }
    for (const ar of this.arrowSticks) {
      if ((ar.f ?? 0) !== this.map.floor) continue;
      const k = Math.min(1, ar.life / 3);
      ctx.save();
      ctx.globalAlpha = 0.45 * k;
      ctx.strokeStyle = '#cfc9b4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ar.x, ar.y);
      ctx.lineTo(ar.x - Math.cos(ar.ang) * 8, ar.y - Math.sin(ar.ang) * 8);
      ctx.stroke();
      ctx.restore();
    }
    for (const ar of this.arrows) {
      if (!ar.dead && (ar.f ?? 0) === this.map.floor) ar.draw(ctx);
    }
    for (const gv of this.graves) {
      if (!gv.dead && (gv.f ?? 0) === this.map.floor) gv.draw(ctx, this.art, this.time);
    }
    for (const tt of this.totems) {
      if (!tt.dead && (tt.f ?? 0) === this.map.floor) tt.draw(ctx, this.art, this.time);
    }
    for (const th of this.zThrows) {
      if (!th.dead && (th.f ?? 0) === this.map.floor) th.draw(ctx, this.art, this.time);
    }
    for (const b of this.bolts) {
      if ((b.f ?? 0) !== this.map.floor) continue;
      const k = Math.max(0, b.life / b.max);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#dff0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      const segs = 5;
      for (let i = 1; i < segs; i++) {
        const kk = i / segs;
        const jx = Math.sin(b.seed + i * 12.9) * 9 * (1 - Math.abs(kk - 0.5) * 1.4);
        const jy = Math.cos(b.seed + i * 7.7) * 7;
        ctx.lineTo(b.x0 + (b.x1 - b.x0) * kk + jx, b.y0 + (b.y1 - b.y0) * kk + jy);
      }
      ctx.lineTo(b.x1, b.y1);
      ctx.stroke();
      ctx.globalAlpha = k * 0.4;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(140,190,255,0.5)';
      ctx.stroke();
      ctx.restore();
    }
    this.traps.draw(ctx, this.time, this.map.floor);
    this.drawWallBuys(ctx);
    this.drawGrenadeCrates(ctx);
    this.drawPerkMachines(ctx);
    if (this.map.rangePads) this.drawRangePads(ctx);
    if (this.map.floor === 0) this.drawMysteryBox(ctx);   // one box, ground floor, drawn once
    this.drawPowerSwitch(ctx);
    this.drawWorkbench(ctx);
    this.drawPackAPunch(ctx);
    this.drawSecretSwitches(ctx);
    this.drawSecretLoot(ctx);
    this.drawSupplies(ctx);
    this.drawCaches(ctx);
    if (!this.rangeMode && this.map.floor === HELI_PAD.f) {
      this.drawHeliPad(ctx);
      this.drawRoofBeacons(ctx);
      this.drawRoofFlare(ctx);
      this.drawRoofRadio(ctx);
      this.drawHeli(ctx);
    }
    this.drawPowerups(ctx);

    // 3. actors, sorted by feet depth
    const actors = this.zombies.filter((z) => !z.remove && (z.floor ?? 0) === this.map.floor);
    const list = actors.map((z) => ({ y: z.pos.y, d: () => z.draw(ctx, this.art, this.time) }));
    // the revive channel: a green bar over the body somebody is kneeling by
    if (this.reviveTarget && (this._reviveT ?? 0) > 0 && !this.reviveTarget.dead) {
      const tgt = this.reviveTarget;
      const k = clamp(this._reviveT / (this.reviveNeed ?? 10), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(tgt.pos.x - 16, tgt.pos.y - 32, 32, 5);
      ctx.fillStyle = '#7fd75a';
      ctx.fillRect(tgt.pos.x - 16, tgt.pos.y - 32, Math.round(32 * k), 5);
      ctx.strokeStyle = 'rgba(127,215,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tgt.pos.x - 16.5, tgt.pos.y - 32.5, 33, 6);
    }
    for (const pl of (this.players ?? [this.player])) {
      if (!pl || pl.evac || (pl.floor ?? this.map.floor) !== this.map.floor) continue;
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
        // a ribbon of light, not a rope: the core is a hairline and the
        // colour is a thin halo around it
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = t.colour;
        ctx.globalAlpha = k * 0.20;
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        ctx.moveTo(t.x0, t.y0);
        ctx.lineTo(t.x1, t.y1);
        ctx.stroke();
        ctx.globalAlpha = k * 0.55;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.globalAlpha = k;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.1;
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

    // 6b. the players' own bottles and pots, tumbling to where they were aimed
    for (const th of this.pThrows) {
      if ((th.floor ?? this.map.floor) !== this.map.floor) continue;
      ctx.save();
      ctx.translate(th.x, th.y);
      ctx.rotate(Math.sin(th.rot) * 0.6);
      if (th.kind === 'molotov') {
        ctx.fillStyle = '#7a3a2a';
        ctx.fillRect(-2, -3, 4, 6);
        ctx.fillStyle = '#d0603c';
        ctx.fillRect(-1, -6, 2, 3);
        if (Math.floor(th.t * 14) % 2 === 0) { ctx.fillStyle = '#f6c04a'; ctx.fillRect(-1, -8, 2, 2); }
      } else {
        ctx.fillStyle = '#4a5c4a';
        ctx.fillRect(-2, -4, 4, 7);
        ctx.fillStyle = '#8ab06a';
        ctx.fillRect(-2, -1, 4, 2);
      }
      ctx.restore();
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
      // A glow is the mark of a head that is up and facing you. The hounds
      // carry their heads level with the floor and the crawlers have theirs
      // on the tiles -- and a pool of light sat over both of them like a
      // torch, which read as "something is burning" rather than "a dog".
      const off = z.def?.headOff ?? 1;
      if (off < 0.6) continue;
      const gx = z.pos.x - camX, gy = z.pos.y - camY - HEAD_OFF_Y * off;
      if (gx < -20 || gy < -20 || gx > vw + 20 || gy > vh + 20) continue;
      ctx.drawImage(glowImg, Math.round(z.pos.x - gr), Math.round(z.pos.y - HEAD_OFF_Y * off - gr));
    }
    ctx.restore();

    if (this.debug.paths) this.drawDebugWorld(ctx, camX, camY);

    ctx.restore();     // <-- back to screen space

    // 9. weather: drifting leaves above the world
    // the governor only reaches for the weather once the lights are already low
    if (settings.get('weather') && this._perfStage < 2) this.drawWeather(ctx, camX, camY);

    // 10. lighting (screen space!)
    this.drawLighting(ctx, camX, camY);

    // 10a. the box beacon burns above the darkness, so the one crate that
    // sells guns reads through the pre-power gloom and never looks like
    // a second piece of furniture
    this.box.drawBeacon(ctx, this.time, camX, camY);
    // Small battery-lit cache markings remain readable before generator power.
    ctx.save();
    ctx.translate(-camX, -camY);
    this.drawCaches(ctx, true);
    ctx.restore();

    // 10b. DLSS5's grade over the lit scene: warm highlights, pushed contrast,
    // a touch of film grain. Cheap full-screen blits, only when it is switched
    // on. Run before the HUD so the text stays clean and readable.
    if (this._dlss) postgrade(ctx, vw, vh, this.time, !this._grainOff);

    // 11. vignette + HUD
    // a slightly deeper vignette when the grade is on, so the edges fall away
    drawVignette(ctx, vw, vh, this._dlss ? 0.5 : 0.38);

    // 11a. the dusk a totem brings: a purple weight over the whole picture
    if (this.totemPower) {
      ctx.save();
      ctx.fillStyle = `rgba(38,16,64,${0.26 + Math.sin(this.time * 1.7) * 0.05})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 + Math.sin(this.time * 2.3) * 0.02;
      ctx.fillStyle = '#7a3ac0';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }

    // 11b. weather on the glass: the flash, the streaks, the fog, the wet
    this.drawWeatherFx(ctx, vw, vh);

    // 11c. what a snowball or a bolt left on you
    if (this.player.chillT > 0 && !this.player.dead) {
      const a = Math.min(0.5, (this.player.chillT / 3.2) * 0.5);
      const grd = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.3, vw / 2, vh / 2, vh * 0.75);
      grd.addColorStop(0, 'rgba(160,210,240,0)');
      grd.addColorStop(1, `rgba(160,210,240,${a})`);
      ctx.save(); ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh); ctx.restore();
    }
    if (this.player.stunT > 0 && !this.player.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 + Math.random() * 0.2;
      ctx.strokeStyle = '#dff0ff';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const x = Math.random() * vw;
        const y = Math.random() < 0.5 ? Math.random() * 34 : vh - Math.random() * 34;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + randRange(-24, 24), y + randRange(-14, 14));
        ctx.lineTo(x + randRange(-30, 30), y + randRange(-18, 18));
        ctx.stroke();
      }
      ctx.restore();
    }

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
    else if (!this.started && this.scene === 'achievements') drawAchievements(ctx, this, vw, vh);
    else if (!this.started && this.scene === 'stats') drawStats(ctx, this, vw, vh);
    else if (!this.started && this.scene === 'outfits') drawOutfits(ctx, this, vw, vh);
    else if (!this.started) drawMenu(ctx, this, vw, vh);
    else if (this.gameOver) drawGameOver(ctx, this, vw, vh);
    else if (this.paused) drawPause(ctx, this, vw, vh);
    // The way out of every one of those, drawn over it: a phone has no ESC,
    // and "O / ESC — back" was a sentence it could not act on. The death
    // screen gets one too -- "tap anywhere to try again" left a phone no way
    // to say it had had enough.
    if (this.settingsOpen || this.debugOpen || (this.gameOver && this.started)
      || (!this.started && (this.scene === 'achievements' || this.scene === 'stats' || this.scene === 'outfits'))) {
      if (this.gameOver && this.overT <= 1.1) { /* wait for the ledger to land */ } else {
        drawBackChip(ctx, this, vw, vh,
          this.debugOpen ? 'CLOSE' : this.gameOver ? 'MENU' : 'BACK');
      }
    }

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
    // the crate is solid where it stands -- and it only ever stands on the
    // ground floor, so upstairs there is no phantom block to walk into
    if (bs && this.box.state !== 'gone' && this.map.floor === 0) add(bs.x, bs.y, 13, 8, 8);
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

  /** The lamps that belong to the storey you are standing on. */
  lampsHere() { return this.map.lamps ?? LAMPS; }

  /**
   * Power does not arrive everywhere at once: the generator spins up and the
   * filaments catch one by one, each fixture flickering for a beat before it
   * settles. The delay is hashed from the position, so every client in a co-op
   * game sees the same lamps catch in the same order.
   */
  _lampWarm(l) {
    if (!this.powerOn) return 0;
    const delay = 0.15 + ((((l.x * 7 + l.y * 13) | 0) % 97) / 97) * 1.7;
    const t = this.time - this.powerOnAt - delay;
    if (t <= 0) return 0;
    if (t >= 0.8) return 1;
    const step = Math.floor(t * 16);
    const r = Math.abs(Math.sin(step * 12.9898 + (l.x + l.y) * 78.233) * 43758.5453) % 1;
    return r < 0.5 ? 0.95 : 0.15;
  }

  /** All light positions are world-space; the layer itself is screen-space. */
  drawLighting(ctx, camX, camY) {
    const L = this.lighting;
    const sx = (wx) => wx - camX;
    const sy = (wy) => wy - camY;
    // the night upstairs is not the night downstairs
    const amb = AMBIENT[this.map.floor] ?? AMBIENT[0];
    L.setAmbient(amb.rgb, amb.alpha);
    L.begin();

    // open sky over the storey, if it has any
    const sky = SKY_LIGHT[this.map.floor];
    if (sky) {
      L.point(this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 1.15, sky.power, sky.colour, sky.glow);
    }

    // ceiling lamps -- the mains ones only burn once the generator is on.
    // Every storey has its own set; the hand-placed table is the ground
    // floor's. (This used to read the ground floor's list on every storey,
    // so the barracks lamps upstairs never lit anything at all.)
    for (const l of this.lampsHere()) {
      if (l.mains && !this.powerOn) continue;
      let warm = 1;
      if (l.mains) { warm = this._lampWarm(l); if (warm <= 0.01) continue; }
      const x = sx(l.x), y = sy(l.y);
      if (x < -220 || y < -220 || x > this.vw + 220 || y > this.vh + 220) continue;
      let f = l.flick * warm;
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
      // the open box throws light -- from the ground floor only; it used to
      // glow through the ceiling of whatever storey you were standing on
      if (this.map.floor === 0) {
        const bs = this.box.spot;
        L.point(sx(bs.x), sy(bs.y), this.box.open ? 150 : 84, 0.8,
          'rgba(255,225,150,0.30)', this.box.open ? 0.55 : 0.22);
      }
      // Pack-a-Punch drum. Only the ground floor has one -- and the old
      // `return` here did not skip the drum, it skipped the entire rest of
      // the lighting pass: no darkness, no torch, no muzzle flash, no bloom
      // and no composite at all on the two storeys upstairs.
      const pp = this.map.papSpot;
      if (pp) {
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

    // the haunts light their own corners: dusk-purple totem, one small candle
    for (const tt of this.totems) {
      if (tt.dead || (tt.f ?? 0) !== this.map.floor) continue;
      const pulse = 0.7 + Math.sin(this.time * 2.2) * 0.3;
      L.point(sx(tt.x), sy(tt.y - 14), 96, 0.5 * pulse, 'rgba(176,122,224,0.4)', 0.6 * pulse);
    }
    for (const gv of this.graves) {
      if (gv.dead || (gv.f ?? 0) !== this.map.floor) continue;
      const fl = 0.75 + Math.sin(this.time * 7 + gv.uid) * 0.25;
      L.point(sx(gv.x + 7), sy(gv.y - 5), 52, 0.35 * fl, 'rgba(240,200,96,0.35)', 0.5 * fl);
    }

    // the roof ending lights its own corners: four beacons, one searchlight
    if (!this.rangeMode && this.map.floor === HELI_PAD.f) {
      const sws = this.map.floors?.[0]?.secretSwitches ?? [];
      HELI_BEACONS.forEach((b, i) => {
        if (!sws[i]?.found) return;
        const blink = 0.55 + 0.45 * Math.sin(this.time * 6 + i * 1.7);
        L.point(sx(b.x), sy(b.y - 4), 64, 0.4 * blink,
          i % 2 ? 'rgba(90,224,106,0.4)' : 'rgba(224,90,90,0.4)', 0.5 * blink);
      });
      if (this.heli.phase >= 2 && this.heli.phase <= 4) {
        const hp = this._heliPos();
        L.point(sx(hp.x), sy(hp.y), 240 * hp.scale, 0.45 * hp.light, 'rgba(240,235,190,0.3)', 0.4 * hp.light);
      }
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
      if (bx < -110 || by < -110 || bx > this.vw + 110 || by > this.vh + 110) continue;
      const broken = b.planks <= 0;
      L.point(bx, by, broken ? 96 : 62, broken ? 0.6 : 0.34,
        broken ? 'rgba(126,156,198,0.18)' : 'rgba(110,140,180,0.10)', broken ? 0.34 : 0.18);
    }
    L.composite(ctx, this.vw, this.vh, this._dlss ? 1 : 0);

    // lamp fixtures (drawn after the darkness so they stay visible)
    ctx.save();
    for (const l of this.lampsHere()) {
      if (l.mains && !this.powerOn) continue;
      let warm = 1;
      if (l.mains) { warm = this._lampWarm(l); if (warm <= 0.01) continue; }
      const lx = l.x - camX, ly = l.y - camY;
      if (lx < -20 || ly < -20 || lx > this.vw + 20 || ly > this.vh + 20) continue;
      ctx.globalAlpha = 0.55 * l.flick * warm;
      ctx.fillStyle = '#20211f';
      ctx.fillRect(lx - 5, ly - 2, 10, 3);
      ctx.fillStyle = `rgba(255,205,130,${0.9 * l.flick * warm})`;
      ctx.fillRect(lx - 3, ly - 1, 6, 2);
      ctx.globalAlpha = 0.20 * l.flick * warm;
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
      const hz = d.horizontal;
      if (d.open) {
        // Keep the aperture bare. The jambs line its sides; the leaf is parked
        // on the adjacent wall tile, beyond the hinge, never in the walking lane.
        ctx.fillStyle = '#3f2a17';
        if (hz) { ctx.fillRect(x - 1, y, 2, T); ctx.fillRect(x + T - 1, y, 2, T); }
        else { ctx.fillRect(x, y - 1, T, 2); ctx.fillRect(x, y + T - 1, T, 2); }
        ctx.fillStyle = '#5a3d22';
        if (hz) ctx.fillRect(x - T + 2, y + 2, T - 4, 4);
        else ctx.fillRect(x + 2, y - T + 2, 4, T - 4);
        ctx.fillStyle = '#a07a46';
        if (hz) ctx.fillRect(x - T + 2, y + 2, T - 4, 1);
        else ctx.fillRect(x + 2, y - T + 2, 1, T - 4);
        continue;
      }
      // closed: a real paneled door standing in a frame -- it used to be a
      // stack of planks over the opening, which read as a barricade, not a
      // door you could buy
      ctx.fillStyle = '#33220f';                      // the frame
      ctx.fillRect(x - 1, y - 1, T + 2, T + 2);
      ctx.fillStyle = '#6b4a2b';                      // the slab
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = 'rgba(48,30,14,0.45)';          // grain, along the slab
      ctx.fillRect(x + 7, y, 1, T); ctx.fillRect(x + 16, y, 1, T);
      const panel = (px, py, pw, ph) => {             // two recessed panels
        ctx.fillStyle = '#4a3018';
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = '#7d5833';
        ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
        ctx.fillStyle = 'rgba(40,24,10,0.5)';
        ctx.fillRect(px + 1, py + ph - 2, pw - 2, 1);
        ctx.fillRect(px + pw - 2, py + 1, 1, ph - 2);
      };
      // Fixed camera: every closed slab reads front-on, regardless of wall axis.
      panel(x + 3, y + 3, T - 6, 8); panel(x + 3, y + 13, T - 6, 8);
      ctx.fillStyle = '#20222a';                      // hinges
      ctx.fillRect(x + 1, y + 2, 2, 3); ctx.fillRect(x + 1, y + T - 5, 2, 3);
      ctx.fillStyle = '#c9a24a';                      // the brass knob
      ctx.beginPath();
      ctx.arc(x + T - 4, y + T / 2, 1.7, 0, Math.PI * 2);
      ctx.fill();
      // price tag -- a Jammer takes the numbers off everything you buy
      const p = this.player;
      if (!this.jammed && dist(p.pos.x, p.pos.y, d.cx, d.cy) < 90) {
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
      if (this.jammed) { ctx.restore(); continue; }
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
      // lettering -- a Jammer takes the label off the machine, not the machine
      if (!this.jammed) {
        ctx.fillStyle = lit ? def.colour : '#6a6a6a';
        ctx.font = 'bold 7px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(owned ? 'SOLD' : def.short, ps.x, ps.y + 8);
      }
      ctx.restore();

      if (!owned && !this.jammed && dist(this.player.pos.x, this.player.pos.y, ps.x, ps.y) < 90) {
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
    this.box.draw(ctx, this.art, this.time);
    const s = this.box.spot;
    const price = this.box.price();
    const showPrice = !this.jammed && this.box.state === 'closed'
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

    if (!this.jammed && dist(this.player.pos.x, this.player.pos.y, x, y) < 100) {
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

  /** The deck the bird wants: painted on the roof for good, from night one. */
  drawHeliPad(ctx) {
    const { x, y } = HELI_PAD;
    if (!this._vis(x, y, 90)) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(230,225,200,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.arc(x, y, 44, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(230,225,200,0.65)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 16); ctx.lineTo(x - 13, y + 16);
    ctx.moveTo(x + 13, y - 16); ctx.lineTo(x + 13, y + 16);
    ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The flare locker at the pad centre, and the green burn itself: a glowing
   * pool with a smoke column the crew can home on from the west trees.
   */
  drawRoofFlare(ctx) {
    const H = this.heli;
    const { x, y } = HELI_PAD;
    if (!this._vis(x, y, 90)) return;
    ctx.save();
    if (H.phase === 1) {
      // the locker: a small green-striped box waiting for a hand
      ctx.fillStyle = '#2c3a30';
      ctx.fillRect(x - 7, y - 6, 14, 12);
      ctx.strokeStyle = '#5ae06a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 6.5, y - 5.5, 13, 11);
      const blink = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.fillStyle = `rgba(120,230,130,${0.35 + 0.5 * blink})`;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (H.phase === 2 && H.flare) {
      const thin = H.t < 108 ? 1 : Math.max(0.15, (116 - H.t) / 8);
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 5.2);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 46 * thin + 10);
      g.addColorStop(0, `rgba(140,240,140,${0.5 * pulse * thin})`);
      g.addColorStop(0.55, `rgba(70,190,90,${0.28 * pulse * thin})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 46 * thin + 10, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // the stick itself, hissing on the deck
      ctx.fillStyle = '#3a4038';
      ctx.fillRect(x - 2, y - 3, 4, 7);
      ctx.fillStyle = `rgba(160,255,160,${0.8 * pulse})`;
      ctx.beginPath(); ctx.arc(x, y - 4, 2.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** The roof radio station: a dead shack until somebody pays the scrap. */
  drawRoofRadio(ctx) {
    const { x, y } = ROOF_RADIO;
    if ((this.map.floor ?? 0) !== ROOF_RADIO.f) return;
    if (!this._vis(x, y, 90)) return;
    const fixed = !!this.roofRadio?.fixed;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 12, 16, 5, 0, 0, TAU); ctx.fill();
    // the shack
    ctx.fillStyle = fixed ? '#3b4148' : '#33363b';
    ctx.fillRect(x - 14, y - 12, 28, 24);
    ctx.fillStyle = fixed ? '#4b525b' : '#3d4046';
    ctx.fillRect(x - 14, y - 16, 28, 5);
    ctx.strokeStyle = '#14171c';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 14.5, y - 16.5, 29, 28);
    // the mast: bent while it is broken, straight and guy-wired once fixed
    ctx.strokeStyle = fixed ? '#8b939c' : '#6a6f76';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 16);
    if (fixed) ctx.lineTo(x + 8, y - 40);
    else { ctx.lineTo(x + 11, y - 28); ctx.lineTo(x + 16, y - 33); }
    ctx.stroke();
    if (fixed) {
      const blink = 0.5 + 0.5 * Math.sin(this.time * 3.4);
      ctx.fillStyle = `rgba(120,230,130,${0.4 + 0.6 * blink})`;
      ctx.beginPath(); ctx.arc(x + 8, y - 41, 2.2, 0, TAU); ctx.fill();
      // the dish turns, slowly, looking for the bird
      ctx.save();
      ctx.translate(x - 6, y - 20);
      ctx.rotate(Math.sin(this.time * 0.7) * 0.5);
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#8fe05a';
      ctx.fillRect(x - 10, y - 6, 3, 3);
    } else {
      ctx.fillStyle = '#5a2f2a';
      ctx.fillRect(x - 10, y - 6, 3, 3);
      // a dead set sparks now and then, so the roof feels like a job, not a prop
      if (Math.sin(this.time * 1.7) > 0.985) {
        ctx.strokeStyle = 'rgba(200,230,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 2); ctx.lineTo(x - 1, y + 2); ctx.lineTo(x - 5, y + 4);
        ctx.stroke();
      }
    }
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = fixed ? '#8fe05a' : '#6f6a5c';
    ctx.fillText(fixed ? 'ROOF RADIO' : 'ROOF RADIO (DEAD)', x, y + 22);
    ctx.restore();
  }

  /** Four corner lights, one per dial downstairs: red and green, slow blink. */
  drawRoofBeacons(ctx) {
    const sws = this.map.floors?.[0]?.secretSwitches ?? [];
    HELI_BEACONS.forEach((b, i) => {
      if (!this._vis(b.x, b.y, 50)) return;
      const lit = !!sws[i]?.found;
      ctx.save();
      ctx.fillStyle = '#23262c';
      ctx.fillRect(b.x - 4, b.y - 2, 8, 7);
      const col = i % 2 ? '#5ae06a' : '#e05a5a';
      if (lit) {
        const blink = 0.55 + 0.45 * Math.sin(this.time * 6 + i * 1.7);
        ctx.globalAlpha = blink;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(b.x, b.y - 4, 3, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 * blink;
        const g = ctx.createRadialGradient(b.x, b.y - 4, 0, b.x, b.y - 4, 28);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y - 4, 28, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#3a3f47';
        ctx.beginPath(); ctx.arc(b.x, b.y - 4, 2.4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });
  }

  /** The bird itself: shadow on the deck, searchlight, rotor, nav lights. */
  drawHeli(ctx) {
    const H = this.heli;
    if (H.phase < 2 || H.phase > 4) return;
    const { x, y, scale, alpha, light } = this._heliPos();
    if (!this._vis(x, y, 260)) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // the shadow stays on the deck while the bird is high
    ctx.fillStyle = `rgba(0,0,0,${0.3 * (2 - scale)})`;
    ctx.beginPath();
    ctx.ellipse(HELI_PAD.x, HELI_PAD.y + 6, 46 * scale, 15 * scale, 0, 0, TAU);
    ctx.fill();
    // searchlight pool, strongest on the way in
    if (light > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 130 * scale);
      g.addColorStop(0, `rgba(240,235,190,${0.32 * light * alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 130 * scale, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // skids
    ctx.strokeStyle = '#1d2126'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-24, 13); ctx.lineTo(18, 13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-24, 17); ctx.lineTo(18, 17); ctx.stroke();
    // tail boom and fin
    ctx.fillStyle = '#39424a';
    ctx.fillRect(-58, -4, 36, 7);
    ctx.fillStyle = '#2c343a';
    ctx.fillRect(-62, -13, 7, 15);
    // body
    ctx.fillStyle = '#4a545c';
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5d6871';
    ctx.beginPath(); ctx.ellipse(6, -3, 16, 8, 0, 0, TAU); ctx.fill();
    // glass
    ctx.fillStyle = 'rgba(150,200,230,0.55)';
    ctx.beginPath(); ctx.ellipse(15, -2, 8, 6, 0, 0, TAU); ctx.fill();
    if (H.phase === 4) {
      // the people who boarded: two small silhouettes watching the house shrink
      ctx.fillStyle = 'rgba(28,30,36,0.92)';
      ctx.beginPath(); ctx.arc(12, -3, 2.6, 0, TAU); ctx.fill();
      ctx.fillRect(9.4, -1, 5.2, 4.4);
      ctx.beginPath(); ctx.arc(18.4, -2, 2.3, 0, TAU); ctx.fill();
      ctx.fillRect(16.1, 0, 4.6, 3.6);
    }
    // nav lights
    const blink = Math.sin(this.time * 8) > 0;
    ctx.fillStyle = blink ? '#ff5a4a' : '#5a2a24';
    ctx.fillRect(-28, -2, 3, 3);
    ctx.fillStyle = blink ? '#5aff7a' : '#245a2e';
    ctx.fillRect(25, -2, 3, 3);
    // rotor: two crossing blades and the disc they blur into
    const rot = this.time * (H.phase === 4 ? 26 : H.phase === 3 ? 17 : 22);
    ctx.save();
    ctx.translate(0, -11);
    ctx.strokeStyle = 'rgba(212,222,232,0.75)';
    ctx.lineWidth = 2;
    for (let b = 0; b < 2; b++) {
      const a = rot + b * Math.PI / 2;
      const dx = Math.cos(a) * 52, dy = Math.sin(a) * 10;
      ctx.beginPath(); ctx.moveTo(-dx, -dy); ctx.lineTo(dx, dy); ctx.stroke();
    }
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#d8e2ea';
    ctx.beginPath(); ctx.ellipse(0, 0, 52, 10, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /**
   * What the night left in the fields: a burned-out car at the bottom of the
   * map and a tank wreck at the southeast corner, both standing in scorched
   * earth instead of grass. The 'V' tiles under them carry the collision and
   * the flow field; this carries the rust.
   */
  drawWrecks(ctx) {
    // ---- car: enlarged hull collision at tiles (28..33, 45..47) ----------
    {
      const x = 31 * T, y = 46.5 * T;
      if (this._vis(x, y, 110)) {
        ctx.save();
        // the ground around it: scorched earth, mud and wheel ruts, wide
        ctx.fillStyle = 'rgba(52,40,27,0.9)';
        ctx.beginPath(); ctx.ellipse(x, y + 2, 112, 54, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(36,28,19,0.7)';
        ctx.beginPath(); ctx.ellipse(x - 10, y + 6, 80, 36, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(30,24,16,0.5)';
        for (const [mx, my, mr] of [[-100, 18, 20], [90, -20, 24], [70, 28, 17], [-70, -30, 15], [10, 44, 16]]) {
          ctx.beginPath(); ctx.ellipse(x + mx, y + my, mr, mr * 0.55, 0, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(28,22,15,0.55)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x - 120, y + 28); ctx.quadraticCurveTo(x - 34, y + 38, x + 52, y + 32); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 112, y + 42); ctx.quadraticCurveTo(x - 16, y + 52, x + 68, y + 46); ctx.stroke();
        // body: hood, cabin, boot -- a sedan silhouette, not a brick
        ctx.translate(x, y);
        ctx.rotate(-0.06);
        ctx.scale(2, 2);                 // the wrecks read twice as big now
        ctx.fillStyle = '#191512';                       // shadow under it
        ctx.beginPath(); ctx.ellipse(0, 4, 34, 13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5a3524';                       // rusted paint
        ctx.fillRect(-32, -9, 64, 18);
        ctx.fillStyle = '#6b4029';
        ctx.fillRect(-32, -9, 64, 4);
        ctx.fillStyle = '#47281a';                       // hood and boot dips
        ctx.fillRect(-32, -6, 14, 12);
        ctx.fillRect(20, -6, 12, 12);
        ctx.fillStyle = '#241a14';                       // the cabin
        ctx.fillRect(-16, -12, 30, 24);
        ctx.fillStyle = '#0e1116';                       // glass, most of it gone
        ctx.fillRect(-14, -10, 8, 20);
        ctx.fillRect(4, -10, 8, 20);
        ctx.fillStyle = 'rgba(160,190,210,0.16)';        // what is left of it
        ctx.fillRect(-14, -10, 3, 7);
        ctx.fillRect(4, 3, 3, 6);
        ctx.fillStyle = '#3a2317';                       // scorch over the roof
        ctx.fillRect(-6, -12, 10, 24);
        ctx.fillStyle = '#7a4a2e';                       // rust blooms
        for (const [rx, ry] of [[-26, -4], [12, 4], [-8, 7], [24, -6]]) ctx.fillRect(rx, ry, 4, 3);
        // wheels: two on, one off and lying by the door
        ctx.fillStyle = '#101014';
        ctx.fillRect(-26, 8, 12, 5); ctx.fillRect(14, 8, 12, 5);
        ctx.fillRect(-26, -13, 12, 5); ctx.fillRect(14, -13, 12, 5);
        ctx.fillStyle = '#2c2c34';
        ctx.fillRect(-23, 9, 6, 3); ctx.fillRect(17, 9, 6, 3);
        ctx.beginPath(); ctx.arc(30, 16, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3c3c46';
        ctx.beginPath(); ctx.arc(30, 16, 2.5, 0, TAU); ctx.fill();
        // the driver's door, torn open across the mud
        ctx.save();
        ctx.translate(-4, 10); ctx.rotate(0.9);
        ctx.fillStyle = '#5a3524';
        ctx.fillRect(0, 0, 4, 20);
        ctx.fillStyle = '#0e1116';
        ctx.fillRect(1, 3, 2, 8);
        ctx.restore();
        ctx.restore();
      }
    }
    // ---- tank: enlarged hull collision at tiles (61..67, 42..45) ----------
    {
      const x = 64.5 * T, y = 44 * T;
      if (this._vis(x, y, 120)) {
        ctx.save();
        ctx.fillStyle = 'rgba(52,40,27,0.9)';
        ctx.beginPath(); ctx.ellipse(x, y, 124, 62, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(36,28,19,0.7)';
        ctx.beginPath(); ctx.ellipse(x + 6, y + 4, 92, 44, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(30,24,16,0.5)';
        for (const [mx, my, mr] of [[-110, 28, 24], [100, 34, 20], [-86, -38, 17], [106, -28, 15], [-20, 56, 18]]) {
          ctx.beginPath(); ctx.ellipse(x + mx, y + my, mr, mr * 0.55, 0, 0, TAU); ctx.fill();
        }
        // the track it threw: a bent steel band in the mud beside it
        ctx.strokeStyle = '#1c1e22';
        ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(x - 100, y + 46); ctx.quadraticCurveTo(x - 52, y + 60, x + 4, y + 52); ctx.stroke();
        ctx.strokeStyle = '#33363c';
        ctx.lineWidth = 3;
        for (let i = 0; i < 9; i++) ctx.fillRect(x - 96 + i * 12, y + 48 + Math.sin(i) * 4, 4, 3);
        ctx.translate(x, y);
        ctx.rotate(0.10);
        ctx.scale(2, 2);                 // twice the tank, twice the mud around it
        ctx.fillStyle = '#14161a';                       // shadow
        ctx.beginPath(); ctx.ellipse(0, 4, 40, 18, 0, 0, TAU); ctx.fill();
        // tracks: the one still on, with its road wheels
        ctx.fillStyle = '#17191d';
        ctx.fillRect(-34, -18, 68, 9);
        ctx.fillRect(-34, 9, 68, 9);
        ctx.fillStyle = '#2b2e34';
        for (let i = 0; i < 6; i++) {
          ctx.beginPath(); ctx.arc(-28 + i * 11, -13.5, 3, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(-28 + i * 11, 13.5, 3, 0, TAU); ctx.fill();
        }
        // hull: sloped front, engine deck behind
        ctx.fillStyle = '#3f4a38';
        ctx.fillRect(-30, -10, 60, 20);
        ctx.fillStyle = '#4c5a44';
        ctx.fillRect(-30, -10, 60, 5);
        ctx.fillStyle = '#333d2e';
        ctx.fillRect(14, -8, 16, 16);
        ctx.fillStyle = '#2a3326';                       // front glacis
        ctx.beginPath(); ctx.moveTo(-30, -10); ctx.lineTo(-40, -4); ctx.lineTo(-40, 4); ctx.lineTo(-30, 10); ctx.closePath(); ctx.fill();
        // turret, turned off the axis, and the bent gun
        ctx.save();
        ctx.rotate(-0.24);
        ctx.fillStyle = '#46543e';
        ctx.beginPath(); ctx.ellipse(-2, 0, 15, 13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#526148';
        ctx.beginPath(); ctx.ellipse(-4, -2, 10, 8, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#2f382a';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-34, -6); ctx.lineTo(-40, -3); ctx.stroke();
        ctx.fillStyle = '#242c20';
        ctx.fillRect(-43, -5, 4, 5);
        ctx.restore();
        // the loader's hatch, open; rust and scorch over all of it
        ctx.fillStyle = '#1d241a';
        ctx.beginPath(); ctx.ellipse(6, -4, 5, 4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5a4a30';
        for (const [rx, ry] of [[-22, 4], [8, 6], [-10, -6], [20, -4]]) ctx.fillRect(rx, ry, 5, 3);
        ctx.fillStyle = 'rgba(20,16,12,0.55)';
        ctx.fillRect(-16, -10, 12, 20);
        ctx.restore();
      }
    }
  }

  drawCaches(ctx, markerOnly = false) {
    for (const c of this.map.cacheSpots ?? []) {
      if (c.taken || !this._vis(c.x, c.y, 40)) continue;
      ctx.save();
      if (!markerOnly) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(c.x - 11, c.y + 4, 22, 4);
        ctx.fillStyle = '#293b36';
        ctx.fillRect(c.x - 10, c.y - 8, 20, 14);
        ctx.fillStyle = '#607d67';
        ctx.fillRect(c.x - 10, c.y - 8, 20, 4);
        ctx.strokeStyle = '#d8c88d'; ctx.lineWidth = 1;
        ctx.strokeRect(c.x - 9.5, c.y - 7.5, 19, 13);
        ctx.fillStyle = '#c8b36c';
        ctx.fillRect(c.x - 8, c.y - 8, 2, 14);
        ctx.fillRect(c.x + 6, c.y - 8, 2, 14);
      } else {
        ctx.globalAlpha = 0.8 + Math.sin(this.time * 3 + c.x) * 0.15;
        ctx.fillStyle = '#f2e2a4';
        ctx.fillRect(c.x - 1, c.y - 5, 2, 8);
        ctx.fillRect(c.x - 4, c.y - 2, 8, 2);
        ctx.strokeStyle = '#d7c780'; ctx.lineWidth = 1;
        ctx.strokeRect(c.x - 11.5, c.y - 9.5, 23, 17);
      }
      ctx.restore();
    }
  }

  drawSupplies(ctx) {
    for (const s of this.supplies) {
      if (s.taken || (s.f ?? 0) !== this.map.floor) continue;
      if (!this._vis(s.x, s.y, 70)) continue;
      const falling = s.t < s.fall;
      const k = falling ? Math.min(1, s.t / s.fall) : 1;
      const y = s.y - (falling ? (1 - k) * 150 : 0);
      const sway = falling ? Math.sin(s.t * 3 + s.seed) * 8 * (1 - k) : 0;
      const x = s.x + sway;
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.3 * k})`;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, 10 * k, 4 * k, 0, 0, TAU); ctx.fill();
      if (falling) {
        ctx.fillStyle = '#c8c2ae';
        ctx.beginPath(); ctx.arc(x, y - 26, 18, Math.PI, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(200,194,174,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 24); ctx.lineTo(x, y - 5);
        ctx.moveTo(x + 14, y - 24); ctx.lineTo(x, y - 5);
        ctx.stroke();
      }
      ctx.fillStyle = '#4d5c43';
      ctx.fillRect(x - 9, y - 8, 18, 12);
      ctx.fillStyle = '#3a4634';
      ctx.fillRect(x - 9, y - 8, 18, 3);
      ctx.fillStyle = '#d8d4c0';
      ctx.fillRect(x - 2, y - 8, 4, 12);
      if (!falling && Math.sin(this.time * 5 + s.seed) > -0.2) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y - 12, 0, x, y - 12, 36);
        g.addColorStop(0, 'rgba(255,90,70,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y - 12, 36, 0, TAU); ctx.fill();
      }
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
      if (pu.dead) continue;
      if (this._vis(pu.x, pu.y, 40)) pu.draw(ctx);
    }
  }

  /** Cull helper: is this world point anywhere near the visible viewport? */
  _vis(x, y, pad = 60) {
    return x > this.cam.x - pad && y > this.cam.y - pad
      && x < this.cam.x + this.vw + pad && y < this.cam.y + this.vh + pad;
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
    const tx1 = Math.min(m.w - 1, Math.ceil((camX + this.vw) / T2));
    const ty1 = Math.min(m.h - 1, Math.ceil((camY + this.vh) / T2));
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

  /**
   * The weather you feel on the screen itself: the lightning flash, slanted
   * rain, droplets crawling down the glass, and the fog that eats the map
   * down to a circle around you. All of it screen-space, all of it cheap.
   */
  drawWeatherFx(ctx, vw, vh) {
    const W = this.wx;
    if (!W) return;
    if (W.flash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.5, W.flash * W.flash * 0.5);
      ctx.fillStyle = '#cfe0ff';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }
    if (W.kind === 'storm' && settings.get('weather') && this._perfStage < 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,215,240,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of W.drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.l * 0.35, d.y + d.l);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (W.wet > 0.03 && settings.get('weather')) {
      const sheet = wetSheet(vw, vh);
      ctx.save();
      ctx.globalAlpha = 0.14 * W.wet;
      ctx.drawImage(sheet, 0, 0);
      // three droplets that actually crawl
      ctx.globalAlpha = 0.3 * W.wet;
      ctx.strokeStyle = 'rgba(200,220,240,0.7)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const x = ((i * 271 + 90) % vw) + Math.sin(this.time * 0.3 + i * 2) * 6;
        const y0 = (((i * 173) % (vh / 2)) + (this.time * (12 + i * 5)) % (vh / 2)) | 0;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.quadraticCurveTo(x + 3, y0 + 24, x - 2, y0 + 52);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (W.kind === 'fog' && settings.get('weather')) {
      const camX = clamp(Math.round(this.cam.x), 0, Math.max(0, this.map.w * T - vw));
      const camY = clamp(Math.round(this.cam.y), 0, Math.max(0, this.map.h * T - vh));
      const px = clamp(this.player.pos.x - camX, 0, vw);
      const py = clamp(this.player.pos.y - camY, 0, vh);
      ctx.save();
      ctx.fillStyle = 'rgba(148,158,166,0.14)';
      ctx.fillRect(0, 0, vw, vh);
      const grd = ctx.createRadialGradient(px, py, 60, px, py, 430);
      grd.addColorStop(0, 'rgba(158,168,176,0)');
      grd.addColorStop(0.55, 'rgba(158,168,176,0.32)');
      grd.addColorStop(1, 'rgba(168,178,186,0.78)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }
  }

  drawWeather(ctx, camX, camY) {
    ctx.save();
    for (const l of this.weather.leaves) {
      const sx = l.x - camX, sy = l.y - camY;
      if (sx < -10 || sy < -10 || sx > this.vw + 10 || sy > this.vh + 10) continue;
      if (sx < -10 || sy < -10 || sx > this.vw + 10 || sy > this.vh + 10) continue;
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

  drawRangePads(ctx) {
    for (const pd of this.map.rangePads) {
      if (!this._vis(pd.x, pd.y, 60)) continue;
      const name = pd.pad
        ? (pd.pad === 'clear' ? 'CLEAR' : 'HOLD')
        : (ENEMY_TYPES[pd.type]?.name ?? pd.type);
      const col = pd.pad ? '#8fa0b0' : (ENEMY_TYPES[pd.type]?.colour ?? '#c46a4a');
      ctx.save();
      ctx.fillStyle = 'rgba(10,10,14,0.55)';
      ctx.fillRect(pd.x - 11, pd.y - 8, 22, 16);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.strokeRect(pd.x - 10.5, pd.y - 7.5, 21, 15);
      ctx.fillStyle = col;
      ctx.font = 'bold 6px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name.slice(0, 8).toUpperCase(), pd.x, pd.y + 2);
      ctx.restore();
    }
  }

  drawGrenadeCrates(ctx) {
    for (const g of this.map.grenadeCrates) {
      if (!this._vis(g.x, g.y, 50)) continue;
      ctx.save();
      if (g.kind === 'molotov') {
        // a crate of bottles with their rags up: fire, and it looks like fire
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(g.x - 8, g.y + 4, 16, 2);
        ctx.fillStyle = '#5a3a22';
        ctx.fillRect(g.x - 8, g.y - 4, 16, 8);
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(g.x - 8, g.y - 4, 16, 2);
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(g.x - 8, g.y - 1, 16, 1);
        for (const bx of [-5, 0, 5]) {
          ctx.fillStyle = '#7a3a2a';
          ctx.fillRect(g.x + bx - 1, g.y - 9, 3, 5);
          ctx.fillStyle = '#d0603c';
          ctx.fillRect(g.x + bx - 1, g.y - 11, 3, 2);
        }
        this._cratePrice(ctx, g);
        ctx.restore();
        continue;
      }
      if (g.kind === 'gas') {
        // grey-green canisters under a hazard band: slow, choke, crawl
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(g.x - 8, g.y + 4, 16, 2);
        ctx.fillStyle = '#37473a';
        ctx.fillRect(g.x - 8, g.y - 6, 16, 10);
        ctx.fillStyle = '#4a5c4a';
        ctx.fillRect(g.x - 8, g.y - 6, 16, 2);
        ctx.fillStyle = '#8ab06a';
        ctx.fillRect(g.x - 8, g.y - 2, 16, 2);
        ctx.fillStyle = '#20261f';
        ctx.fillRect(g.x - 5, g.y - 8, 3, 2);
        ctx.fillRect(g.x + 2, g.y - 8, 3, 2);
        this._cratePrice(ctx, g);
        ctx.restore();
        continue;
      }
      // two stacked metal ammo cans with a stencilled band -- ammunition,
      // not the mystery crate: the silhouette must not invite the confusion
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(g.x - 8, g.y + 4, 16, 2);
      ctx.fillStyle = '#43503a';
      ctx.fillRect(g.x - 8, g.y - 1, 16, 6);           // bottom can
      ctx.fillStyle = '#4d5c42';
      ctx.fillRect(g.x - 6, g.y - 7, 12, 6);           // top can
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(g.x - 8, g.y - 1, 16, 1);
      ctx.fillRect(g.x - 6, g.y - 7, 12, 1);
      ctx.fillStyle = '#2c3527';                        // handles
      ctx.fillRect(g.x - 3, g.y - 9, 6, 2);
      ctx.fillStyle = '#d8d4c0';                        // stencil band
      ctx.fillRect(g.x - 8, g.y + 1, 16, 2);
      ctx.fillStyle = '#43503a';
      ctx.fillRect(g.x - 2, g.y + 1, 4, 2);             // stencil gap
      this._cratePrice(ctx, g);
      ctx.restore();
    }
  }

  /** The price tag under a throwable crate, in whichever state the wallet is. */
  _cratePrice(ctx, g) {
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.points >= GRENADE_PRICE ? '#f0d98a' : '#6f6a5c';
    ctx.fillText(`${GRENADE_PRICE}`, g.x, g.y + 13);
  }
}
