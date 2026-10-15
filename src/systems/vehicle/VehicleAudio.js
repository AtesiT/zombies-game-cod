import { audio } from '../../audio.js';
/** One reusable engine voice routed through the game's volume/mute controls. */
export class VehicleAudio {
  /** Start/update engine pitch; lazily creates audio only after gesture unlock. */
  update(active, speed) {
    if (!active || !audio.ctx) {
      this.stop();
      return;
    }
    if (!this.osc) {
      this.osc = audio.ctx.createOscillator();
      this.gain = audio.ctx.createGain();
      this.osc.type = 'sawtooth';
      this.osc.connect(this.gain);
      this.gain.connect(audio.sfxBus);
      this.gain.gain.value = 0.025;
      this.osc.start();
    }
    this.osc.frequency.setTargetAtTime(35 + speed * 0.32, audio.ctx.currentTime, 0.08);
  }
  /** Play a short crush impact through the existing bounded SFX path. */
  crush() {
    audio.impact(true, false);
    audio.clang();
  }
  /** Stop and disconnect the engine voice. Safe to call repeatedly. */
  stop() {
    if (this.osc) {
      this.osc.stop();
      this.osc.disconnect();
      this.gain.disconnect();
      this.osc = null;
      this.gain = null;
    }
  }
}
