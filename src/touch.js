// On-screen controls for a phone: a stick to walk with, a stick to aim with,
// and the buttons you actually reach for. Everything here feeds the very same
// Input object the keyboard and the mouse feed, so nothing else in the game
// has to know a phone is involved -- and the same panel works whether the
// phone is playing on its own or joined to somebody's game over the network.
//
// The panel is laid out in *virtual* 800x500 units -- the same space the game
// draws in -- and the whole layer is then scaled to whatever size the stage
// ended up. A four-inch screen therefore gets a proportionally smaller panel
// instead of a full-size one hanging off the edges, and on short screens the
// layout switches to a compact grid so the buttons cannot collide with the
// walking stick.

const GEO = {
  pad: 14,
  normal: { stick: 132, knob: 54, fire: 92, small: 56, gap: 8 },
  compact: { stick: 100, knob: 42, fire: 74, small: 46, gap: 6 },
};

// A thumb needs about this many REAL pixels, whatever the screen is. The panel
// is drawn in virtual units and scaled down with the stage, so on a four-inch
// phone the buttons were shrinking to a quarter of an inch: the layout gives
// them back the size the stage took away.
const THUMB = 40;

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Everything on the right-hand side: name, key it stands for, label, colour. */
const BUTTONS = [
  { id: 'fire', key: null, label: 'FIRE', big: true, colour: 0xd0603c },
  { id: 'interact', key: 'KeyF', label: 'F', colour: 0x3f6f4a },
  { id: 'reload', key: 'KeyR', label: 'R', colour: 0x4a5a6b },
  { id: 'swap', key: 'KeyQ', label: 'Q', colour: 0x4a5a6b },
  { id: 'sprint', key: 'ShiftLeft', label: '>>', colour: 0x6b5a3a },
  { id: 'grenade', key: 'KeyG', label: 'G', colour: 0x6b3a3a },
  { id: 'medkit', key: 'KeyH', label: 'H', colour: 0x3a6b5f },
  { id: 'knife', key: 'KeyV', label: 'V', colour: 0x5a5a5a },
];

// the small ones, laid out in a grid to the left of FIRE: [column, row]
const GRID = {
  interact: [0, 0], reload: [1, 0], knife: [2, 0],
  swap: [0, 1], sprint: [1, 1], grenade: [2, 1], medkit: [0, 2],
};

export class TouchControls {
  /**
   * @param {object} input  the game's Input instance
   * @param {object} opts   { mount: element to hang the panel from }
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.move = { x: 0, y: 0 };      // -1..1, from the left stick
    this.aim = { x: 0, y: 0 };       // -1..1, from the right stick
    this.held = new Set();           // buttons currently down
    this.enabled = false;
    this._touches = new Map();       // touch id -> 'move' | 'aim' | 'tap' | button id
    this._built = false;
    this._stageW = 800;
    this._stageH = 500;
    this._size = 1;                  // the player's own multiplier

    this.root = opts.mount ?? (typeof document !== 'undefined' ? document.body : null);
    if (!this.root) return;
    this._build();
  }

  // ------------------------------------------------------------------ build --
  _el(tag, css, text) {
    const d = document.createElement(tag);
    Object.assign(d.style, css);
    if (text !== undefined) d.textContent = text;
    return d;
  }

  _build() {
    if (this._built) return;
    this._built = true;

    const panel = this._el('div', {
      position: 'absolute', left: '0', top: '0',
      width: '800px', height: '500px',        // virtual units, scaled by layout()
      transformOrigin: '0 0', transform: `scale(${this._stageW / 800})`,
      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent', zIndex: '40', display: 'none',
    });
    this.panel = panel;

    const mk = (label) => {
      const base = this._el('div', {
        position: 'absolute', borderRadius: '50%', boxSizing: 'border-box',
        background: 'rgba(18,20,24,0.34)',
        border: '2px solid rgba(210,220,235,0.22)',
      });
      const knob = this._el('div', {
        position: 'absolute', borderRadius: '50%', boxSizing: 'border-box',
        background: 'rgba(226,234,244,0.30)',
        border: '2px solid rgba(226,234,244,0.45)',
        pointerEvents: 'none',
      });
      base.appendChild(knob);
      const tag = this._el('div', {
        position: 'absolute', width: '100%', textAlign: 'center',
        color: 'rgba(210,220,235,0.4)', font: 'bold 10px "Courier New", monospace',
        pointerEvents: 'none',
      }, label);
      base.appendChild(tag);
      return { base, knob, tag };
    };

    this.left = mk('MOVE');
    this.right = mk('AIM');
    panel.appendChild(this.left.base);
    panel.appendChild(this.right.base);

    // ---- the buttons -------------------------------------------------------
    this.buttons = {};
    for (const b of BUTTONS) {
      const d = this._el('div', {
        position: 'absolute', borderRadius: '50%', boxSizing: 'border-box',
        background: `rgba(${(b.colour >> 16) & 255},${(b.colour >> 8) & 255},${b.colour & 255},${b.big ? 0.42 : 0.32})`,
        border: `2px solid ${hex(b.colour)}`,
        color: '#e8eef6', font: `bold ${b.big ? 13 : 15}px "Courier New", monospace`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }, b.label);
      panel.appendChild(d);
      this.buttons[b.id] = d;
    }

    // ---- the pause / menu corner ------------------------------------------
    const pause = this._el('div', {
      position: 'absolute', borderRadius: '6px',
      background: 'rgba(18,20,24,0.45)', border: '1px solid rgba(210,220,235,0.25)',
      color: '#cfe0ee', font: 'bold 13px "Courier New", monospace',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, 'II');
    panel.appendChild(pause);
    this.buttons.pause = pause;

    this.root.appendChild(panel);
    this._measure();
    this._wire();
  }

  /** Sizes and positions everything, in virtual 800x500 units. */
  _measure() {
    const small = this._compact();
    const g = small ? GEO.compact : GEO.normal;
    const scale = (this._stageW || 800) / 800;
    // grow the virtual sizes by however much the stage shrank them, so the
    // thing you press is the same size on a phone as it is on a laptop
    const bump = Math.min(1.8, Math.max(1, THUMB / (g.small * scale)));
    const k = this._size * bump;
    this._tier = small ? 'compact' : 'normal';
    const S = g.stick * k, K = g.knob * k, F = g.fire * k, B = g.small * k;
    const gap = g.gap * k, pad = GEO.pad;
    this._geo = { S, K, F, B, gap, pad, bump };

    const place = (el, w, h, right, bottom) => {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      if (right !== undefined) { el.style.right = `${right}px`; el.style.left = 'auto'; }
      if (bottom !== undefined) { el.style.bottom = `${bottom}px`; el.style.top = 'auto'; }
    };

    // the walking stick, bottom left
    place(this.left.base, S, S, undefined, pad);
    this.left.base.style.left = `${pad}px`;
    this.left.knob.style.width = `${K}px`;
    this.left.knob.style.height = `${K}px`;
    this.left.tag.style.bottom = '-15px';
    this._resetKnob(this.left);

    // the aiming stick, above the button grid on the right
    place(this.right.base, S, S, pad + F + gap, pad + 3 * (B + gap));
    this.right.knob.style.width = `${K}px`;
    this.right.knob.style.height = `${K}px`;
    this.right.tag.style.bottom = '-15px';
    this._resetKnob(this.right);

    // FIRE, bottom right
    place(this.buttons.fire, F, F, pad, pad);
    // the rest, in a grid beside it
    for (const [id, [col, row]] of Object.entries(GRID)) {
      place(this.buttons[id], B, B, pad + F + gap + col * (B + gap), pad + row * (B + gap));
    }
    place(this.buttons.pause, 44 * k, 30 * k, pad, undefined);
    this.buttons.pause.style.top = `${pad}px`;
    for (const b of BUTTONS) {
      this.buttons[b.id].style.fontSize = `${(b.big ? 13 : 15) * k}px`;
    }
  }

  /** Screens this small get the compact layout -- no button lands on a stick. */
  _compact() {
    return this._stageH < 430 || this._stageW < 620;
  }

  /** The player's own size multiplier (SETTINGS -> CONTROL SIZE). */
  setSize(mult) {
    this._size = mult || 1;
    if (this._built) this._measure();
  }

  /**
   * Called whenever the stage is resized: the panel lives in the same 800x500
   * space the game draws in, so it scales by exactly the same amount.
   */
  layout(stageW, stageH) {
    this._stageW = stageW || 800;
    this._stageH = stageH || 500;
    if (!this.panel) return;
    const k = this._stageW / 800;
    this.panel.style.transform = `scale(${k})`;
    if (this._compact() !== (this._tier === 'compact')) this._measure();
    else if (this._geo) {
      // the stage changed size without crossing the tier: the thumb bump did
      const scale = this._stageW / 800;
      const g = this._tier === 'compact' ? GEO.compact : GEO.normal;
      const want = Math.min(1.8, Math.max(1, THUMB / (g.small * scale)));
      if (Math.abs(want - (this._geo.bump ?? 1)) > 0.02) this._measure();
    }
  }

  // ------------------------------------------------------------------ input --
  _wire() {
    const panel = this.panel;
    if (!panel || !panel.addEventListener) return;

    const stickAt = (which, touch) => {
      const box = which.base.getBoundingClientRect?.();
      const rw = (box?.width ?? this._geo?.S ?? 132) / 2;
      const r = rw || 66;
      const cx = (box?.left ?? 0) + rw;
      const cy = (box?.top ?? 0) + rw;
      let dx = touch.clientX - cx;
      let dy = touch.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      // a thumb resting on the stick should not walk the player into a wall
      const mag = Math.min(1, len / r);
      const scaled = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD);
      dx = (dx / len) * scaled;
      dy = (dy / len) * scaled;
      const out = which === this.left ? this.move : this.aim;
      out.x = dx; out.y = dy;
      const off = ((this._geo?.S ?? 132) - (this._geo?.K ?? 54)) / 2;
      which.knob.style.left = `${off + dx * off}px`;
      which.knob.style.top = `${off + dy * off}px`;
      return out;
    };

    const findButton = (target) => {
      for (const [id, el] of Object.entries(this.buttons)) if (el === target) return id;
      return null;
    };

    this._onStart = (e) => {
      for (const t of e.changedTouches) {
        const target = t.target ?? e.target;
        const id = findButton(target);
        if (id) {
          this._touches.set(t.identifier, { kind: 'button', id });
          this._press(id, true);
        } else if (this._inBox(target, this.left.base)) {
          this._touches.set(t.identifier, { kind: 'move' });
          stickAt(this.left, t);
        } else if (this._inBox(target, this.right.base)) {
          this._touches.set(t.identifier, { kind: 'aim' });
          stickAt(this.right, t);
        } else {
          this._touches.set(t.identifier, { kind: 'tap' });
          this._tap(t, 'down');
        }
      }
      e.preventDefault?.();
    };
    this._onMove = (e) => {
      for (const t of e.changedTouches) {
        const rec = this._touches.get(t.identifier);
        if (!rec) continue;
        if (rec.kind === 'move') stickAt(this.left, t);
        else if (rec.kind === 'aim') stickAt(this.right, t);
        else if (rec.kind === 'tap') this._tap(t, 'move');
      }
      e.preventDefault?.();
    };
    this._onEnd = (e) => {
      for (const t of e.changedTouches) {
        const rec = this._touches.get(t.identifier);
        if (!rec) continue;
        this._touches.delete(t.identifier);
        if (rec.kind === 'move') {
          this.move.x = 0; this.move.y = 0;
          this._resetKnob(this.left);
        } else if (rec.kind === 'aim') {
          this.aim.x = 0; this.aim.y = 0;
          this._resetKnob(this.right);
        } else if (rec.kind === 'tap') {
          this._tap(t, 'up');
        } else {
          this._press(rec.id, false);
        }
      }
      e.preventDefault?.();
    };

    panel.addEventListener('touchstart', this._onStart, { passive: false });
    panel.addEventListener('touchmove', this._onMove, { passive: false });
    panel.addEventListener('touchend', this._onEnd, { passive: false });
    panel.addEventListener('touchcancel', this._onEnd, { passive: false });
    // a mouse on a touch laptop should be able to use the same panel
    panel.addEventListener('mousedown', (e) => this._onStart({ changedTouches: [{ identifier: -1, clientX: e.clientX, clientY: e.clientY, target: e.target }], preventDefault: () => {} }));
    window.addEventListener?.('mousemove', (e) => {
      if (this._touches.has(-1)) this._onMove({ changedTouches: [{ identifier: -1, clientX: e.clientX, clientY: e.clientY }], preventDefault: () => {} });
    });
    window.addEventListener?.('mouseup', () => {
      if (this._touches.has(-1)) this._onEnd({ changedTouches: [{ identifier: -1 }], preventDefault: () => {} });
    });
  }

  _inBox(target, box) {
    // a child of the stick counts as the stick (the knob, the label)
    let n = target;
    while (n && n !== this.panel) { if (n === box) return true; n = n.parentNode; }
    return false;
  }

  _resetKnob(which) {
    if (!which?.knob || !this._geo) return;
    const off = (this._geo.S - this._geo.K) / 2;
    which.knob.style.left = `${off}px`;
    which.knob.style.top = `${off}px`;
  }

  /**
   * A bare tap on the game surface. Without this the panel would swallow
   * every menu press on a phone, which makes the front door unusable on the
   * one device that most needs on-screen controls.
   */
  /**
   * Is a list on screen? In one, a finger behaves differently: the row under
   * it lights up as it slides, and the choice is made when it lets go. In the
   * game itself a press has to fire the instant it lands, or shooting would
   * feel a thumb-beat late.
   */
  _menuOpen() {
    const g = this.game;
    if (!g) return false;
    return !g.started || g.settingsOpen || g.craftOpen || g.paused;
  }

  _tap(t, mode = 'move') {
    const inp = this.input;
    const box = inp?.canvas?.getBoundingClientRect?.();
    // a lift with no coordinates keeps the last one it was given, rather than
    // dragging the cursor off to nowhere
    if (box && box.width && box.height && inp.canvas.width && Number.isFinite(t?.clientX)) {
      inp.mouse.cx = t.clientX - box.left;
      inp.mouse.cy = t.clientY - box.top;
      inp.mouse.x = (inp.mouse.cx / box.width) * (inp.vw ?? inp.canvas.width);
      inp.mouse.y = (inp.mouse.cy / box.height) * (inp.vh ?? inp.canvas.height);
    }
    if (mode === 'up') {
      inp.mouse.down = false;
      inp.mouse.released = true;
      // hold, slide, let go: the row you release over is the row you meant,
      // which is the only way to pick one with a thumb covering the screen
      if (this._slid) { inp.mouse.pressed = true; this._slid = false; }
    } else if (mode === 'down') {
      if (!inp.mouse.down) {
        if (this._menuOpen()) this._slid = true;
        else inp.mouse.pressed = true;
      }
      inp.mouse.down = true;
    }
    inp.anyInput = true;
  }

  _press(id, down) {
    const def = BUTTONS.find((b) => b.id === id);
    if (down) this.held.add(id); else this.held.delete(id);
    if (id === 'fire') {
      this.input.mouse.down = down;
      if (down) this.input.mouse.pressed = true;
      else this.input.mouse.released = true;
      this.input.anyInput = true;
      return;
    }
    if (id === 'pause') {
      if (down) this.input.pressed.add('Escape');
      return;
    }
    if (!def || !def.key) return;
    if (down) {
      if (!this.input.keys.has(def.key)) this.input.pressed.add(def.key);
      this.input.keys.add(def.key);
    } else {
      this.input.keys.delete(def.key);
      this.input.released.add(def.key);
    }
    this.input.anyInput = true;
  }

  // ----------------------------------------------------------------- frame --
  /** Called once per frame, before the game reads its input. */
  update(game) {
    this.game = game;          // the panel has to know when a list is open
    if (!this.enabled) return;
    const inp = this.input;
    // walking: the stick is a vector, the keyboard still works alongside it
    inp.stick = this.move;
    // aiming: put the virtual cursor 300 px out along the right stick, from
    // the player's own position on screen, so the angle is right even when
    // the camera is pinned against the edge of the map
    const p = game?.player?.pos, cam = game?.cam;
    if (!p || !cam) return;
    if (this.aim.x || this.aim.y) {
      inp.mouse.x = (p.x - cam.x) + this.aim.x * 300;
      inp.mouse.y = (p.y - cam.y) + this.aim.y * 300;
      return;
    }
    // no stick, no cursor: with assist on, point the barrel at the nearest
    // thing that wants to eat you. It is the difference between a phone port
    // that fights you and one you can actually finish a round on.
    if (game.settings && game.settings.get('touchAssist')) {
      const t = this._nearest(game);
      if (t) {
        inp.mouse.x = (t.pos.x - cam.x);
        inp.mouse.y = (t.pos.y - cam.y);
      }
    }
  }

  _nearest(game) {
    const p = game.player.pos;
    let best = null, bestD = 460 * 460;
    for (const z of game.zombies ?? []) {
      if (z.dead) continue;
      const d = (z.pos.x - p.x) ** 2 + (z.pos.y - p.y) ** 2;
      if (d < bestD) { bestD = d; best = z; }
    }
    return best;
  }

  show(on) {
    this.enabled = !!on;
    if (this.panel) this.panel.style.display = on ? 'block' : 'none';
    if (!on) {
      this.move.x = 0; this.move.y = 0;
      this.aim.x = 0; this.aim.y = 0;
      for (const id of [...this.held]) this._press(id, false);
      this._touches.clear();
      if (this.left) this._resetKnob(this.left);
      if (this.right) this._resetKnob(this.right);
    }
  }

  dispose() {
    this.show(false);
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    this._built = false;
  }
}

const DEAD = 0.14;   // ignore a thumb just resting on the stick

/** Phones and tablets, and laptops that think they are both. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const has = ('ontouchstart' in window) || (navigator?.maxTouchPoints ?? 0) > 0;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return has || coarse;
}

/** Held upright? The game is wider than it is tall, and it shows. */
export function isPortrait() {
  if (typeof window === 'undefined') return false;
  return (window.innerHeight ?? 0) > (window.innerWidth ?? 0) * 1.05;
}
