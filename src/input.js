// Keyboard + mouse state. Coordinates are reported in *internal canvas*
// pixels (the game renders at a fixed low resolution and is CSS-upscaled).

// A notch of a real mouse wheel, in deltaY units, is one row of a list.
const WHEEL_STEP = 100;
// and this is as much unspent distance as is ever kept between frames: a
// trackpad flick that arrives all at once still scrolls, just not to the end
// of the world in one frame
const WHEEL_KEEP = 800;
const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Input {
  /** The resolution the game thinks in, whatever size the canvas really is. */
  setLogicalSize(w, h) { this.vw = w; this.vh = h; }

  constructor(canvas) {
    this.canvas = canvas;
    // Pointer coordinates are reported in the game's own 800x500 space, which
    // is *not* necessarily the size of the backing store: DLSS5 renders the
    // canvas larger than that and scales it down, and the mouse must not know.
    this.vw = canvas.width;
    this.vh = canvas.height;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false };
    this.wheel = 0;
    this._wheelPx = 0;          // raw wheel distance, in hundredths of a notch
    this.pointer = 'mouse';     // 'mouse' | 'touch', for the drawn cursor
    this.anyInput = false;
    // set by a full-screen list that wants the movement keys for itself
    this.menuLock = false;
    // filled in by the on-screen stick (see src/touch.js); null on desktop
    this.stick = { x: 0, y: 0 };

    const onKey = (e, down) => {
      if (e.repeat) return;
      const c = e.code;
      if (down) {
        if (!this.keys.has(c)) this.pressed.add(c);
        this.keys.add(c);
      } else {
        this.keys.delete(c);
        this.released.add(c);
      }
      this.anyInput = true;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(c)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear(); this.pressed.clear(); this.released.clear();
      this.mouse.down = this.mouse.rdown = this.mouse.pressed = this.mouse.released = false;
      this.stick.x = this.stick.y = 0;
      this.wheel = 0; this._wheelPx = 0; this.anyInput = false;
    });

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.mouse.cx = e.clientX - r.left;
      this.mouse.cy = e.clientY - r.top;
      this.mouse.x = (this.mouse.cx / r.width) * this.vw;
      this.mouse.y = (this.mouse.cy / r.height) * this.vh;
    };
    window.addEventListener('mousemove', toLocal);
    window.addEventListener('mousedown', (e) => {
      toLocal(e);
      this.anyInput = true;
      if (e.button === 0) { this.mouse.down = true; this.mouse.pressed = true; }
      if (e.button === 2) this.mouse.rdown = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.down = false; this.mouse.released = true; }
      if (e.button === 2) this.mouse.rdown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // The wheel used to add one row per *event*, and a trackpad sends thirty
    // events for one flick: a two-inch swipe went through a whole menu. What
    // is accumulated now is the distance the wheel actually turned, and a
    // notch of a real mouse is 100 of it, so a mouse moves one row and a
    // trackpad moves in proportion to the hand.
    window.addEventListener('wheel', (e) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this._wheelPx = clampNum(this._wheelPx + e.deltaY * unit, -WHEEL_KEEP, WHEEL_KEEP);
      this.anyInput = true;
    }, { passive: true });
  }

  isDown(...codes) { return codes.some((c) => this.keys.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  wasReleased(...codes) { return codes.some((c) => this.released.has(c)); }

  /** Movement vector from WASD / arrows and the on-screen stick, normalised. */
  moveVector() {
    // A full-screen menu that still lets you walk is a menu that closes
    // itself while you read it: the bench sets this, and the arrows belong to
    // the list until it does.
    if (this.menuLock) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
    const st = this.stick;
    if (st && (st.x || st.y)) {
      x += st.x; y += st.y;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
    }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed = false;
    this.mouse.released = false;
    // one row for a mouse notch, and a ceiling of one row per frame for a
    // flick: the remainder stays in the accumulator, so nothing is lost and
    // nothing teleports
    this.wheel = Math.max(-1, Math.min(1, Math.trunc((this._wheelPx ?? 0) / WHEEL_STEP)));
    if (this.wheel) this._wheelPx -= this.wheel * WHEEL_STEP;
    this._wheelPx = clampNum(this._wheelPx, -WHEEL_KEEP, WHEEL_KEEP);
    this.anyInput = false;
  }
}
