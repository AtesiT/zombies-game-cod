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
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // shared white-noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.ready = true;
    this._startAmbient();
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
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
    g.connect(dest || this.master);
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
    src.connect(hp).connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.ambientGain = g;

    // distant sub drone
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 41;
    const og = ctx.createGain();
    og.gain.value = 0.035;
    o.connect(og).connect(this.master);
    o.start();
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
    }[kind] || { dur: 0.16, crack: 2400, body: 190, peak: 0.5, tail: 0.1 };

    // bright transient
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(cfg.crack, t);
    bp.frequency.exponentialRampToValueAtTime(cfg.crack * 0.25, t + cfg.dur);
    bp.Q.value = 0.9;
    n.connect(bp);
    const g1 = this._env(bp, t, cfg.peak * atten, 0.001, cfg.dur);
    g1.connect(this.master);
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
    g2.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);

    // breathy layer
    const n = this._noiseSrc();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 1.2;
    n.connect(nf);
    const ng = this._env(nf, t, 0.035 * vol, 0.12, dur * 0.9);
    ng.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(this.master);
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
      g.connect(this.master);
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
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 2.8);
  }
}

export const audio = new AudioEngine();
