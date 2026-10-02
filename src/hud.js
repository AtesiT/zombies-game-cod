// HUD, overlays and full-screen menus.
import { clamp, TAU } from './util.js';
import { WEAPONS } from './weapons.js';
import { T } from './art.js';

const INK = '#e6dcc2';
const INK_DIM = '#9a917c';
const GOLD = '#f0d98a';
const RED = '#c4463a';

function text(ctx, str, x, y, {
  font = 'bold 12px "Courier New", monospace', colour = INK, align = 'left',
  shadow = true, alpha = 1,
} = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = colour;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function bar(ctx, x, y, w, h, k, bg, fg, border = true) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, k)) * w, h);
  if (border) {
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

export class HUD {
  constructor() {
    this.hitMarker = 0;
    this.hitMarkerHead = false;
    this.pointPulse = 0;
    this.shownPoints = 0;
    this.ammoWarn = 0;
  }

  hit(head) { this.hitMarker = 0.22; this.hitMarkerHead = head; }

  update(dt, game) {
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.pointPulse = Math.max(0, this.pointPulse - dt * 2);
    this.shownPoints += (game.points - this.shownPoints) * Math.min(1, dt * 9);
    if (Math.abs(game.points - this.shownPoints) < 1) this.shownPoints = game.points;
    const s = game.player.slot;
    if (!game.player.reloading && s.mag <= WEAPONS[game.player.current].magSize * 0.25) {
      this.ammoWarn = 0.5 + Math.sin(game.time * 8) * 0.35;
    } else this.ammoWarn = 0;
  }

  // -------------------------------------------------------------------------
  draw(ctx, game, w, h) {
    const p = game.player;

    this._lowHealth(ctx, game, w, h);
    this._damageDirs(ctx, game, w, h);
    this._crosshair(ctx, game, w, h);   // doubles as the mouse cursor

    ctx.save();
    // soft gradient strip behind the bottom HUD so it reads on any background
    const g = ctx.createLinearGradient(0, h - 74, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h - 74, w, 74);
    ctx.restore();

    this._round(ctx, game, w, h);
    this._points(ctx, game, w, h);
    this._weapon(ctx, game, w, h);
    this._health(ctx, game, w, h);
    this._prompt(ctx, game, w, h);
    this._minimap(ctx, game, w, h);
    this._banners(ctx, game, w, h);
  }

  // ---------------------------------------------------------------- round --
  _round(ctx, game, w, h) {
    const y = h - 16;
    text(ctx, 'ROUND', w / 2, y - 26, { font: 'bold 11px "Courier New", monospace', colour: INK_DIM, align: 'center' });
    text(ctx, String(game.round), w / 2, y, { font: 'bold 26px "Courier New", monospace', colour: INK, align: 'center' });
    if (game.zombiesLeft > 0 && game.started) {
      text(ctx, `${game.zombiesLeft} LEFT`, w / 2, y + 13, {
        font: 'bold 10px "Courier New", monospace', colour: 'rgba(200,190,160,0.6)', align: 'center',
      });
    } else if (game.intermission > 0) {
      text(ctx, `NEXT IN ${Math.ceil(game.intermission)}`, w / 2, y + 13, {
        font: 'bold 10px "Courier New", monospace', colour: GOLD, align: 'center',
      });
    }
  }

  // --------------------------------------------------------------- points --
  _points(ctx, game, w, h) {
    const x = 16, y = h - 18;
    text(ctx, 'POINTS', x, y - 24, { font: 'bold 10px "Courier New", monospace', colour: INK_DIM });
    const s = 1 + this.pointPulse * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    text(ctx, String(Math.round(this.shownPoints)), 0, 0, {
      font: 'bold 22px "Courier New", monospace', colour: GOLD,
    });
    ctx.restore();
  }

  // --------------------------------------------------------------- weapon --
  _weapon(ctx, game, w, h) {
    const p = game.player;
    const d = p.def, s = p.slot;
    const x = w - 16;
    const yAmmo = h - 18;
    const lowMag = s.mag <= d.magSize * 0.25;
    const magStr = String(s.mag).padStart(2, '0');
    text(ctx, magStr, x, yAmmo, {
      font: 'bold 24px "Courier New", monospace',
      colour: p.reloading ? INK_DIM : lowMag ? `rgba(196,70,58,${0.65 + this.ammoWarn * 0.35})` : INK,
      align: 'right',
    });
    text(ctx, ` / ${s.reserve}`, x, yAmmo - 3, {
      font: 'bold 13px "Courier New", monospace', colour: INK_DIM, align: 'right',
    });
    text(ctx, d.name.toUpperCase(), x, yAmmo - 20, {
      font: 'bold 11px "Courier New", monospace', colour: INK, align: 'right',
    });

    // grenades
    if (p.grenades > 0) {
      text(ctx, `◈ x${p.grenades}`, x, yAmmo - 34, {
        font: 'bold 11px "Courier New", monospace', colour: GOLD, align: 'right',
      });
    }

    if (p.reloading) {
      const k = 1 - p.reloadTimer / d.reloadTime;
      bar(ctx, x - 90, yAmmo + 6, 90, 4, k, 'rgba(0,0,0,0.55)', GOLD);
      text(ctx, 'RELOADING', x - 94, yAmmo + 10, {
        font: 'bold 9px "Courier New", monospace', colour: GOLD, align: 'right',
      });
    } else if (s.mag === 0) {
      text(ctx, s.reserve > 0 ? 'PRESS R' : 'NO AMMO', x, yAmmo + 14, {
        font: 'bold 11px "Courier New", monospace',
        colour: s.reserve > 0 ? `rgba(240,217,138,${0.5 + this.ammoWarn})` : RED, align: 'right',
      });
    }
  }

  // --------------------------------------------------------------- health --
  _health(ctx, game, w, h) {
    const p = game.player;
    const bw = 168, bh = 8;
    const x = w / 2 - bw / 2, y = h - 44;
    const k = p.hp / p.maxHp;
    const col = k > 0.66 ? '#8fae6a' : k > 0.33 ? '#d0a13f' : RED;
    bar(ctx, x, y, bw, bh, k, 'rgba(0,0,0,0.6)', col);
    // hit-capacity pips: 3 hits without regen
    const pips = 3;
    for (let i = 1; i < pips; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + (bw * i) / pips, y, 1, bh);
    }
    const regenIn = Math.max(0, p.regenDelay - (game.time - p.lastHurt));
    if (p.hp < p.maxHp) {
      text(ctx, regenIn > 0.05 ? `+${Math.ceil(regenIn)}s` : 'RECOVERING', w / 2, y - 4, {
        font: 'bold 9px "Courier New", monospace',
        colour: regenIn > 0.05 ? 'rgba(200,190,160,0.55)' : '#8fae6a', align: 'center',
      });
    }
  }

  // --------------------------------------------------------------- prompt --
  _prompt(ctx, game, w, h) {
    const it = game.interaction;
    if (!it) return;
    const lines = [];
    if (it.type === 'wallbuy') {
      const d = WEAPONS[it.weapon];
      const owned = game.player.loadout[it.weapon].owned;
      lines.push(owned
        ? `[E] ${d.name} AMMO  ${d.ammoPrice}`
        : `[E] BUY ${d.name.toUpperCase()}  ${d.price}`);
    } else if (it.type === 'door') {
      lines.push(`[E] OPEN DOOR  ${it.door.price}`);
    } else if (it.type === 'barricade') {
      lines.push(it.barricade.planks >= it.barricade.maxPlanks
        ? 'BARRICADE INTACT'
        : `[E] HOLD TO REBUILD  +${10} PER PLANK`);
    } else if (it.type === 'grenade') {
      lines.push(`[E] FRAG GRENADES  ${it.price}`);
    }
    let y = h - 108;
    for (const l of lines) {
      text(ctx, l, w / 2, y, {
        font: 'bold 13px "Courier New", monospace',
        colour: it.affordable ? GOLD : '#8a8371', align: 'center',
      });
      y += 15;
    }
    if (it.type === 'barricade' && it.barricade.planks < it.barricade.maxPlanks) {
      const b = it.barricade;
      bar(ctx, w / 2 - 40, y + 2, 80, 4, b.planks / b.maxPlanks, 'rgba(0,0,0,0.6)', '#a8843f');
      text(ctx, `${b.planks}/${b.maxPlanks} PLANKS`, w / 2, y + 17, {
        font: 'bold 9px "Courier New", monospace', colour: INK_DIM, align: 'center',
      });
    }
  }

  // ------------------------------------------------------------ crosshair --
  _crosshair(ctx, game, w, h) {
    const m = game.input.mouse;
    const spread = 5 + game.player.def.spread * 320
      + Math.hypot(game.player.vel.x, game.player.vel.y) * 0.045
      + game.player.recoil * 1.4;
    const len = 5;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(m.x + dx * spread, m.y + dy * spread);
      ctx.lineTo(m.x + dx * (spread + len), m.y + dy * (spread + len));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(240,235,215,0.9)';
    ctx.lineWidth = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(m.x + dx * spread, m.y + dy * spread);
      ctx.lineTo(m.x + dx * (spread + len), m.y + dy * (spread + len));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,235,215,0.7)';
    ctx.fillRect(m.x | 0, m.y | 0, 1, 1);

    if (this.hitMarker > 0) {
      const a = clamp(this.hitMarker / 0.22, 0, 1);
      ctx.strokeStyle = this.hitMarkerHead ? `rgba(240,90,70,${a})` : `rgba(245,240,225,${a})`;
      ctx.lineWidth = 2;
      const r = 5 + (1 - a) * 4;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(m.x + sx * r, m.y + sy * r);
        ctx.lineTo(m.x + sx * (r + 5), m.y + sy * (r + 5));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --------------------------------------------------------- damage dirs ---
  _damageDirs(ctx, game, w, h) {
    const p = game.player;
    for (const d of p.hitDirs) {
      const a = clamp(1 - d.age / 1.6, 0, 1);
      const cx = w / 2, cy = h / 2;
      const r = Math.min(w, h) * 0.34;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(d.angle);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, r, -0.28, 0.28);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------- low health ---
  _lowHealth(ctx, game, w, h) {
    const p = game.player;
    const k = 1 - p.hp / p.maxHp;
    if (k <= 0.35) return;
    const s = (k - 0.35) / 0.65;
    const pulse = 0.55 + Math.sin(game.time * 4.5) * 0.2;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.62);
    g.addColorStop(0, 'rgba(90,0,0,0)');
    g.addColorStop(1, `rgba(120,10,10,${0.55 * s * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // -------------------------------------------------------------- minimap --
  _minimap(ctx, game, w, h) {
    const map = game.map;
    const pad = 10;
    const maxW = 130, maxH = 92;
    const s = Math.min(maxW / map.w, maxH / map.h);
    const mw = map.w * s, mh = map.h * s;
    const x0 = w - mw - pad, y0 = pad;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(8,9,13,0.72)';
    ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6);
    ctx.strokeStyle = 'rgba(200,190,160,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 3.5, y0 - 3.5, mw + 7, mh + 7);

    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!map.seen[ty * map.w + tx]) continue;
        const t = map.tiles[ty * map.w + tx];
        let c = null;
        if (t === 2) c = '#4b4f59';
        else if (t === 1 || t === 6) c = '#2b2c31';
        else if (t === 3) c = '#7a5a33';
        else if (t === 4) c = '#8a6a3a';
        else if (t === 5) c = '#5a4526';
        else c = '#1d1e18';
        ctx.fillStyle = c;
        ctx.fillRect(x0 + tx * s, y0 + ty * s, Math.ceil(s), Math.ceil(s));
      }
    }
    for (const z of game.zombies) {
      if (z.dead) continue;
      const tx = z.pos.x / T, ty = z.pos.y / T;
      if (!map.seen[(ty | 0) * map.w + (tx | 0)]) continue;
      ctx.fillStyle = '#c4463a';
      ctx.fillRect(x0 + tx * s - 1, y0 + ty * s - 1, 3, 3);
    }
    // player
    const px = x0 + (game.player.pos.x / T) * s;
    const py = y0 + (game.player.pos.y / T) * s;
    ctx.fillStyle = '#f0d98a';
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeRect(px - 1.5, py - 1.5, 3, 3);
    // viewport rect
    const vx = x0 + (game.cam.x / T) * s;
    const vy = y0 + (game.cam.y / T) * s;
    ctx.strokeStyle = 'rgba(240,235,215,0.30)';
    ctx.strokeRect(vx + 0.5, vy + 0.5, (game.vw / T) * s, (game.vh / T) * s);
    ctx.restore();
  }

  // -------------------------------------------------------------- banners --
  _banners(ctx, game, w, h) {
    const b = game.banner;
    if (!b || b.t <= 0) return;
    const k = b.t / b.max;
    const fade = k > 0.75 ? (1 - k) / 0.25 : k < 0.3 ? k / 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    const cy = h * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, cy - 40, w, 74);
    ctx.fillStyle = 'rgba(200,60,45,0.85)';
    ctx.fillRect(0, cy - 40, w, 1);
    ctx.fillRect(0, cy + 33, w, 1);
    text(ctx, b.title, w / 2, cy, {
      font: `bold ${b.big ? 46 : 28}px "Courier New", monospace`, colour: b.colour || INK, align: 'center',
    });
    if (b.sub) {
      text(ctx, b.sub, w / 2, cy + 24, {
        font: 'bold 13px "Courier New", monospace', colour: INK_DIM, align: 'center',
      });
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
//  Full-screen menus
// ---------------------------------------------------------------------------
export function drawTitle(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,10,0.82)';
  ctx.fillRect(0, 0, w, h);

  const t = game.time;
  const cy = h * 0.3;

  ctx.globalAlpha = 0.9 + Math.sin(t * 1.6) * 0.1;
  text(ctx, 'NACHT', w / 2, cy - 34, {
    font: 'bold 52px "Courier New", monospace', colour: '#c9c0a4', align: 'center',
  });
  text(ctx, 'DER UNTOTEN', w / 2, cy + 6, {
    font: 'bold 34px "Courier New", monospace', colour: '#a8402f', align: 'center',
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(200,60,45,0.7)';
  ctx.fillRect(w / 2 - 150, cy + 20, 300, 1);

  const lines = [
    'WASD / ARROWS — move          MOUSE — aim',
    'LEFT CLICK — fire      R — reload      1-5 / WHEEL — swap weapon',
    'E — buy weapon · open door · rebuild barricade   (+10 per plank)',
    'V — knife   G — frag grenade   M — mute   P / ESC — pause',
  ];
  let y = cy + 52;
  for (const l of lines) {
    text(ctx, l, w / 2, y, { font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center' });
    y += 19;
  }

  const blink = 0.55 + Math.sin(t * 4) * 0.45;
  text(ctx, 'CLICK TO BEGIN', w / 2, h * 0.82, {
    font: 'bold 20px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
  });
  text(ctx, 'survive as long as you can', w / 2, h * 0.82 + 20, {
    font: 'bold 11px "Courier New", monospace', colour: 'rgba(150,140,120,0.7)', align: 'center',
  });
  ctx.restore();
}

export function drawPause(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,10,0.7)';
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'PAUSED', w / 2, h * 0.42, {
    font: 'bold 34px "Courier New", monospace', colour: INK, align: 'center',
  });
  text(ctx, 'P / ESC — resume      R — restart run', w / 2, h * 0.42 + 28, {
    font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center',
  });
  ctx.restore();
}

export function drawGameOver(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = `rgba(40,4,4,${Math.min(0.82, game.overT * 0.7)})`;
  ctx.fillRect(0, 0, w, h);
  const t = Math.min(1, game.overT / 0.7);
  ctx.globalAlpha = t;

  text(ctx, 'YOU DIED', w / 2, h * 0.28, {
    font: 'bold 44px "Courier New", monospace', colour: '#a8402f', align: 'center',
  });

  const s = game.stats;
  const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const rows = [
    ['ROUNDS SURVIVED', String(s.round)],
    ['TOTAL KILLS', String(s.kills)],
    ['HEADSHOTS', String(s.headshots)],
    ['POINTS EARNED', String(s.points)],
    ['BARRICADES REBUILT', String(s.planks)],
    ['DOORS OPENED', String(s.doors)],
    ['ACCURACY', `${acc}%`],
  ];
  let y = h * 0.28 + 44;
  for (const [k, v] of rows) {
    text(ctx, k, w / 2 - 14, y, { font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'right' });
    text(ctx, v, w / 2 + 14, y, { font: 'bold 12px "Courier New", monospace', colour: INK, align: 'left' });
    y += 20;
  }

  if (game.overT > 1.1) {
    const blink = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(ctx, 'PRESS R OR CLICK TO TRY AGAIN', w / 2, h * 0.86, {
      font: 'bold 15px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
    });
  }
  ctx.restore();
}
