// The Magic Box: pay, spin, hope. Moves to a new spot after too many pulls,
// and the teddy bear eventually steals it away.

import { rollBox, WEAPONS } from './weapons.js';

export const BOX_PRICE = 950;
const SPIN_TIME = 2.6;
const TEDDY_CHANCE = 0.17;

export class MysteryBox {
  constructor(spots) {
    this.spots = spots.map((s, i) => ({ ...s, id: i }));
    this.current = 0;
    this.state = 'closed';      // closed | spinning | offering | leaving | gone
    this.timer = 0;
    this.weapon = null;         // what the box is currently offering
    this.pulls = 0;
    this.firesale = false;
    this.firesaleTimer = 0;
    this.cycleAngle = 0;
    this.shownWeapons = [];
    this.movedAt = -99;         // when it last packed up and went somewhere else
  }

  /**
   * Where the crate is standing. Guarded because the number of homes changes
   * with the storey you are on: a host on the ground floor has five, a guest
   * upstairs has three, and a synchronised `current` can point past the end of
   * the shorter list.
   */
  get spot() {
    if (!this.spots.length) return null;
    if (this.current < 0 || this.current >= this.spots.length) this.current = 0;
    return this.spots[this.current];
  }
  get open() { return this.state === 'spinning' || this.state === 'offering'; }

  update(dt) {
    if (this.firesale) {
      this.firesaleTimer -= dt;
      if (this.firesaleTimer <= 0) this.firesale = false;
    }
    if (this.state === 'spinning') {
      this.timer -= dt;
      this.cycleAngle += dt * 9;
      if (this.timer <= 0) { this.state = 'offering'; this.timer = 6.5; }
      else if (Math.random() < 0.5) this.shownWeapons.push(rollBox());
    } else if (this.state === 'offering') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'closed';
    } else if (this.state === 'leaving') {
      this.timer -= dt;
      if (this.timer <= 0) { this.relocate(); this.movedAt = this._now?.() ?? 0; this.state = 'closed'; }
    }
  }

  price() { return this.firesale ? 10 : BOX_PRICE; }

  /**
   * Move to another storey's set of spots, keeping the same one where we can.
   * The box used to keep the ground floor's list forever, which put it inside
   * a wall the moment you climbed the stairs.
   */
  useSpots(spots) {
    if (!spots?.length) return;
    if (this.spots.length === spots.length
      && this.spots.every((s, i) => s.x === spots[i].x && s.y === spots[i].y)) return;
    const keep = this.spots[this.current];
    this.spots = spots.map((s, i) => ({ ...s, id: i }));
    // stay put if this spot exists upstairs too, otherwise pick a fresh one
    const same = this.spots.findIndex((s) => s.x === keep?.x && s.y === keep?.y);
    this.current = same >= 0 ? same : Math.min(this.current, this.spots.length - 1);
  }

  /** Send the box somewhere else and reset the pull counter. */
  relocate() {
    // one home, or none: there is nowhere to go, so it simply stays put
    if (this.spots.length < 2) { this.pulls = 0; return; }
    let n = this.current;
    for (let i = 0; i < 20; i++) {
      n = (Math.random() * this.spots.length) | 0;
      if (n !== this.current) break;
    }
    if (n === this.current) n = (this.current + 1) % this.spots.length;
    this.current = n;
    this.pulls = 0;
  }

  /** Start a spin. Returns the teddy-bear result or null. */
  spin(rng = Math.random) {
    if (this.state !== 'closed') return null;
    this.pulls++;
    this.shownWeapons = [];
    // the bear only shows up after you have had a fair go
    if (this.pulls >= 4 && rng() < TEDDY_CHANCE) {
      this.state = 'leaving';
      this.timer = 1.2;
      this.weapon = null;
      return 'teddy';
    }
    this.weapon = rollBox(rng);
    this.state = 'spinning';
    this.timer = SPIN_TIME;
    return null;
  }

  /** Take the offered weapon. */
  take() {
    if (this.state !== 'offering') return null;
    const w = this.weapon;
    this.state = 'closed';
    this.weapon = null;
    this.timer = 0;
    return w;
  }

  displayName() {
    if (this.state === 'spinning') {
      const i = Math.floor(this.cycleAngle) % Math.max(1, this.shownWeapons.length || 1);
      const id = this.shownWeapons[i] ?? this.weapon;
      return id ? WEAPONS[id].name : '?';
    }
    if (this.state === 'offering' && this.weapon) return WEAPONS[this.weapon].name;
    return null;
  }

  draw(ctx, art) {
    const s = this.spot;
    ctx.save();
    ctx.translate(s.x, s.y);
    // crate body
    ctx.fillStyle = '#4a3a24';
    ctx.fillRect(-15, -11, 30, 22);
    ctx.fillStyle = '#5d4a2e';
    ctx.fillRect(-15, -11, 30, 3);
    ctx.fillStyle = '#33281a';
    ctx.fillRect(-15, 8, 30, 3);
    for (let i = -12; i < 14; i += 8) {
      ctx.fillStyle = '#3c301e';
      ctx.fillRect(i, -11, 2, 22);
    }
    ctx.strokeStyle = '#241b10';
    ctx.lineWidth = 1;
    ctx.strokeRect(-15.5, -11.5, 31, 23);
    // brass corners
    ctx.fillStyle = '#a8853c';
    for (const [cx, cy] of [[-15, -11], [13, -11], [-15, 9], [13, 9]]) ctx.fillRect(cx, cy, 2, 2);

    if (this.state === 'closed') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-13, -6, 26, 12);
      ctx.fillStyle = '#f5d76e';
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', 0, 2);
    } else {
      // the lid is open, light pours out
      const g = ctx.createLinearGradient(0, -20, 0, 4);
      g.addColorStop(0, 'rgba(255,230,150,0)');
      g.addColorStop(1, 'rgba(255,230,150,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(-13, -20, 26, 22);
      ctx.fillStyle = '#0d0f13';
      ctx.fillRect(-13, -6, 26, 12);
      if (this.state === 'offering' && this.weapon) {
        const gun = art.guns[this.weapon];
        const img = gun ? gun.img : null;
        if (img) {
          const sc = Math.min(1, 24 / img.width);
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.drawImage(img,
            -img.width * sc / 2 + 2, -img.height * sc / 2 + 1,
            img.width * sc, img.height * sc);
          ctx.restore();
        }
        ctx.fillStyle = '#ffe9a8';
        ctx.font = 'bold 6px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(WEAPONS[this.weapon].name.slice(0, 14).toUpperCase(), 0, 9);
      } else if (this.state === 'spinning') {
        const id = this.shownWeapons[Math.floor(this.cycleAngle) % Math.max(1, this.shownWeapons.length)];
        ctx.fillStyle = '#ffe9a8';
        ctx.font = 'bold 6px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(id ? WEAPONS[id].name.slice(0, 13).toUpperCase() : '...', 0, 2);
      }
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 13, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
