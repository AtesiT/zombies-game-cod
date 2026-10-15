/** Fixed-step inertia physics with swept/substepped oriented static collision. */
export class VehicleController {
  constructor(body, map) {
    this.body = body;
    this.map = map;
  }
  /** Check the full body footprint, including its interior, against static tiles/props. */
  blocked() {
    const b = this.body;
    for (let x = -b.length / 2; x <= b.length / 2; x += b.length / 12)
      for (let y = -b.width / 2; y <= b.width / 2; y += b.width / 6) {
        const p = b.world(x, y);
        if (this.map.solidAt(Math.floor(p.x / 24), Math.floor(p.y / 24))) return true;
        for (const r of this.map.solidProps ?? [])
          if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) return true;
      }
    return false;
  }
  /** Integrate velocity separately from heading to retain visible lateral slip. */
  update(dt, controls, onStep = () => {}) {
    const b = this.body,
      steps = Math.max(1, Math.ceil(dt * 120)),
      h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const c = Math.cos(b.angle),
        s = Math.sin(b.angle);
      let forward = b.vel.x * c + b.vel.y * s,
        lateral = -b.vel.x * s + b.vel.y * c;
      const powered = b.driving && b.hp > 0 && b.fuel > 0;
      const throttle = powered ? controls.throttle : 0;
      forward += throttle * b.config.acceleration * (this.weatherSpeed ?? 1) * h;
      forward *= Math.exp(-(controls.brake ? 5.5 : 0.45) * h);
      forward = Math.max(-b.config.maxSpeed * (this.weatherSpeed ?? 1) * 0.4, Math.min(b.config.maxSpeed * (this.weatherSpeed ?? 1), forward));
      lateral *= Math.exp((-(controls.brake ? 1.4 : 3.2) / ((this.driftMultiplier ?? 1) * (this.weatherDrift ?? 1))) * h);
      b.steer += (controls.steer - b.steer) * (1 - Math.exp(-7 * h));
      const oldAngle = b.angle,
        ox = b.pos.x,
        oy = b.pos.y;
      b.angle += ((b.steer * forward) / b.length) * 0.72 * h;
      b.vel.x = forward * c - lateral * s;
      b.vel.y = forward * s + lateral * c;
      b.pos.x += b.vel.x * h;
      b.pos.y += b.vel.y * h;
      if (this.blocked()) {
        b.angle = oldAngle;
        b.pos.x = ox;
        b.pos.y = oy;
        b.vel.x *= -0.15;
        b.vel.y *= -0.15;
      }
      if (powered)
        b.fuel = Math.max(
          0,
          b.fuel - (0.08 + Math.abs(throttle) * 0.32 + Math.abs(forward) * 0.001) * h,
        );
      onStep(h);
    }
  }
}
