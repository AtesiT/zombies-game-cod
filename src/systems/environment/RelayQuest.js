import { audio } from '../../audio.js';
/** Ordered relay puzzle and defend-the-console finale, configured without map IDs. */
export class RelayQuest {
  constructor(manager, config) {
    this.manager = manager;
    this.config = config;
    this.stage = 0;
    this.charging = false;
    this.charge = 0;
    this.complete = false;
  }
  /** Contextual quest prompt. */
  interaction(player) {
    if (this.complete) return null;
    const c = this.config;
    for (let i = 0; i < c.switches.length; i++) {
      const s = c.switches[i];
      if (Math.hypot(player.pos.x - s.x, player.pos.y - s.y) < 38)
        return {
          kind: 'relay',
          index: i,
          label: `RELAY ${s.name} (${this.stage}/${c.switches.length})`,
          quest: this,
        };
    }
    if (Math.hypot(player.pos.x - c.finale.x, player.pos.y - c.finale.y) < 45)
      return {
        kind: 'finale',
        label: `RESTORE BROADCAST • ${c.requiredSigns} FALLEN SIGNS REQUIRED`,
        quest: this,
      };
    return null;
  }
  /** Process ordered switches or begin final broadcast. */
  interact(action) {
    const c = this.config;
    if (this.complete) return;
    if (action.kind === 'relay') {
      if (action.index === this.stage) this.stage++;
      else if (action.index >= this.stage) this.stage = 0;
      this.manager.message(`RELAYS ${this.stage}/${c.switches.length}`);
      this.manager.emit('environment:quest-stage', this.stage);
      return;
    }
    if (
      this.stage < c.switches.length ||
      this.manager.destructibles.count('neon-sign') < c.requiredSigns
    ) {
      this.manager.message('CONNECT RELAYS IN ORDER / SHOOT SIGNS');
      return;
    }
    this.charging = true;
    this.charge = 0;
    this.manager.message('DEFEND THE BROADCAST');
  }
  /** Charge only while the player remains at the finale; reward once. */
  update(dt) {
    if (!this.charging || this.complete) return;
    const g = this.manager.game,
      c = this.config;
    if (
      g.player.dead ||
      Math.hypot(g.player.pos.x - c.finale.x, g.player.pos.y - c.finale.y) > c.defendRadius
    ) {
      this.charging = false;
      this.charge = 0;
      this.manager.message('BROADCAST INTERRUPTED');
      return;
    }
    this.charge += dt;
    if (this.charge >= c.holdSeconds) {
      audio.chime();
      this.complete = true;
      this.charging = false;
      g.addPoints(c.reward, c.finale.x, c.finale.y, '#8be8e2', g.player);
      g.player.heal(100);
      g.player.slot.mag = g.player.def.mag;
      g.player.slot.reserve = g.player.def.maxReserve;
      g.bannerShow('THE MARKET SPEAKS', c.message, { dur: 4, colour: '#97e6de' });
      this.manager.emit('environment:quest-complete', c.id);
    }
  }
  /** Draw numbered relay clues and finale state. */
  draw(ctx) {
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < this.config.switches.length; i++) {
      const s = this.config.switches[i];
      ctx.fillStyle = i < this.stage ? '#7bebbb' : '#ce6bce';
      ctx.fillRect(s.x - 10, s.y - 10, 20, 20);
      this.manager.label(ctx, `${i + 1} • ${s.name}`, s.x, s.y - 17);
    }
    const f = this.config.finale;
    ctx.fillStyle = this.complete ? '#82e0b9' : '#c8a1e2';
    ctx.fillRect(f.x - 15, f.y - 12, 30, 24);
    this.manager.label(
      ctx,
      this.complete
        ? 'BROADCAST ONLINE'
        : this.charging
          ? `BROADCAST ${Math.ceil(this.charge)}/${this.config.holdSeconds}`
          : 'BROADCAST CONSOLE',
      f.x,
      f.y - 22,
    );
    ctx.restore();
  }
}
