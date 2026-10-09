// On-screen controls for a phone: a stick to walk with, a stick to aim with,
// and the buttons you actually reach for. Everything here feeds the very same
// Input object the keyboard and the mouse feed, so nothing else in the game
// has to know a phone is involved -- and the same panel works whether the
// phone is playing on its own or joined to somebody's game over the network.

const SIZE = {
  stick: 132,        // outer diameter of a stick, in CSS pixels
  knob: 54,
  fire: 92,
  small: 56,
};

const DEAD = 0.14;   // ignore a thumb just resting on the stick

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
    this._touches = new Map();       // touch id -> 'move' | 'aim' | button id
    this._built = false;

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
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent', zIndex: '40', display: 'none',
    });
    this.panel = panel;

    // ---- the walking stick -------------------------------------------------
    const mk = (label) => {
      const base = this._el('div', {
        position: 'absolute', width: `${SIZE.stick}px`, height: `${SIZE.stick}px`,
        borderRadius: '50%', background: 'rgba(18,20,24,0.34)',
        border: '2px solid rgba(210,220,235,0.22)', boxSizing: 'border-box',
      });
      const knob = this._el('div', {
        position: 'absolute', width: `${SIZE.knob}px`, height: `${SIZE.knob}px`,
        borderRadius: '50%', background: 'rgba(226,234,244,0.30)',
        border: '2px solid rgba(226,234,244,0.45)', boxSizing: 'border-box',
        left: `${(SIZE.stick - SIZE.knob) / 2}px`, top: `${(SIZE.stick - SIZE.knob) / 2}px`,
        pointerEvents: 'none',
      });
      base.appendChild(knob);
      if (label) {
        base.appendChild(this._el('div', {
          position: 'absolute', width: '100%', textAlign: 'center', bottom: '-18px',
          color: 'rgba(210,220,235,0.4)', font: 'bold 10px "Courier New", monospace',
          pointerEvents: 'none',
        }, label));
      }
      return { base, knob };
    };

    const left = mk('MOVE');
    left.base.style.left = '18px';
    left.base.style.bottom = '18px';
    panel.appendChild(left.base);

    const right = mk('AIM');
    right.base.style.right = `${SIZE.fire + 40}px`;
    right.base.style.bottom = '18px';
    panel.appendChild(right.base);

    this.left = left;
    this.right = right;

    // ---- the buttons -------------------------------------------------------
    const byId = {};
    for (const b of BUTTONS) {
      const d = this._el('div', {
        position: 'absolute',
        width: `${b.big ? SIZE.fire : SIZE.small}px`,
        height: `${b.big ? SIZE.fire : SIZE.small}px`,
        borderRadius: '50%', boxSizing: 'border-box',
        background: `rgba(${[(b.colour >> 16) & 255, (b.colour >> 8) & 255, b.colour & 255].join(',')},${b.big ? 0.42 : 0.32})`,
        border: `2px solid ${hex(b.colour)}`,
        color: '#e8eef6', font: `bold ${b.big ? 13 : 15}px "Courier New", monospace`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }, b.label);
      panel.appendChild(d);
      byId[b.id] = d;
    }
    // fan the small ones around the fire button
    const place = (id, dx, dy) => {
      const d = byId[id];
      d.style.right = `${dx}px`;
      d.style.bottom = `${dy}px`;
    };
    byId.fire.style.right = '18px';
    byId.fire.style.bottom = '18px';
    place('interact', 18 + SIZE.fire + 12, 18 + 6);
    place('reload', 18 + SIZE.fire + 74, 18 + 4);
    place('swap', 18 + SIZE.fire + 12, 18 + SIZE.small + 18);
    place('sprint', 18 + SIZE.fire + 74, 18 + SIZE.small + 14);
    place('grenade', 18 + SIZE.fire + 132, 18 + 6);
    place('medkit', 18 + SIZE.fire + 132, 18 + SIZE.small + 14);
    place('knife', 18 + SIZE.fire + 190, 18 + 6);
    this.buttons = byId;

    // ---- the pause / menu corner ------------------------------------------
    const pause = this._el('div', {
      position: 'absolute', right: '14px', top: '14px',
      width: '44px', height: '30px', borderRadius: '6px',
      background: 'rgba(18,20,24,0.45)', border: '1px solid rgba(210,220,235,0.25)',
      color: '#cfe0ee', font: 'bold 13px "Courier New", monospace',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, 'II');
    panel.appendChild(pause);
    this.buttons.pause = pause;

    this.root.appendChild(panel);
    this._wire();
  }

  // ------------------------------------------------------------------ input --
  _wire() {
    const panel = this.panel;
    if (!panel || !panel.addEventListener) return;

    const stickAt = (which, touch) => {
      const box = which.base.getBoundingClientRect?.() ?? { left: 0, top: 0, width: SIZE.stick, height: SIZE.stick };
      const r = SIZE.stick / 2;
      let dx = touch.clientX - (box.left + box.width / 2);
      let dy = touch.clientY - (box.top + box.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      const mag = Math.min(1, len / r);
      // a thumb resting on the stick should not walk the player into a wall
      const scaled = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD);
      dx = (dx / len) * scaled;
      dy = (dy / len) * scaled;
      const out = which === this.left ? this.move : this.aim;
      out.x = dx; out.y = dy;
      const off = (SIZE.stick - SIZE.knob) / 2;
      which.knob.style.left = `${off + dx * r}px`;
      which.knob.style.top = `${off + dy * r}px`;
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
        } else if (target === this.left.base || target === this.left.knob
          || this._inBox(target, this.left.base)) {
          this._touches.set(t.identifier, { kind: 'move' });
          stickAt(this.left, t);
        } else if (target === this.right.base || target === this.right.knob
          || this._inBox(target, this.right.base)) {
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

  /**
   * A bare tap on the game surface. Without this the panel would swallow
   * every menu press on a phone, which makes the front door unusable on the
   * one device that most needs on-screen controls.
   */
  _tap(t, mode = 'move') {
    const inp = this.input;
    const box = inp?.canvas?.getBoundingClientRect?.();
    if (box && box.width && box.height && inp.canvas.width) {
      inp.mouse.cx = t.clientX - box.left;
      inp.mouse.cy = t.clientY - box.top;
      inp.mouse.x = (inp.mouse.cx / box.width) * inp.canvas.width;
      inp.mouse.y = (inp.mouse.cy / box.height) * inp.canvas.height;
    }
    if (mode === 'up') {
      inp.mouse.down = false;
      inp.mouse.released = true;
    } else if (mode === 'down') {
      if (!inp.mouse.down) inp.mouse.pressed = true;
      inp.mouse.down = true;
    }
    inp.anyInput = true;
  }

  _inBox(target, box) {
    // a child of the stick counts as the stick (the knob, the label)
    let n = target;
    while (n && n !== this.panel) { if (n === box) return true; n = n.parentNode; }
    return false;
  }

  _resetKnob(which) {
    const off = (SIZE.stick - SIZE.knob) / 2;
    which.knob.style.left = `${off}px`;
    which.knob.style.top = `${off}px`;
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

/** Phones and tablets, and laptops that think they are both. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const has = ('ontouchstart' in window) || (navigator?.maxTouchPoints ?? 0) > 0;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return has || coarse;
}
