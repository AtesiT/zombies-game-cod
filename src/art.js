// Rendering helpers: builds pixel-art canvases from the ASCII data in
// spriteData.js and paints the static level into one big offscreen canvas.
import {
  PAL, PLAYER_UPPER, PLAYER_LEGS, ZOMBIE_UPPER, ZOMBIE_UPPER_ATTACK, ZOMBIE_LEGS,
  GUNS, GRENADE_SPRITE, PLAQUE_ART,
} from './spriteData.js';
import { SKINS } from './skins.js';
import { makeRng, TAU } from './util.js';

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

/**
 * Build a canvas from ASCII rows + palette.
 *
 * `over` swaps individual palette keys for one build -- that is how ten
 * outfits come out of a single drawing: the cut of the uniform never changes,
 * only the cloth it is cut from. Keys it does not mention keep the stock
 * colour, so a skin that only wants a different helmet cannot accidentally
 * turn the soldier's face green.
 */
export function buildSprite(rows, w, h, over = null) {
  const { canvas, ctx } = makeCanvas(w, h);
  for (let y = 0; y < rows.length; y++) {
    const line = rows[y];
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === '.' || ch === ' ') continue;
      const col = (over && over[ch]) || PAL[ch];
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

function frames(upper, legs, pal = null) {
  return legs.map((l) => buildSprite(upper.concat(l), SPRITE_W, SPRITE_H, pal));
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
  // ---- the second wave ----
  python:     { len: 13, stock: 'wood', stockLen: 3, mag: 'box',  magLen: 2, barrel: 'thin',   muzzle: 'none' },
  sten:       { len: 19, stock: 'wire', stockLen: 5, mag: 'box',  magLen: 3, barrel: 'thin',   muzzle: 'none' },
  greasegun:  { len: 18, stock: 'wire', stockLen: 5, mag: 'box',  magLen: 3, barrel: 'shroud', muzzle: 'none' },
  garand:     { len: 24, stock: 'wood', stockLen: 6, mag: 'none', magLen: 0, barrel: 'thin',   muzzle: 'none' },
  stg44:      { len: 23, stock: 'wood', stockLen: 5, mag: 'box',  magLen: 4, barrel: 'thin',   muzzle: 'brake' },
  sawedoff:   { len: 14, stock: 'wood', stockLen: 4, mag: 'none', magLen: 0, barrel: 'thick',  muzzle: 'none' },
  gewehr43:   { len: 25, stock: 'wood', stockLen: 6, mag: 'box',  magLen: 2, barrel: 'thin',   muzzle: 'none' },
  lewis:      { len: 26, stock: 'wood', stockLen: 5, mag: 'drum', magLen: 5, barrel: 'shroud', muzzle: 'none' },
  // ---- the third wave ----
  lever:      { len: 22, stock: 'wood', stockLen: 6, mag: 'none', magLen: 0, barrel: 'thick',  muzzle: 'none' },
  bulldog:    { len: 17, stock: 'wood', stockLen: 5, mag: 'none', magLen: 0, barrel: 'thick',  muzzle: 'none' },
  osa:        { len: 12, stock: 'none', mag: 'box',  magLen: 2, barrel: 'thin',   muzzle: 'none' },
  molot:      { len: 19, stock: 'wood', stockLen: 4, mag: 'box',  magLen: 4, barrel: 'thick',  muzzle: 'brake' },
  trenchpipe: { len: 24, stock: 'wood', stockLen: 5, mag: 'none', magLen: 0, barrel: 'thick',  muzzle: 'cone' },
  flamer:     { len: 20, stock: 'tank', stockLen: 5, mag: 'tank', magLen: 4, barrel: 'thick',  muzzle: 'cone', accent: '#f08030' },
  stormbow:   { len: 24, stock: 'wood', stockLen: 5, mag: 'none', magLen: 0, barrel: 'thin',   muzzle: 'prongs', accent: '#9fd2ff' },
  rift:       { len: 21, stock: 'tank', stockLen: 5, mag: 'box',  magLen: 3, barrel: 'thick',  muzzle: 'prongs', accent: '#c080ff' },
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

/**
 * The armoured walker: a steel pot on a grey corpse.
 *
 * The old one was a plain tint of the ordinary body, and a flat recolour of a
 * bald head reads as a lump: nothing on it says "armour", so the eye settles
 * on the shape, and the shape is a skull. This draws the helmet instead of
 * recolouring the head -- a domed pot with a brim, a riveted band, a chin
 * strap and a shoulder plate on each side -- so the thing on its head is
 * something, and the face underneath is still a face.
 */
function buildHelmeted(src, steel = 0.42) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(tintCopy(src, '#7c8a94', steel), 0, 0);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const DARK = '#48525b';     // the shell's edge, and the shadow under the brim
  const MID = '#7c8b96';      // the pot itself
  const LIT = '#a9b7c0';      // moonlight on the crown
  // ---- the pot: a dome, two pixels wide at the top and eight at the brim ----
  px(9, 1, DARK, 2, 1);
  px(8, 2, DARK, 4, 1);
  px(7, 3, DARK, 6, 1);
  px(6, 4, DARK, 8, 1);
  px(9, 1, MID, 2, 1);
  px(8, 2, MID, 4, 1);
  px(7, 3, MID, 6, 1);
  px(6, 4, MID, 8, 1);
  px(8, 2, LIT, 2, 1);        // one highlight, on the crown only
  px(9, 3, LIT, 1, 1);
  // ---- the brim: one row, the same width as the shell, so it is a helmet
  //      and not a hat; a shadow under it hides everything but the face ----
  px(6, 5, DARK, 8, 1);
  px(7, 5, MID, 6, 1);
  px(8, 5, LIT, 4, 1);
  px(7, 6, '#2b3238', 6, 1);
  // ---- chin strap, so the pot is worn rather than balanced ------------------
  px(6, 6, '#59636b', 1, 3);
  px(13, 6, '#59636b', 1, 3);
  // ---- shoulder plates: the armour continues where a coat would -------------
  px(2, 11, DARK, 4, 2);
  px(3, 11, MID, 3, 1);
  px(14, 11, DARK, 4, 2);
  px(14, 11, MID, 3, 1);
  px(8, 13, DARK, 4, 1);                            // a breastplate seam
  return canvas;
}

/**
 * The hellhound, side on, facing east: 26x16 at two leg poses.
 *
 * It is the only body with a frame of its own, so it is the only one that
 * could be drawn badly -- and it was: at 18x12, with the legs painted over by
 * a flat slab of a body, it read as a striped insect the size of a soldier's
 * boot. This one has a chest and a haunch that are different shapes, a deep
 * barrel, four legs with paws, a neck that carries the head *forward* rather
 * than out of the shoulders, ears off the skull and a red eye, so it is a dog
 * even while it is running at your face in the dark. Two poses of the legs, so
 * it trots instead of gliding.
 */
function buildDog(legs = 0) {
  const W = 26, H = 16;
  const { canvas, ctx } = makeCanvas(W, H);
  // The fur is lit a shade above the old coat: at 1.75 the body was big enough
  // to read in a dark room by its silhouette alone, and at 1:1 a near-black
  // dog in a near-black room is a pair of eyes and nothing else.
  const D = '#33261a';   // dark fur / outline
  const M = '#634c33';   // mid fur
  const L = '#8a6c48';   // light fur (the moon on its back)
  const S = '#1a1410';   // shadow, under everything
  const E = '#b02a1c';   // eye glow
  const R = '#6d1a18';   // collar
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // ---- legs: four of them, and the trot is which pair is forward ------------
  const near = legs ? [{ x: 17, y: 11 }, { x: 8, y: 11 }] : [{ x: 15, y: 11 }, { x: 10, y: 11 }];
  const far = legs ? [{ x: 15, y: 10 }, { x: 10, y: 10 }] : [{ x: 18, y: 10 }, { x: 8, y: 10 }];
  for (const { x, y } of far) { px(x, y, M, 2, 4); px(x, y + 4, S, 3, 1); }   // far pair, dimmer
  for (const { x, y } of near) { px(x, y, D, 2, 4); px(x, y + 4, S, 3, 1); }

  // ---- tail: up and back, the way an angry dog carries it --------------------
  px(3, 6, D, 2, 1); px(2, 5, D, 2, 1); px(1, 3, D, 2, 2); px(1, 3, M, 1, 1);

  // ---- the barrel: deep chest at the front, tucked waist at the back --------
  px(5, 6, M, 15, 5);            // body
  px(5, 6, L, 14, 1);            // moonlight along the spine
  px(5, 10, D, 15, 1);           // belly in shadow
  px(4, 7, D, 3, 3);             // rear quarter
  px(5, 7, D, 1, 3);
  px(17, 5, M, 5, 7);            // chest: the tallest part of the animal
  px(17, 5, L, 4, 1);
  px(20, 6, D, 1, 5);            // the crease between chest and shoulder

  // ---- neck up to the head, collar at the throat ----------------------------
  px(20, 4, M, 3, 3);
  px(20, 4, L, 2, 1);
  px(19, 6, R, 4, 2);            // collar: the one warm band on it
  px(19, 6, '#8a2420', 4, 1);

  // ---- head: skull, muzzle, jaw, ears, one red eye --------------------------
  px(21, 2, D, 4, 5);            // skull, outlined by its own dark fur
  px(22, 2, M, 3, 4);
  px(21, 1, D, 1, 2);            // near ear, standing up
  px(23, 1, D, 2, 2);
  px(24, 4, M, 2, 3);            // muzzle
  px(25, 4, S, 1, 1);            // nose
  px(24, 6, '#2b1b18', 2, 1);    // open jaw
  px(23, 3, E, 1, 1);            // eye
  px(25, 3, E, 1, 1);

  return canvas;
}

/**
 * A prop layer: wash a base body and then paint on top of it.
 *
 * Nine of the things in this file are the same corpse with a different life
 * painted over it, and writing that out nine times is how the head ends up
 * three pixels to the left in one of them. Everything here goes through this:
 * one wash, one painter, one place to fix.
 */
function painted(src, tint, amount, paint) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(tintCopy(src, tint, amount), 0, 0);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  paint(px, ctx);
  return canvas;
}

/**
 * The Knight's helm.
 *
 * The armoured walker wears a pot with a brim, and the Knight was wearing the
 * same pot: a thing you could not tell from the walker's at a glance, on a
 * body three times as heavy, and with the corpse's own face still showing
 * through the middle of it. That face is what read as "something on its head".
 * This is a great helm instead -- flat crown, a cross-shaped visor slit, a
 * riveted band, vents punched along the jaw, and a rust-coloured crest along
 * the top which is the only thing you need to see in the dark to know that
 * this one is not a walker with a hat.
 */
function buildKnightHead(src, plate = 0.6) {
  return painted(src, '#6d7783', plate, (px) => {
    const D = '#20262d';       // the shell's edge, near black
    const M = '#4c5763';       // the steel, a cold blue-grey
    const L = '#8795a5';       // the moon on it
    const H = '#c4ced8';       // the one bright edge the eye follows
    const K = '#0b0e12';       // inside the helm
    // ---- the crest: a low rust ridge, the tell in the dark ------------------
    px(7, 0, '#5a2419', 1, 1);
    px(8, 0, '#9c4530', 4, 1);
    px(12, 0, '#7d3527', 1, 1);
    // ---- the bucket: flat crown, square shoulders, a jaw that closes in -----
    px(7, 1, D, 7, 1);
    px(6, 2, D, 9, 1);
    px(5, 3, D, 11, 5);        // the face plate, y3..y7
    px(6, 8, D, 9, 1);         // the jaw, one row in on each side
    px(7, 9, D, 7, 1);         // and the chin
    px(8, 1, M, 5, 1);
    px(7, 2, M, 7, 1);
    px(6, 3, M, 9, 5);
    px(7, 8, M, 7, 1);
    // The light comes from the left: the crown and the near edge catch it and
    // the far side stays in shadow, so the helm reads as round, not as a box.
    px(8, 1, L, 4, 1);
    px(7, 2, L, 4, 1);
    px(6, 3, H, 1, 1);
    px(6, 4, L, 1, 3);
    px(7, 8, L, 5, 1);
    px(13, 3, D, 1, 5);
    px(14, 3, M, 1, 4);
    // ---- one dark slot across the face, and nothing else that could be a face
    px(6, 5, K, 8, 1);
    px(6, 5, M, 1, 1); px(13, 5, M, 1, 1);    // cut short of the edge
    // ---- the vents: two a side, at the very edge of the jaw, in shadow -----
    px(6, 7, K, 1, 1); px(13, 7, K, 1, 1);
    px(6, 8, D, 1, 1); px(13, 8, D, 1, 1);
  });
}

/** The knight's body: plate over the corpse, a pauldron each side, a seam. */
function buildKnight(src) {
  return painted(buildKnightHead(src, 0.66), '#59636e', 0.3, (px) => {
    const D = '#20262d';       // the edges, as on the helm
    const P = '#5d6874';       // the plate
    const L = '#8795a5';       // the moon on it
    // ---- pauldrons: a slab over each shoulder, one row proud of the body ---
    px(4, 11, D, 4, 2); px(5, 11, P, 3, 1);
    px(12, 11, D, 4, 2); px(13, 11, P, 3, 1);
    // ---- the breastplate: a V of plate from the gorget down to the belt -----
    // The chest was mostly its own outline: at the scale the game draws it the
    // knight came out as a helm on a black shape. Plate first, edge around it.
    px(7, 12, D, 6, 1);
    px(8, 13, D, 6, 1);
    px(9, 14, D, 3, 2);
    px(8, 12, P, 4, 1);
    px(9, 13, P, 4, 1);
    px(10, 14, P, 1, 2);
    px(8, 12, L, 3, 1);        // the gorget catches the same light as the helm
    px(8, 13, L, 1, 1);        // and the light runs down the near edge
    px(9, 15, '#3f4853', 2, 1);   // the belt, in shadow under the plate
    // ---- greaves: the same plate on the legs, or the body is a black lump.
    // The legs are three pixels wide; a wider greave made the knight stand
    // like a tripod, so the plate goes *on* the leg, not around it ----------
    px(5, 16, '#4c5661', 1, 3); px(6, 16, '#3b434d', 2, 3); px(5, 16, '#6d7a88', 1, 1);
    px(12, 16, '#3b434d', 2, 3); px(14, 16, '#31383f', 1, 3);
    px(5, 19, '#3b434d', 3, 1); px(12, 19, '#31383f', 3, 1);
    // ---- a seam down each thigh: mail under the plate, not bare leg --------
    px(7, 20, D, 2, 1);
    px(11, 20, D, 2, 1);
  });
}

/** Crawler: the zombie sprite chopped down to a dragging torso + arms. */
/**
 * The skeleton a Bonewright sews out of the floor.
 *
 * It used to be the ordinary corpse with a chalk tint on it: a *white zombie*,
 * which at gameplay scale read as "a zombie someone turned the brightness up
 * on" rather than as bones. A skeleton has to lose the bulk, not the colour,
 * so this one is drawn from nothing: a skull with two sockets, a spine, four
 * ribs with light through them, and limbs that are one pixel wide.
 *
 * Same 20x22 box and the same body row as every other body, so it stands on
 * the floor the way the walker does -- and it is `headless` in the table, so
 * the empty space above the ribs is not a headshot waiting to happen.
 */
function buildSkeleton(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const BONE = '#e2dcc4';      // the lit side of a bone
  const BONE2 = '#b3ab90';     // and its shadow
  const D = '#2b271f';         // the gap between bones: this is what makes it read
  const HOLE = '#12100c';      // a socket

  // ---- the skull: a narrow box, wider at the crown than the jaw ------------
  // Bone, not outline: the first pass was a black frame with white inside it,
  // which at gameplay scale read as a man in a dark cap.
  px(7, 2, BONE, 6, 1);        // the crown
  px(6, 3, BONE, 8, 1);        // and the brow, one wider each side
  px(6, 2, BONE2, 1, 1); px(13, 2, BONE2, 1, 1);
  px(6, 4, BONE, 8, 4);        // the face plate
  px(6, 4, BONE2, 1, 4);       // the far side of it in shadow
  px(7, 5, HOLE, 2, 2);        // sockets, deep enough to read at a glance
  px(11, 5, HOLE, 2, 2);
  px(9, 6, BONE2, 2, 1);
  px(9, 7, D, 2, 1);           // the nasal hole
  px(7, 8, BONE, 6, 1);        // the upper jaw
  px(6, 8, D, 1, 1); px(13, 8, D, 1, 1);
  px(8, 9, BONE2, 4, 1);       // and the teeth, in shadow under it

  // ---- the spine and the ribs: bars of bone with light between them -------
  px(9, 10, BONE, 2, 1);
  for (const y of [11, 12, 13, 14]) {
    px(9, y, BONE2, 2, 1);     // the vertebra
    px(7, y, BONE, 2, 1);      // the rib, left
    px(11, y, BONE, 2, 1);     // and right
    px(8, y, D, 1, 1);         // the gaps that stop it being a slab
    px(11, y, D, 1, 1);
  }
  px(6, 12, BONE2, 1, 1);      // the tips of the lowest pair
  px(13, 12, BONE2, 1, 1);

  // ---- the pelvis, and a hip joint each side -----------------------------
  px(7, 15, BONE, 6, 1);
  px(8, 16, BONE2, 4, 1);

  // ---- arms: one bone, hanging, with a wrist and a hand ------------------
  px(4, 11, BONE, 1, 5);       // the near arm, down the side
  px(5, 11, BONE2, 1, 1);      // the shoulder
  px(4, 16, BONE, 2, 1);       // the hand
  px(4, 12, D, 1, 1);          // the elbow's shadow, so it is not a stick
  px(15, 11, BONE2, 1, 4);     // the far arm, darker: further away
  px(14, 11, BONE, 1, 1);
  px(15, 15, BONE2, 2, 1);

  // ---- legs: two bones each, because a femur is not a plank -------------
  px(7, 17, BONE, 1, 5);
  px(8, 17, D, 1, 5);
  px(8, 17, BONE2, 1, 1);      // the knee
  px(7, 21, BONE, 2, 1);       // the foot
  px(11, 17, D, 1, 5);
  px(12, 17, BONE2, 1, 5);
  px(11, 17, BONE2, 1, 1);
  px(11, 21, BONE2, 2, 1);
  return canvas;
}

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

function buildCorpse(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  // a heap on the floor: only the bottom third, pulled down and to one side
  const cut = Math.round(src.height * 0.62);
  const h = src.height - cut;
  ctx.drawImage(src, 0, cut, src.width, h, -1, src.height - h - 1, src.width, h);
  // one flung arm, so it does not read as a painted-on puddle
  ctx.fillStyle = '#4c6b3a';
  ctx.fillRect(src.width - 7, src.height - h + 1, 6, 2);
  ctx.fillStyle = '#3b5430';
  ctx.fillRect(src.width - 10, src.height - h + 3, 4, 2);
  return canvas;
}

// ---------------------------------------------------------------------------
//  The apiary, the barrow and the web: the second wave of bodies.
//
//  Every one of these is the same 20x22 corpse with one thing painted on it,
//  because that is how the roster stays readable: you learn the silhouette of
//  the human body once, then you learn nine hats. The exception is the spider,
//  which is not a person at all and is drawn from scratch -- and the bee,
//  which is nine pixels wide and has to be.
// ---------------------------------------------------------------------------

/** A beekeeper: cream suit, mesh veil, gloves, and a hive on its back. */
function buildBeekeeper(src) {
  return painted(src, '#d8cfae', 0.62, (px) => {
    // ---- the broad brim, one row wider than the head on each side ----------
    px(3, 2, '#6a5c3a', 14, 1);
    px(4, 3, '#4e4329', 12, 1);
    // ---- the veil: a pale mesh box, dark enough that the face behind it is
    //      a suggestion rather than a face, which is what a veil is ----------
    px(6, 4, '#a89e80', 9, 6);
    px(6, 4, '#c8bf9e', 1, 6);          // the light down one edge
    px(14, 4, '#8a8066', 1, 6);
    for (const y of [6, 8]) for (const x of [7, 9, 11, 13]) px(x, y, '#6e6650', 1, 1);
    px(8, 5, '#2a2620', 1, 1);          // two eyes behind the mesh
    px(11, 5, '#2a2620', 1, 1);
    px(8, 7, '#4a4436', 4, 1);          // the line where the mouth is
    // ---- hive boxes strapped to its back ----------------------------------
    px(16, 10, '#7a5c30', 4, 4);
    px(16, 11, '#5c4422', 4, 1);
    px(16, 13, '#5c4422', 4, 1);
    px(17, 11, '#e0b04a', 1, 1);      // the seam of honey showing through
    // ---- gauntlets: it does not want to be stung either --------------------
    px(0, 12, '#e6e0c6', 3, 2);
    px(17, 12, '#e6e0c6', 3, 2);
  });
}

/** An archer: a bow held out to the side, and a quiver over one shoulder. */
function buildArcher(src) {
  // A bow is a curve with a string across it, and on a 20-pixel corpse a curve
  // is three rows of two pixels. The first version was a straight stick with a
  // gap beside it, which read as a walking stick. This one leans out over the
  // hand -- top, belly and bottom all step away from the body -- and the string
  // runs back to the shoulder, so the whole shape is a D.
  return painted(src, '#e8e4d2', 0.86, (px) => {
    // ---- the stave: one pixel where it is thin, three where it bends ------
    px(16, 3, '#6a4a24', 1, 1);        // the top nock
    px(17, 4, '#8a6338', 1, 3);        // the upper limb, stepping out
    px(18, 7, '#8a6338', 1, 3);        // the belly
    px(17, 10, '#8a6338', 1, 3);       // the lower limb, stepping back in
    px(16, 13, '#6a4a24', 1, 2);       // the bottom nock
    px(18, 7, '#a87a44', 1, 1);        // the lit shoulder of the belly
    // ---- the string, straight down the inside of the curve ----------------
    px(15, 3, '#c8c2a8', 1, 12);
    // ---- the nocked shaft, across it and at you --------------------------
    px(11, 8, '#d8d2bc', 8, 1);
    px(11, 7, '#8a8a7a', 1, 3);        // the barb
    // ---- a quiver of arrows over the shoulder -----------------------------
    px(2, 8, '#4e3a22', 2, 6);
    px(2, 7, '#c8c2a8', 1, 1);
    px(3, 6, '#c8c2a8', 1, 2);
    // ---- a skull with an eye socket in it ---------------------------------
    px(8, 5, '#2a2620', 1, 1);
    px(11, 5, '#2a2620', 1, 1);
  });
}

/** A bulwark: a plank shield held out in front, iron boss in the middle. */
function buildBulwark(src) {
  return painted(src, '#e8e4d2', 0.86, (px) => {
    px(14, 7, '#4a3a24', 5, 10);
    px(15, 8, '#6a5232', 4, 8);
    px(15, 9, '#5a462a', 4, 1);
    px(15, 12, '#5a462a', 4, 1);
    px(16, 10, '#8d949a', 2, 3);       // the boss
    px(16, 11, '#c8d2da', 1, 1);
    // an iron rim, so it is a shield and not a door
    px(14, 7, '#2e2a22', 5, 1);
    px(14, 16, '#2e2a22', 5, 1);
  });
}

/** A drummer: a drum on its belly and two raised sticks. */
function buildDrummer(src) {
  return painted(src, '#e8e4d2', 0.86, (px) => {
    // ---- the drum: slung across the front of the body, not carried at the
    // side. The first version hung it off the right hip, where it read as a
    // box the corpse had picked up; a drum has to be on the belly and it has
    // to be the widest thing in the silhouette.
    px(4, 11, '#3a1612', 13, 1);       // the iron rim, top
    px(4, 16, '#3a1612', 13, 1);       // ...and bottom
    px(5, 12, '#7a3228', 11, 4);       // the shell
    px(5, 13, '#8a3a2e', 11, 2);       // its lit face
    px(5, 12, '#e0d8bc', 11, 1);       // the skin, catching the light
    px(5, 15, '#c8bda0', 11, 1);
    // the rope over one shoulder, holding it up
    px(7, 6, '#8a7038', 1, 6);
    px(8, 6, '#a8874a', 1, 6);
    // ---- sticks, up over the shoulders -----------------------------------
    px(3, 3, '#c8b48a', 1, 6);
    px(2, 2, '#e0cfa8', 2, 1);
    px(16, 4, '#c8b48a', 1, 5);
    px(15, 3, '#e0cfa8', 2, 1);
  });
}

/** A sapper: a crawling body with a bundle of charges roped to its back. */
function buildSapper(src) {
  return painted(src, '#8a7a52', 0.5, (px) => {
    // it is drawn over the crawler's own shape, so the bundle sits high
    px(6, 3, '#3a3a30', 9, 6);
    px(7, 4, '#5a5040', 7, 4);
    px(7, 5, '#8a6a3a', 1, 1);
    px(10, 4, '#8a6a3a', 1, 1);
    px(12, 6, '#8a6a3a', 1, 1);
    px(9, 2, '#c8b48a', 2, 1);         // the fuse
    px(11, 1, '#e0a03a', 1, 1);
  });
}

/** The First: a rib cage for a crown and a tabard over the bones. */
function buildFirst(src) {
  return painted(src, '#efe9d2', 0.9, (px) => {
    // the crown: five ribs off the skull
    for (let i = 0; i < 5; i++) px(6 + i * 2, 1 - (i % 2), '#d8cfae', 1, 2);
    px(6, 2, '#b8ae90', 9, 1);
    // the tabard
    px(7, 11, '#6a2420', 7, 5);
    px(9, 11, '#8a3a2a', 3, 3);
    px(8, 15, '#6a2420', 5, 1);
    // empty sockets, so it is a skull and not a face
    px(8, 5, '#1e1c16', 1, 1);
    px(11, 5, '#1e1c16', 1, 1);
    px(9, 7, '#1e1c16', 2, 1);
  });
}

/**
 * The spider: 24x18, side on, facing east. Four legs a side in two poses, an
 * abdomen wide enough to carry a mark, and eyes where you would expect them.
 * The weaver is dust-brown, the widow is black with a pale cross, the porter
 * is a fat thing with an egg sac slung under it.
 */
const SPIDER_SKIN = {
  weaver: { d: '#241c14', m: '#4c3c26', l: '#6e5a3a', eye: '#d8c070' },
  widow: { d: '#141118', m: '#332a3c', l: '#57495f', eye: '#e05a6a' },
  porter: { d: '#1d1710', m: '#3d2f20', l: '#5c4a30', eye: '#c8a04a' },
};

function buildSpider(kind = 'weaver', step = 0) {
  const W = 24, H = 18;
  const { canvas, ctx } = makeCanvas(W, H);
  const S = SPIDER_SKIN[kind] ?? SPIDER_SKIN.weaver;
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  // a one-pixel line, because eight legs made of scattered dots read as dirt
  const seg = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const k = n ? i / n : 0;
      px(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), c);
    }
  };
  // ---- legs: four pairs, each with a knee up above the body and a foot on
  //      the floor. The far side is a shade darker and a pixel higher; the
  //      trot is which of the two poses the knee is in. ---------------------
  const AX = 14, AY = 9;
  const upLegs = [[20, 3, 23, 5], [21, 6, 24, 8], [21, 12, 24, 14], [19, 15, 21, 17]];
  const downLegs = [[20, 3, 23, 5], [21, 6, 24, 8], [21, 12, 24, 14], [19, 15, 21, 17]];
  for (let i = 0; i < 4; i++) {
    const lift = step && i % 2 === 0 ? 1 : 0;
    for (const [side, col, off] of [[1, S.d, 0], [-1, S.m, 1]]) {
      const [kx, ky, fx, fy] = upLegs[i];
      const kx2 = kx + off, ky2 = side > 0 ? ky - lift - off : H - 1 - ky + lift + off;
      const fx2 = fx + off, fy2 = side > 0 ? fy - lift - off : H - 1 - fy + lift + off;
      const sy = side > 0 ? AY - 2 + (i > 1 ? i - 1 : 0) : AY + 2 - (i > 1 ? i - 1 : 0);
      seg(AX - 1, sy, kx2, ky2, col);
      seg(kx2, ky2, fx2, fy2, col);
      px(fx2, fy2, col, 2, 1);
    }
  }
  // ---- the abdomen, low and round, with whatever is written on it ----------
  ctx.fillStyle = S.d;
  ctx.beginPath(); ctx.ellipse(9, 9, 5.6, 4.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = S.m;
  ctx.beginPath(); ctx.ellipse(9, 9, 4.6, 3.7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = S.l;
  ctx.beginPath(); ctx.ellipse(8.5, 7.6, 3.2, 1.6, 0, 0, TAU); ctx.fill();
  if (kind === 'widow') {
    // the pale cross that says what bit you
    px(8, 7, '#efe9d2', 1, 5);
    px(6, 9, '#efe9d2', 5, 1);
  } else if (kind === 'porter') {
    // the egg sac, slung low and pale, with the brood showing through it
    ctx.fillStyle = '#cfc2a4';
    ctx.beginPath(); ctx.ellipse(9, 13.2, 4.2, 2.4, 0, 0, TAU); ctx.fill();
    px(7, 13, '#efe6cc', 1, 1); px(10, 13, '#efe6cc', 1, 1); px(9, 11, '#8a7a5a', 1, 1);
  } else {
    // a weaver's spinners, and the thread running back out of them
    px(4, 9, S.l, 2, 1);
    seg(4, 9, 1, 12, '#b8ae90');
  }
  // ---- the cephalothorax and the eyes -------------------------------------
  ctx.fillStyle = S.d;
  ctx.beginPath(); ctx.ellipse(AX, AY, 3.6, 3.1, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = S.m;
  ctx.beginPath(); ctx.ellipse(AX, AY, 2.7, 2.2, 0, 0, TAU); ctx.fill();
  px(15, 7, S.l, 2, 1);
  px(16, 7, S.eye, 1, 1);
  px(15, 10, S.eye, 1, 1);
  px(17, 9, S.eye, 1, 1);
  // fangs, and the two feelers in front of them
  px(17, 10, S.d, 2, 1);
  seg(16, 8, 20, 6, S.d);
  seg(16, 10, 20, 12, S.d);
  return canvas;
}

/**
 * The hive: a stacked box of comb on a stump, with the bees' door in the
 * front and a warm glow in it. 16x22, so it stands about waist-high on a
 * soldier and reads as furniture you could shoot.
 */
function buildHive() {
  const { canvas, ctx } = makeCanvas(16, 22);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  // the stump it was put down on
  px(4, 19, '#3a2c1c', 8, 3);
  px(5, 19, '#4e3b26', 6, 2);
  // three stacked boxes, each a shade apart, each with a seam
  for (const [y, top, body] of [[12, '#8a6a34', '#6e5326'], [7, '#96743a', '#7a5c2c'], [2, '#a07c40', '#84632f']]) {
    px(3, y, top, 10, 1);
    px(3, y + 1, body, 10, 4);
    px(3, y + 4, '#4e3c1e', 10, 1);
    px(12, y + 1, '#5c4622', 1, 3);
  }
  // the door, and the light in it
  px(6, 18, '#2a2010', 4, 2);
  px(7, 18, '#e0b04a', 2, 1);
  // a couple of bees already on the landing board
  px(5, 16, '#2a2118', 1, 1);
  px(9, 15, '#e0b040', 1, 1);
  // the roof, with a lip
  px(2, 0, '#4e3c1e', 12, 1);
  px(3, 1, '#6a5228', 10, 1);
  return canvas;
}

/**
 * The bee: 9x8, side on. Nine pixels is not much, so it is three things and
 * nothing else -- a striped abdomen, a wing, and an eye.
 */
function buildBee(frame = 0) {
  const { canvas, ctx } = makeCanvas(9, 8);
  const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const hi = frame ? 1 : 0;
  px(2, 3, '#2a2118', 5, 4);        // abdomen
  px(3, 3, '#e0b040', 1, 4);        // stripes
  px(5, 3, '#e0b040', 1, 4);
  px(7, 3, '#2a2118', 1, 3);        // head
  px(8, 4, '#f0e0a0', 1, 1);        // eye
  px(4, 1 + hi, '#cfe0ee', 3, 2);   // wing
  px(5, 0 + hi, '#eef6fa', 2, 1);
  px(2, 7, '#1a1410', 1, 1);        // the leg it is hanging from
  return canvas;
}

let cache = null;

/**
 * One painter, four frames: the standing pose, its mirror, the attack pose and
 * that one mirrored. Every enemy set in the table below is built this way, so
 * a body can never be missing a frame it needs when it turns round or reaches
 * for you.
 */
function fillSet(out, name, paint, base) {
  const { idle, atk } = base;
  out[name] = idle.map(paint);
  out[name + 'Flip'] = idle.map((c) => paint(flipH(c)));
  out[name + 'Atk'] = atk.map(paint);
  out[name + 'AtkFlip'] = atk.map((c) => paint(flipH(c)));
}

// ---- the nine wardens ------------------------------------------------------
// A mini-boss is the same corpse with its old job still on it. They are meant
// to be read in one glance from the other side of a room: a light, a blade, a
// cap, a crown.
function buildWarden(src) {
  return painted(buildKnightHead(src, 0.62), '#4a5a3a', 0.18, (px) => {
    // a bull's-eye lantern in the off hand, and the keys at the belt
    px(1, 14, '#8a7a3a', 4, 4);
    px(2, 15, '#f0d98a', 2, 2);
    px(1, 18, '#4a4326', 4, 1);
    px(11, 16, '#c8b48a', 1, 2);
    px(10, 17, '#c8b48a', 1, 1);
    px(12, 17, '#c8b48a', 1, 1);
  });
}

function buildOrganist(src) {
  return painted(src, '#6a4a86', 0.62, (px) => {
    // a high collar, and the rope it pulls with both hands
    px(5, 9, '#efe6d0', 2, 3);
    px(13, 9, '#efe6d0', 2, 3);
    px(10, 12, '#d8c8a8', 1, 6);
    px(9, 18, '#b0a080', 3, 1);
    // and the mouth it sings through is not a mouth any more
    px(8, 7, '#2a1020', 4, 2);
    px(9, 6, '#3a1830', 2, 1);
  });
}

function buildButcher(src) {
  return painted(src, '#8a4a3a', 0.5, (px) => {
    // the apron, and the cleaver hanging off the hand
    px(6, 12, '#d8d0bc', 8, 4);
    px(7, 12, '#8a3a2a', 2, 2);
    px(16, 8, '#9aa4ac', 4, 6);
    px(16, 8, '#c8d2da', 4, 1);
    px(17, 10, '#5a646c', 2, 2);
    px(15, 13, '#4a3424', 2, 2);
  });
}

function buildQueen(src) {
  return painted(buildBeekeeper(src), '#c8a03a', 0.22, (px) => {
    // a crown of honeycomb, and the drones she carries
    for (let i = 0; i < 5; i++) px(6 + i * 2, 0, '#e0b04a', 1, 2);
    px(6, 1, '#f0d060', 9, 1);
    px(2, 4, '#e0b040', 1, 1);
    px(16, 5, '#e0b040', 1, 1);
    px(9, 14, '#e0b040', 2, 2);
  });
}

function buildGravedigger(src) {
  return painted(src, '#4e5a4a', 0.6, (px) => {
    // a shovel over one shoulder and a heap of earth at the feet
    px(15, 3, '#8a6338', 1, 12);
    px(14, 2, '#9aa4ac', 3, 4);
    px(15, 1, '#c8d2da', 1, 1);
    px(14, 15, '#4a3a24', 3, 2);
    px(3, 18, '#5a4a30', 5, 2);
  });
}

function buildBellringer(src) {
  return painted(src, '#3a6a8a', 0.55, (px) => {
    // a hand bell, and the collar that goes with it
    px(15, 10, '#b0a040', 4, 4);
    px(16, 10, '#e0c860', 2, 1);
    px(16, 14, '#7a6a20', 2, 1);
    px(17, 15, '#c8b048', 1, 1);
    px(6, 10, '#d8d2bc', 8, 1);
  });
}

/**
 * The Colonel: the last of the nine, and the only one that is not a corpse
 * wearing its old job.
 *
 * He used to be the Warden's helm with a cap drawn on top of it, which made the
 * first warden and the last one the same silhouette in the same green -- and the
 * helm sits over the zombie's own head, so the cap had nothing to sit on. He has
 * a head of his own now: a bare jaw under a peaked cap, gold braid on the
 * shoulder, a sabre up in the right hand. Round fifty should not look like
 * round ten.
 */
function buildColonel(src) {
  return painted(src, '#4a4a3a', 0.22, (px) => {
    const CAP = '#2e3526';     // the crown, dark olive
    const BAND = '#171c12';    // the band and the peak, near black
    const LIT = '#5a6142';     // the moon on the crown
    const GOLD = '#c8b048';
    // ---- the peaked cap: crown, band, and a peak that juts forward ---------
    px(5, 1, CAP, 9, 2);       // crown, rows 1..2
    px(4, 2, CAP, 11, 1);      // it flares out over the head
    px(5, 1, LIT, 6, 1);       // the crown catches the light from the left
    px(4, 3, BAND, 12, 1);     // the band
    px(4, 4, BAND, 13, 1);     // and the peak, one row proud of the face
    px(17, 4, BAND, 1, 1);     // the point of it
    // the badge, and the braid looped over the band
    px(9, 1, GOLD, 2, 1);
    px(9, 3, GOLD, 1, 1);
    px(11, 3, GOLD, 1, 1);
    px(13, 3, GOLD, 1, 1);
    // ---- the jaw, shut: a line of teeth under the shadow of the peak ------
    px(6, 8, '#2a2018', 7, 1);
    px(7, 9, '#c8b48a', 5, 1);
    // ---- the cuirass under the tunic: he is still plated, just not helmed --
    px(7, 12, '#9aa4ac', 1, 3);       // the near edge catches the light
    px(6, 12, '#6f7985', 1, 3);
    px(8, 12, '#8a94a0', 4, 1);       // the breastplate
    px(8, 13, '#7c8794', 4, 2);
    px(12, 12, '#5a646c', 1, 3);      // and the far side in shadow
    px(9, 12, GOLD, 1, 1);            // buttons down the seam
    px(11, 14, GOLD, 1, 1);
    // ---- gold braid on the shoulder, and the ribbon of the last campaign ---
    px(2, 11, GOLD, 4, 1);
    px(2, 12, '#8a7a30', 4, 1);
    px(14, 12, '#c85a3a', 1, 2);
    px(14, 14, GOLD, 1, 1);
    // ---- the sabre: held in the forward hand, blade up past the shoulder --
    px(18, 3, '#c8d2da', 1, 9);      // the blade
    px(18, 2, '#eef3f8', 1, 1);      // the point of it
    px(17, 12, GOLD, 3, 1);          // the guard, over the hand that holds it
    px(18, 13, '#3a2c1c', 1, 1);     // the grip, under the guard
  });
}

/**
 * The totem: a wrapped pole with a small lit skull on top. Drawn once, used
 * by every totem in every game -- the glow around it is haunts.js's job.
 */
function buildTotem() {
  const { canvas, ctx } = makeCanvas(14, 32);
  // the pole, dark wood
  ctx.fillStyle = '#3a2c1c';
  ctx.fillRect(5, 8, 4, 24);
  ctx.fillStyle = '#4e3b26';
  ctx.fillRect(6, 8, 2, 24);
  // rope windings
  ctx.fillStyle = '#6b5334';
  for (const y of [12, 16, 20, 24, 28]) ctx.fillRect(4, y, 6, 1);
  // the skull, and the light inside it
  ctx.fillStyle = '#cfc6a8';
  ctx.fillRect(4, 2, 6, 5);
  ctx.fillRect(5, 1, 4, 1);
  ctx.fillStyle = '#241a10';
  ctx.fillRect(5, 4, 2, 2);
  ctx.fillRect(8, 4, 1, 2);
  ctx.fillStyle = '#b07ae0';
  ctx.fillRect(5, 4, 1, 1);
  ctx.fillRect(8, 4, 1, 1);
  // feathers on the side
  ctx.fillStyle = '#7a5a8a';
  ctx.fillRect(10, 6, 1, 5);
  ctx.fillRect(11, 8, 1, 4);
  ctx.fillStyle = '#5a4a6a';
  ctx.fillRect(3, 7, 1, 4);
  return canvas;
}

/**
 * The grave: a leaning headstone on a mound, chipped edge, one candle socket.
 */
function buildGrave() {
  const { canvas, ctx } = makeCanvas(18, 24);
  // the mound
  ctx.fillStyle = '#2c2417';
  ctx.fillRect(2, 19, 14, 4);
  ctx.fillStyle = '#3d3220';
  ctx.fillRect(4, 18, 10, 2);
  ctx.fillStyle = '#4a3d26';
  ctx.fillRect(6, 17, 6, 1);
  // the stone, leaning a little
  ctx.save();
  ctx.translate(9, 18);
  ctx.rotate(-0.07);
  ctx.fillStyle = '#5a5f66';
  ctx.fillRect(-4, -14, 8, 14);
  ctx.fillStyle = '#6d737b';
  ctx.fillRect(-4, -16, 8, 3);
  ctx.fillRect(-3, -17, 6, 2);
  // the chipped corner and the scratch of a name nobody reads
  ctx.fillStyle = '#494e55';
  ctx.fillRect(2, -16, 2, 2);
  ctx.fillStyle = '#41464d';
  ctx.fillRect(-2, -11, 4, 1);
  ctx.fillRect(-2, -8, 3, 1);
  ctx.fillRect(-2, -5, 4, 1);
  ctx.restore();
  // the candle stub on the mound
  ctx.fillStyle = '#c8b98a';
  ctx.fillRect(13, 15, 2, 4);
  return canvas;
}

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

  // ---- outfits ------------------------------------------------------------
  // One sprite set per outfit, built once, plus the standard kit filed under
  // '' so a body with no outfit (and every zombie-side call site that only
  // knows `art.player`) has something to fall back on.
  const playerSets = { '': { frames: player, flip: player.map(flipH) } };
  for (const [id, skin] of Object.entries(SKINS)) {
    const set = frames(PLAYER_UPPER, PLAYER_LEGS, skin.pal);
    playerSets[id] = { frames: set, flip: set.map(flipH) };
  }
  for (const set of Object.values(playerSets)) {
    set.white = set.frames.map((c) => flatCopy(c, '#ffffff'));
    set.whiteFlip = set.flip.map((c) => flatCopy(c, '#ffffff'));
  }

  cache = {
    player,
    playerFlip: player.map(flipH),
    // outfit id -> { frames, flip, white, whiteFlip }; '' is the standard kit
    playerSets,
    zombie,
    zombieFlip: zombie.map(flipH),
    zombieAtk,
    zombieAtkFlip: zombieAtk.map(flipH),
    dog: buildDog(0),
    dogFlip: flipH(buildDog(0)),
    // two poses so a hound trots instead of gliding, and so the size increase
    // did not turn it into a moving cut-out
    dogFrames: [buildDog(0), buildDog(1)],
    dogFramesFlip: [flipH(buildDog(0)), flipH(buildDog(1))],
    // enemy variants: pale/angry runners, slab-grey brutes
    zombieRunner: zombie.map((c) => tintCopy(c, '#c86a5a', 0.42)),
    zombieRunnerFlip: zombie.map((c) => tintCopy(flipH(c), '#c86a5a', 0.42)),
    zombieRunnerAtk: zombieAtk.map((c) => tintCopy(c, '#c86a5a', 0.42)),
    zombieRunnerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#c86a5a', 0.42)),
    zombieBrute: zombie.map((c) => tintCopy(c, '#6b7a6a', 0.50)),
    // helmeted: a steel pot with a brim and a strap, plates on both shoulders
    helmet: zombie.map((c) => buildHelmeted(c)),
    helmetFlip: zombie.map((c) => buildHelmeted(flipH(c))),
    helmetAtk: zombieAtk.map((c) => buildHelmeted(c)),
    helmetAtkFlip: zombieAtk.map((c) => buildHelmeted(flipH(c))),
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
    // ---- item B -------------------------------------------------------
    // miner: earth-stained, with grit worked into the cloth
    miner: zombie.map((c) => tintCopy(c, '#6b5330', 0.55)),
    minerFlip: zombie.map((c) => tintCopy(flipH(c), '#6b5330', 0.55)),
    minerAtk: zombieAtk.map((c) => tintCopy(c, '#6b5330', 0.55)),
    minerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#6b5330', 0.55)),
    // medic: field grey with a pale apron, and a red cross drawn at runtime
    medic: zombie.map((c) => tintCopy(c, '#7d8b94', 0.52)),
    medicFlip: zombie.map((c) => tintCopy(flipH(c), '#7d8b94', 0.52)),
    medicAtk: zombieAtk.map((c) => tintCopy(c, '#7d8b94', 0.52)),
    medicAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#7d8b94', 0.52)),
    // mimic: whatever is lying on the floor already
    mimic: zombie.map(buildCorpse),
    mimicFlip: zombie.map((c) => buildCorpse(flipH(c))),
    mimicUp: zombie.map((c) => tintCopy(c, '#a8455a', 0.5)),
    mimicUpFlip: zombie.map((c) => tintCopy(flipH(c), '#a8455a', 0.5)),
    mimicUpAtk: zombieAtk.map((c) => tintCopy(c, '#a8455a', 0.5)),
    mimicUpAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#a8455a', 0.5)),
    // amalgam: three of them got tired of queueing
    fusion: zombie.map((c) => tintCopy(c, '#4a3f52', 0.6)),
    fusionFlip: zombie.map((c) => tintCopy(flipH(c), '#4a3f52', 0.6)),
    fusionAtk: zombieAtk.map((c) => tintCopy(c, '#4a3f52', 0.6)),
    fusionAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#4a3f52', 0.6)),

    // ---- three from the creature shortlist -----------------------------
    // bonewright: bone-pale and gaunt, in a long dark apron, needle in hand
    bonewright: zombie.map((c) => tintCopy(c, '#cfc9b4', 0.74)),
    bonewrightFlip: zombie.map((c) => tintCopy(flipH(c), '#cfc9b4', 0.74)),
    bonewrightAtk: zombieAtk.map((c) => tintCopy(c, '#cfc9b4', 0.74)),
    bonewrightAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#cfc9b4', 0.74)),
    // skeletons: what it sews out of the dirt. Not a tinted corpse -- a corpse
    // with the meat taken off it (see buildSkeleton), so it reads as bones.
    skeleton: zombie.map((c) => buildSkeleton(c)),
    skeletonFlip: zombie.map((c) => flipH(buildSkeleton(c))),
    skeletonAtk: zombieAtk.map((c) => buildSkeleton(c)),
    skeletonAtkFlip: zombieAtk.map((c) => flipH(buildSkeleton(c))),
    // swarmling's scattered halves: chitin, small and dark
    swarmlet: zombie.map((c) => tintCopy(c, '#4a3a2c', 0.66)),
    swarmletFlip: zombie.map((c) => tintCopy(flipH(c), '#4a3a2c', 0.66)),
    swarmletAtk: zombieAtk.map((c) => tintCopy(c, '#4a3a2c', 0.66)),
    swarmletAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#4a3a2c', 0.66)),
    // jammer: signals grey, with the wireless set strapped to its back
    jammer: zombie.map((c) => tintCopy(c, '#3a4756', 0.6)),
    jammerFlip: zombie.map((c) => tintCopy(flipH(c), '#3a4756', 0.6)),
    jammerAtk: zombieAtk.map((c) => tintCopy(c, '#3a4756', 0.6)),
    jammerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#3a4756', 0.6)),

    // ---- the haunt round ------------------------------------------------
    // bearer: bruised purple, the dusk already on it
    bearer: zombie.map((c) => tintCopy(c, '#7a4ab0', 0.55)),
    bearerFlip: zombie.map((c) => tintCopy(flipH(c), '#7a4ab0', 0.55)),
    bearerAtk: zombieAtk.map((c) => tintCopy(c, '#7a4ab0', 0.55)),
    bearerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#7a4ab0', 0.55)),
    // mourner: graveyard ash, wet at the edges
    mourner: zombie.map((c) => tintCopy(c, '#565d68', 0.6)),
    mournerFlip: zombie.map((c) => tintCopy(flipH(c), '#565d68', 0.6)),
    mournerAtk: zombieAtk.map((c) => tintCopy(c, '#565d68', 0.6)),
    mournerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#565d68', 0.6)),
    // wraith: moonlight through a body -- the draw path gives it the alpha
    wraith: zombie.map((c) => tintCopy(c, '#cfe0ee', 0.82)),
    wraithFlip: zombie.map((c) => tintCopy(flipH(c), '#cfe0ee', 0.82)),
    wraithAtk: zombieAtk.map((c) => tintCopy(c, '#cfe0ee', 0.82)),
    wraithAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#cfe0ee', 0.82)),
    // snowman: frost over everything, a coal-dark heart showing through
    snowman: zombie.map((c) => tintCopy(c, '#dfe9f2', 0.8)),
    snowmanFlip: zombie.map((c) => tintCopy(flipH(c), '#dfe9f2', 0.8)),
    snowmanAtk: zombieAtk.map((c) => tintCopy(c, '#dfe9f2', 0.8)),
    snowmanAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#dfe9f2', 0.8)),
    // arsonist: lamp-oil and cinders
    arsonist: zombie.map((c) => tintCopy(c, '#c85a20', 0.55)),
    arsonistFlip: zombie.map((c) => tintCopy(flipH(c), '#c85a20', 0.55)),
    arsonistAtk: zombieAtk.map((c) => tintCopy(c, '#c85a20', 0.55)),
    arsonistAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#c85a20', 0.55)),
    // witch: bilious, with something of the gasbag's green about it
    witch: zombie.map((c) => tintCopy(c, '#6a9a3a', 0.55)),
    witchFlip: zombie.map((c) => tintCopy(flipH(c), '#6a9a3a', 0.55)),
    witchAtk: zombieAtk.map((c) => tintCopy(c, '#6a9a3a', 0.55)),
    witchAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#6a9a3a', 0.55)),
    // shocker: ozone blue, singed at the cuffs
    shocker: zombie.map((c) => tintCopy(c, '#3a7ab0', 0.55)),
    shockerFlip: zombie.map((c) => tintCopy(flipH(c), '#3a7ab0', 0.55)),
    shockerAtk: zombieAtk.map((c) => tintCopy(c, '#3a7ab0', 0.55)),
    shockerAtkFlip: zombieAtk.map((c) => tintCopy(flipH(c), '#3a7ab0', 0.55)),
    // knight: a great helm on a suit of plate, which is the one thing you
    // have to be able to see from the other side of the room
    knight: zombie.map(buildKnight),
    knightFlip: zombie.map((c) => buildKnight(flipH(c))),
    knightAtk: zombieAtk.map(buildKnight),
    knightAtkFlip: zombieAtk.map((c) => buildKnight(flipH(c))),
    totem: buildTotem(),
    grave: buildGrave(),

    dogWhite: flatCopy(buildDog(0), '#ffd9d9'),
    playerWhite: player.map((c) => flatCopy(c, '#ffffff')),
    playerWhiteFlip: player.map((c) => flatCopy(flipH(c), '#ffffff')),
    zombieWhite: zombie.map((c) => flatCopy(c, '#ffe9e9')),
    zombieWhiteFlip: zombie.map((c) => flatCopy(flipH(c), '#ffe9e9')),
    guns,
    plaques,
    monkeybomb: guns.monkeybomb.img,
    grenade: buildSprite(GRENADE_SPRITE.rows, GRENADE_SPRITE.w, GRENADE_SPRITE.h),
  };
  // ---- the second wave: the apiary, the barrow and the web ----------------
  // `fillSet` writes the four frames every walking body needs, in one call,
  // so a new creature is one line here and cannot be missing a pose.
  const BODY = { idle: zombie, atk: zombieAtk };
  fillSet(cache, 'beekeeper', buildBeekeeper, BODY);
  fillSet(cache, 'archer', buildArcher, BODY);
  fillSet(cache, 'bulwark', buildBulwark, BODY);
  fillSet(cache, 'drummer', buildDrummer, BODY);
  fillSet(cache, 'first', buildFirst, BODY);
  // a sapper is a crawler with a bundle on its back, so it is drawn from the
  // crawler's chopped-down shape rather than the full corpse
  fillSet(cache, 'sapper', (c) => buildSapper(buildCrawler(c)), BODY);
  // the spiders are their own frames, in two leg poses
  for (const k of ['weaver', 'widow', 'porter']) {
    cache[k] = [buildSpider(k, 0), buildSpider(k, 1)];
    cache[k + 'Flip'] = [flipH(cache[k][0]), flipH(cache[k][1])];
    cache[k + 'Atk'] = cache[k];
    cache[k + 'AtkFlip'] = cache[k + 'Flip'];
  }
  cache.hive = buildHive();
  cache.bee = [buildBee(0), buildBee(1)];
  cache.beeFlip = [flipH(cache.bee[0]), flipH(cache.bee[1])];
  // ---- the nine wardens ---------------------------------------------------
  fillSet(cache, 'warden', buildWarden, BODY);
  fillSet(cache, 'organist', buildOrganist, BODY);
  fillSet(cache, 'butcher', buildButcher, BODY);
  fillSet(cache, 'queen', buildQueen, BODY);
  fillSet(cache, 'gravedigger', buildGravedigger, BODY);
  fillSet(cache, 'bellringer', buildBellringer, BODY);
  fillSet(cache, 'colonel', buildColonel, BODY);
  // the mother is a porter grown enormous: same frames, twice the body, which
  // is the point of her -- you have met this shape before and it was small
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
  ROOF: 12,          // walkable felt-and-gravel roof of the bunker
  VOID: 13,          // solid nothing: the open air beyond the parapet
  BUNK: 14,          // barracks furniture, upstairs only: solid, but low
  LOCKER: 15,        // steel locker against a wall
  TABLE: 16,         // trestle table -- solid, so it earns its footprint
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
  // upper storeys: laid boards underfoot, stud-and-plaster walls around you.
  // Deliberately a different material (and a warmer, lighter tone) than the
  // concrete and brick downstairs, so going up never looks like the same room.
  boardA: '#5d4a33',
  boardB: '#55432e',
  boardC: '#66523a',
  plankSeam: 'rgba(0,0,0,0.34)',
  plankGrain: 'rgba(0,0,0,0.13)',
  partSide: '#4f4a3f',
  partSide2: '#474336',
  partTop: '#6a6353',
  partTopDim: '#5b5548',
  partTopLit: '#7b7361',
  partDark: '#2b2822',
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

// 0..1, stable per tile pair: how the ground clusters into mud and thick
// grass without storing a single extra byte of map
function _groundNoise(x, y) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) % 1000 / 1000;
}

function paintExterior(ctx, px, py, rng) {
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  const mud = _groundNoise(Math.floor(tx / 2), Math.floor(ty / 2));
  const lush = _groundNoise(Math.floor((tx + 11) / 3), Math.floor((ty + 5) / 3));
  if (mud < 0.02) {   // a tenth of the old mud: the field was ankle-deep
    // a mud patch: wet, trodden, darker at the heart, shining where it pools
    ctx.fillStyle = rng() < 0.5 ? '#3a3025' : '#443a2c';
    ctx.fillRect(px, py, T, T);
    ctx.fillStyle = '#2e261c';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(px + ((rng() * (T - 6)) | 0), py + ((rng() * (T - 4)) | 0), 4 + ((rng() * 5) | 0), 2 + ((rng() * 3) | 0));
    }
    ctx.fillStyle = 'rgba(120,140,150,0.10)';
    ctx.fillRect(px + ((rng() * (T - 8)) | 0), py + ((rng() * (T - 5)) | 0), 6 + ((rng() * 6) | 0), 2);
    // a chewed blade or two at the edges, so it blends into the field
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = C.grass2;
      ctx.fillRect(px + ((rng() * T) | 0), py + ((rng() * T) | 0), 1, 2);
    }
    return;
  }
  const base = rng() < 0.4 ? C.dirtA : rng() < 0.6 ? C.dirtB : C.dirtC;
  ctx.fillStyle = base;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 14, rng, 0.2, 0.04);

  // dead grass tufts -- and where the ground is rich, a thick stand of it
  const tufts = lush > 0.98 ? 9 + ((rng() * 5) | 0) : (rng() * 5) | 0;   // thick stands: a tenth as many
  for (let i = 0; i < tufts; i++) {
    const x = px + ((rng() * T) | 0);
    const y = py + ((rng() * T) | 0);
    const tall = lush > 0.98;
    ctx.fillStyle = rng() < 0.5 ? C.grass : C.grass2;
    ctx.fillRect(x, y, 1, tall ? 3 + ((rng() * 2) | 0) : 2);
    ctx.fillRect(x - 1, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
    if (tall && rng() < 0.4) {
      ctx.fillStyle = '#6d7a44';
      ctx.fillRect(x, y - 1, 1, 1);
    }
  }
  if (rng() < 0.14) {
    ctx.fillStyle = C.stone;
    ctx.fillRect(px + ((rng() * (T - 4)) | 0), py + ((rng() * (T - 3)) | 0), 2 + ((rng() * 3) | 0), 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(px + ((rng() * (T - 4)) | 0), py + ((rng() * (T - 3)) | 0), 2, 1);
  }
}

function paintFloorBoards(ctx, px, py, rng, northIsWall) {
  const plank = 6;
  for (let y = 0; y < T; y += plank) {
    const k = rng();
    const base = k < 0.34 ? C.boardA : k < 0.68 ? C.boardB : C.boardC;
    ctx.fillStyle = base;
    ctx.fillRect(px, py + y, T, plank - 1);
    // grain
    ctx.fillStyle = C.plankGrain;
    for (let i = 0; i < 3; i++) {
      const gy = py + y + 1 + ((rng() * (plank - 2)) | 0);
      ctx.fillRect(px + ((rng() * T) | 0), gy, 3 + ((rng() * 9) | 0), 1);
    }
    ctx.fillStyle = C.plankSeam;
    ctx.fillRect(px, py + y + plank - 1, T, 1);
  }
  // staggered butt joints
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (let y = 0; y < T; y += plank) {
    ctx.fillRect(px + ((rng() * T) | 0), py + y, 1, plank - 1);
  }
  // knots and nail heads
  if (rng() < 0.18) {
    ctx.fillStyle = 'rgba(30,20,12,0.35)';
    ctx.beginPath();
    ctx.ellipse(px + 3 + rng() * (T - 6), py + 3 + rng() * (T - 6), 1.5 + rng() * 2, 1 + rng() * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (rng() < 0.4) {
    ctx.fillStyle = 'rgba(226,216,190,0.18)';
    ctx.fillRect(px + 1 + ((rng() * (T - 2)) | 0), py + ((rng() * T) | 0), 1, 1);
  }
  speckle(ctx, px, py, 9, rng);
  if (northIsWall) {
    const g = ctx.createLinearGradient(0, py, 0, py + 7);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, T, 7);
  }
}

/** Upstairs partitions are timber stud and plaster, not brick. */
function paintPartition(ctx, px, py, rng, n) {
  ctx.fillStyle = rng() < 0.5 ? C.partSide : C.partSide2;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 11, rng, 0.2, 0.045);

  // vertical studs ghosting through the plaster
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let x = 5; x < T; x += 8) ctx.fillRect(px + x, py, 1, T);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  ctx.fillRect(px, py + ((T / 2) | 0), T, 1);
  // scuffed skirting and a few cracks
  if (rng() < 0.3) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    const x = px + 2 + ((rng() * (T - 4)) | 0);
    let y = py + 3 + ((rng() * 8) | 0);
    for (let i = 0; i < 6 + ((rng() * 5) | 0); i++) {
      ctx.fillRect(x, y, 1, 1);
      y += 1;
      if (y > py + T - 2) break;
    }
  }

  const exposed = !n.n;
  const faceH = exposed ? 5 : 3;
  ctx.fillStyle = exposed ? C.partTop : C.partTopDim;
  ctx.fillRect(px, py, T, faceH);
  if (exposed) { ctx.fillStyle = C.partTopLit; ctx.fillRect(px, py, T, 1); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px, py + faceH, T, 1);
  speckle(ctx, px, py, 4, rng, 0.18, 0.06);
  if (!n.w) { ctx.fillStyle = C.partDark; ctx.fillRect(px, py, 1, T); }
  if (!n.e) { ctx.fillStyle = C.partDark; ctx.fillRect(px + T - 1, py, 1, T); }
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
  // The user asked for the wooden crates back: they are furniture and they
  // stay furniture. The mystery box no longer needs their silhouette to be
  // recognisable -- its golden ? burns through the darkness on its own.
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

function paintRoof(ctx, px, py, rng, northIsWall) {
  // rolled felt, a little lighter than the concrete inside so the roof
  // reads as "outside, under the moon" rather than another bunker room
  const base = rng() < 0.4 ? '#34333a' : rng() < 0.55 ? '#2f2e35' : '#38373f';
  ctx.fillStyle = base;
  ctx.fillRect(px, py, T, T);
  speckle(ctx, px, py, 20, rng);
  // felt laps
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(px, py + 11, T, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fillRect(px, py + 12, T, 1);
  // gravel
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.22)';
    ctx.fillRect(px + 1 + ((rng() * (T - 2)) | 0), py + 1 + ((rng() * (T - 2)) | 0), 1, 1);
  }
  // puddles / patch repairs
  if (rng() < 0.09) {
    ctx.fillStyle = 'rgba(14,16,22,0.42)';
    ctx.beginPath();
    ctx.ellipse(px + 4 + rng() * (T - 8), py + 4 + rng() * (T - 8),
      3 + rng() * 5, 2 + rng() * 3, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (northIsWall) {
    const g = ctx.createLinearGradient(0, py, 0, py + 6);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, T, 6);
  }
}

function paintVoid(ctx, px, py, rng, rows = 50) {
  // Open night air around an upper storey. Deliberately not a black hole: it
  // reads as sky -- deep and starry up top, thinning into a soft haze low
  // down where the eye expects the distant yard to be.
  const k = Math.max(0, Math.min(1, py / (rows * T)));   // 0 top, 1 bottom
  const r = Math.round(9 + k * 11);
  const g = Math.round(11 + k * 13);
  const b = Math.round(18 + k * 21);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(px, py, T, T);
  // a slow drifting haze band so big empty stretches are not dead flat
  const haze = Math.sin(py / T * 0.21) * 0.5 + 0.5;
  if (haze > 0.42) {
    ctx.fillStyle = `rgba(78,96,138,${(0.045 + haze * 0.055).toFixed(3)})`;
    ctx.fillRect(px, py, T, T);
  }
  // stars, thinning out as the haze thickens towards the ground
  if (rng() < 0.36 * (1 - k * 0.7)) {
    const sx = px + ((rng() * T) | 0), sy = py + ((rng() * T) | 0);
    ctx.fillStyle = `rgba(202,216,255,${(0.10 + rng() * 0.24).toFixed(2)})`;
    ctx.fillRect(sx, sy, 1, 1);
  }
}

/**
 * Paints every static tile into one canvas the size of the whole level.
 * `tiles` is a flat Uint8Array of TILE.* values, `w`/`h` the level dimensions.
 */
// one baked canvas per floor, keyed by seed -- the map is rebuilt on the fly
// when the player takes the stairs, so repainting has to stay cheap
const _levelCache = new Map();

export function paintLevel(tiles, w, h, seed = 1337, storey = 0) {
  const hit = _levelCache.get(seed);
  if (hit && hit.w === w && hit.h === h) return hit.canvas;
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
        const nb = {
          n: at(x, y - 1) === TILE.WALL, s: at(x, y + 1) === TILE.WALL,
          w: at(x - 1, y) === TILE.WALL, e: at(x + 1, y) === TILE.WALL,
        };
        if (storey > 0) paintPartition(ctx, px, py, trng, nb);
        else paintWall(ctx, px, py, trng, nb);
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
      } else if (t === TILE.ROOF) {
        paintRoof(ctx, px, py, trng, at(x, y - 1) === TILE.WALL);
        if (at(x, y - 1) === TILE.WALL) { /* shadow already inside paintRoof */ }
      } else if (t === TILE.VOID) {
        paintVoid(ctx, px, py, trng, h);
      } else {
        const shaded = at(x, y - 1) === TILE.WALL;
        if (storey > 0) paintFloorBoards(ctx, px, py, trng, shaded);
        else paintFloor(ctx, px, py, trng, shaded);
        if (t === TILE.CRATE) paintCrate(ctx, px, py, trng, { s: at(x, y + 1) === TILE.WALL });
        else if (t === TILE.RUBBLE) paintRubble(ctx, px, py, trng);
        else if (t === TILE.BUNK) paintBunk(ctx, px, py, trng);
        else if (t === TILE.LOCKER) paintLocker(ctx, px, py, trng);
        else if (t === TILE.TABLE) paintTable(ctx, px, py, trng);
      }
    }
  }
  _levelCache.set(seed, { canvas, w, h, seed });
  // keep it bounded: a handful of floors, nothing more
  if (_levelCache.size > 6) _levelCache.delete(_levelCache.keys().next().value);
  return canvas;
}

// ---------------------------------------------------------------- furniture
// Upstairs used to be empty floor with the odd crate. A barracks should look
// slept in: bunks, lockers, a table to sit at.

function bunkRng(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function paintBunk(ctx, px, py, rng) {
  paintFloorBoards(ctx, px, py, rng, false);
  const x = px + 1, y = py + 1, w = T - 2, h = T - 2;
  // frame
  ctx.fillStyle = '#3b3e47';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#4b4f59';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 4);
  // two mattresses, end on, one above the other
  for (let i = 0; i < 2; i++) {
    const my = y + 3 + i * 9;
    ctx.fillStyle = '#75725e';
    ctx.fillRect(x + 2, my, w - 4, 6);
    ctx.fillStyle = '#8b876f';
    ctx.fillRect(x + 2, my, w - 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, my + 4, w - 4, 2);
    // a folded blanket at the foot
    ctx.fillStyle = i ? '#5c4f42' : '#605440';
    ctx.fillRect(x + w - 8, my, 6, 6);
  }
  // corner posts
  ctx.fillStyle = '#23252b';
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x + 2, y + 2, w - 4, 1);
}

function paintLocker(ctx, px, py, rng) {
  paintFloorBoards(ctx, px, py, rng, false);
  const x = px + 3, y = py + 1, w = T - 6, h = T - 2;
  ctx.fillStyle = '#454b51';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#555c63';
  ctx.fillRect(x + 1, y + 1, w / 2 - 1, h - 2);
  ctx.fillStyle = '#4c535a';
  ctx.fillRect(x + w / 2, y + 1, w / 2 - 1, h - 2);
  // handles and vents
  ctx.fillStyle = '#20242a';
  ctx.fillRect(x + w / 2 - 3, y + h / 2 - 1, 2, 3);
  ctx.fillRect(x + w - 3, y + h / 2 - 1, 2, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + 2, y + 3 + i * 3, w / 2 - 3, 1);
    ctx.fillRect(x + w / 2 + 1, y + 3 + i * 3, w / 2 - 3, 1);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y + h - 2, w, 2);
}

function paintTable(ctx, px, py, rng) {
  paintFloorBoards(ctx, px, py, rng, false);
  const x = px + 1, y = py + 5, w = T - 2, h = T - 11;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 1, y + h, w - 2, 2);
  ctx.fillStyle = '#5a4527';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#71593a';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x, y + h - 1, w, 1);
  // things left on it
  const r = bunkRng(px, py);
  if (r > 0.55) {                       // a mug
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(x + 3, y + 2, 3, 4);
  } else if (r > 0.3) {                 // a spread map or a deck of cards
    ctx.fillStyle = '#9a9276';
    ctx.fillRect(x + 4, y + 2, 8, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 4, y + 3, 8, 1);
  }
  speckle(ctx, x, y, 5, rng, 0.2, 0.05);
}
