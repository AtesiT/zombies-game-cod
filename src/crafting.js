// The workbench in the shed. Spend salvage (and sometimes points) on gear
// you cannot buy anywhere else.

export const RECIPES = {
  medkit: {
    id: 'medkit', name: 'Medkit', salvage: 8, points: 0, key: 'H',
    colour: '#63c74d', glyph: '+',
    desc: 'Patch yourself up for 55 health. Stackable.',
    hint: 'Press H to use.',
  },
  plankkit: {
    id: 'plankkit', name: 'Plank Bundle', salvage: 5, points: 0,
    colour: '#c8a05a', glyph: '=',
    desc: 'Nails two planks back on every broken window at once.',
  },
  fragkit: {
    id: 'fragkit', name: 'Frag Bundle', salvage: 6, points: 250,
    colour: '#8fa0b0', glyph: 'o',
    desc: 'Two more Mk2 frag grenades.',
  },
  ammocrate: {
    id: 'ammocrate', name: 'Ammo Crate', salvage: 10, points: 0,
    colour: '#e0c060', glyph: 'A',
    desc: 'Refills reserve ammo for every weapon you carry.',
  },
  armorplate: {
    id: 'armorplate', name: 'Armour Plate', salvage: 14, points: 1500,
    colour: '#7aa8d0', glyph: 'V',
    desc: 'Absorbs the next 60 damage before your health does.',
  },
  spikes: {
    id: 'spikes', name: 'Barricade Spikes', salvage: 10, points: 1000,
    colour: '#c86a5a', glyph: 'W',
    desc: 'Windows bite back for 3 rounds. 40 damage a chew.',
  },
};

export const RECIPE_ORDER = Object.keys(RECIPES);

export class Workbench {
  /**
   * The bench stands in the attic at the top of the house, so the storey you
   * are on decides whether there is one under your hands at all: the game
   * re-points it every time you change floor, and it keeps its last position
   * on the storeys that have no bench (nothing looks at it up there).
   */
  constructor(spot) {
    this.x = spot?.x ?? 0;
    this.y = spot?.y ?? 0;
    this.hasSpot = !!spot;
    this.spikesRounds = 0;
  }

  /** Follow the storey you have just climbed to. */
  useSpot(spot) {
    this.hasSpot = !!spot;
    if (!spot) return;
    this.x = spot.x;
    this.y = spot.y;
  }

  /** Can the player afford this recipe right now? */
  canCraft(game, id) {
    const r = RECIPES[id];
    if (!r) return 'nope';
    if (game.player.salvage < r.salvage) return 'salvage';
    if (game.player.points < r.points) return 'points';
    return 'ok';
  }

  craft(game, id) {
    if (this.canCraft(game, id) !== 'ok') return null;
    const r = RECIPES[id];
    const p = game.player;
    p.salvage -= r.salvage;
    p.points -= r.points;
    p.crafted[id] = (p.crafted[id] ?? 0) + 1;

    switch (id) {
      case 'medkit': p.medkits = (p.medkits ?? 0) + 1; break;
      case 'fragkit': p.grenades = Math.min(9, p.grenades + 2); break;
      case 'plankkit': game.carpenter(2); break;
      case 'ammocrate': p.refillAllReserve(); break;
      case 'armorplate': p.armor = Math.min(120, (p.armor ?? 0) + 60); break;
      case 'spikes': this.spikesRounds = 3; break;
      default: break;
    }
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
