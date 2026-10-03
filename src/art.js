// Rendering helpers: builds pixel-art canvases from the ASCII data in
// spriteData.js and paints the static level into one big offscreen canvas.
import {
  PAL, PLAYER_UPPER, PLAYER_LEGS, ZOMBIE_UPPER, ZOMBIE_UPPER_ATTACK, ZOMBIE_LEGS,
  GUNS, GRENADE_SPRITE, PLAQUE_ART,
} from './spriteData.js';
import { makeRng } from './util.js';

export const T = 24;                 // tile size in world pixels
export const SPRITE_W = 20;
export const SPRITE_H = 22;
export const BODY_ROW = 13;          // sprite row that sits on the entity origin
export const HEAD_ROW = 6;           // sprite row of the head centre

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return { canvas: c, ctx: x };
}

/** Build a canvas from ASCII rows + palette. */
export function buildSprite(rows, w, h) {
  const { canvas, ctx } = makeCanvas(w, h);
  for (let y = 0; y < rows.length; y++) {
    const line = rows[y];
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === '.' || ch === ' ') continue;
      const col = PAL[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

function flipH(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/** Tint a sprite a single flat colour (used for hit flashes / silhouettes). */
export function flatCopy(src, colour) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, src.width, src.height);
  return canvas;
}

function frames(upper, legs) {
  return legs.map((l) => buildSprite(upper.concat(l), SPRITE_W, SPRITE_H));
}

// ---------------------------------------------------------------------------
//  Parametric gun builder -- every weapon is drawn pointing east, 9px tall,
//  with its grip at `pivot`. Keeps 15 weapons consistent and cheap.
// ---------------------------------------------------------------------------
const GUN_METAL = ['#3b3d44', '#6d6f79', '#9a9ba4'];   // dark / mid / light
const GUN_WOOD = ['#3f2a17', '#6a4a2a', '#8a6338'];

function gunCanvas(w, h) { return makeCanvas(w, h); }

export function buildGun(spec) {
  const {
    len = 18, stock = 'wood', stockLen = 5, mag = 'box', magLen = 3,
    metal = GUN_METAL, wood = GUN_WOOD, accent = null,
    barrel = 'thin', muzzle = 'none', height = 9,
  } = spec;
  const H = height;
  const mid = (H - 1) >> 1;              // centre row of the weapon
  const { canvas, ctx } = gunCanvas(len, H);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  const ARM_X0 = 0, HAND_X = 4;
  // arm + hand (always the same so the pose stays consistent)
  px(ARM_X0 + 1, mid - 3, '#43492f', 1, 1);
  px(ARM_X0 + 0, mid - 2, '#43492f', 5, 1);
  px(ARM_X0 + 0, mid - 1, '#5a6142', 5, 3);
  px(ARM_X0 + 1, mid + 2, '#43492f', 4, 1);
  px(HAND_X, mid - 1, '#c39a72', 2, 2);
  px(HAND_X, mid + 1, '#9a7554', 2, 1);

  const bodyX0 = HAND_X + 2;
  const stockEnd = bodyX0 + (stock === 'none' ? 0 : stockLen);
  const recvEnd = Math.min(len - 1, stockEnd + Math.max(3, Math.round((len - stockEnd) * 0.42)));

  // stock
  if (stock === 'wood') {
    px(bodyX0, mid - 1, wood[1], stockLen, 3);
    px(bodyX0, mid - 1, wood[2], stockLen, 1);
    px(bodyX0, mid + 1, wood[0], stockLen, 1);
  } else if (stock === 'wire') {
    px(bodyX0, mid, metal[0], stockLen, 1);
    px(bodyX0, mid + 1, metal[0], stockLen, 1);
    px(bodyX0 + 1, mid - 1, metal[0], 1, 1);
  } else if (stock === 'tank') {
    px(bodyX0, mid - 2, accent ?? metal[1], stockLen, 5);
    px(bodyX0, mid - 2, '#ffffff33', stockLen, 1);
  }
  // receiver
  px(stockEnd, mid - 2, metal[1], recvEnd - stockEnd, 5);
  px(stockEnd, mid - 2, metal[2], recvEnd - stockEnd, 1);
  px(stockEnd, mid + 2, metal[0], recvEnd - stockEnd, 1);
  px(recvEnd - 1, mid - 2, metal[0], 1, 5);
  // sight
  px(stockEnd + 1, mid - 3, metal[0], 1, 1);
  px(recvEnd - 2, mid - 3, metal[0], 1, 1);
  // barrel
  if (barrel === 'thin') {
    px(recvEnd, mid, metal[0], len - recvEnd, 1);
    px(recvEnd, mid - 1, metal[1], len - recvEnd - 2, 1);
  } else if (barrel === 'thick') {
    px(recvEnd, mid - 1, metal[0], len - recvEnd, 3);
    px(recvEnd, mid - 1, metal[1], len - recvEnd, 1);
  } else if (barrel === 'shroud') {
    px(recvEnd, mid - 2, metal[0], len - recvEnd, 5);
    px(recvEnd, mid - 1, metal[1], len - recvEnd, 1);
    for (let x = recvEnd + 2; x < len; x += 3) px(x, mid - 2, metal[0], 1, 5);
  }
  // magazine
  if (mag === 'box') {
    const mx = stockEnd + 1;
    px(mx, mid + 3, metal[0], magLen, 3);
    px(mx, mid + 3, metal[1], 1, 3);
  } else if (mag === 'drum') {
    const mx = stockEnd;
    px(mx, mid + 3, metal[0], magLen + 1, 3);
    px(mx + 1, mid + 2, metal[1], magLen - 1, 1);
    px(mx, mid + 5, metal[2], magLen + 1, 1);
  } else if (mag === 'belt') {
    px(stockEnd + 1, mid + 3, '#7a6a3a', magLen, 2);
    for (let x = stockEnd + 1; x < stockEnd + 1 + magLen; x += 2) px(x, mid + 3, '#b99542', 1, 2);
  } else if (mag === 'tank') {
    px(stockEnd, mid + 3, accent ?? '#5a7a3a', magLen, 3);
    px(stockEnd, mid + 3, '#ffffff33', magLen, 1);
  }
  // muzzle device
  const last = len - 1;
  if (muzzle === 'cone') {
    px(last - 2, mid - 2, accent ?? metal[1], 3, 5);
    px(last - 1, mid - 1, '#1b1c20', 2, 3);
  } else if (muzzle === 'coil') {
    for (let i = 0; i < 3; i++) px(last - 4 + i * 2, mid - 2, accent ?? '#7fd0a0', 1, 5);
  } else if (muzzle === 'prongs') {
    px(last - 1, mid - 3, accent ?? metal[2], 2, 1);
    px(last - 1, mid + 3, accent ?? metal[2], 2, 1);
    px(last - 1, mid - 1, accent ?? metal[2], 1, 3);
  } else if (muzzle === 'brake') {
    px(last - 3, mid - 2, metal[0], 4, 5);
    px(last - 3, mid, '#1b1c20', 4, 1);
  }
  return canvas;
}

// Per-weapon silhouettes. `pivot` is the grip in the sprite, `muzzle` the tip
// of the barrel -- both relative to the sprite's top-left corner.
export const GUN_SPECS = {
  m1911:      { len: 13, stock: 'none', mag: 'box',  magLen: 2, barrel: 'thin',   muzzle: 'none' },
  mp40:       { len: 18, stock: 'wire', mag: 'box',  magLen: 3, barrel: 'thin',   muzzle: 'none' },
  thompson:   { len: 20, stock: 'wood', stockLen: 6, mag: 'drum', magLen: 4, barrel: 'shroud', muzzle: 'brake' },
  trenchgun:  { len: 19, stock: 'wood', stockLen: 6, mag: 'none', barrel: 'shroud', muzzle: 'none' },
  ppsh:       { len: 21, stock: 'wood', stockLen: 5, mag: 'drum', magLen: 4, barrel: 'shroud', muzzle: 'none' },
  kar98k:     { len: 25, stock: 'wood', stockLen: 6, mag: 'none', barrel: 'thin',   muzzle: 'none' },
  fg42:       { len: 24, stock: 'wood', stockLen: 4, mag: 'box',  magLen: 4, barrel: 'thin',   muzzle: 'prongs' },
  bar:        { len: 23, stock: 'wood', stockLen: 5, mag: 'box',  magLen: 4, barrel: 'thick',  muzzle: 'brake' },
  mg42:       { len: 27, stock: 'wood', stockLen: 5, mag: 'belt', magLen: 6, barrel: 'shroud', muzzle: 'brake' },
  ptrs41:     { len: 31, stock: 'wood', stockLen: 6, mag: 'box',  magLen: 4, barrel: 'thin',   muzzle: 'brake' },
  raygun:     { len: 17, stock: 'tank', stockLen: 5, mag: 'tank', magLen: 3, barrel: 'none', muzzle: 'cone', accent: '#7fd75a' },
  wunderwaffe:{ len: 23, stock: 'tank', stockLen: 6, mag: 'tank', magLen: 4, barrel: 'none', muzzle: 'coil', accent: '#8fd6ff' },
  thundergun: { len: 21, stock: 'tank', stockLen: 6, mag: 'tank', magLen: 4, barrel: 'none', muzzle: 'cone', accent: '#f0a03c' },
  winterhowl: { len: 22, stock: 'tank', stockLen: 6, mag: 'tank', magLen: 4, barrel: 'none', muzzle: 'prongs', accent: '#7fe6ff' },
};

function buildMonkeyBomb() {
  const { canvas, ctx } = makeCanvas(11, 11);
  const b = '#6b4a2a', B = '#45301c', w = '#c99a63', k = '#1b1512', g = '#b9b06a';
  const px = (x, y, c, ww = 1, hh = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, ww, hh); };
  px(3, 1, b, 5, 1);                 // head top
  px(2, 2, b, 7, 1);
  px(1, 3, B, 1, 3); px(9, 3, B, 1, 3);   // ears
  px(2, 3, w, 7, 1);
  px(2, 4, w, 7, 1); px(3, 4, k, 1, 1); px(7, 4, k, 1, 1);
  px(3, 5, w, 5, 1); px(4, 5, k, 1, 1); px(6, 5, k, 1, 1);
  px(3, 6, w, 5, 1);
  px(3, 7, b, 5, 1);
  px(2, 8, b, 7, 1);                 // shoulders
  px(2, 9, B, 2, 2); px(7, 9, B, 2, 2);   // arms
  px(4, 9, g, 3, 1);                 // wind-up key
  px(4, 10, B, 3, 1);
  return canvas;
}

/** Overlay a flat colour over a sprite, keeping its alpha (for enemy variants). */
export function tintCopy(src, colour, amount = 0.35) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = amount;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, src.width, src.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function buildDog() {
  const W = 18, H = 12;
  const { canvas, ctx } = makeCanvas(W, H);
  const D = '#2a2119';   // dark fur
  const M = '#4a3a28';   // mid fur
  const L = '#6b5439';   // light fur
  const E = '#8c2a20';   // eye glow
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // legs first so the body covers their tops (3px stubs, not stilts)
  for (const [lx, ly] of [[7, 1], [7, 9], [12, 1], [12, 9]]) px(lx, ly, D, 2, 3);
  // tail sweeping off to the left
  px(3, 4, D, 3, 1); px(1, 3, D, 3, 1);
  // body
  px(5, 3, M, 9, 6);
  px(5, 3, L, 9, 1);
  px(5, 8, D, 9, 1);
  px(6, 4, D, 3, 2);            // haunch shading
  px(4, 4, D, 2, 4);            // rear
  // neck + head
  px(12, 3, M, 4, 6);
  px(12, 3, L, 4, 1);
  px(15, 4, M, 3, 4);           // snout
  px(17, 5, D, 1, 2);
  px(17, 5, '#1a1410', 1, 1);   // nose
  px(11, 2, D, 2, 2);           // ears
  px(14, 2, D, 2, 2);
  px(15, 4, E, 1, 1);           // eyes
  px(12, 4, E, 1, 1);
  return canvas;
}

/** Crawler: the zombie sprite chopped down to a dragging torso + arms. */
function buildCrawler(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  // draw only the lower two thirds, squashed, so it reads as "dragging itself"
  const cut = Math.round(src.height * 0.24);
  const h = src.height - cut;
  ctx.drawImage(src, 0, cut, src.width, h, 0, src.height - h, src.width, h);
  // reaching arms
  ctx.fillStyle = '#4c6b3a';
  ctx.fillRect(1, src.height - h + 3, 4, 2);
  ctx.fillRect(src.width - 5, src.height - h + 4, 4, 2);
  ctx.fillStyle = '#3b5430';
  ctx.fillRect(1, src.height - h + 5, 3, 1);
  ctx.fillRect(src.width - 4, src.height - h + 6, 3, 1);
  return canvas;
}

let cache = null;

export function buildArt() {
  if (cache) return cache;

  const player = frames(PLAYER_UPPER, PLAYER_LEGS);
  const zombie = frames(ZOMBIE_UPPER, ZOMBIE_LEGS);
  const zombieAtk = frames(ZOMBIE_UPPER_ATTACK, ZOMBIE_LEGS);

  const guns = {};
  for (const [id, spec] of Object.entries(GUN_SPECS)) {
    const h = spec.height ?? 9;
    const mid = (h - 1) >> 1;
    guns[id] = {
      img: buildGun(spec),
      flip: null,
      pivot: { x: 2, y: mid },
      muzzle: { x: spec.len, y: mid },
    };
    guns[id].flip = flipH(guns[id].img);
  }
  guns.monkeybomb = {
    img: buildMonkeyBomb(),
    flip: null,
    pivot: { x: 5, y: 5 },
    muzzle: { x: 9, y: 5 },
  };
  guns.monkeybomb.flip = flipH(guns.monkeybomb.img);

  const plaques = {};
  for (const [id, rows] of Object.entries(PLAQUE_ART)) {
    plaques[id] = buildSprite(rows, rows[0].length, rows.length);
  }

  cache = {
    player,
    playerFlip: player.map(flipH),
    zombie,
    zombieFlip: zombie.map(flipH),
    zombieAtk,
    zombieAtkFlip: zombieAtk.map(flipH),
    dog: buildDog(),
    dogFlip: flipH(buildDog()),
    // enemy variants: pale/angry runners, slab-grey brutes
    zombieRunner: zombie.map((c) => tintCopy(c, '#c86a5a', 0.42)),
    zombieRunnerFlip: zombie.map((c) => tintCopy(flipH(c), '#c86a5a', 0.42)),
    zombieRunnerAtk: zombieAtk.map((c) => tintCopy(c, '#c86a5a', 0.42)),
    zombieRunnerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#c86a5a', 0.42)),
    zombieBrute: zombie.map((c) => tintCopy(c, '#6b7a6a', 0.50)),
    // helmeted: steel pot over the skull, heavy coat
    helmet: zombie.map((c) => tintCopy(c, '#7c8a94', 0.42)),
    helmetFlip: zombie.map((c) => tintCopy(flipH(c), '#7c8a94', 0.42)),
    helmetAtk: zombieAtk.map((c) => tintCopy(c, '#7c8a94', 0.42)),
    helmetAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#7c8a94', 0.42)),
    // napalm: charred, glowing from the inside
    napalm: zombie.map((c) => tintCopy(c, '#c4461c', 0.62)),
    napalmFlip: zombie.map((c) => tintCopy(flipH(c), '#c4461c', 0.62)),
    napalmAtk: zombieAtk.map((c) => tintCopy(c, '#c4461c', 0.62)),
    napalmAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#c4461c', 0.62)),
    // gasbag: bloated and sickly green
    gasbag: zombie.map((c) => tintCopy(c, '#79c04a', 0.58)),
    gasbagFlip: zombie.map((c) => tintCopy(flipH(c), '#79c04a', 0.58)),
    gasbagAtk: zombieAtk.map((c) => tintCopy(c, '#79c04a', 0.58)),
    gasbagAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#79c04a', 0.58)),
    // crawlers: the lower half of each walk frame, dragging
    crawler: zombie.map(buildCrawler),
    crawlerFlip: zombie.map((c) => buildCrawler(flipH(c))),
    // shriekers: pale wretches with their mouths stuck open
    shrieker: zombie.map((c) => tintCopy(c, '#b9a0d0', 0.55)),
    shriekerFlip: zombie.map((c) => tintCopy(flipH(c), '#b9a0d0', 0.55)),
    shriekerAtk: zombieAtk.map((c) => tintCopy(c, '#b9a0d0', 0.55)),
    shriekerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#b9a0d0', 0.55)),
    zombieBruteFlip: zombie.map((c) => tintCopy(flipH(c), '#6b7a6a', 0.50)),
    zombieBruteAtk: zombieAtk.map((c) => tintCopy(c, '#6b7a6a', 0.50)),
    zombieBruteAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#6b7a6a', 0.50)),
    dogWhite: flatCopy(buildDog(), '#ffd9d9'),
    playerWhite: player.map((c) => flatCopy(c, '#ffffff')),
    playerWhiteFlip: player.map((c) => flatCopy(flipH(c), '#ffffff')),
    zombieWhite: zombie.map((c) => flatCopy(c, '#ffe9e9')),
    zombieWhiteFlip: zombie.map((c) => flatCopy(flipH(c), '#ffe9e9')),
    guns,
    plaques,
    monkeybomb: guns.monkeybomb.img,
    grenade: buildSprite(GRENADE_SPRITE.rows, GRENADE_SPRITE.w, GRENADE_SPRITE.h),
  };
  return cache;
}

// ---------------------------------------------------------------------------
//  Level painting
// ---------------------------------------------------------------------------

export const TILE = {
  EXTERIOR: 0,
  FLOOR: 1,
  WALL: 2,
  WINDOW: 3,
  DOOR: 4,
  CRATE: 5,
  RUBBLE: 6,
  TREE: 7,
  FENCE: 8,
  VEHICLE: 9,
  STAIR: 10,
  SECRET_DOOR: 11,
};

const C = {
  floorA: '#2c2d33',
  floorB: '#292a2f',
  floorC: '#303138',
  floorLine: 'rgba(0,0,0,0.28)',
  // walls are clearly lighter than the concrete so they read as raised blocks
  wallSide: '#474b55',
  wallSide2: '#41454e',
  wallTop: '#5b606b',
  wallTopDim: '#4f545e',
  wallTopLit: '#6a6f7b',
  wallDark: '#24262d',
  wallEdge: '#15171c',
  dirtA: '#26261f',
  dirtB: '#21211b',
  dirtC: '#2c2c23',
  grass: '#2c3424',
  grass2: '#333c2b',
  stone: '#3a3b38',
};

function speckle(ctx, px, py, n, rng, dark = 0.16, light = 0.05) {
  for (let i = 0; i < n; i++) {
    const x = px + ((rng() * T) | 0);
    const y = py + ((rng() * T) | 0);
    ctx.fillStyle = rng() < 0.55 ? `rgba(0,0,0,${dark * rng()})` : `rgba(255,255,255,${light * rng()})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function paintFloor(ctx, px, py, rng, northIsWall) {
  const base = rng() < 0.34 ? C.floorA : rng() < 0.5 ? C.floorB : C.floorC;
  ctx.fillStyle = base;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 16, rng);

  // concrete slab seams
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(px, py, T, 1);
  ctx.fillRect(px, py, 1, T);

  // a few cracks / chips
  if (rng() < 0.22) {
    let x = px + 2 + ((rng() * (T - 4)) | 0);
    let y = py + 2 + ((rng() * (T - 4)) | 0);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let i = 0; i < 5 + ((rng() * 6) | 0); i++) {
      ctx.fillRect(x, y, 1, 1);
      x += rng() < 0.5 ? 1 : rng() < 0.5 ? 0 : -1;
      y += rng() < 0.5 ? 1 : 0;
      if (x < px || y < py || x > px + T - 1 || y > py + T - 1) break;
    }
  }
  if (rng() < 0.1) {
    ctx.fillStyle = 'rgba(20,14,12,0.30)';
    ctx.beginPath();
    ctx.ellipse(px + rng() * T, py + rng() * T, 2 + rng() * 4, 1 + rng() * 3, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // contact shadow cast by a wall to the north
  if (northIsWall) {
    const g = ctx.createLinearGradient(0, py, 0, py + 7);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, T, 7);
  }
}

function paintExterior(ctx, px, py, rng) {
  const base = rng() < 0.4 ? C.dirtA : rng() < 0.6 ? C.dirtB : C.dirtC;
  ctx.fillStyle = base;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 14, rng, 0.2, 0.04);

  // dead grass tufts
  const tufts = (rng() * 5) | 0;
  for (let i = 0; i < tufts; i++) {
    const x = px + ((rng() * T) | 0);
    const y = py + ((rng() * T) | 0);
    ctx.fillStyle = rng() < 0.5 ? C.grass : C.grass2;
    ctx.fillRect(x, y, 1, 2);
    ctx.fillRect(x - 1, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }
  if (rng() < 0.14) {
    ctx.fillStyle = C.stone;
    ctx.fillRect(px + ((rng() * (T - 4)) | 0), py + ((rng() * (T - 3)) | 0), 2 + ((rng() * 3) | 0), 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(px + ((rng() * (T - 4)) | 0), py + ((rng() * (T - 3)) | 0), 2, 1);
  }
}

function paintWall(ctx, px, py, rng, n) {
  ctx.fillStyle = rng() < 0.5 ? C.wallSide : C.wallSide2;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 10, rng, 0.22, 0.035);

  // brick courses
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 4; y < T; y += 6) ctx.fillRect(px, py + y, T, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  const off = ((px / T) | 0) % 2 ? 0 : 6;
  for (let y = 4; y < T; y += 6) {
    for (let x = off; x < T; x += 12) ctx.fillRect(px + x, py + y, 1, 6);
  }

  // top face -- full height when the north side is exposed, thinner when the
  // block is buried inside a wall run (otherwise interior partitions vanish)
  const exposed = !n.n;
  const faceH = exposed ? 5 : 3;
  ctx.fillStyle = exposed ? C.wallTop : C.wallTopDim;
  ctx.fillRect(px, py, T, faceH);
  if (exposed) {
    ctx.fillStyle = C.wallTopLit;
    ctx.fillRect(px, py, T, 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px, py + faceH, T, 1);
  speckle(ctx, px, py, 4, rng, 0.18, 0.06);
  // sides
  if (!n.w) { ctx.fillStyle = C.wallDark; ctx.fillRect(px, py, 1, T); }
  if (!n.e) { ctx.fillStyle = C.wallDark; ctx.fillRect(px + T - 1, py, 1, T); }
  if (!n.s) {
    ctx.fillStyle = C.wallEdge;
    ctx.fillRect(px, py + T - 2, T, 2);
  }
}

function paintCrate(ctx, px, py, rng, n) {
  paintFloor(ctx, px, py, rng, false);
  const x = px + 2, y = py + 1, w = T - 4, h = T - 3;
  ctx.fillStyle = '#4a3620';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6b5233';
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = '#82653f';
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  // plank lines on the top face
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 1; i < 3; i++) ctx.fillRect(x, y + i * 2, w, 1);
  // diagonal brace on the side
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < h - 5; i++) ctx.fillRect(x + 2 + i, y + 6 + i, 2, 1);
  speckle(ctx, x, y, 8, rng, 0.25, 0.05);
  if (n.s) {
    const g = ctx.createLinearGradient(0, py + T - 4, 0, py + T);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py + T - 4, T, 4);
  }
}

function paintTree(ctx, px, py, rng) {
  paintExterior(ctx, px, py, rng);
  const cx = px + T / 2 + ((rng() * 5) | 0) - 2;
  const cy = py + T / 2 + ((rng() * 5) | 0) - 2;
  const r = 8 + ((rng() * 4) | 0);
  // canopy: dark base, lighter crown offset up-left, a few needle clumps
  ctx.fillStyle = '#131b10';
  ctx.beginPath(); ctx.arc(cx + 1, cy + 2, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2414';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#23301b';
  ctx.beginPath(); ctx.arc(cx - 1.5, cy - 2, r * 0.72, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b3a21';
  ctx.beginPath(); ctx.arc(cx - 3, cy - 4, r * 0.42, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2, d = rng() * r * 0.95;
    ctx.fillStyle = rng() < 0.5 ? '#35482a' : '#111a0d';
    ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 1);
  }
}

function paintFence(ctx, px, py, rng) {
  paintExterior(ctx, px, py, rng);
  // two rails + pickets; deliberately low so you can see and shoot over it
  ctx.fillStyle = '#20242a';
  ctx.fillRect(px, py + 6, T, 2);
  ctx.fillRect(px, py + 14, T, 2);
  for (let i = 0; i < 4; i++) {
    const x = px + 2 + i * 6;
    ctx.fillStyle = '#4a4640';
    ctx.fillRect(x, py + 3, 2, 17);
    ctx.fillStyle = '#5d584f';
    ctx.fillRect(x, py + 3, 1, 17);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 2, py + 4, 1, 16);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(px, py + 19, T, 2);
}

function paintVehicle(ctx, px, py, rng) {
  paintExterior(ctx, px, py, rng);
  // rusted flatbed: body, cab hint, broken wheels
  ctx.fillStyle = '#3d3a33';
  ctx.fillRect(px + 1, py + 2, T - 2, T - 5);
  ctx.fillStyle = '#4a463c';
  ctx.fillRect(px + 1, py + 2, T - 2, 3);
  ctx.fillStyle = '#2b2924';
  ctx.fillRect(px + 1, py + T - 6, T - 2, 3);
  ctx.fillStyle = '#5a4a30';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(px + 2 + ((rng() * (T - 5)) | 0), py + 3 + ((rng() * (T - 9)) | 0), 2, 2);
  }
  ctx.fillStyle = '#17181a';
  ctx.fillRect(px + 2, py + 1, 5, T - 3);
  ctx.fillRect(px + T - 8, py + 1, 6, T - 3);
  ctx.fillStyle = '#0f1012';
  ctx.fillRect(px + 3, py + 4, 3, 5);   // shattered windscreen
  ctx.fillStyle = 'rgba(120,140,160,0.25)';
  ctx.fillRect(px + 4, py + 5, 2, 3);
}

function paintStair(ctx, px, py, rng) {
  ctx.fillStyle = '#191b20';
  ctx.fillRect(px, py, T, T);
  // treads receding into the dark
  for (let i = 0; i < 6; i++) {
    const y = py + 2 + i * 3;
    ctx.fillStyle = `rgba(${110 - i * 12},${112 - i * 12},${120 - i * 12},1)`;
    ctx.fillRect(px + 3, y, T - 6, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + 3, y + 2, T - 6, 1);
  }
  ctx.strokeStyle = 'rgba(200,190,160,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);
  ctx.fillStyle = 'rgba(230,220,180,0.55)';
  ctx.fillRect(px + T / 2 - 1, py + 3, 2, T - 8);
  ctx.fillRect(px + T / 2 - 3, py + T - 7, 6, 2);
}

function paintSecretDoor(ctx, px, py, rng) {
  // a bricked-up archway -- the mortar is slightly off, if you look closely
  ctx.fillStyle = '#33353c';
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 14, rng, 0.25, 0.05);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let y = 0; y < T; y += 5) ctx.fillRect(px, py + y, T, 1);
  const off = ((px / T) | 0) % 2 ? 0 : 6;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < T; y += 5) for (let x = off; x < T; x += 12) ctx.fillRect(px + x, py + y, 1, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(px + T / 2 - 1, py + 3, 1, T - 6);
  ctx.fillStyle = 'rgba(150,140,110,0.20)';
  ctx.fillRect(px + T / 2 - 3, py + T / 2 - 1, 7, 2);
}

function paintRubble(ctx, px, py, rng) {
  paintFloor(ctx, px, py, rng, false);
  for (let i = 0; i < 6; i++) {
    const x = px + 3 + ((rng() * (T - 7)) | 0);
    const y = py + 3 + ((rng() * (T - 7)) | 0);
    const s = 1 + ((rng() * 3) | 0);
    ctx.fillStyle = rng() < 0.5 ? '#4b4c46' : '#3a3b36';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, s, 1);
  }
}

/**
 * Paints every static tile into one canvas the size of the whole level.
 * `tiles` is a flat Uint8Array of TILE.* values, `w`/`h` the level dimensions.
 */
let _levelCache = null;

export function paintLevel(tiles, w, h, seed = 1337) {
  if (_levelCache && _levelCache.w === w && _levelCache.h === h && _levelCache.seed === seed) {
    return _levelCache.canvas;
  }
  const { canvas, ctx } = makeCanvas(w * T, h * T);
  const rng = makeRng(seed);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? TILE.WALL : tiles[y * w + x]);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = tiles[i];
      const px = x * T, py = y * T;
      // deterministic per-tile rng so repaints are stable
      const trng = makeRng(seed + i * 2654435761);
      if (t === TILE.WALL) {
        paintWall(ctx, px, py, trng, {
          n: at(x, y - 1) === TILE.WALL, s: at(x, y + 1) === TILE.WALL,
          w: at(x - 1, y) === TILE.WALL, e: at(x + 1, y) === TILE.WALL,
        });
      } else if (t === TILE.TREE) {
        paintTree(ctx, px, py, trng);
      } else if (t === TILE.FENCE) {
        paintFence(ctx, px, py, trng);
      } else if (t === TILE.VEHICLE) {
        paintVehicle(ctx, px, py, trng);
      } else if (t === TILE.STAIR) {
        paintStair(ctx, px, py, trng);
      } else if (t === TILE.SECRET_DOOR) {
        paintSecretDoor(ctx, px, py, trng);
      } else if (t === TILE.EXTERIOR) {
        paintExterior(ctx, px, py, trng);
      } else {
        paintFloor(ctx, px, py, trng, at(x, y - 1) === TILE.WALL);
        if (t === TILE.CRATE) paintCrate(ctx, px, py, trng, { s: at(x, y + 1) === TILE.WALL });
        else if (t === TILE.RUBBLE) paintRubble(ctx, px, py, trng);
      }
    }
  }
  _levelCache = { canvas, w, h, seed };
  return canvas;
}
