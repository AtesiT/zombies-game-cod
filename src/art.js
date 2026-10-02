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

let cache = null;

export function buildArt() {
  if (cache) return cache;

  const player = frames(PLAYER_UPPER, PLAYER_LEGS);
  const zombie = frames(ZOMBIE_UPPER, ZOMBIE_LEGS);
  const zombieAtk = frames(ZOMBIE_UPPER_ATTACK, ZOMBIE_LEGS);

  const guns = {};
  for (const [id, g] of Object.entries(GUNS)) {
    guns[id] = {
      img: buildSprite(g.rows, g.w, g.h),
      flip: null,
      pivot: g.pivot,
      muzzle: g.muzzle,
    };
    guns[id].flip = flipH(guns[id].img);
  }

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
    playerWhite: player.map((c) => flatCopy(c, '#ffffff')),
    playerWhiteFlip: player.map((c) => flatCopy(flipH(c), '#ffffff')),
    zombieWhite: zombie.map((c) => flatCopy(c, '#ffe9e9')),
    zombieWhiteFlip: zombie.map((c) => flatCopy(flipH(c), '#ffe9e9')),
    guns,
    plaques,
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
