// The workbench. It stands on the roof (see WORKBENCH_ROOF in mapData.js), so
// anything you want built, you carry up three storeys for.
//
// ---------------------------------------------------------------------------
//  WHAT IS ON THE BENCH, AND WHAT IS ON THE SHELF.
//
//  The first bench was six vending-machine buttons with nothing behind them:
//  no progression, no reason to climb, and every one of them a consumable you
//  bought the moment you could afford it. It was emptied while the set was
//  rebuilt, and what comes back now comes back smaller and sharper: the two
//  buttons that were always honest (a medkit, an armour plate) plus one thing
//  the old bench could never be -- a permanent change to the house itself.
//
//  The rest of the first six still live in SHELVED_RECIPES below, already
//  rewritten onto the new contract, so hanging one back on is one line:
//
//      RECIPES.plankkit = SHELVED_RECIPES.plankkit;
//
//  and the menu, the co-op path and tools/harness/craft*.mjs all pick it up
//  from there. The order the rows come in is the order they were hung.
// ---------------------------------------------------------------------------
//
//  A recipe is data plus two optional functions:

//
//    id, name         key, and what the row says
//    salvage, points  what it costs (either may be 0)
//    colour, glyph    the stripe down the row's left edge, and its icon
//    desc             one line inside the row
//    hint             one line under the menu, when this row is selected
//    once             true = one per run; a built row says BUILT and refuses
//    apply(game, p)   what you get, run *after* the cost is taken
//    useful(game, p)  may it take your money right now? Without it a recipe is
//                     always worth buying. With it, a purchase that would
//                     change nothing is refused, and the row says why (`full`)
//                     instead of quietly eating your scrap.
//    full             that refusal, e.g. 'GRANADES FULL'
//
//  `useful` exists because the old bench sold +2 frags to a man already
//  carrying nine, and a 120-armour plate to a man already in one: the money
//  went first and the clamp happened after, so the player paid for air. Every
//  new recipe that tops something up owes the bench one of these.

import { WEAPON_ORDER, defFor } from './weapons.js';

export const RECIPES = {};

/**
 * Deepen every window in the house by two planks.
 *
 * `boards` is false when a guest is merely catching up with a house that
 * already has the shutters: its plank counts arrive in the snapshot already
 * deepened, so adding boards here would add them twice.
 */
export function applyShutters(game, boards = true) {
  for (const F of game.map?.floors ?? []) {
    for (const b of F.barricades ?? []) {
      b.maxPlanks += 2;
      if (boards) b.planks = Math.min(b.maxPlanks, b.planks + 2);
    }
  }
  if (game.workbench) game.workbench.shuttersUp = true;
}

/**
 * The bench, live. Read this rather than caching a list at load time: a
 * blueprint can be hung on the bench mid-run (a found blueprint, a bench
 * level), and the tests hang their own on to check the money side of the
 * contract.
 */
export function recipeIds() { return Object.keys(RECIPES); }

/**
 * Look a blueprint up by id -- without falling through to Object.prototype.
 * The id can arrive off the network (net.js, `m:'craft'`), and RECIPES is a
 * plain object, so `RECIPES['__proto__']` would otherwise come back as
 * something truthy that is not a recipe at all.
 */
export function recipe(id) {
  return Object.prototype.hasOwnProperty.call(RECIPES, id) ? RECIPES[id] : undefined;
}

/** The word the player gets when the answer is no. */
export function craftRefusal(id, why) {
  const r = recipe(id);
  switch (why) {
    case 'salvage': return 'NOT ENOUGH SCRAP';
    case 'points': return 'NOT ENOUGH POINTS';
    case 'once': return 'ALREADY BUILT';
    case 'useless': return r?.full ?? 'NOTHING TO DO';
    default: return 'NO SUCH BLUEPRINT';
  }
}

/** Why a row is greyed out, in the short form the menu prints on it. */
export function craftRowNote(game, id, why) {
  const r = recipe(id);
  if (why === 'ok') return '';
  if (why === 'salvage') {
    const need = (r?.salvage ?? 0) - (game.player?.salvage ?? 0);
    return `NEED ${need} MORE SCRAP`;
  }
  if (why === 'points') {
    const need = (r?.points ?? 0) - (game.player?.points ?? 0);
    return `NEED ${need} MORE PTS`;
  }
  return craftRefusal(id, why);
}

export class Workbench {
  /**
   * The bench stands on the top storey, so the floor you are on decides
   * whether there is one under your hands at all: the game re-points it every
   * time you climb, and it keeps its last position on the storeys that have no
   * bench (nothing draws it up there).
   */
  constructor(spot) {
    this.x = spot?.x ?? 0;
    this.y = spot?.y ?? 0;
    this.hasSpot = !!spot;
    // steel shutters are bought once per house, not once per player: the flag
    // lives here so the second buyer of either team is refused honestly
    this.shuttersUp = false;
    // Barricade spikes are the bench's one effect that outlives the purchase:
    // windows bite back for three rounds. It is deliberately *shared* -- the
    // windows are shared, and in co-op somebody has to be able to buy for the
    // house. Whoever pays, everybody's windows bite.
    this.spikesRounds = 0;
  }

  /** Follow the storey you have just climbed to. */
  useSpot(spot) {
    this.hasSpot = !!spot;
    if (!spot) return;
    this.x = spot.x;
    this.y = spot.y;
  }

  /**
   * 'ok', or the reason it is not: 'nope' (no such blueprint), 'once',
   * 'useless', 'salvage', 'points'. The order matters -- a purchase that would
   * do nothing is refused before anybody looks in the purse, so the row can
   * say the useful thing.
   */
  canCraft(game, id, p = game.player) {
    const r = recipe(id);
    if (!r || !p) return 'nope';
    if (r.once && (p.crafted?.[id] ?? 0) > 0) return 'once';
    if (r.useful && !r.useful(game, p)) return 'useless';
    if ((p.salvage ?? 0) < (r.salvage ?? 0)) return 'salvage';
    if ((p.points ?? 0) < (r.points ?? 0)) return 'points';
    return 'ok';
  }

  /** Take the money, hand over the goods. Returns the recipe, or null. */
  craft(game, id, p = game.player) {
    if (this.canCraft(game, id, p) !== 'ok') return null;
    const r = recipe(id);
    p.salvage = (p.salvage ?? 0) - (r.salvage ?? 0);
    p.points = (p.points ?? 0) - (r.points ?? 0);
    p.crafted[id] = (p.crafted?.[id] ?? 0) + 1;
    if (typeof r.apply === 'function') r.apply(game, p);
    return r;
  }

  onRoundStart() {
    if (this.spikesRounds > 0) this.spikesRounds--;
  }

  draw(ctx) {
    const { x, y } = this;
    // bench
    ctx.fillStyle = '#4a3826';
    ctx.fillRect(x - 18, y - 8, 36, 16);
    ctx.fillStyle = '#5e4830';
    ctx.fillRect(x - 18, y - 8, 36, 4);
    ctx.fillStyle = '#33261a';
    ctx.fillRect(x - 18, y + 5, 36, 3);
    for (let i = -15; i < 16; i += 10) {
      ctx.fillStyle = '#3d2e1f';
      ctx.fillRect(x + i, y - 8, 2, 16);
    }
    ctx.strokeStyle = '#241a11';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 18.5, y - 8.5, 37, 17);
    // tools
    ctx.fillStyle = '#b9b6ae';
    ctx.fillRect(x - 12, y - 4, 9, 2);
    ctx.fillRect(x - 4, y - 4, 2, 6);
    ctx.fillStyle = '#c8a05a';
    ctx.fillRect(x + 4, y - 5, 7, 3);
    ctx.fillRect(x + 4, y - 2, 3, 5);
    ctx.fillStyle = '#7fd75a';
    ctx.fillRect(x - 15, y + 1, 5, 4);
    // vice
    ctx.fillStyle = '#6a6a72';
    ctx.fillRect(x + 12, y - 3, 5, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 11, 18, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
//  The first six, off the bench and onto the shelf. Each one carries the
//  `useful` check it never had, which is the whole point of keeping them: when
//  they go back on, they cannot sell you something you are already full of.
// ---------------------------------------------------------------------------
export const SHELVED_RECIPES = {
  medkit: {
    id: 'medkit', name: 'Medkit', salvage: 8, points: 0, key: 'H',
    colour: '#63c74d', glyph: '+',
    desc: 'Patch yourself up for 55 health. Stackable.',
    hint: 'Press H to use.',
    // three is a pocket, not a pharmacy: past that the row says so instead of
    // letting you bury forty scrap in a health bar you will never reach
    useful: (game, p) => (p.medkits ?? 0) < 3,
    full: 'POCKETS FULL',
    apply: (game, p) => { p.medkits = (p.medkits ?? 0) + 1; },
  },
  plankkit: {
    id: 'plankkit', name: 'Plank Bundle', salvage: 5, points: 0,
    colour: '#c8a05a', glyph: '=',
    desc: 'Nails two planks back on every broken window at once.',
    useful: (game) => (game.map?.barricades ?? []).some((b) => b.planks < b.maxPlanks),
    full: 'WINDOWS INTACT',
    apply: (game) => { game.carpenter(2); },
  },
  fragkit: {
    id: 'fragkit', name: 'Frag Bundle', salvage: 6, points: 250,
    colour: '#8fa0b0', glyph: 'o',
    desc: 'Two more Mk2 frag grenades.',
    useful: (game, p) => (p.grenades ?? 0) < 9,
    full: 'GRANADES FULL',
    apply: (game, p) => { p.grenades = Math.min(9, (p.grenades ?? 0) + 2); },
  },
  ammocrate: {
    id: 'ammocrate', name: 'Ammo Crate', salvage: 10, points: 0,
    colour: '#e0c060', glyph: 'A',
    desc: 'Refills reserve ammo for every weapon you carry.',
    // it refills the magazine too, so a gun that is merely half-empty in the
    // chamber still counts as worth paying for
    useful: (game, p) => WEAPON_ORDER.some((id) => {
      const s = p.loadout?.[id];
      if (!s?.owned) return false;
      const d = defFor(id, !!p.packed?.has(id));
      return (s.reserve ?? 0) < d.maxReserve || (s.mag ?? 0) < d.mag;
    }),
    full: 'AMMO FULL',
    apply: (game, p) => { p.refillAllReserve(); },
  },
  armorplate: {
    id: 'armorplate', name: 'Armour Plate', salvage: 14, points: 1500,
    colour: '#7aa8d0', glyph: 'V',
    desc: 'Absorbs the next 60 damage before your health does.',
    useful: (game, p) => (p.armor ?? 0) < 120,
    full: 'ARMOUR FULL',
    apply: (game, p) => { p.armor = Math.min(120, (p.armor ?? 0) + 60); },
  },
  spikes: {
    id: 'spikes', name: 'Barricade Spikes', salvage: 10, points: 1000,
    colour: '#c86a5a', glyph: 'W',
    desc: 'Windows bite back for 3 rounds. 40 damage a chew.',
    hint: 'Shared: whoever pays, every window in the house bites.',
    useful: (game) => (game.workbench?.spikesRounds ?? 0) <= 0,
    full: 'SPIKES ALREADY UP',
    apply: (game) => { game.workbench.spikesRounds = 3; },
  },
};

// ---------------------------------------------------------------------------
//  The bench as it stands: the two honest consumables, and one permanent
//  change to the house. The order here is the order of the rows in the menu.
// ---------------------------------------------------------------------------
RECIPES.medkit = SHELVED_RECIPES.medkit;
RECIPES.armorplate = SHELVED_RECIPES.armorplate;
RECIPES.shutters = {
  id: 'shutters', name: 'Steel Shutters', salvage: 30, points: 2500,
  colour: '#9fb4c8', glyph: '#',
  desc: 'Every window on every floor takes two more planks.',
  hint: 'Once per house: all three storeys at once, and the cap goes up, not just the boards.',
  // a house-wide once: the second purchase would be planks nobody can spend,
  // so the row says so instead of taking the money
  useful: (game) => !game.workbench?.shuttersUp,
  full: 'SHUTTERS ALREADY UP',
  apply: (game) => {
    applyShutters(game);
    // bannerShow() itself tells the guests (game.js), so no second netEmit
    game.bannerShow?.('STEEL SHUTTERS', 'every window in the house takes two more planks',
      { dur: 3.2, colour: '#9fb4c8' });
  },
};
