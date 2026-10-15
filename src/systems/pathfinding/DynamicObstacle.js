/** Sparse, conservative tile footprint of an oriented obstacle. */
export class DynamicObstacle {
  cells = new Set();
  revision = 0;
  /** Update only the old/new bounding footprint, returning changed tile indices. */
  update(body, map) {
    const cells = new Set(),
      r = Math.hypot(body.length, body.width) / 2 + 18;
    for (
      let y = Math.max(0, Math.floor((body.pos.y - r) / 24));
      y <= Math.min(map.h - 1, Math.floor((body.pos.y + r) / 24));
      y++
    )
      for (
        let x = Math.max(0, Math.floor((body.pos.x - r) / 24));
        x <= Math.min(map.w - 1, Math.floor((body.pos.x + r) / 24));
        x++
      )
        if (body.distance((x + 0.5) * 24, (y + 0.5) * 24) < 18) cells.add(y * map.w + x);
    const changed = [];
    for (const i of this.cells) if (!cells.has(i)) changed.push(i);
    for (const i of cells) if (!this.cells.has(i)) changed.push(i);
    if (changed.length) {
      this.cells = cells;
      this.revision++;
    }
    return changed;
  }
}
