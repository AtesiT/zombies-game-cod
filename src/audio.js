// Fully procedural WebAudio SFX -- no asset files, everything is synthesised.
// The context is created lazily on the first user gesture (browser policy).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.ambientGain = null;
    this.muted = false;
    this.ready = false;
    this._lastGrowl = 0;
    this._lastShriek = -9;
    this._lastWhimper = -9;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    // every one-shot effect runs through the sfx bus; ambience has its own
    // routing: every effect -> sfx/ambient bus -> shared bus -> master -> out.
    // The shared bus has to exist *before* anything connects to it, otherwise
    // connect(undefined) throws and the whole engine dies silently.
    const bus = this.ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this.bus = bus;

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(bus);

    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 1;
    this.ambientBus.connect(bus);

    // shared white-noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.ready = true;
    this._startAmbient();
    // volumes may have been set from storage before the context existed
    if (this._masterVol !== undefined || this._sfxVol !== undefined || this._ambVol !== undefined) {
      this.setVolumes({
        master: this._masterVol === undefined ? undefined : this._masterVol * 100,
        sfx: this._sfxVol === undefined ? undefined : this._sfxVol * 100,
        ambient: this._ambVol === undefined ? undefined : this._ambVol * 100,
      });
      this.setMuted(this.muted);
    }
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : (this._masterVol ?? 0.85);
  }

  /** Volumes come in as 0..100 from the settings screen. */
  setVolumes({ master, sfx, ambient } = {}) {
    if (master !== undefined) this._masterVol = Math.max(0, Math.min(1, master / 100));
    if (sfx !== undefined) this._sfxVol = Math.max(0, Math.min(1, sfx / 100));
    if (ambient !== undefined) this._ambVol = Math.max(0, Math.min(1, ambient / 100));
    if (!this.ready) return;
    const t = this.t;
    if (this._masterVol !== undefined) {
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this._masterVol, t + 0.05);
    }
    if (this._sfxVol !== undefined) this.sfxBus.gain.linearRampToValueAtTime(this._sfxVol, t + 0.05);
    if (this._ambVol !== undefined) this.ambientBus.gain.linearRampToValueAtTime(this._ambVol, t + 0.05);
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  _noiseSrc(dur, playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    return s;
  }

  _env(node, t0, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  _tone(type, f0, f1, t0, dur, peak, dest = null) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = this._env(o, t0, peak, Math.min(0.008, dur * 0.2), dur);
    g.connect(dest || this.bus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  // ------------------------------------------------------------- ambiance --
  _startAmbient() {
    const ctx = this.ctx;
    // wind: filtered noise with a slow LFO on the cutoff
    const src = this._noiseSrc();
    src.playbackRate.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    const g = ctx.createGain();
    g.gain.value = 0.055;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(lp.frequency);
    src.connect(hp).connect(lp).connect(g).connect(this.ambientBus);
    src.start();
    lfo.start();
    this.ambientGain = g;

    // distant sub drone
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 41;
    const og = ctx.createGain();
    og.gain.value = 0.035;
    o.connect(og).connect(this.ambientBus);
    o.start();

    // a slow pulse we can fade in when the round is nearly over. It rides on
    // top of the drone's base gain, so at rest it is completely silent.
    const pulse = ctx.createOscillator();
    pulse.type = 'sine';
    pulse.frequency.value = 0.85;
    const pg = ctx.createGain();
    pg.gain.value = 0;
    pulse.connect(pg).connect(og.gain);
    pulse.start();

    this._windGain = g;
    this._droneOsc = o;
    this._droneGain = og;
    this._pulseGain = pg;
    this._tension = 0;
  }

  /**
   * 0 = business as usual, 1 = one shambling survivor left somewhere in the
   * dark. Wind drops away, the drone sags a semitone and starts to breathe,
   * and the player's own pulse fills the gap.
   */
  setTension(t) {
    if (!this.ready) return;
    t = Math.max(0, Math.min(1, t));
    if (Math.abs(t - (this._tension ?? 0)) < 0.005) return;
    this._tension = t;
    const now = this.ctx.currentTime;
    const ramp = 0.6;
    if (this._windGain) {
      this._windGain.gain.cancelScheduledValues(now);
      this._windGain.gain.setValueAtTime(this._windGain.gain.value, now);
      this._windGain.gain.linearRampToValueAtTime(0.055 - 0.040 * t, now + ramp);
    }
    if (this._droneGain) {
      this._droneGain.gain.cancelScheduledValues(now);
      this._droneGain.gain.setValueAtTime(this._droneGain.gain.value, now);
      this._droneGain.gain.linearRampToValueAtTime(0.035 + 0.034 * t, now + ramp);
    }
    if (this._droneOsc) {
      this._droneOsc.frequency.cancelScheduledValues(now);
      this._droneOsc.frequency.setValueAtTime(this._droneOsc.frequency.value, now);
      this._droneOsc.frequency.linearRampToValueAtTime(41 - 9 * t, now + ramp);
    }
    if (this._pulseGain) {
      this._pulseGain.gain.cancelScheduledValues(now);
      this._pulseGain.gain.setValueAtTime(this._pulseGain.gain.value, now);
      this._pulseGain.gain.linearRampToValueAtTime(0.030 * t, now + ramp);
    }
  }

  // --------------------------------------------------------------- shots ---
  shot(kind = 'pistol', dist = 0) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const atten = Math.max(0.25, 1 - dist / 1400);
    const cfg = {
      pistol: { dur: 0.16, crack: 2400, body: 190, peak: 0.5, tail: 0.1 },
      smg: { dur: 0.12, crack: 2900, body: 210, peak: 0.4, tail: 0.07 },
      shotgun: { dur: 0.34, crack: 1500, body: 120, peak: 0.75, tail: 0.28 },
      rifle: { dur: 0.42, crack: 3400, body: 130, peak: 0.8, tail: 0.4 },
      sniper: { dur: 0.52, crack: 3800, body: 105, peak: 0.9, tail: 0.55 },
    }[kind] || { dur: 0.16, crack: 2400, body: 190, peak: 0.5, tail: 0.1 };

    if (kind === 'raygun' || kind === 'wunderwaffe' || kind === 'thundergun'
      || kind === 'winterhowl' || kind === 'throw') { this.wonder(kind); return; }

    // bright transient
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(cfg.crack, t);
    bp.frequency.exponentialRampToValueAtTime(cfg.crack * 0.25, t + cfg.dur);
    bp.Q.value = 0.9;
    n.connect(bp);
    const g1 = this._env(bp, t, cfg.peak * atten, 0.001, cfg.dur);
    g1.connect(this.bus);
    n.start(t); n.stop(t + cfg.dur + 0.1);

    // body thump
    this._tone('sine', cfg.body, cfg.body * 0.35, t, cfg.tail, 0.35 * atten * cfg.peak);

    // room tail
    const n2 = this._noiseSrc(0.5, 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.35);
    n2.connect(lp);
    const g2 = this._env(lp, t + 0.01, 0.10 * atten, 0.01, 0.38);
    g2.connect(this.bus);
    n2.start(t); n2.stop(t + 0.45);
  }

  knife() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.14);
    f.Q.value = 2.2;
    n.connect(f);
    const g = this._env(f, t, 0.24, 0.006, 0.15);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.2);
  }

  dryFire() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 6;
    n.connect(bp);
    const g = this._env(bp, t, 0.22, 0.001, 0.04);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.08);
  }

  reload(stage = 0) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const f = [1500, 900, 2600][stage % 3];
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
    n.connect(bp);
    const g = this._env(bp, t, 0.3, 0.002, 0.07);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.12);
    this._tone('square', 220, 120, t, 0.05, 0.06);
  }

  impact(flesh = true, head = false) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = flesh ? 'lowpass' : 'bandpass';
    f.frequency.value = flesh ? 700 : 2600;
    f.Q.value = flesh ? 1 : 3;
    n.connect(f);
    const g = this._env(f, t, flesh ? 0.3 : 0.22, 0.001, flesh ? 0.09 : 0.05);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.14);
    if (head) this._tone('triangle', 1400, 500, t, 0.09, 0.14);
    if (flesh) this._tone('sine', 140, 60, t, 0.08, 0.16);
  }

  growl(pitch = 1, vol = 1) {
    if (!this.ready || this.muted) return;
    if (this.t - this._lastGrowl < 0.12) return;
    this._lastGrowl = this.t;
    const t = this.t;
    const dur = 0.5 + Math.random() * 0.5;
    const base = (62 + Math.random() * 26) * pitch;

    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (0.72 + Math.random() * 0.2), t + dur);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5 + Math.random() * 4;
    const vg = this.ctx.createGain();
    vg.gain.value = base * 0.16;
    vib.connect(vg).connect(o.frequency);
    vib.start(t); vib.stop(t + dur);

    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(520, t);
    f.frequency.linearRampToValueAtTime(300, t + dur);
    f.Q.value = 4.5;
    o.connect(f);
    const g = this._env(f, t, 0.1 * vol, 0.09, dur);
    g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.1);

    // breathy layer
    const n = this._noiseSrc();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 1.2;
    n.connect(nf);
    const ng = this._env(nf, t, 0.035 * vol, 0.12, dur * 0.9);
    ng.connect(this.bus);
    n.start(t); n.stop(t + dur + 0.1);
  }

  zombieDie() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    n.connect(f);
    const g = this._env(f, t, 0.28, 0.01, 0.42);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.5);
    this._tone('sawtooth', 180, 48, t, 0.45, 0.09);
  }

  playerHurt() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('sine', 150, 55, t, 0.35, 0.4);
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    n.connect(f);
    const g = this._env(f, t, 0.35, 0.002, 0.2);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.25);
  }

  heartbeat(intensity = 1) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    for (const [off, amp] of [[0, 0.5], [0.19, 0.34]]) {
      this._tone('sine', 68, 34, t + off, 0.16, 0.42 * intensity * amp);
      this._tone('sine', 46, 28, t + off, 0.2, 0.3 * intensity * amp);
    }
  }

  wood(place = false) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const f0 = place ? 900 : 380;
    this._tone('triangle', f0, f0 * 0.45, t, 0.13, 0.3);
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = place ? 2200 : 1300; f.Q.value = 3;
    n.connect(f);
    const g = this._env(f, t, 0.2, 0.002, 0.09);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.15);
  }

  door() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc(0.6, 0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.7);
    n.connect(f);
    const g = this._env(f, t, 0.3, 0.05, 0.7);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.8);
    this._tone('sine', 90, 50, t, 0.6, 0.16);
  }

  buy() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('square', 880, 880, t, 0.07, 0.13);
    this._tone('square', 1320, 1320, t + 0.07, 0.11, 0.11);
  }

  deny() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('square', 220, 150, t, 0.14, 0.12);
  }

  explosion() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.9);
    n.connect(f);
    const g = this._env(f, t, 0.9, 0.004, 0.95);
    g.connect(this.bus);
    n.start(t); n.stop(t + 1.1);
    this._tone('sine', 120, 30, t, 0.7, 0.65);
    this._tone('sawtooth', 70, 25, t, 0.5, 0.25);
  }

  roundSting(up = true) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const root = up ? 55 : 49;
    [1, 1.5, 2.02, 2.98].forEach((m, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'sine';
      o.frequency.value = root * m;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = this._env(o, t, 0.16 / (i + 1), 0.25, 2.4);
      g.connect(this.bus);
      o.start(t); o.stop(t + 2.9);
    });
    // reverse-swell noise
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t); n.stop(t + 2.8);
  }

  // --------------------------------------------------- wonder weapons ------
  /** Ray Gun / DG-2 / Thunder Gun / Winter's Howl / Monkey Bomb. */
  wonder(kind) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    if (kind === 'raygun') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.28);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.3);
      const g = this._env(o, t, 0.42, 0.004, 0.34);
      o.connect(f).connect(g).connect(this.bus);
      o.start(t); o.stop(t + 0.4);
      this._tone('sine', 220, 60, t, 0.3, 0.3);
      return;
    }
    if (kind === 'wunderwaffe') {
      const n = this._noiseSrc(0.6, 1.6);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(5200, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.4);
      bp.Q.value = 3;
      const g = this._env(bp, t, 0.4, 0.002, 0.42);
      n.connect(bp).connect(g).connect(this.bus);
      n.start(t); n.stop(t + 0.5);
      this._tone('sawtooth', 90, 40, t, 0.3, 0.25);
      return;
    }
    if (kind === 'thundergun') {
      const n = this._noiseSrc();
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(70, t + 0.8);
      const g = this._env(lp, t, 0.95, 0.01, 0.85);
      n.connect(lp).connect(g).connect(this.bus);
      n.start(t); n.stop(t + 1.0);
      this._tone('sine', 70, 26, t, 0.8, 0.7);
      return;
    }
    if (kind === 'winterhowl') {
      const n = this._noiseSrc(0.5, 0.7);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2400;
      const g = this._env(hp, t, 0.3, 0.02, 0.55);
      n.connect(hp).connect(g).connect(this.bus);
      n.start(t); n.stop(t + 0.7);
      this._tone('triangle', 2600, 900, t, 0.4, 0.18);
      return;
    }
    // monkey bomb throw
    this._tone('square', 300, 700, t, 0.12, 0.12);
  }

  /** Wind-up monkey squeak, pitch rising as the fuse burns down. */
  monkey(progress = 0) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    for (let i = 0; i < 3; i++) {
      const f = 620 + progress * 900 + i * 130;
      this._tone('square', f, f * 1.7, t + i * 0.055, 0.05, 0.075);
    }
  }

  /** Power-up pickup / perk chime. */
  chime() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    [784, 988, 1319].forEach((f, i) => this._tone('triangle', f, f, t + i * 0.06, 0.28, 0.14));
  }

  perk() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) => this._tone('square', f, f, t + i * 0.07, 0.22, 0.10));
    this._tone('sine', 110, 70, t, 0.5, 0.22);
  }

  nuke() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this.explosion();
    const n = this._noiseSrc();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(hp).connect(g).connect(this.bus);
    n.start(t); n.stop(t + 1.7);
  }

  hammer() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    for (let i = 0; i < 3; i++) this.wood(true), this._tone('triangle', 700, 300, t + i * 0.11, 0.1, 0.22);
  }

  /** The generator kicks in: a rising hum and a clunk. */
  powerUp() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(32, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t); o.stop(t + 2.7);
    this._tone('square', 180, 60, t, 0.2, 0.2);
    [392, 523, 659].forEach((ff, i) => this._tone('triangle', ff, ff, t + 0.5 + i * 0.12, 0.4, 0.14));
  }

  /** Mystery box: the rumble of the wheel spinning. */
  boxSpin() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc(2.6, 0.4);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.2);
    g.gain.setValueAtTime(0.18, t + 2.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t); n.stop(t + 2.8);
    for (let i = 0; i < 12; i++) this._tone('square', 140 + i * 9, 120 + i * 9, t + i * 0.2, 0.05, 0.05);
  }

  /** Dog round: a howl and a pack of barks. */
  dogRound() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(520, t + 0.5);
    o.frequency.linearRampToValueAtTime(240, t + 1.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2.5;
    const g = this._env(o, t, 0.3, 0.2, 1.5);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t); o.stop(t + 1.8);
    for (let i = 0; i < 6; i++) {
      this._tone('square', 420 + Math.random() * 200, 180, t + 0.4 + i * 0.15, 0.07, 0.08);
    }
  }

  /** Easter egg: static, then a distant melody. */
  /** The Shrieker: a ragged human scream that rises and breaks. */
  shriek(vol = 1) {
    if (!this.ready || this.muted) return;
    if (this.t - this._lastShriek < 0.5) return;
    this._lastShriek = this.t;
    const t = this.t;
    const base = 300 + Math.random() * 90;
    const dur = 0.95;

    // voice: a sawtooth glissando with a wobbling formant on top
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.7, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.28);
    o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.6);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);

    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 1150; f1.Q.value = 5;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'peaking'; f2.frequency.value = 2400; f2.Q.value = 3; f2.gain.value = 9;
    o.connect(f1).connect(f2);
    const g = this._env(f2, t, 0.22 * vol, 0.06, dur);
    g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.1);

    // ragged breath tearing out of it
    const n = this._noiseSrc();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.setValueAtTime(1800, t);
    nf.frequency.exponentialRampToValueAtTime(700, t + dur);
    nf.Q.value = 1.6;
    n.connect(nf);
    const ng = this._env(nf, t, 0.10 * vol, 0.12, dur * 0.95);
    ng.connect(this.bus);
    n.start(t); n.stop(t + dur + 0.1);
  }

  /** Level traps arming: flame, electric or steam. */
  trap(kind = 'flame') {
    if (!this.ready || this.muted) return;
    const t = this.t;
    if (kind === 'flame') {
      const n = this._noiseSrc(1.6, 0.4);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(320, t);
      f.frequency.exponentialRampToValueAtTime(1500, t + 0.18);
      f.frequency.exponentialRampToValueAtTime(220, t + 1.1);
      f.Q.value = 0.9;
      n.connect(f);
      const g = this._env(f, t, 0.5, 0.05, 1.2);
      g.connect(this.bus);
      n.start(t); n.stop(t + 1.3);
      this._tone('sine', 90, 45, t, 0.5, 0.2);
    } else if (kind === 'electric') {
      for (let i = 0; i < 9; i++) {
        const tt = t + i * 0.055;
        this._tone('square', 1500 + Math.random() * 2200, 500, tt, 0.045, 0.11);
      }
      const n = this._noiseSrc();
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2400;
      n.connect(hp);
      const g = this._env(hp, t, 0.22, 0.01, 0.85);
      g.connect(this.bus);
      n.start(t); n.stop(t + 0.95);
      this._tone('sine', 60, 40, t, 0.6, 0.22);
    } else {
      const n = this._noiseSrc(1.2, 0.9);
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(3200, t + 0.5);
      f.Q.value = 0.7;
      n.connect(f);
      const g = this._env(f, t, 0.34, 0.09, 1.3);
      g.connect(this.bus);
      n.start(t); n.stop(t + 1.4);
      this._tone('sine', 130, 260, t, 0.7, 0.10);
    }
  }

  /**
   * The sound of the last one still out there: a wet, tired, half-breath moan
   * from somewhere you cannot see. Never twice close together.
   */
  whimper() {
    if (!this.ready || this.muted) return;
    if (this.t - this._lastWhimper < 2.2) return;
    this._lastWhimper = this.t;
    const t = this.t;
    const base = 128 + Math.random() * 104;
    const dur = 0.55 + Math.random() * 0.75;

    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (0.68 + Math.random() * 0.12), t + dur);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 3 + Math.random() * 3;
    const vg = this.ctx.createGain();
    vg.gain.value = base * 0.09;
    vib.connect(vg).connect(o.frequency);
    vib.start(t); vib.stop(t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 620 + Math.random() * 260; f.Q.value = 7;
    o.connect(f);
    const g = this._env(f, t, 0.045, 0.24, dur);
    g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.2);

    // the breath behind it
    const n = this._noiseSrc();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1150; nf.Q.value = 1.1;
    n.connect(nf);
    const ng = this._env(nf, t, 0.018, 0.34, dur);
    ng.connect(this.bus);
    n.start(t); n.stop(t + dur + 0.2);
  }

  /** Rifle round on a Stahlhelm: a bright, short, inharmonic ping. */
  clang() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    // three inharmonic partials is what makes metal read as metal
    for (const [f, v, d] of [[2400, 0.09, 0.26], [3310, 0.06, 0.19], [4700, 0.035, 0.13]]) {
      this._tone('triangle', f, f * 0.94, t, d, v);
    }
    this._tone('square', 900, 640, t, 0.05, 0.05);
    const n = this._noiseSrc(0.12, 0.1);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    n.connect(hp);
    const g = this._env(hp, t, 0.05, 0.004, 0.13);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.18);
  }

  /** The helmet finally comes off: a heavier, rattling version of the ping. */
  helmetOff() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this.clang();
    this._tone('triangle', 1500, 900, t + 0.02, 0.34, 0.10);
    this._tone('triangle', 1120, 620, t + 0.06, 0.42, 0.07);
    this._tone('sine', 320, 190, t + 0.02, 0.28, 0.09);
    const n = this._noiseSrc(0.4, 0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
    n.connect(bp);
    const g = this._env(bp, t, 0.10, 0.01, 0.38);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.45);
  }

  /** Fuel going up: a whoomp, then a steady roar that fades. */
  ignite() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc(1.4, 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(420, t + 1.4);
    f.Q.value = 1.1;
    n.connect(f);
    const g = this._env(f, t, 0.34, 0.05, 1.5);
    g.connect(this.bus);
    n.start(t); n.stop(t + 1.6);
    this._tone('sine', 150, 44, t, 0.55, 0.30);
    this._tone('sawtooth', 90, 38, t + 0.02, 0.4, 0.10);
  }

  /** Pack-a-Punch: the machine swallows the gun and spits it back upgraded. */
  packAPunch() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    // motor winding up
    this._tone('sawtooth', 70, 190, t, 1.0, 0.14);
    this._tone('square', 140, 380, t + 0.05, 0.9, 0.07);
    const n = this._noiseSrc(0.8, 0.6);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.9);
    bp.Q.value = 3;
    n.connect(bp);
    const g = this._env(bp, t, 0.2, 0.25, 1.0);
    g.connect(this.bus);
    n.start(t); n.stop(t + 1.1);
    // clunk, then the upgraded chime
    this._tone('square', 200, 90, t + 1.0, 0.12, 0.2);
    this._tone('triangle', 523, 523, t + 1.22, 0.20, 0.16);
    this._tone('triangle', 659, 659, t + 1.34, 0.20, 0.15);
    this._tone('triangle', 784, 784, t + 1.46, 0.24, 0.14);
    this._tone('triangle', 1046, 1046, t + 1.58, 0.55, 0.12);
  }

  radioStart() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc(4.5, 1.2);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.4);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t); n.stop(t + 4.5);
    const melody = [440, 587, 659, 587, 494, 440];
    melody.forEach((f, i) => this._tone('triangle', f, f, t + 1.2 + i * 0.42, 0.5, 0.09));
  }
}

export const audio = new AudioEngine();
