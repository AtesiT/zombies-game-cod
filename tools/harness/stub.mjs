// Headless harness: a minimal DOM + canvas so the game logic can run in Node.
// Run `npm i` in this directory first (it only pulls @napi-rs/canvas, and the
// game itself stays dependency-free -- this is dev tooling, nothing more).
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SRC = resolve(HERE, '..', '..', 'src');
export const ROOT = resolve(HERE, '..', '..');

export function nc(w = 300, h = 150) {
  const c = createCanvas(w || 1, h || 1);
  c.style = {};
  c.addEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 };
globalThis.document = { createElement: (t) => (t === 'canvas' ? nc() : { style: {} }), getElementById: () => nc(800, 500) };
globalThis.performance = { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.AudioContext = undefined;

export async function load() {
  const [game, input, ent, wep, perks, craft, ach, tr, set, pu, hud] = await Promise.all([
    import(SRC + '/game.js'), import(SRC + '/input.js'), import(SRC + '/entities.js'),
    import(SRC + '/weapons.js'), import(SRC + '/perks.js'), import(SRC + '/crafting.js'),
    import(SRC + '/achievements.js'), import(SRC + '/traps.js'), import(SRC + '/settings.js'),
    import(SRC + '/powerups.js'), import(SRC + '/hud.js'),
  ]);
  return {
    Game: game.Game, VW: game.VW, VH: game.VH, Input: input.Input,
    WEAPONS: wep.WEAPONS, WEAPON_ORDER: wep.WEAPON_ORDER, PAP_PRICE: wep.PAP_PRICE,
    PERKS: perks.PERKS, RECIPE_ORDER: craft.RECIPE_ORDER, ENEMY_TYPES: ent.ENEMY_TYPES,
    Zombie: ent.Zombie, Grenade: ent.Grenade, settings: set.settings, SETTING_DEFS: set.SETTING_DEFS,
    TRAP_PRICE: tr.TRAP_PRICE, POWERUPS: pu.POWERUPS ?? {},
    menuRows: hud.menuRows, menuHitTest: hud.menuHitTest, CONTROL_ROWS: hud.CONTROL_ROWS,
  };
}
