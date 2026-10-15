/** Bounded session-local text sprites; avoids per-frame Canvas font shaping. */
export class EnvironmentRenderer {
  constructor(capacity = 256) {
    this.capacity = capacity;
    this.labels = new Map();
  }
  /** Draw with the caller's current font, color and alignment; cache only stable style/text. */
  label(ctx, text, x, y) {
    const key = `${ctx.font}|${ctx.fillStyle}|${text}`;
    let sprite = this.labels.get(key);
    if (!sprite) {
      const canvas = document.createElement('canvas'),
        c = canvas.getContext('2d');
      c.font = ctx.font;
      const width = Math.ceil(c.measureText(text).width) + 6,
        size = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 12),
        baseline = Math.ceil(size * 1.25) + 2;
      canvas.width = width;
      canvas.height = Math.ceil(size * 1.9) + 4;
      c.font = ctx.font;
      c.fillStyle = ctx.fillStyle;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(text, 3, baseline);
      sprite = { canvas, width, baseline };
      if (this.labels.size >= this.capacity) this.labels.delete(this.labels.keys().next().value);
      this.labels.set(key, sprite);
    }
    const offset =
      ctx.textAlign === 'center'
        ? sprite.width / 2
        : ['right', 'end'].includes(ctx.textAlign)
          ? sprite.width
          : 0;
    ctx.drawImage(sprite.canvas, x - offset, y - sprite.baseline);
  }
  /** Release label canvases on map changes. */
  dispose() {
    this.labels.clear();
  }
}
