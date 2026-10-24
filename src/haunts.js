// ---------------------------------------------------------------------------
//  Haunts: the things the new creatures leave behind.
//
//  A Totem Bearer plants a totem and the house goes to dusk -- the horde gets
//  bolder while it hums. A Mourner digs a grave, and the grave rings a bell
//  and lets half-seen wraiths out to walk. Both are built to be shot: they
//  have hit points, they flash when they are hit, and they die with a show.
//  Both also expire on their own, so a player who ignores them is punished by
//  the clock rather than by an immortal furniture.
//
//  ZThrow is anything a zombie's hands let go of: a snowball, a fire bottle,
//  a stink potion. It flies a fixed arc to a point on the floor and does its
//  one thing when it lands.
//
//  Everything here follows the snapshot rule from net.js: a guest rebuilds
//  these from tuples, so every field the RENDERER touches must be a plain
//  number on the object, and every draw() must work without host-only state.
//  update() takes `auth` from the game: timers and kinematics run everywhere,
//  consequences (spawns, damage, fire) only where the world is simulated.
// ---------------------------------------------------------------------------
import { randRange, dist, TAU, clamp } from './util.js';
import { audio } from './audio.js';

/** Is this the machine that owns the world? Single player always is. */
export const isAuth = (game) => !game.net?.playing || game.net.isHost;

// ---------------------------------------------------------------------------
export class Totem {
  constructor(x, y, floor, uid) {
    this.kind = 'totem';
    this.uid = uid;
    this.x = x; this.y = y;
    this.f = floor ?? 0;
    this.maxHp = 140; this.hp = this.maxHp;
    this.maxLife = 50; this.life = this.maxLife;
    this.dead = false;
    this.t = randRange(0, 10);       // private clock: wobble, pulse phase
    this.pulse = randRange(1.5, 3);  // the hum you can hear across the house
    this.flash = 0;                  // hurt feedback
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    // the hum rings on every machine from its own timer, the way the grave's
    // bell does: synced sound arrives half a beat behind the picture, and a
    // pulse is atmosphere, not gameplay
    this.pulse -= dt;
    if (this.pulse <= 0) {
      this.pulse = randRange(3.2, 4.4);
      audio.totemPulse?.();
      game.particles?.spark?.(this.x, this.y - 20, -Math.PI / 2, 5, '#b07ae0');
    }
    if (!isAuth(game)) return;
    this.life -= dt;
    if (this.life <= 0) this.breakApart(game, false);
  }

  /** Returns true when this blow finished it. */
  hurt(dmg, game) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 1;
    game.particles?.spark?.(this.x + randRange(-5, 5), this.y - randRange(4, 22), randRange(0, TAU), 4, '#c89ae8');
    if (this.hp <= 0) { this.breakApart(game, true); return true; }
    return false;
  }

  breakApart(game, shot) {
    if (this.dead) return;
    this.dead = true;
    if (!isAuth(game)) return;
    game.particles?.chunk?.(this.x, this.y - 12, randRange(0, TAU), 8);
    game.particles?.spark?.(this.x, this.y - 14, randRange(0, TAU), 18, '#d8b0ff');
    game.explosionLights?.push({ x: this.x, y: this.y - 10, r: 190, life: 0.5, max: 0.5, colour: '#b07ae0', f: this.f });
    game.shake?.(2.4, 0.2);
    audio.totemBreak?.();
    if (shot) {
      game.bannerShow?.('TOTEM DOWN', 'the light comes back', { dur: 2.2, colour: '#c8a8f0' });
      game.say?.('totemdown');
    }
  }

  draw(ctx, art, t = 0) {
    const px = Math.round(this.x), py = Math.round(this.y);
    const dying = this.life < 4 ? (Math.floor(this.life * 6) % 2 === 0 ? 0.45 : 1) : 1;
    // the pool of dusk it stands in
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = 0.20 + Math.sin(this.t * 2.2) * 0.07;
    ctx.globalAlpha = clamp(glow, 0, 1) * dying;
    ctx.fillStyle = '#7a3ac0';
    ctx.beginPath(); ctx.ellipse(px, py, 26, 12, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = dying;
    if (art?.totem) ctx.drawImage(art.totem, px - (art.totem.width >> 1), py - art.totem.height + 6);
    // hurt flash over the whole stick
    if (this.flash > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.6 * dying;
      ctx.fillStyle = '#e8d0ff';
      ctx.fillRect(px - 6, py - 30, 12, 32);
    }
    ctx.restore();
    // orbiting rune: which way to look when the lights go funny
    const a = this.t * 1.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.5 + Math.sin(this.t * 5) * 0.2) * dying;
    ctx.fillStyle = '#c89af0';
    ctx.beginPath();
    ctx.arc(px + Math.cos(a) * 13, py - 24 + Math.sin(a) * 5, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
    // health pip once it has been touched
    if (!this.dead && this.hp < this.maxHp) {
      const w = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px - w / 2, py - 38, w, 3);
      ctx.fillStyle = '#b07ae0';
      ctx.fillRect(px - w / 2, py - 38, w * clamp(this.hp / this.maxHp, 0, 1), 3);
    }
  }
}

// ---------------------------------------------------------------------------
export class Grave {
  constructor(x, y, floor, uid) {
    this.kind = 'grave';
    this.uid = uid;
    this.x = x; this.y = y;
    this.f = floor ?? 0;
    this.maxHp = 110; this.hp = this.maxHp;
    this.maxLife = 45; this.life = this.maxLife;
    this.dead = false;
    this.t = randRange(0, 10);
    this.bellT = randRange(3, 5);    // the first bell comes early: you are meant to hear it
    this.spawnT = randRange(2.5, 4); // and so is the first wraith
    this.ring = 0;                   // expanding ring right after a bell
    this.flash = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.ring = Math.max(0, this.ring - dt * 0.9);
    if (!isAuth(game)) {
      // a guest rings its own copy of the bell from the synced timer, so the
      // sound is never half a second behind the picture
      this.bellT -= dt;
      if (this.bellT <= 0) { this.bellT = randRange(6, 9); this.ring = 1; audio.bell?.(0.5); }
      return;
    }
    this.life -= dt;
    this.bellT -= dt;
    if (this.bellT <= 0) {
      this.bellT = randRange(6, 9);
      this.ring = 1;
      audio.bell?.(this._muffled(game) ? 0.45 : 0.9);
      game.particles?.smoke?.(this.x, this.y - 10, 3);
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.life > 3) {
      this.spawnT = randRange(5, 8);
      const live = game.zombies?.reduce((n, z) => n + (!z.dead && z.type === 'wraith' ? 1 : 0), 0) ?? 0;
      const mine = game.zombies?.reduce((n, z) => n + (!z.dead && z.graveUid === this.uid ? 1 : 0), 0) ?? 0;
      if (live < 4 && mine < 2) game.spawnWraith?.(this.x, this.y, this.f, this.uid);
    }
    if (this.life <= 0) this.breakApart(game, false);
  }

  _muffled(game) {
    return (game.player?.floor ?? 0) !== this.f;
  }

  hurt(dmg, game) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 1;
    game.particles?.spark?.(this.x + randRange(-6, 6), this.y - randRange(2, 16), randRange(0, TAU), 3, '#cfc9b4');
    game.particles?.dust?.(this.x, this.y, randRange(0, TAU), 3);
    if (this.hp <= 0) { this.breakApart(game, true); return true; }
    return false;
  }

  breakApart(game, shot) {
    if (this.dead) return;
    this.dead = true;
    if (!isAuth(game)) return;
    // whatever it let out fades with it: the wraiths belong to the grave
    for (const z of game.zombies ?? []) {
      if (!z.dead && z.graveUid === this.uid) z.dyingT = 2.6;
    }
    game.particles?.dust?.(this.x, this.y, randRange(0, TAU), 14);
    game.particles?.chunk?.(this.x, this.y - 8, randRange(0, TAU), 6);
    game.explosionLights?.push({ x: this.x, y: this.y - 6, r: 140, life: 0.4, max: 0.4, colour: '#9fb4c8', f: this.f });
    audio.graveBreak?.();
    if (shot) {
      game.bannerShow?.('GRAVE DESPOILED', 'the bells stop, the walkers fade', { dur: 2.2, colour: '#9fb4c8' });
      game.say?.('gravedown');
    }
  }

  draw(ctx, art, t = 0) {
    const px = Math.round(this.x), py = Math.round(this.y);
    const dying = this.life < 4 ? (Math.floor(this.life * 6) % 2 === 0 ? 0.45 : 1) : 1;
    ctx.save();
    ctx.globalAlpha = dying;
    if (art?.grave) ctx.drawImage(art.grave, px - (art.grave.width >> 1), py - art.grave.height + 6);
    // candle that will not go out
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.5 + Math.sin(this.t * 7) * 0.22) * dying;
    ctx.fillStyle = '#f0c860';
    ctx.beginPath(); ctx.arc(px + 7, py - 5, 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.16 * dying;
    ctx.beginPath(); ctx.arc(px + 7, py - 5, 7, 0, TAU); ctx.fill();
    ctx.restore();
    // the bell's ring, spreading out where the sound went
    if (this.ring > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.ring * 0.35 * dying;
      ctx.strokeStyle = '#cfe0ee';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(px, py, 14 + (1 - this.ring) * 46, (14 + (1 - this.ring) * 46) * 0.45, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (this.flash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.5 * dying;
      ctx.fillStyle = '#e8e4d2';
      ctx.fillRect(px - 8, py - 22, 16, 24);
      ctx.restore();
    }
    if (!this.dead && this.hp < this.maxHp) {
      const w = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px - w / 2, py - 32, w, 3);
      ctx.fillStyle = '#9fb4c8';
      ctx.fillRect(px - w / 2, py - 32, w * clamp(this.hp / this.maxHp, 0, 1), 3);
    }
  }
}

// ---------------------------------------------------------------------------
export class Hive {
  /**
   * The beekeeper's nest: a box of humming comb that stays where it was put.
   * It has hit points, it has a clock, and while both are running it makes
   * bees -- small, quick, worth almost nothing, and not part of the round.
   * Shooting the bees is the wrong answer and that is the whole design.
   */
  constructor(x, y, floor, uid) {
    this.kind = 'hive';
    this.uid = uid;
    this.x = x; this.y = y;
    this.f = floor ?? 0;
    this.maxHp = 110; this.hp = this.maxHp;
    this.maxLife = 46; this.life = this.maxLife;
    this.dead = false;
    this.t = randRange(0, 10);
    this.spawnT = randRange(1.4, 2.6);
    this.flash = 0;
    this.hum = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.hum = Math.max(0, this.hum - dt);
    if (!isAuth(game)) return;
    this.life -= dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 3.1;
      this.hum = 0.5;
      const live = (game.zombies ?? []).reduce(
        (n, z) => n + (!z.dead && z.hiveUid === this.uid ? 1 : 0), 0);
      if (live < 5) game.spawnBee?.(this);
    }
    if (this.life <= 0) this.breakApart(game, false);
  }

  hurt(dmg, game) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 1;
    game.particles?.spark?.(this.x + randRange(-6, 6), this.y - randRange(2, 16), randRange(0, TAU), 4, '#e0b04a');
    if (this.hp <= 0) { this.breakApart(game, true); return true; }
    return false;
  }

  breakApart(game, shot) {
    if (this.dead) return;
    this.dead = true;
    if (!isAuth(game)) return;
    game.particles?.chunk?.(this.x, this.y - 8, randRange(0, TAU), 8);
    game.particles?.spark?.(this.x, this.y - 10, randRange(0, TAU), 16, '#e0b04a');
    game.explosionLights?.push({ x: this.x, y: this.y - 8, r: 120, life: 0.4, max: 0.4, colour: '#e0b04a', f: this.f });
    // the bees it still had in it come out at once, and they are angry
    for (let i = 0; i < 3; i++) game.spawnBee?.(this);
    audio.wood?.(true);
    if (shot) {
      game.bannerShow?.('HIVE DOWN', 'the humming stops', { dur: 1.8, colour: '#e0b04a' });
      game.addPoints?.(120, this.x, this.y - 20, '#f0d98a', game.player);
    }
  }

  draw(ctx, art, t = 0) {
    const px = Math.round(this.x), py = Math.round(this.y);
    const dying = this.life < 4 ? (Math.floor(this.life * 6) % 2 === 0 ? 0.45 : 1) : 1;
    ctx.save();
    ctx.globalAlpha = dying;
    // the hum: a warm pool under the box, and it breathes
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.14 + Math.sin(this.t * 3) * 0.05 + (this.hum > 0 ? 0.12 : 0)) * dying;
    ctx.fillStyle = '#c8901c';
    ctx.beginPath(); ctx.ellipse(px, py, 16, 7, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = dying;
    if (art?.hive) ctx.drawImage(art.hive, px - (art.hive.width >> 1), py - art.hive.height + 5);
    if (this.flash > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.55 * dying;
      ctx.fillStyle = '#ffe6a8';
      ctx.fillRect(px - 7, py - 18, 14, 20);
    }
    ctx.restore();
    // bees in the air, so you can see where they come from
    if (this.hum > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const a = this.t * 4 + i * 1.3, r = 6 + (i % 3) * 4;
        ctx.globalAlpha = 0.5 * (this.hum / 0.5) * dying;
        ctx.fillStyle = '#e0c060';
        ctx.fillRect(px + Math.cos(a) * r, py - 10 + Math.sin(a * 1.4) * r * 0.6, 1.5, 1.5);
      }
      ctx.restore();
    }
    if (!this.dead && this.hp < this.maxHp) {
      const w = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px - w / 2, py - 30, w, 3);
      ctx.fillStyle = '#e0b04a';
      ctx.fillRect(px - w / 2, py - 30, w * clamp(this.hp / this.maxHp, 0, 1), 3);
    }
  }
}

// ---------------------------------------------------------------------------
export class Thread {
  /**
   * A knot of silk on the floor. It does not move, it does not chase you, and
   * it does not kill you -- it takes your legs. Walk into one and you are at a
   * little over half speed and the dash is refused; the way out is a bullet, a
   * knife, or a dash that starts outside it and tears straight through.
   *
   * The whole point of it being shootable is that it is cheap to draw and
   * cheap to remove, and it makes the floor of a room a thing you look at.
   */
  constructor(x, y, floor) {
    this.kind = 'thread';
    this.uid = 0;
    this.x = x; this.y = y;
    this.f = floor ?? 0;
    this.maxHp = 24; this.hp = this.maxHp;
    this.maxLife = 22; this.life = this.maxLife;
    this.dead = false;
    this.t = randRange(0, 10);
    this.seed = randRange(0, 100);
    this.flash = 0;
  }

  update(dt) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  hurt(dmg, game) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 1;
    game?.particles?.spark?.(this.x, this.y - 3, randRange(0, TAU), 3, '#e8e4d2');
    if (this.hp <= 0) { this.tear(game); return true; }
    return false;
  }

  tear(game) {
    if (this.dead) return;
    this.dead = true;
    game?.particles?.dust?.(this.x, this.y, randRange(0, TAU), 4);
    audio.silk?.(0.5);
  }

  draw(ctx, art, t = 0) {
    const px = Math.round(this.x), py = Math.round(this.y);
    const k = clamp(this.life / 2, 0, 1);          // fades out as it ages
    const a = 0.35 + Math.sin(this.t * 2 + this.seed) * 0.06;
    ctx.save();
    ctx.globalAlpha = a * k;
    ctx.strokeStyle = this.flash > 0.1 ? '#ffffff' : '#cfc8b4';
    ctx.lineWidth = 1;
    // six strands from a hub, and one ring: a knot, not a puddle
    const R = 12;
    for (let i = 0; i < 6; i++) {
      const ang = (this.seed + i * (TAU / 6));
      ctx.beginPath();
      ctx.moveTo(px, py - 2);
      ctx.lineTo(px + Math.cos(ang) * R, py + Math.sin(ang) * R * 0.55);
      ctx.stroke();
    }
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    ctx.ellipse(px, py - 2, R * 0.6, R * 0.32, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
//  An arrow. Unlike everything else a zombie lets go of, this one is aimed:
//  it flies in a straight line until it hits a wall or a body, and the body
//  does not have to be where it was when the bow was drawn.
// ---------------------------------------------------------------------------
export class Arrow {
  constructor(x, y, ang, speed, dmg, floor, heavy = false) {
    this.kind = 'arrow';
    this.x = x; this.y = y;
    this.ang = ang;
    this.speed = speed;
    this.dmg = dmg;
    this.f = floor ?? 0;
    this.heavy = heavy;
    this.life = 2.2;
    this.dead = false;
    this.trail = [];
  }

  update(dt, game) {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const step = this.speed * dt;
    const nx = this.x + Math.cos(this.ang) * step;
    const ny = this.y + Math.sin(this.ang) * step;
    // a wall stops it; the shaft is left sticking in the plaster
    if (game.map.blockedAt(nx, ny, 1, this.f)) {
      this.dead = true;
      game.particles?.dust?.(this.x, this.y, this.ang, 3);
      game.stickArrow?.(this.x, this.y, this.ang, this.f);
      return;
    }
    this.x = nx; this.y = ny;
    this.trail.push({ x: nx, y: ny });
    if (this.trail.length > 4) this.trail.shift();
    if (!isAuth(game)) return;
    for (const p of game.players ?? [game.player]) {
      if (!p || p.dead || (p.floor ?? 0) !== this.f) continue;
      if (dist(p.pos.x, p.pos.y - 4, this.x, this.y) < 9) {
        this.dead = true;
        const hit = p.hurt(this.dmg, this.x - Math.cos(this.ang) * 20,
          this.y - Math.sin(this.ang) * 20, game);
        if (hit) game.popups?.add?.(p.pos.x, p.pos.y - 30, 'ARROW', '#cfc9b4', 10);
        game.particles?.blood?.(this.x, this.y, this.ang, 4, 0.6);
        audio.impact?.(true, false);
        return;
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = this.heavy ? '#efe9d2' : '#cfc9b4';
    ctx.lineWidth = this.heavy ? 1.6 : 1.1;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - Math.cos(this.ang) * 9, this.y - Math.sin(this.ang) * 9);
    ctx.stroke();
    // the head, so you can read which way it is going
    ctx.fillStyle = this.heavy ? '#ffffff' : '#e8e4d2';
    ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
//  What a zombie throws. It flies a fixed arc to a fixed point -- the aim was
//  decided (badly, for the snowman) when it left the hand -- and does its one
//  thing where it lands.
// ---------------------------------------------------------------------------
const THROW_STYLE = {
  snow: { dur: (d) => 0.5 + d / 460, scatter: 96, hitR: 26, colour: '#e8f2fa' },
  bottle: { dur: (d) => 0.55 + d / 420, scatter: 44, hitR: 0, colour: '#d0703a' },
  potion: { dur: (d) => 0.55 + d / 420, scatter: 50, hitR: 0, colour: '#7ac050' },
};

export class ZThrow {
  constructor(sx, sy, tx, ty, kind, floor) {
    this.kind = 'zthrow';
    this.throwKind = kind;             // 'snow' | 'bottle' | 'potion'
    this.sx = sx; this.sy = sy;
    this.tx = tx; this.ty = ty;
    this.x = sx; this.y = sy;
    this.f = floor ?? 0;
    const d = dist(sx, sy, tx, ty);
    this.dur = THROW_STYLE[kind].dur(d);
    this.t = 0;
    this.dead = false;
    this.spin = randRange(0, TAU);
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    const k = clamp(this.t / this.dur, 0, 1);
    this.x = this.sx + (this.tx - this.sx) * k;
    this.y = this.sy + (this.ty - this.sy) * k;
    this.spin += dt * 9;
    if (this.t >= this.dur) {
      this.dead = true;
      if (isAuth(game)) this.land(game);
    }
  }

  /** height above the floor, for the draw: a lazy ballistic arc */
  get h() { return Math.sin(Math.PI * clamp(this.t / this.dur, 0, 1)) * 26; }

  land(game) {
    const st = THROW_STYLE[this.throwKind] ?? THROW_STYLE.snow;
    if (this.throwKind === 'snow') {
      let hit = false;
      for (const pl of game.players ?? [game.player]) {
        if (!pl || pl.dead || (pl.floor ?? 0) !== this.f) continue;
        if (dist(pl.pos.x, pl.pos.y, this.tx, this.ty) < st.hitR) {
          hit = true;
          pl.chillT = Math.max(pl.chillT ?? 0, 3.2);
          if (pl.hurt?.(6, this.tx, this.ty, game)) {
            game.particles?.blood?.(pl.pos.x, pl.pos.y, randRange(0, TAU), 3, 0.5);
          }
          game.popups?.add?.(pl.pos.x, pl.pos.y - 40, 'CHILLED', '#9fd0f0', 11);
        }
      }
      audio.snowHit?.(hit ? 1 : 0.5);
      game.particles?.spark?.(this.tx, this.ty, -Math.PI / 2, hit ? 12 : 6, '#e8f2fa');
      if (hit) game.shake?.(1.2, 0.12);
      return;
    }
    audio.glass?.(1);
    if (this.throwKind === 'bottle') {
      audio.ignite?.();
      game.addFire?.(this.tx, this.ty, 78, 4.6);
      game.explosionLights?.push({ x: this.tx, y: this.ty, r: 130, life: 0.3, max: 0.3, colour: '#f0903a', f: this.f });
      game.particles?.spark?.(this.tx, this.ty, -Math.PI / 2, 14, '#f0a040');
    } else {
      audio.ignite?.();
      game.addGas?.(this.tx, this.ty, 88, 6.5);
      game.particles?.smoke?.(this.tx, this.ty, 12);
    }
  }

  draw(ctx, art, t = 0) {
    if (this.dead) return;
    const px = Math.round(this.x), py = Math.round(this.y);
    const h = this.h;
    const st = THROW_STYLE[this.throwKind] ?? THROW_STYLE.snow;
    // shadow first: where it is going to land is the whole game
    ctx.save();
    ctx.globalAlpha = 0.3 * (1 - h / 40);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(px, py + 2, 3.4, 1.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(px, py - h);
    if (this.throwKind === 'snow') {
      ctx.rotate(this.spin);
      ctx.fillStyle = '#f2f8fc';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(160,200,230,0.8)';
      ctx.fillRect(-1, -1, 2, 2);
    } else {
      ctx.rotate(Math.sin(this.spin) * 0.8);
      // the bottle: dark glass, and the fire one is already lit
      ctx.fillStyle = this.throwKind === 'bottle' ? '#5a3a20' : '#2e4a2a';
      ctx.fillRect(-1.5, -3.5, 3, 7);
      ctx.fillStyle = this.throwKind === 'bottle' ? '#d0703a' : '#7ac050';
      ctx.fillRect(-1.5, -1, 3, 3);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-0.8, -5, 1.6, 1.8);
      if (this.throwKind === 'bottle') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#f0a040';
        ctx.globalAlpha = 0.7 + Math.sin(t * 30) * 0.3;
        ctx.beginPath(); ctx.arc(0, -6, 2.4, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    // a faint trail so a fast eye can follow it
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = st.colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - (this.tx - this.sx) * 0.03, py - h + 4);
    ctx.lineTo(px, py - h);
    ctx.stroke();
    ctx.restore();
  }
}
