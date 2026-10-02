// Keyboard + mouse state. Coordinates are reported in *internal canvas*
// pixels (the game renders at a fixed low resolution and is CSS-upscaled).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false };
    this.wheel = 0;
    this.anyInput = false;

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
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.cx = e.clientX - r.left;
      this.mouse.cy = e.clientY - r.top;
      this.mouse.x = (this.mouse.cx / r.width) * canvas.width;
      this.mouse.y = (this.mouse.cy / r.height) * canvas.height;
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
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  isDown(...codes) { return codes.some((c) => this.keys.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  wasReleased(...codes) { return codes.some((c) => this.released.has(c)); }

  /** Movement vector from WASD / arrows, normalised. */
  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed = false;
    this.mouse.released = false;
    this.wheel = 0;
    this.anyInput = false;
  }
}
