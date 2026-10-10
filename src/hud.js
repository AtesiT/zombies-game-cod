// HUD, overlays and full-screen menus.
import { clamp, TAU } from './util.js';
import { WEAPONS } from './weapons.js';
import { PERKS } from './perks.js';
import { RECIPES, RECIPE_ORDER } from './crafting.js';
import { POWERUPS } from './powerups.js';
import { loadBoard } from './achievements.js';
import { T } from './art.js';
import { settings, SETTING_DEFS } from './settings.js';
import { MAX_PLAYERS } from './net.js';
import { isPortrait, isTouchDevice } from './touch.js';

const INK = '#e6dcc2';
const INK_DIM = '#9a917c';
const GOLD = '#f0d98a';
const RED = '#c4463a';

// ------------------------------------------------------------------ text
// Setting ctx.font is one of the more expensive things you can ask a 2d
// context for, and shaping a string twice (shadow + fill) is not free either.
// The HUD asks for the same handful of strings every frame, so bake each one
// once into its own little canvas and blit it. Readouts that change -- points,
// ammo, round -- settle after a few frames; the cache is capped and evicts the
// oldest entry so a long session cannot grow it without bound.
const TEXT_CACHE = new Map();
const TEXT_CACHE_MAX = 1200;
const TEXT_PAD = 3;
let _measurer = null;

function measurer() {
  if (!_measurer) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    _measurer = c.getContext('2d');
  }
  return _measurer;
}

// A colour that fades -- a blinking prompt, a low-ammo warning -- arrives here
// as a fresh rgba() string every frame, which would mint a new sprite every
// frame and evict the whole cache before anything got reused. So split the
// alpha out: bake the glyphs opaque and put the fade on globalAlpha instead.
function splitColour(colour) {
  const m = /^\s*rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(colour);
  if (m) {
    return {
      rgb: `rgb(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])})`,
      a: m[4] !== undefined && Number.isFinite(+m[4]) ? +m[4] : 1,
    };
  }
  return { rgb: colour, a: 1 };
}

function textSprite(str, font, colour, shadow) {
  const { rgb, a } = splitColour(colour);
  const key = `${font}|${rgb}|${shadow ? 1 : 0}|${str}`;
  const hit = TEXT_CACHE.get(key);
  if (hit) return hit;

  const m = measurer();
  m.font = font;
  const tm = m.measureText(str);
  const tw = Math.ceil(tm.width);
  const asc = Math.ceil(tm.actualBoundingBoxAscent || 9);
  const desc = Math.ceil(tm.actualBoundingBoxDescent || 3);

  const c = document.createElement('canvas');
  c.width = Math.max(1, tw + TEXT_PAD * 2);
  c.height = Math.max(1, asc + desc + TEXT_PAD * 2);
  const x = c.getContext('2d');
  x.font = font;
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  if (shadow) {
    x.fillStyle = 'rgba(0,0,0,0.75)';
    x.fillText(str, TEXT_PAD + 1, TEXT_PAD + asc + 1);
  }
  x.fillStyle = rgb;
  x.fillText(str, TEXT_PAD, TEXT_PAD + asc);

  const sprite = { canvas: c, tw, ox: TEXT_PAD, oy: TEXT_PAD + asc, alpha: a };
  if (TEXT_CACHE.size >= TEXT_CACHE_MAX) TEXT_CACHE.delete(TEXT_CACHE.keys().next().value);
  TEXT_CACHE.set(key, sprite);
  return sprite;
}

export function text(ctx, str, x, y, {
  font = 'bold 12px "Courier New", monospace', colour = INK, align = 'left',
  shadow = true, alpha = 1,
} = {}) {
  str = String(str);
  // A blitted sprite is only crisp at 1:1. Anything drawn under a scale or a
  // rotation -- the points readout punches up when you score -- gets the real
  // thing instead, at its own (small) cost.
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const scaled = m && (Math.abs(m.a - 1) > 0.02 || Math.abs(m.d - 1) > 0.02 || m.b || m.c);
  if (scaled) {
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
    return;
  }

  const s = textSprite(str, font, colour, shadow);
  const dx = align === 'right' ? x - s.ox - s.tw : align === 'center' ? x - s.ox - s.tw / 2 : x - s.ox;
  const dy = y - s.oy;
  ctx.save();
  ctx.globalAlpha = alpha * s.alpha;
  ctx.drawImage(s.canvas, Math.round(dx), Math.round(dy));
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
    if (!game.player.reloading && s.mag <= WEAPONS[game.player.current].mag * 0.25) {
      this.ammoWarn = 0.5 + Math.sin(game.time * 8) * 0.35;
    } else this.ammoWarn = 0;
  }

  // -------------------------------------------------------------------------
  _fps(ctx, game, w, h) {
    if (!settings.get('fps')) return;
    const f = Math.round(game.fps ?? 60);
    const colour = f >= 55 ? '#7fbf5f' : f >= 40 ? '#f0d98a' : '#c4463a';
    ctx.save();
    ctx.fillStyle = 'rgba(6,7,10,0.55)';
    ctx.fillRect(w - 58, 6, 52, 18);
    text(ctx, `${f} FPS`, w - 32, 17, {
      font: 'bold 12px "Courier New", monospace', colour, align: 'center',
    });
    ctx.restore();
  }

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
    this._perks(ctx, game, w, h);
    this._timers(ctx, game, w, h);
    this._scrap(ctx, game, w, h);
    this._prompt(ctx, game, w, h);
    this._minimap(ctx, game, w, h);
    this._net(ctx, game, w, h);
    this._squad(ctx, game, w, h);
    this._revive(ctx, game, w, h);
    this._banners(ctx, game, w, h);
    this._fps(ctx, game, w, h);
    this._floor(ctx, game, w, h);
    if (game.craftOpen) this._craftMenu(ctx, game, w, h);
    this._toast(ctx, game, w, h);
  }

  // ------------------------------------------------------------------ net --
  /** Who else is in the room, and how to get somebody into it. */
  _net(ctx, game, w, h) {
    const net = game.net;
    if (!net || net.role === 'off') return;
    const y = 30;
    if (net.isHost) {
      const n = 1 + net.peers.size;
      const where = net.addr || (net.url ? 'THIS MACHINE' : '');
      text(ctx, n > 1 ? `ROOM  ${n}/${MAX_PLAYERS}` : `ROOM OPEN  ${n}/${MAX_PLAYERS}   \u00b7   ${where}`,
        w - 12, y, { font: 'bold 10px "Courier New", monospace', colour: '#9fd0e0', align: 'right' });
    } else {
      text(ctx, `HOST  ${net.nameOf?.(net.hostId) ?? ''}`.trim(), w - 12, y, {
        font: 'bold 10px "Courier New", monospace', colour: '#9fd0e0', align: 'right',
      });
    }
  }

  // ---------------------------------------------------------------- squad --
  /** Co-op: the other bodies, across the top left under the round counter. */
  _squad(ctx, game, w, h) {
    const mates = (game.players ?? []).filter((pl) => pl && pl !== game.player);
    if (!mates.length) return;
    let y = 46;
    for (const m of mates) {
      const name = (m.name || 'PLAYER').slice(0, 10);
      const downed = m.downed && !m.dead;
      const colour = m.dead ? '#6b6b6b' : downed ? RED : '#cfe0ee';
      text(ctx, name, 14, y, { font: 'bold 10px "Courier New", monospace', colour, shadow: true });
      // a little health bar, or a bleeding-out one
      const bw = 54, bh = 4, bx = 14 + 62, by = y - 7;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      const k = m.dead ? 0 : clamp((m.hp ?? 0) / (m.maxHp || 100), 0, 1);
      if (downed) {
        const bleed = clamp((m.bleedT ?? 0) / 32, 0, 1);
        ctx.fillStyle = 'rgba(120,40,40,0.9)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = RED;
        ctx.fillRect(bx, by, bw * bleed, bh);
      } else {
        ctx.fillStyle = k > 0.5 ? '#63c74d' : k > 0.25 ? GOLD : RED;
        ctx.fillRect(bx, by, bw * k, bh);
      }
      ctx.restore();
      if (m.dead) {
        text(ctx, 'OUT', bx + bw + 6, y, { font: 'bold 9px "Courier New", monospace', colour: '#8a8371' });
      } else if (downed) {
        text(ctx, 'DOWN', bx + bw + 6, y, { font: 'bold 9px "Courier New", monospace', colour: RED });
      }
      y += 14;
    }
  }

  /** "HOLD F" over the body at your feet. */
  _revive(ctx, game, w, h) {
    const p = game.player;
    if (!p || p.dead) return;
    const near = (game.players ?? []).find((o) => o !== p && o.downed && !o.dead
      && Math.hypot(o.pos.x - p.pos.x, o.pos.y - p.pos.y) < 40);
    if (near) {
      const blink = 0.7 + Math.sin(game.time * 8) * 0.3;
      text(ctx, `HOLD F  REVIVE ${(near.name || 'TEAM').slice(0, 10)}`, w / 2, h * 0.62, {
        font: 'bold 13px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
      });
      return;
    }
    if (p.downed && !p.dead) {
      const left = Math.max(0, p.bleedT ?? 0);
      text(ctx, `YOU ARE DOWN  ${left.toFixed(0)}s`, w / 2, h * 0.34, {
        font: 'bold 18px "Courier New", monospace', colour: RED, align: 'center',
      });
      text(ctx, 'somebody has to reach you', w / 2, h * 0.34 + 18, {
        font: 'bold 11px "Courier New", monospace', colour: INK_DIM, align: 'center',
      });
    }
  }

  // ---------------------------------------------------------------- perks --
  _perks(ctx, game, w, h) {
    const list = [...game.player.perks];
    if (!list.length) return;
    const size = 20, gap = 4;
    const totalW = list.length * size + (list.length - 1) * gap;
    let x = w / 2 - totalW / 2;
    const y = h - 92;
    for (const id of list) {
      const def = PERKS[id];
      ctx.save();
      ctx.fillStyle = 'rgba(10,11,15,0.8)';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = def.colour;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(def.short, x + size / 2, y + size / 2 + 3);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      ctx.restore();
      x += size + gap;
    }
  }

  // --------------------------------------------------------- powerup timers --
  _timers(ctx, game, w, h) {
    const active = [];
    for (const [k, v] of Object.entries(game.timers)) {
      if (v > 0) active.push({ id: k, t: v });
    }
    if (!active.length) return;
    let y = 66;
    for (const a of active) {
      const def = POWERUPS[a.id];
      const x = 12;
      ctx.save();
      ctx.fillStyle = 'rgba(10,11,15,0.75)';
      ctx.fillRect(x, y, 108, 15);
      ctx.fillStyle = def ? def.colour : '#f0d98a';
      ctx.fillRect(x, y, 3, 15);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = def ? def.colour : INK;
      ctx.fillText((def ? def.label : a.id.toUpperCase()), x + 7, y + 11);
      ctx.fillStyle = INK_DIM;
      ctx.textAlign = 'right';
      ctx.fillText(`${a.t.toFixed(1)}s`, x + 104, y + 11);
      ctx.restore();
      y += 18;
    }
  }

  // ------------------------------------------------------------ scrap/medkits --
  _scrap(ctx, game, w, h) {
    const p = game.player;
    const x = 16, y = h - 62;
    ctx.save();
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fd0e0';
    ctx.fillText(`SCRAP ${p.salvage}`, x, y);
    if ((p.medkits ?? 0) > 0) {
      ctx.fillStyle = '#63c74d';
      ctx.fillText(`MEDKIT x${p.medkits}  [H]`, x, y + 13);
    }
    if ((p.armor ?? 0) > 0) {
      bar(ctx, x, y + 18, 70, 4, Math.min(1, p.armor / 120), 'rgba(0,0,0,0.6)', '#7aa8d0');
    }
    ctx.restore();
  }

  // ----------------------------------------------------------- craft menu --
  _craftMenu(ctx, game, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,7,10,0.88)';
    ctx.fillRect(0, 0, w, h);
    text(ctx, 'WORKBENCH', w / 2, 78, {
      font: 'bold 26px "Courier New", monospace', colour: GOLD, align: 'center',
    });
    text(ctx, `SCRAP: ${game.player.salvage}     POINTS: ${game.points}`, w / 2, 98, {
      font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center',
    });

    const cols = 2, cw = 330, ch = 62, gap = 12;
    const totalW = cols * cw + gap;
    const x0 = w / 2 - totalW / 2;
    let y0 = 122;
    RECIPE_ORDER.forEach((id, i) => {
      const r = RECIPES[id];
      const col = i % cols, row = (i / cols) | 0;
      const x = x0 + col * (cw + gap);
      const y = y0 + row * (ch + gap);
      const why = game.workbench.canCraft(game, id);
      const ok = why === 'ok';
      ctx.globalAlpha = ok ? 1 : 0.5;
      ctx.fillStyle = 'rgba(18,20,26,0.95)';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = ok ? 'rgba(240,217,138,0.55)' : 'rgba(120,115,100,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = r.colour;
      ctx.fillRect(x, y, 3, ch);

      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = r.colour;
      ctx.fillText(`[${i + 1}] ${r.name.toUpperCase()}`, x + 12, y + 22);
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = INK_DIM;
      ctx.fillText(r.desc, x + 12, y + 38);
      ctx.fillStyle = ok ? GOLD : RED;
      ctx.textAlign = 'right';
      const cost = `${r.salvage} SCRAP` + (r.points ? `  ${r.points} PTS` : '');
      ctx.fillText(cost, x + cw - 12, y + 54);
      ctx.globalAlpha = 1;
    });

    text(ctx, '[E] or [ESC] to step away', w / 2, h - 40, {
      font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center',
    });
    ctx.restore();
  }

  // ------------------------------------------------------- achievement toast --
  _toast(ctx, game, w, h) {
    const a = game.achievements.banner;
    if (!a) return;
    const k = game.achievements.bannerT / 3.4;
    const fade = k > 0.85 ? (1 - k) / 0.15 : k < 0.18 ? k / 0.18 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    const bw = 300, bh = 52;
    const x = w - bw - 14, y = h * 0.16;
    ctx.fillStyle = 'rgba(10,11,15,0.9)';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = GOLD;
    ctx.fillRect(x, y, 3, bh);
    ctx.strokeStyle = 'rgba(240,217,138,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = 'rgba(240,217,138,0.85)';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ACHIEVEMENT UNLOCKED', x + 12, y + 16);
    ctx.fillStyle = INK;
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillText(a.name.toUpperCase(), x + 12, y + 34);
    ctx.fillStyle = INK_DIM;
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillText(a.desc, x + 12, y + 46);
    ctx.restore();
  }

  // ---------------------------------------------------------------- round --
  _floor(ctx, game, w, h) {
    if (!game.started) return;
    const m = game.map;
    if (!m.floorShort) return;
    const x = 10, y = 96;
    ctx.save();
    ctx.fillStyle = 'rgba(6,7,10,0.55)';
    ctx.fillRect(x, y, 96, 17);
    ctx.fillStyle = m.isRoof ? '#9fd0f0' : '#e6dcc2';
    ctx.fillRect(x, y, 2, 17);
    text(ctx, m.floorShort === 'G' ? 'GROUND FLOOR' : m.floorName, x + 8, y + 12, {
      font: 'bold 10px "Courier New", monospace',
      colour: m.isRoof ? '#9fd0f0' : '#e6dcc2',
    });
    ctx.restore();
  }

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
    // The readout lerps toward the real total, so it used to bake a brand new
    // text sprite on every frame of the catch-up. Round the *string* to a
    // coarse step while the gap is still wide -- you cannot read the
    // difference at that speed -- and let it land on the exact figure once
    // it is nearly there. The number itself keeps lerping exactly.
    const gap = Math.abs(game.points - this.shownPoints);
    const step = gap > 500 ? 25 : gap > 120 ? 10 : gap > 8 ? 5 : 1;
    const shown = step === 1 ? Math.round(this.shownPoints)
      : Math.round(this.shownPoints / step) * step;
    const s = 1 + this.pointPulse * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    text(ctx, String(shown), 0, 0, {
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
    const lowMag = s.mag <= d.mag * 0.25;
    const magStr = String(s.mag).padStart(2, '0');
    const packed = p.isPacked;
    const nameCol = packed ? '#8fe05a' : INK;

    text(ctx, magStr, x, yAmmo, {
      font: 'bold 24px "Courier New", monospace',
      colour: p.reloading ? INK_DIM : lowMag ? `rgba(196,70,58,${0.65 + this.ammoWarn * 0.35})` : INK,
      align: 'right',
    });
    text(ctx, ` / ${s.reserve}`, x, yAmmo - 3, {
      font: 'bold 13px "Courier New", monospace', colour: INK_DIM, align: 'right',
    });
    text(ctx, d.name.toUpperCase(), x, yAmmo - 20, {
      font: 'bold 11px "Courier New", monospace', colour: nameCol, align: 'right',
    });
    if (packed) {
      text(ctx, 'PACK-A-PUNCHED', x, yAmmo - 30, {
        font: 'bold 8px "Courier New", monospace', colour: '#8fe05a', align: 'right',
      });
    }

    // the second carried gun, dimmed, above the active one
    const other = p.active === 0 ? 1 : 0;
    const otherId = p.slots[other];
    const yOther = packed ? yAmmo - 44 : yAmmo - 34;
    if (otherId) {
      const od = game.packedDef(otherId);
      const os = p.loadout[otherId];
      text(ctx, `[2] ${od.name.toUpperCase()}`, x, yOther, {
        font: 'bold 10px "Courier New", monospace',
        colour: p.packed.has(otherId) ? 'rgba(143,224,90,0.6)' : 'rgba(230,220,194,0.45)',
        align: 'right',
      });
      text(ctx, `${os.mag} / ${os.reserve}`, x, yOther + 12, {
        font: 'bold 9px "Courier New", monospace', colour: 'rgba(154,145,124,0.7)', align: 'right',
      });
    } else {
      text(ctx, '[2] EMPTY', x, yOther, {
        font: 'bold 10px "Courier New", monospace', colour: 'rgba(154,145,124,0.4)', align: 'right',
      });
    }

    // grenades
    if (p.grenades > 0) {
      text(ctx, `\u25C8 x${p.grenades}`, x, yOther - 16, {
        font: 'bold 11px "Courier New", monospace', colour: GOLD, align: 'right',
      });
    }

    if (p.busy) {
      const k = 1 - p.swapTimer / Math.max(0.001, p.swapTotal);
      bar(ctx, x - 90, yAmmo + 6, 90, 4, k, 'rgba(0,0,0,0.55)', '#8fa0b0');
      text(ctx, 'SWAPPING', x - 94, yAmmo + 10, {
        font: 'bold 9px "Courier New", monospace', colour: '#8fa0b0', align: 'right',
      });
    } else if (p.reloading) {
      const k = 1 - p.reloadTimer / (d.reload * p.perkFx.reloadMul);
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
    } else if (it.type === 'perk') {
      if (it.owned) lines.push(`${it.def.name.toUpperCase()} — ALREADY DRINKING`);
      else if (!game.powerOn) lines.push(`${it.def.name.toUpperCase()} — NO POWER`);
      else lines.push(`[E] ${it.def.name.toUpperCase()}  ${it.def.price}`);
    } else if (it.type === 'box') {
      const b = game.box;
      if (!game.powerOn) lines.push('MYSTERY BOX — NO POWER');
      else if (b.state === 'offering') lines.push(`[E] TAKE ${b.displayName()?.toUpperCase() ?? 'WEAPON'}`);
      else if (b.state === 'closed') lines.push(`[E] SPIN THE BOX  ${b.price()}`);
      else if (b.state === 'spinning') lines.push('...the wheel turns...');
      else lines.push('THE BOX IS MOVING');
    } else if (it.type === 'power') {
      lines.push(game.powerOn ? 'GENERATOR RUNNING' : '[E] THROW THE SWITCH');
    } else if (it.type === 'workbench') {
      lines.push('[E] OPEN WORKBENCH');
    } else if (it.type === 'pap') {
      if (it.already) lines.push('ALREADY PACK-A-PUNCHED');
      else if (!game.powerOn) lines.push('PACK-A-PUNCH — NO POWER');
      else lines.push(`[E] PACK-A-PUNCH ${it.id ? game.packedDef(it.id).name.toUpperCase() : ''}  ${it.price}`);
    } else if (it.type === 'cache') {
      lines.push('[E] OPEN THE SUPPLY CACHE');
    } else if (it.type === 'trap') {
      const t = game.traps.list[it.i];
      lines.push(t.ready
        ? `[E] ${t.name.toUpperCase()}  ${t.price}`
        : `${t.name.toUpperCase()} — RECHARGING ${Math.ceil(t.cool)}s`);
    } else if (it.type === 'switch') {
      lines.push(it.sw.found ? 'SIGNAL LOCKED' : '[E] TURN THE DIAL');
    } else if (it.type === 'loot') {
      lines.push('[E] OPEN THE CACHE');
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
    const onTarget = settings.get('crosshair') && game.aimOnTarget;
    const spread = 5 + game.player.def.spread * 320
      + Math.hypot(game.player.vel.x, game.player.vel.y) * 0.045
      + game.player.recoil * 1.4 + game.player.kickVis * 5;
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
    const tight = onTarget ? spread * 0.62 : spread;
    const ink = onTarget
      ? (game.aimOnHead ? 'rgba(255,150,110,0.98)' : 'rgba(250,120,90,0.95)')
      : 'rgba(240,235,215,0.9)';
    ctx.strokeStyle = ink;
    ctx.lineWidth = onTarget ? 2 : 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(m.x + dx * tight, m.y + dy * tight);
      ctx.lineTo(m.x + dx * (tight + len), m.y + dy * (tight + len));
      ctx.stroke();
    }
    ctx.fillStyle = onTarget ? 'rgba(255,150,110,0.95)' : 'rgba(240,235,215,0.7)';
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
  /** Rebuild the terrain layer of the minimap, but only when fog changes. */
  _miniTerrain(game) {
    const map = game.map;
    const s = Math.min(130 / map.w, 92 / map.h);
    const key = s + ':' + game.map.floor;
    this._miniScale = s;
    if (!this._miniCanvas || this._miniS !== key) {
      this._miniCanvas = document.createElement('canvas');
      this._miniCanvas.width = Math.ceil(map.w * s);
      this._miniCanvas.height = Math.ceil(map.h * s);
      this._miniS = key;
      this._miniDirty = true;
    }
    if (!this._miniDirty) return this._miniCanvas;
    const c = this._miniCanvas.getContext('2d');
    c.clearRect(0, 0, this._miniCanvas.width, this._miniCanvas.height);
    const cs = Math.ceil(s);
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!map.seen[ty * map.w + tx]) continue;
        const t = map.tiles[ty * map.w + tx];
        let col = '#1d1e18';
        if (t === 2) col = '#4b4f59';
        else if (t === 1 || t === 6) col = t === 6 ? '#34312c' : '#2b2c31';
        else if (t === 3) col = '#7a5a33';
        else if (t === 4) col = '#8a6a3a';
        else if (t === 5) col = '#5a4526';
        else if (t === 7) col = '#243020';
        else if (t === 8) col = '#3a3a42';
        else if (t === 9) col = '#4a3a2a';
        else if (t === 10) col = '#5a5f78';
        else if (t === 11) col = '#6a5a70';
        else if (t === 12) col = '#3d414c';     // roof deck
        else if (t === 13) col = '#101320';     // open air
        c.fillStyle = col;
        c.fillRect(tx * s, ty * s, cs, cs);
      }
    }
    this._miniDirty = false;
    return this._miniCanvas;
  }

  _minimap(ctx, game, w, h) {
    const map = game.map;
    const pad = 10;
    const terrain = this._miniTerrain(game);
    const s = this._miniScale;
    const mw = terrain.width, mh = terrain.height;
    const x0 = w - mw - pad, y0 = pad;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(8,9,13,0.72)';
    ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6);
    ctx.strokeStyle = 'rgba(200,190,160,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 3.5, y0 - 3.5, mw + 7, mh + 7);
    ctx.drawImage(terrain, x0, y0);

    // points of interest you have already walked past
    const mark = (wx, wy, colour, size = 3) => {
      const tx = wx / T, ty = wy / T;
      if (!map.seen[(ty | 0) * map.w + (tx | 0)]) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x0 + tx * s - size / 2, y0 + ty * s - size / 2, size, size);
    };
    for (const ps of map.perkSpots) {
      if (game.player.hasPerk(ps.id)) mark(ps.x, ps.y, PERKS[ps.id].colour, 3);
      else if (game.powerOn) mark(ps.x, ps.y, 'rgba(240,217,138,0.75)', 2);
    }
    mark(game.box.spot.x, game.box.spot.y, '#f5d76e', 4);
    if (map.workbench) mark(map.workbench.x, map.workbench.y, '#c8a05a', 3);
    if (map.papSpot && game.powerOn) mark(map.papSpot.x, map.papSpot.y, '#8fe05a', 4);
    if (map.powerSwitch && !game.powerOn) mark(map.powerSwitch.x, map.powerSwitch.y, '#8fe05a', 3);
    for (const t of game.traps.list) {
      if (t.floor !== undefined && t.floor !== map.floor) continue;
      mark(t.x, t.y, t.ready ? '#f0a03c' : '#5a5f52', 3);
    }
    // Staircases and ladders, drawn even where you have never stood: the
    // trouble was never walking to them, it was knowing they were there. The
    // chevron says which way they go.
    for (const l of map.linksOn(map.floor)) {
      const at = map.linkPos(l, map.floor);
      const up = (l.a.floor === map.floor ? l.b.floor : l.a.floor) > map.floor;
      const mx = x0 + at.tx * s, my = y0 + at.ty * s;
      ctx.fillStyle = '#9fd0f0';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
      ctx.fillStyle = '#e8f4ff';
      for (let i = 0; i < 2; i++) {
        const w2 = i === 0 ? 4 : 2;
        ctx.fillRect(mx - w2 / 2, up ? my - 5 - i * 2 : my + 4 + i * 2, w2, 1);
      }
    }
    for (const c of map.cacheSpots ?? []) {
      if (!c.taken) mark(c.x, c.y, '#f2e26a', 3);
    }
    for (const pu of game.powerups) mark(pu.x, pu.y, pu.def.colour, 3);

    for (const z of game.zombies) {
      if (z.dead) continue;
      if ((z.floor ?? 0) !== map.floor) continue;
      const tx = z.pos.x / T, ty = z.pos.y / T;
      if (!map.seen[(ty | 0) * map.w + (tx | 0)]) continue;
      ctx.fillStyle = z.type === 'brute' ? '#e07a3a' : z.type === 'dog' ? '#d05a4a' : '#c4463a';
      const zs = z.def.smash ? 4 : 3;
      ctx.fillRect(x0 + tx * s - 1, y0 + ty * s - 1, zs, zs);
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
/** The title card alone: wash, wordmark, feature list, best round. */
export function titleBackdrop(ctx, game, w, h) {
  ctx.save();
  // dusk-blue wash rather than a black slab -- moody, but you can still read it
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(24,30,46,0.80)');
  g.addColorStop(0.55, 'rgba(30,32,40,0.74)');
  g.addColorStop(1, 'rgba(12,13,18,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const t = game.time;
  const cy = h * 0.24;

  ctx.globalAlpha = 0.9 + Math.sin(t * 1.6) * 0.1;
  text(ctx, 'NACHT', w / 2, cy - 34, {
    font: 'bold 52px "Courier New", monospace', colour: '#e2d8b8', align: 'center',
  });
  text(ctx, 'DER UNTOTEN', w / 2, cy + 6, {
    font: 'bold 34px "Courier New", monospace', colour: '#c2503c', align: 'center',
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(200,60,45,0.7)';
  ctx.fillRect(w / 2 - 150, cy + 20, 300, 1);
  ctx.restore();
}

export function drawTitle(ctx, game, w, h) {
  titleBackdrop(ctx, game, w, h);
  ctx.save();
  const cy = h * 0.24;
  const lines = [
    'WASD / ARROWS move   \u00b7   MOUSE aim   \u00b7   LEFT CLICK fire',
    'R reload   \u00b7   1-0 / WHEEL / [ ] swap   \u00b7   SHIFT sprint   \u00b7   V knife   \u00b7   G frag',
    'E buy weapon \u00b7 open door \u00b7 spin the box \u00b7 hold to rebuild barricade',
    'H use medkit   \u00b7   M mute   \u00b7   P / ESC pause',
  ];
  let y = cy + 50;
  for (const l of lines) {
    text(ctx, l, w / 2, y, { font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center' });
    y += 19;
  }
  const blink = 0.55 + Math.sin(game.time * 4) * 0.45;
  text(ctx, 'CLICK TO BEGIN', w / 2, h - 46, {
    font: 'bold 20px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
//  The front menu: SOLO / MULTIPLAYER / SETTINGS.
//  Rows are data, so the keyboard and the mouse cannot disagree about what
//  is selected -- both go through the same list.
// ---------------------------------------------------------------------------
const MENU_TOP = 0.46;          // where the first row sits, as a fraction of h
const MENU_STEP = 27;
const MENU_HALF_W = 150;
const CONTROLS_TOP = 0.16;      // the controls screen is a list, not a menu
const CONTROLS_STEP = 21;
const CONTROLS_HALF_W = 250;

/** What every key and on-screen button actually does. */
const CONTROL_ROWS = [
  ['MOVE', 'W A S D   ARROWS   LEFT STICK'],
  ['AIM', 'MOUSE   RIGHT STICK'],
  ['FIRE', 'LEFT MOUSE   FIRE'],
  ['RELOAD', 'R   RLD'],
  ['USE  BUY  REVIVE', 'F   F'],
  ['REPAIR A WINDOW', 'HOLD F   HOLD F'],
  ['CRAFT AT THE BENCH', 'HOLD E'],
  ['KNIFE', 'V   KNIFE'],
  ['SWAP WEAPON', 'Q   SWAP'],
  ['PICK WEAPON', '1  2   WHEEL   [ ]'],
  ['SPRINT', 'SHIFT   DASH'],
  ['GRENADE', 'G   NADE'],
  ['MEDKIT', 'H   KIT'],
  ['PAUSE', 'P   ESC   ||'],
  ['SETTINGS', 'O'],
  ['MUTE', 'M'],
  ['PICK A MENU ROW', 'CLICK   TAP   HOLD AND SLIDE'],
];

/** A list scrolls tighter than a menu of three big doors. */
export function menuStep(scene) {
  return scene === 'controls' ? CONTROLS_STEP : MENU_STEP;
}

export function menuRows(scene, game) {
  if (scene === 'mp') {
    const net = game.net;
    return [
      { id: 'host', label: 'HOST A GAME', hint: 'open a room, others drop in mid-round' },
      { id: 'join', label: 'JOIN A GAME', hint: 'somebody else is already holding the line' },
      { id: 'name', label: `YOUR NAME   ${net?.name || 'PLAYER'}` },
      { id: 'addr', label: `RELAY   ${net?.addr || 'this machine'}` },
      { id: 'back', label: 'BACK' },
    ];
  }
  if (scene === 'rooms') {
    const rooms = game.net?.roomList ?? [];
    const rows = rooms.length
      ? rooms.map((rm) => ({
        id: `room:${rm.id}`, room: rm,
        label: `${String(rm.name || rm.id).slice(0, 12).padEnd(12, ' ')}  ${rm.players} IN  ${rm.round ? `ROUND ${rm.round}` : 'LOBBY'}`,
      }))
      : [{ id: 'none', label: 'NO ROOMS ON THIS RELAY', hint: 'start one with HOST A GAME' }];
    rows.push({ id: 'refresh', label: 'REFRESH' });
    rows.push({ id: 'back', label: 'BACK' });
    return rows;
  }
  if (scene === 'controls') {
    const rows = CONTROL_ROWS.map(([what, keys]) => ({
      id: 'none', small: true,
      label: `${what.padEnd(20, ' ')} ${keys}`,
    }));
    rows.push({ id: 'back', label: 'BACK', hint: 'W A S D picks a row, ENTER takes it' });
    return rows;
  }
  if (scene === 'waiting') {
    const dots = '.'.repeat(1 + (Math.floor(game.time * 2) % 3));
    return [{ id: 'waiting', label: `JOINING${dots}`, hint: 'the host will let you in where they are' }];
  }
  return [
    { id: 'solo', label: 'SOLO', hint: 'just you and the windows' },
    { id: 'mp', label: 'MULTIPLAYER', hint: 'same network, up to four of you' },
    { id: 'controls', label: 'CONTROLS', hint: 'every key, and what the buttons mean' },
    { id: 'settings', label: 'SETTINGS', hint: 'volume, lighting, on-screen controls' },
  ];
}

/** Which row is under this point, or -1. */
export function menuHitTest(scene, mx, my, game) {
  const rows = menuRows(scene, game);
  const top = (game.vh ?? 500) * (scene === 'controls' ? CONTROLS_TOP : MENU_TOP);
  const step = menuStep(scene);
  const half = scene === 'controls' ? CONTROLS_HALF_W : MENU_HALF_W;
  for (let i = 0; i < rows.length; i++) {
    const y = top + i * step;
    if (my >= y - step * 0.5 && my < y + step * 0.5
      && mx > (game.vw ?? 800) / 2 - half && mx < (game.vw ?? 800) / 2 + half) return i;
  }
  return -1;
}

export function drawMenu(ctx, game, w, h) {
  titleBackdrop(ctx, game, w, h);
  ctx.save();

  const rows = menuRows(game.scene, game);
  const step = menuStep(game.scene);
  const half = game.scene === 'controls' ? CONTROLS_HALF_W : MENU_HALF_W;
  const top = h * (game.scene === 'controls' ? CONTROLS_TOP : MENU_TOP);
  const sel = clamp(game.menuIndex ?? 0, 0, rows.length - 1);

  if (game.scene === 'controls') {
    text(ctx, 'CONTROLS', w / 2, h * 0.08, {
      font: 'bold 18px "Courier New", monospace', colour: GOLD, align: 'center',
    });
    text(ctx, 'ON A PHONE: HOLD ANYWHERE AND SLIDE TO A ROW, THEN LET GO', w / 2, h * 0.08 + 18, {
      font: 'bold 10px "Courier New", monospace', colour: INK_DIM, align: 'center',
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = top + i * step;
    const on = i === sel;
    const band = step - 3;
    if (on) {
      ctx.fillStyle = 'rgba(240,217,138,0.10)';
      ctx.fillRect(w / 2 - half, y - band / 2, half * 2, band);
      ctx.fillStyle = 'rgba(240,217,138,0.55)';
      ctx.fillRect(w / 2 - half, y - band / 2, 2, band);
      ctx.fillRect(w / 2 + half - 2, y - band / 2, 2, band);
    }
    const size = row.small ? 11 : row.id === 'none' ? 11 : 16;
    text(ctx, row.label, w / 2, y + (row.small ? 3 : 4), {
      font: `bold ${size}px "Courier New", monospace`,
      colour: row.id === 'none' ? (on ? '#b9ae90' : INK_DIM) : on ? GOLD : '#cdbfa0',
      align: 'center',
    });
  }

  const hint = rows[sel]?.hint;
  let hy = top + rows.length * step + 6;
  if (hint) {
    text(ctx, hint, w / 2, hy, { font: 'bold 11px "Courier New", monospace', colour: INK_DIM, align: 'center' });
    hy += 16;
  }

  // network status, good or bad
  const net = game.net;
  if (game.scene === 'mp' || game.scene === 'rooms' || game.scene === 'waiting') {
    const relay = net?.addr || (net?.url ? 'this machine' : 'not connected');
    const st = net?.state === 'open' ? 'LINKED' : net?.state === 'connecting' ? 'CONNECTING' : net?.error || 'NO LINK';
    const colour = net?.state === 'open' ? '#7fd75a' : net?.error ? RED : INK_DIM;
    text(ctx, `RELAY ${relay}   \u00b7   ${st}`, w / 2, hy, {
      font: 'bold 10px "Courier New", monospace', colour, align: 'center',
    });
    hy += 14;
  }
  if (game.netMsg) {
    text(ctx, game.netMsg, w / 2, hy, { font: 'bold 11px "Courier New", monospace', colour: RED, align: 'center' });
    hy += 14;
  }
  // On a phone the browser's own bars eat a third of the screen; the home
  // screen icon does not have any.
  if (isTouchDevice() && !standalone()) {
    text(ctx, 'SHARE \u2192 ADD TO HOME SCREEN  for the full screen', w / 2, hy, {
      font: 'bold 10px "Courier New", monospace', colour: 'rgba(159,208,224,0.75)', align: 'center',
    });
    hy += 14;
  }

  // what the net is actually doing: a lobby that will not let you in is
  // unbearable when it will not say why
  const trail = net?.logLines ?? [];
  if (trail.length && (game.scene === 'mp' || game.scene === 'rooms' || game.scene === 'waiting')) {
    const n = Math.min(6, trail.length);
    let ly = h - 16;
    for (let i = n - 1; i >= 0; i--) {
      text(ctx, trail[trail.length - n + i], 12, ly, {
        font: 'bold 9px "Courier New", monospace', colour: 'rgba(150,160,180,0.7)',
      });
      ly -= 11;
    }
  }

  // held upright on a phone: the game wants to be the other way round
  if (isTouchDevice() && isPortrait()) {
    const blink = 0.6 + Math.sin(game.time * 3) * 0.4;
    text(ctx, 'TURN THE PHONE SIDEWAYS', w / 2, 34, {
      font: 'bold 13px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
    });
  }

  // controls, but only on the front page where there is room for them
  if (game.scene === 'menu') {
    const lines = [
      'WASD / ARROWS move   \u00b7   MOUSE aim   \u00b7   LEFT CLICK fire',
      'R reload  \u00b7  Q / WHEEL swap  \u00b7  SHIFT sprint  \u00b7  V knife  \u00b7  G frag  \u00b7  H medkit',
      'E or F buy, open, spin, rebuild   \u00b7   O settings   \u00b7   P / ESC pause',
    ];
    let y = h - 74;
    for (const l of lines) {
      text(ctx, l, w / 2, y, { font: 'bold 11px "Courier New", monospace', colour: INK_DIM, align: 'center' });
      y += 15;
    }
    const board = loadBoard();
    if (board.length) {
      text(ctx, `BEST ROUND  ${board[0].round}   (${board[0].kills} kills)`, w / 2, y + 4, {
        font: 'bold 11px "Courier New", monospace', colour: GOLD, align: 'center',
      });
    }
  } else {
    text(ctx, 'ESC BACK   \u00b7   ENTER SELECT', w / 2, h - 22, {
      font: 'bold 10px "Courier New", monospace', colour: INK_DIM, align: 'center',
    });
  }
  ctx.restore();
}

export function drawPause(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,10,0.7)';
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'PAUSED', w / 2, h * 0.42, {
    font: 'bold 34px "Courier New", monospace', colour: INK, align: 'center',
  });
  text(ctx, 'P / ESC — resume      O — settings      R — restart run', w / 2, h * 0.42 + 28, {
    font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'center',
  });
  ctx.restore();
}

export function drawSettings(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,10,0.86)';
  ctx.fillRect(0, 0, w, h);

  // the list scrolls now: there are more knobs than there is screen, and a
  // panel that runs off the top is a setting you cannot reach
  const ROW = 24, HEAD = 52, FOOT = 46;
  const rows = SETTING_DEFS.length;
  const maxRows = Math.max(5, Math.floor((h - 40 - HEAD - FOOT) / ROW));
  const shown = Math.min(rows, maxRows);
  const over = rows - shown;
  const top = over > 0
    ? Math.max(0, Math.min(over, game.settingsIndex - Math.floor(shown / 2)))
    : 0;
  const cw = 420, ch = HEAD + shown * ROW + FOOT;
  const cx = Math.round((w - cw) / 2), cy = Math.round((h - ch) / 2);

  ctx.fillStyle = '#14171d';
  ctx.fillRect(cx, cy, cw, ch);
  ctx.strokeStyle = '#3a3f4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
  ctx.fillStyle = '#22262e';
  ctx.fillRect(cx + 1, cy + 1, cw - 2, 30);

  text(ctx, 'SETTINGS', cx + 14, cy + 20, {
    font: 'bold 16px "Courier New", monospace', colour: GOLD,
  });
  text(ctx, 'W / S — pick      A / D — change      ENTER — flip', cx + cw - 14, cy + 20, {
    font: 'bold 10px "Courier New", monospace', colour: INK_DIM, align: 'right',
  });

  // the rows are clipped to the panel, so a half-scrolled one cannot spill
  ctx.beginPath();
  ctx.rect(cx + 2, cy + HEAD - 16, cw - 4, shown * ROW + 12);
  ctx.clip();

  let y = cy + HEAD;
  for (let i = top; i < top + shown; i++) {
    const d = SETTING_DEFS[i];
    const sel = i === game.settingsIndex;
    if (sel) {
      ctx.fillStyle = 'rgba(240,217,138,0.10)';
      ctx.fillRect(cx + 6, y - 12, cw - 12, 22);
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx + 6, y - 12, 2, 22);
    }
    text(ctx, d.label, cx + 18, y + 2, {
      font: 'bold 12px "Courier New", monospace',
      colour: sel ? INK : INK_DIM,
    });

    if (d.type === 'range') {
      const v = settings.get(d.id);
      const bx = cx + cw - 148, bw = 84;
      ctx.fillStyle = '#0c0e13';
      ctx.fillRect(bx, y - 5, bw, 8);
      const k = (v - d.min) / (d.max - d.min);
      ctx.fillStyle = sel ? GOLD : '#7d8360';
      ctx.fillRect(bx, y - 5, Math.round(bw * k), 8);
      text(ctx, d.fmt(v), bx + bw + 54, y + 2, {
        font: 'bold 12px "Courier New", monospace',
        colour: sel ? INK : INK_DIM, align: 'right',
      });
    } else if (d.type === 'toggle') {
      const v = settings.get(d.id);
      const bx = cx + cw - 108;
      ctx.fillStyle = v ? '#3d6b3a' : '#2a2d35';
      ctx.fillRect(bx, y - 11, 46, 20);
      ctx.fillStyle = v ? '#8fdc6a' : '#6a6a6a';
      ctx.fillRect(v ? bx + 26 : bx + 4, y - 7, 16, 12);
      text(ctx, v ? 'ON' : 'OFF', cx + cw - 18, y + 2, {
        font: 'bold 12px "Courier New", monospace',
        colour: v ? '#8fdc6a' : INK_DIM, align: 'right',
      });
    } else {
      text(ctx, 'ENTER', cx + cw - 18, y + 2, {
        font: 'bold 12px "Courier New", monospace',
        colour: sel ? GOLD : INK_DIM, align: 'right',
      });
    }
    y += ROW;
  }
  ctx.restore();      // drop the clip
  ctx.save();

  if (over > 0) {     // a thin marker, so you can tell there is more below
    const tx = cx + cw - 8, th = shown * ROW;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(tx, cy + HEAD - 14, 3, th + 6);
    const kh = Math.max(10, Math.round((th + 6) * (shown / rows)));
    const ky = cy + HEAD - 14 + Math.round((th + 6 - kh) * (top / over));
    ctx.fillStyle = 'rgba(240,217,138,0.45)';
    ctx.fillRect(tx, ky, 3, kh);
  }

  // hint line for whatever is selected
  const hint = SETTING_DEFS[game.settingsIndex]?.hint;
  if (hint) {
    text(ctx, hint, w / 2, cy + ch - 30, {
      font: 'bold 11px "Courier New", monospace', colour: INK_DIM, align: 'center',
    });
  }
  text(ctx, 'O / ESC — back to the game', w / 2, cy + ch - 14, {
    font: 'bold 11px "Courier New", monospace', colour: '#6f6a5c', align: 'center',
  });
  ctx.restore();
}

/**
 * A menu with no pointer is a menu you cannot use: the page hides the system
 * cursor, and a phone has no pointer at all, so the game draws its own. It is
 * drawn last, over everything, wherever the last touch or the mouse is.
 */
/** Running from the home screen, with no browser bars around it? */
function standalone() {
  try {
    return !!globalThis.navigator?.standalone
      || !!globalThis.matchMedia?.('(display-mode: standalone)')?.matches;
  } catch { return false; }
}

export function drawCursor(ctx, game) {
  const m = game?.input?.mouse;
  if (!m) return;
  const x = Math.round(m.x ?? 0), y = Math.round(m.y ?? 0);
  const path = (o) => {
    ctx.beginPath();
    ctx.moveTo(o, o);
    ctx.lineTo(o, o + 13);
    ctx.lineTo(o + 3.5, o + 9.5);
    ctx.lineTo(o + 6, o + 14.5);
    ctx.lineTo(o + 8.5, o + 13);
    ctx.lineTo(o + 6, o + 8);
    ctx.lineTo(o + 10.5, o + 7.5);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  path(1.5);
  ctx.fillStyle = m.down ? GOLD : '#efe8d2';
  path(0);
  ctx.fillStyle = m.down ? 'rgba(240,217,138,0.35)' : 'rgba(239,232,210,0.18)';
  ctx.fillRect(0, 0, 2, 2);
  ctx.restore();
}

export function drawGameOver(ctx, game, w, h) {
  ctx.save();
  ctx.fillStyle = `rgba(40,4,4,${Math.min(0.82, game.overT * 0.7)})`;
  ctx.fillRect(0, 0, w, h);
  const t = Math.min(1, game.overT / 0.7);
  ctx.globalAlpha = t;

  text(ctx, 'YOU DIED', w / 2, h * 0.16, {
    font: 'bold 40px "Courier New", monospace', colour: '#c2503c', align: 'center',
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
  let y = h * 0.20 + 40;
  for (const [k, v] of rows) {
    text(ctx, k, w / 2 - 14, y, { font: 'bold 12px "Courier New", monospace', colour: INK_DIM, align: 'right' });
    text(ctx, v, w / 2 + 14, y, { font: 'bold 12px "Courier New", monospace', colour: INK, align: 'left' });
    y += 18;
  }

  const board = game.board ?? loadBoard();
  if (board.length) {
    y += 8;
    text(ctx, 'BEST RUNS', w / 2, y, {
      font: 'bold 12px "Courier New", monospace', colour: GOLD, align: 'center',
    });
    y += 17;
    board.slice(0, 5).forEach((e, i) => {
      const col = i === (game.rank ?? -1) ? GOLD : INK_DIM;
      text(ctx, `${i + 1}.`, w / 2 - 110, y, { font: 'bold 11px "Courier New", monospace', colour: col, align: 'left' });
      text(ctx, `ROUND ${e.round}`, w / 2 - 88, y, { font: 'bold 11px "Courier New", monospace', colour: col, align: 'left' });
      text(ctx, `${e.kills} kills`, w / 2 - 10, y, { font: 'bold 11px "Courier New", monospace', colour: col, align: 'left' });
      text(ctx, `${e.points} pts`, w / 2 + 110, y, { font: 'bold 11px "Courier New", monospace', colour: col, align: 'right' });
      y += 15;
    });
  }

  if (game.overT > 1.1) {
    const blink = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(ctx, 'PRESS R OR CLICK TO TRY AGAIN', w / 2, h * 0.86, {
      font: 'bold 15px "Courier New", monospace', colour: `rgba(240,217,138,${blink})`, align: 'center',
    });
  }
  ctx.restore();
}
