// Power-up drops. Zombies cough one up every ~28 kills.

export const POWERUPS = {
  maxammo: {
    id: 'maxammo', label: 'MAX AMMO', colour: '#f2e26a', glyph: 'A', weight: 22,
    sound: 'chime',
  },
  instakill: {
    id: 'instakill', label: 'INSTA-KILL', colour: '#e8563c', glyph: 'K', weight: 18,
    sound: 'growl', duration: 15,
  },
  doublepoints: {
    id: 'doublepoints', label: 'DOUBLE POINTS', colour: '#54c8f0', glyph: '2', weight: 18,
    sound: 'chime', duration: 20,
  },
  nuke: {
    id: 'nuke', label: 'NUKE', colour: '#8fe05a', glyph: 'N', weight: 9,
    sound: 'nuke',
  },
  carpenter: {
    id: 'carpenter', label: 'CARPENTER', colour: '#d9a95c', glyph: 'C', weight: 13,
    sound: 'hammer',
  },
  firesale: {
    id: 'firesale', label: 'FIRE SALE', colour: '#f07ac0', glyph: '$', weight: 8,
    sound: 'chime', duration: 25,
  },
  deathmachine: {
    id: 'deathmachine', label: 'DEATH MACHINE', colour: '#c05ce0', glyph: 'M', weight: 7,
    sound: 'chime', duration: 20,
  },
};

const POWER_IDS = Object.keys(POWERUPS);
const TOTAL_WEIGHT = POWER_IDS.reduce((a, k) => a + POWERUPS[k].weight, 0);

export function rollPowerup(rng = Math.random, opts = {}) {
  // Fire Sale is pointless without the box, Carpenter is pointless with no
  // broken windows -- re-roll instead of wasting the drop.
  for (let tries = 0; tries < 6; tries++) {
    let r = rng() * TOTAL_WEIGHT;
    let picked = POWER_IDS[0];
    for (const id of POWER_IDS) {
      r -= POWERUPS[id].weight;
      if (r <= 0) { picked = id; break; }
    }
    if (picked === 'firesale' && !opts.hasBox) continue;
    if (picked === 'carpenter' && opts.brokenWindows === 0) continue;
    return picked;
  }
  return 'maxammo';
}

export class Powerup {
  // a drop belongs to the storey it fell on: a Max Ammo upstairs is not
  // lying at your feet downstairs just because the x and y happen to match
  constructor(x, y, id, f = 0) {
    this.x = x; this.y = y;
    this.id = id;
    this.f = f;
    this.def = POWERUPS[id];
    this.life = 0;
    this.maxLife = 18;
    this.dead = false;
    this.spin = Math.random() * Math.PI * 2;
    this.bob = Math.random() * Math.PI * 2;
  }

  update(dt) {
    this.life += dt;
    this.spin += dt * 1.6;
    this.bob += dt * 3.2;
    if (this.life >= this.maxLife) this.dead = true;
  }

  /** Draw the floating glowing rune. */
  draw(ctx) {
    const def = this.def;
    const bobY = Math.sin(this.bob) * 2.5;
    const left = this.maxLife - this.life;
    // blink out over the last 3 seconds
    if (left < 3 && Math.floor(left * 8) % 2 === 0) return;

    const r = 13;
    ctx.save();
    ctx.translate(this.x, this.y + bobY);

    // glow
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, `${def.colour}88`);
    g.addColorStop(0.45, `${def.colour}33`);
    g.addColorStop(1, `${def.colour}00`);
    ctx.fillStyle = g;
    ctx.fillRect(-30, -30, 60, 60);

    // spinning rune plate
    ctx.rotate(Math.sin(this.spin) * 0.25);
    ctx.fillStyle = 'rgba(12,14,18,0.85)';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.92, -r * 0.38);
    ctx.lineTo(r * 0.57, r * 0.81);
    ctx.lineTo(-r * 0.57, r * 0.81);
    ctx.lineTo(-r * 0.92, -r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = def.colour;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.rotate(-Math.sin(this.spin) * 0.25);
    ctx.fillStyle = def.colour;
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, 0, 1);
    ctx.restore();

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 11, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
