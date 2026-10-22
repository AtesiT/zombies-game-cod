import { SoundtrackPlayer, SOUNDTRACKS } from './soundtracks.js';

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
    this.musicMode = 'repeat';
    // Why the engine is not making noise, for the HUD and for the console.
    // null means "fine"; a string is the reason the player sees on screen.
    this.lastError = null;
    this._lastGrowl = 0;
    this._lastShriek = -9;
    this._lastWhimper = -9;
  }

  /** Is the audio graph built AND the browser clock actually running? */
  get running() { return !!(this.ready && this.ctx && this.ctx.state === 'running'); }

  /**
   * Build the graph. This is called from a user gesture (browser policy), but
   * it has to survive being called twice, being called after a failure, and
   * being called when the context was closed by the browser.
   *
   * If any part of the build throws, we tear the whole half-built engine down
   * instead of leaving `ctx` set: `init()` used to return early on a non-null
   * ctx, so one exception halfway through meant every later gesture did
   * nothing, `ready` stayed false, and the game was silent for good.
   */
  init() {
    if (this.ctx && this.ctx.state !== 'closed') return;
    if (this.ctx) this._teardown();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.lastError = 'This browser has no WebAudio'; return; }
    try {
      this._build(new AC());
    } catch (err) {
      this.lastError = err?.message || String(err);
      console.warn('[audio] the audio engine could not start; the next tap will retry', err);
      this._teardown();
    }
  }

  _build(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);
    // every one-shot effect runs through the sfx bus; ambience has its own
    // routing: every effect -> sfx/ambient bus -> shared bus -> master -> out.
    // The shared bus has to exist *before* anything connects to it, otherwise
    // connect(undefined) throws and the whole engine dies silently.
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this.bus = bus;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(bus);

    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 1;
    this.ambientBus.connect(bus);

    // music has its own fader: it is the one thing you might want gone
    // while keeping the wind and the shots
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(bus);

    // shared white-noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this._startAmbient();
    this._startReverb();
    this._startMusic();

    // ...and only now is the engine usable: a throw above leaves `ready`
    // false, and `_teardown` gives us a clean slate for the next gesture.
    this.ready = true;
    this.lastError = null;
    this._retries = 0;

    // volumes may have been set from storage before the context existed
    if (this._masterVol !== undefined || this._sfxVol !== undefined || this._ambVol !== undefined) {
      this.setVolumes({
        master: this._masterVol === undefined ? undefined : this._masterVol * 100,
        sfx: this._sfxVol === undefined ? undefined : this._sfxVol * 100,
        ambient: this._ambVol === undefined ? undefined : this._ambVol * 100,
        music: this._musicVol === undefined ? undefined : this._musicVol * 100,
      });
      this.setMuted(this.muted);
    }
    // A context created outside a gesture starts suspended. Try to start it
    // now -- if this is a gesture it works; if not, the next tap will.
    this._kick();
    // ...and keep asking, quietly, until it runs. A page that was opened in a
    // background tab, or a browser that only honours gestures for *some*
    // events, leaves the clock parked at time zero: the graph is built, every
    // gain is set, and not one sample ever leaves. The old code waited for
    // the player to click again, which is indistinguishable from a game with
    // no sound at all.
    this._kickUntilRunning();
  }

  /**
   * Nudge a suspended clock a few times over the first couple of seconds.
   *
   * Every attempt is cheap (a resume() on a context that is already running
   * does nothing) and every attempt is swallowed: the permanent gesture
   * listeners in main.js are still the main door. This is the safety net for
   * the case where the gesture arrived but the browser was slow to honour it.
   */
  _kickUntilRunning() {
    if (this._kickTimer) { clearInterval(this._kickTimer); this._kickTimer = null; }
    if (!this.ctx || this.ctx.state === 'running') return;
    let tries = 0;
    const tick = () => {
      tries++;
      if (!this.ctx || this.ctx.state === 'running' || tries > 12) {
        clearInterval(this._kickTimer);
        this._kickTimer = null;
        return;
      }
      this._kick();
    };
    this._kickTimer = setInterval(tick, 250);
    // a timer must never be what keeps a page alive
    this._kickTimer?.unref?.();
  }

  /** Everything a failed or closed context leaves behind. */
  _teardown() {
    if (this._pianoTimer) { clearTimeout(this._pianoTimer); this._pianoTimer = null; }
    try {
      const closing = this.ctx?.close?.();
      if (closing && typeof closing.catch === 'function') closing.catch(() => {});
    } catch { /* the browser may already have closed it */ }
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.sfxBus = null;
    this.ambientBus = null;
    this.musicBus = null;
    this.noise = null;
    this.soundtrack = null;
    this._victoryGroup = null;
    this._music = null;
    this._musicMix = null;
    this._elegyGain = null;
    this._conv = null;
    this._revRet = null;
    this._revIR = {};
    this._windGain = null;
    this._droneOsc = null;
    this._droneGain = null;
    this._pulseGain = null;
    this.ambientGain = null;
    this._victoryUntil = 0;
    if (this._kickTimer) { clearInterval(this._kickTimer); this._kickTimer = null; }
    this.ready = false;
  }

  /** Ask the browser clock to run; safe to call from anywhere, any number of times. */
  _kick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    try {
      const r = ctx.resume();
      // A promise rejection here is normal: Chrome refuses a resume without a
      // user gesture. Swallow it -- the permanent gesture listeners retry.
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* some engines throw synchronously when suspended by policy */ }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'closed') this._teardown();
    if (!this.ctx) this.init();
    this._kick();
    if (this.ctx && this.ctx.state !== 'running') this._kickUntilRunning();
    return !!this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : (this._masterVol ?? 0.85);
  }

  /** Volumes come in as 0..100 from the settings screen. */
  setVolumes({ master, sfx, ambient, music } = {}) {
    if (master !== undefined) this._masterVol = Math.max(0, Math.min(1, master / 100));
    if (sfx !== undefined) this._sfxVol = Math.max(0, Math.min(1, sfx / 100));
    if (ambient !== undefined) this._ambVol = Math.max(0, Math.min(1, ambient / 100));
    if (music !== undefined) this._musicVol = Math.max(0, Math.min(1, music / 100));
    if (!this.ready) return;
    const t = this.t;
    if (this._masterVol !== undefined) {
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this._masterVol, t + 0.05);
    }
    if (this._sfxVol !== undefined) this.sfxBus.gain.linearRampToValueAtTime(this._sfxVol, t + 0.05);
    if (this._ambVol !== undefined) this.ambientBus.gain.linearRampToValueAtTime(this._ambVol, t + 0.05);
    if (this._musicVol !== undefined && this.musicBus) this.musicBus.gain.linearRampToValueAtTime(this._musicVol, t + 0.05);
  }

  /** Local audition/background selection: never changes another peer's music. */
  playSoundtrack(id) {
    if (!SOUNDTRACKS.some((t) => t.id === id)) return false;
    this.resume();
    if (!this.ready) return false;
    this._victoryUntil = 0;
    if (this._victoryGroup) this._victoryGroup.disconnect();
    this.soundtrack ??= new SoundtrackPlayer(this.ctx, this.musicBus);
    this.soundtrack.mode = this.musicMode;
    this.soundtrack.onFinish = () => this.setMusic({ calm: 0.45, combat: 0, last: 0, elegy: 0.55 });
    const ok = this.soundtrack.play(id);
    this.setMusic({ calm: 0, combat: 0, last: 0, elegy: 0 });
    return ok;
  }

  stopSoundtrack() {
    this.soundtrack?.stop();
    if (this._victoryGroup) this._victoryGroup.disconnect();
    this._victoryUntil = 0;
    this.setMusic({ calm: 0.45, combat: 0, last: 0, elegy: 0.55 });
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  _gain(v = 0.0001) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

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

  // ---------------------------------------------------------------- music --
  /**
   * Three layers, cross-faded: a low open fifth while you are safe, a pulse
   * that comes up with the fight, and a thin high scrape for the last one
   * standing. Nothing here is scheduled -- each layer is a drone with an LFO
   * on its gain -- so it costs a handful of oscillators and never needs a
   * clock of its own.
   */
  _startMusic() {
    const ctx = this.ctx;
    if (!this.musicBus) return;
    const layer = () => {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(this.musicBus);
      return g;
    };

    // calm: an open fifth with a slow sweep on the cutoff.
    //
    // The two low sines on their own are inaudible on a laptop or a phone --
    // small speakers simply cannot move 55 Hz -- which is why this used to be
    // a drone nobody could hear. The pair an octave (and a twelfth) up carries
    // the same chord into a register any speaker can actually reproduce.
    const calm = layer();
    for (const [f, amp] of [[55, 0.5], [82.5, 0.45], [110, 0.3], [165, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = amp;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 1;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 130;
      lfo.connect(lg).connect(lp.frequency);
      lfo.start();
      o.connect(og).connect(lp).connect(calm);
      o.start();
    }

    // combat: a bass drum of a heartbeat with a band of hiss breathing over it
    const combat = layer();
    const bass = ctx.createOscillator(); bass.type = 'triangle'; bass.frequency.value = 41;
    const bg = ctx.createGain(); bg.gain.value = 0.55;
    // same problem, same fix: 41 Hz is felt, not heard, so the heartbeat gets
    // harmonics you can actually make out on a phone speaker
    for (const [f, amp] of [[82, 0.26], [123, 0.13]]) {
      const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = f;
      const hg2 = ctx.createGain(); hg2.gain.value = amp;
      h.connect(hg2).connect(bg);
      h.start();
    }
    const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 1.9;
    const tg = ctx.createGain(); tg.gain.value = 0.45;
    thump.connect(tg).connect(bg.gain);
    thump.start();
    bass.connect(bg).connect(combat);
    bass.start();
    const hiss = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
    const hg = ctx.createGain(); hg.gain.value = 0.05;
    const hlfo = ctx.createOscillator(); hlfo.type = 'sine'; hlfo.frequency.value = 0.95;
    const hlg = ctx.createGain(); hlg.gain.value = 0.045;
    hlfo.connect(hlg).connect(hg.gain);
    hlfo.start();
    hiss.connect(bp).connect(hg).connect(combat);
    hiss.start();

    // last: two saws a few hertz apart, beating against each other
    const last = layer();
    for (const f of [233, 246.9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1;
      const g2 = ctx.createGain(); g2.gain.value = 0.14;
      o.connect(lp).connect(g2).connect(last);
      o.start();
    }

    // elegy: the new voice of the house -- a violin pad that breathes on a
    // long swell, and a piano that thinks out loud between the rounds. The
    // pad is a drone like the others; the piano is event-driven (see
    // _pianoTick) and plays into the same gain, so setMusic({elegy}) is the
    // one tap that opens or closes both.
    const elegy = layer();
    for (const [f, det, amp] of [[196, -5, 0.5], [196, 6, 0.5], [293.7, -3, 0.32]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 640; lp.Q.value = 0.9;
      const g2 = ctx.createGain(); g2.gain.value = amp * 0.16;
      // a finger on the string: slow vibrato, deeper as the note leans
      const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.1;
      const vg = ctx.createGain(); vg.gain.value = 7;
      vib.connect(vg).connect(o.detune);
      vib.start();
      o.connect(lp).connect(g2).connect(elegy);
      o.start();
    }
    // the swell: the whole pad breathes in and out every ~22 seconds
    const swell = ctx.createOscillator(); swell.type = 'sine'; swell.frequency.value = 0.045;
    const swg = ctx.createGain(); swg.gain.value = 0.35;
    swell.connect(swg).connect(elegy.gain);
    swell.start();
    this._elegyGain = elegy;

    this._music = { calm, combat, last, elegy };
    this._musicMix = { calm: 0, combat: 0, last: 0, elegy: 0 };
  }

  // ------------------------------------------------------------- the piano --
  /**
   * A small sad piano that plays itself while the elegy layer is up: two or
   * three notes out of A minor, far apart, each one a struck sine with a
   * couple of quiet harmonics and a long tail. It costs a timeout and a
   * handful of oscillators per note, and it never plays over the fight --
   * the mix decides that, not this.
   */
  _pianoNote(freq, t0, vol = 0.5) {
    const ctx = this.ctx;
    const dest = this._elegyGain;
    if (!dest) return;
    for (const [mult, amp, type] of [[1, 1, 'sine'], [2, 0.32, 'triangle'], [3.01, 0.12, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol * amp * 0.3, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + 2.7);
    }
    // the hammer: a tick of noise at the front of the note
    const n = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(vol * 0.06, t0 + 0.001);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    n.connect(hp).connect(ng).connect(dest);
    n.start(t0); n.stop(t0 + 0.06);
  }

  _pianoTick() {
    this._pianoTimer = null;
    if (!this.ready || this.muted) return;
    const mix = this._musicMix?.elegy ?? 0;
    if (mix > 0.05) {
      // A minor, spread over two octaves: every note is allowed next to every
      // other, which is why this can be random and still sound like a choice
      const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
      const t = this.t + 0.06;
      const n = Math.random() < 0.3 ? 2 : 1;
      let last = -1;
      for (let i = 0; i < n; i++) {
        let k = (Math.random() * scale.length) | 0;
        if (k === last) k = (k + 3) % scale.length;
        last = k;
        const octave = Math.random() < 0.35 ? 0.5 : 1;
        this._pianoNote(scale[k] * octave, t + i * (0.16 + Math.random() * 0.3), 0.4 + Math.random() * 0.25);
      }
    }
    this._pianoTimer = setTimeout(() => this._pianoTick(), 1400 + Math.random() * 2200);
  }

  _pianoWant(on) {
    if (on && !this._pianoTimer && this.ready) this._pianoTick();
    if (!on && this._pianoTimer) { clearTimeout(this._pianoTimer); this._pianoTimer = null; }
  }

  /** Where each layer sits, 0..1. They are allowed to overlap. */
  setMusic({ calm, combat, last, elegy } = {}) {
    if (!this.ready || !this._music) return;
    if (this.soundtrack?.current || this.t < (this._victoryUntil ?? 0)) {
      calm = combat = last = elegy = 0;
    }
    // `top` is the ceiling each layer is scaled by. It was 0.12, which -- with
    // the game asking for 0.45 of calm -- put the whole soundtrack at about
    // a twentieth of the volume of a gunshot. Music you cannot hear over the
    // wind is not atmosphere, it is a rumour.
    const t = this.t, ramp = 0.9, top = 0.32;
    const set = (node, v) => {
      if (v === undefined) return;
      v = Math.max(0, Math.min(1, v));
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), t);
      node.gain.linearRampToValueAtTime(Math.max(0.0001, v * top), t + ramp);
    };
    set(this._music.calm, calm);
    set(this._music.combat, combat);
    set(this._music.last, last);
    set(this._music.elegy, elegy);
    const m = this._musicMix;
    this._musicMix = {
      calm: calm ?? m.calm, combat: combat ?? m.combat,
      last: last ?? m.last, elegy: elegy ?? m.elegy,
    };
    this._pianoWant((this._musicMix.elegy ?? 0) > 0.05);
  }

  // --------------------------------------------------------------- reverb --
  /** Send the effects through a convolution tail that matches the room. */
  _startReverb() {
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    const send = ctx.createGain();
    send.gain.value = 0.45;
    const ret = ctx.createGain();
    ret.gain.value = 0.9;
    this.sfxBus.connect(send);
    send.connect(conv);
    conv.connect(ret);
    ret.connect(this.bus);
    this._conv = conv;
    this._revRet = ret;
    this._revIR = {};
    this.setReverb('room', true);
  }

  /** A cheap synthetic impulse: dulled noise, decaying. Four rooms is plenty. */
  _ir(zone) {
    if (this._revIR[zone]) return this._revIR[zone];
    const [secs, decay, bright] = ({
      room: [0.32, 3.0, 0.8],
      corridor: [0.62, 2.1, 0.55],
      yard: [0.12, 3.6, 1.0],
      roof: [0.46, 2.6, 0.9],
    })[zone] || [0.32, 3.0, 0.8];
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * secs));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        lp += ((Math.random() * 2 - 1) * (1 - k) - lp) * (0.4 * bright);
        d[i] = lp * Math.pow(1 - k, decay);
      }
    }
    this._revIR[zone] = buf;
    return buf;
  }

  /** room | corridor | yard | roof. Swapping live clicks, so duck first. */
  setReverb(zone, immediate = false) {
    if (!this.ready || !this._conv) return;
    if (zone === this._reverbZone && !immediate) return;
    this._reverbZone = zone;
    const ir = this._ir(zone);
    if (immediate) { this._conv.buffer = ir; return; }
    const t = this.t;
    this._revRet.gain.cancelScheduledValues(t);
    this._revRet.gain.setValueAtTime(this._revRet.gain.value, t);
    this._revRet.gain.linearRampToValueAtTime(0.0001, t + 0.05);
    setTimeout(() => {
      if (!this._conv) return;
      this._conv.buffer = ir;
      const t2 = this.t;
      this._revRet.gain.cancelScheduledValues(t2);
      this._revRet.gain.setValueAtTime(0.0001, t2);
      this._revRet.gain.linearRampToValueAtTime(0.9, t2 + 0.12);
    }, 70);
  }

  // ------------------------------------------------------------ the house --
  /** Floorboards, somewhere in the dark. */
  creak(vol = 1) {
    if (!this.ready) return;
    const t = this.t;
    const src = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 9;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.linearRampToValueAtTime(180 + Math.random() * 260, t + 0.5);
    const g = this._gain(0.0001);
    g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(bp).connect(g).connect(this.ambientBus);
    src.start(t); src.stop(t + 0.7);
  }

  /** Water, somewhere in the dark. */
  drip(vol = 1) {
    if (!this.ready) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    const g = this._gain(0.0001);
    g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(this.ambientBus);
    o.start(t); o.stop(t + 0.2);
  }

  /** Glass under a boot, or under a boot that used to be a window. */
  glass(vol = 1) {
    if (!this.ready) return;
    const t = this.t;
    for (let i = 0; i < 5; i++) {
      const t0 = t + i * 0.018 + Math.random() * 0.02;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1800 + Math.random() * 2600, t0);
      o.frequency.exponentialRampToValueAtTime(700, t0 + 0.09);
      const g = this._gain(0.0001);
      g.gain.linearRampToValueAtTime(0.05 * vol, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      o.connect(g).connect(this.sfxBus);
      o.start(t0); o.stop(t0 + 0.14);
    }
  }

  /** The magazine's last round: a dry click you can hear through a fight. */
  lastRound() {
    if (!this.ready) return;
    const t = this.t;
    const src = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 3;
    const g = this._gain(0.0001);
    g.gain.linearRampToValueAtTime(0.16, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(t); src.stop(t + 0.1);
  }

  /**
   * The loudspeaker voice. Not speech -- the shape of it: a pulse train run
   * through two formants per syllable, over a bed of static, so what you
   * hear is a man talking through a wall. The actual words go on screen.
   * Returns how long the subtitle should stay up.
   */
  voice(text, { pitch = 1 } = {}) {
    if (!this.ready) return 0;
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    const syl = Math.min(26, Math.max(2, Math.round(words * 1.7)));
    const t = this.t;
    const out = this._gain(0.85);
    out.connect(this.sfxBus);
    const hiss = this._noiseSrc();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.value = 1700; hp.Q.value = 0.7;
    const hg = this._gain(0.05);
    hiss.connect(hp).connect(hg).connect(out);
    hiss.start(t);
    hiss.stop(t + 0.5 + syl * 0.13);
    for (let i = 0; i < syl; i++) {
      const t0 = t + 0.05 + i * 0.13;
      const dur = 0.07 + Math.random() * 0.05;
      const vow = [520, 720, 300, 640, 430][i % 5];
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(78 * pitch * (0.9 + Math.random() * 0.25), t0);
      const f1 = this.ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.value = vow;
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.Q.value = 8; f2.frequency.value = vow * 2.1;
      const g = this._gain(0.0001);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0.11, t0 + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(f1); o.connect(f2);
      f1.connect(g); f2.connect(g);
      g.connect(out);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    return 0.6 + syl * 0.13;
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
      launcher: { dur: 0.30, crack: 700, body: 90, peak: 0.7, tail: 0.3 },
      flamer: { dur: 0.16, crack: 1100, body: 140, peak: 0.22, tail: 0.12 },
    }[kind] || { dur: 0.16, crack: 2400, body: 190, peak: 0.5, tail: 0.1 };

    if (kind === 'raygun' || kind === 'wunderwaffe' || kind === 'thundergun'
      || kind === 'winterhowl' || kind === 'throw' || kind === 'stormbow'
      || kind === 'rift') { this.wonder(kind); return; }

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

  /**
   * A dash: a short rush of air that arrives and leaves. It is built like the
   * knife (one filtered noise burst), swept the other way -- low to a hiss --
   * so it cannot be mistaken for a blade or a shot when both are happening.
   */
  dash() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    f.Q.value = 1.1;
    n.connect(f);
    const g = this._env(f, t, 0.16, 0.01, 0.2);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.26);
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
    if (kind === 'stormbow') {
      // bowstring snap, then the air itself discharging
      const n = this._noiseSrc(0.3, 0.9);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 0.12);
      bp.Q.value = 2.5;
      const g = this._env(bp, t, 0.3, 0.002, 0.16);
      n.connect(bp).connect(g).connect(this.bus);
      n.start(t); n.stop(t + 0.2);
      this._tone('sawtooth', 2200, 300, t + 0.02, 0.3, 0.22);
      return;
    }
    if (kind === 'rift') {
      const n = this._noiseSrc();
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      const g = this._env(lp, t, 0.8, 0.004, 0.55);
      n.connect(lp).connect(g).connect(this.bus);
      n.start(t); n.stop(t + 0.65);
      this._tone('sine', 140, 40, t, 0.5, 0.5);
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
  // ------------------------------------------------------- haunt round sfx --
  /**
   * The drummer's beat: a tom with the heel of the hand on it, a little
   * behind the beat on purpose, because it is a dead man playing.
   */
  drum(vol = 0.8) {
    if (!this.ready || this.muted) return;
    const t = this.t + 0.012;
    this._tone('sine', 118, 62, t, 0.22, 0.34 * vol, this.sfxBus);
    this._tone('triangle', 74, 48, t + 0.004, 0.16, 0.2 * vol, this.sfxBus);
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    n.connect(f);
    const g = this._env(f, t, 0.16 * vol, 0.002, 0.1);
    g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.13);
  }

  /** A bow: the string let go, and the hiss of the arrow away. */
  bow(vol = 0.7) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('triangle', 340, 96, t, 0.14, 0.22 * vol, this.sfxBus);
    this._tone('sine', 720, 180, t, 0.06, 0.1 * vol, this.sfxBus);
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
    n.connect(f);
    const g = this._env(f, t, 0.12 * vol, 0.004, 0.18);
    g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.24);
  }

  /** Silk: a dry whisper, and nothing else. */
  silk(vol = 0.6) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 3400;
    n.connect(f);
    const g = this._env(f, t, 0.09 * vol, 0.03, 0.3);
    g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.36);
  }

  /** Venom arriving: a wet, rising gurgle under the hurt sound. */
  venom(vol = 0.7) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('sawtooth', 64, 132, t, 0.5, 0.14 * vol, this.sfxBus);
    this._tone('sine', 130, 74, t + 0.06, 0.4, 0.1 * vol, this.sfxBus);
  }

  /** The grave's bell: struck metal that will not hurry. */
  bell(vol = 0.9) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const f0 = 146;
    for (const [mult, amp, dec] of [[1, 1, 4.2], [2.0, 0.5, 3.4], [2.42, 0.38, 3.0],
      [3.01, 0.26, 2.4], [4.16, 0.16, 1.8], [5.43, 0.1, 1.2]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * mult * (1 + (Math.random() - 0.5) * 0.004);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16 * amp * vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + dec + 0.1);
    }
    // the clapper's knock
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    n.connect(bp);
    const g = this._env(bp, t, 0.1 * vol, 0.002, 0.06);
    g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.1);
  }

  /** Weather: the sky splitting, some distance off. */
  thunder(vol = 1) {
    if (!this.ready || this.muted) return;
    const t = this.t + 0.02;
    const n = this._noiseSrc();
    n.playbackRate.value = 0.5;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 0.7;
    // the rumble walks: the filter opens and shuts while the tail decays
    lp.frequency.setValueAtTime(90, t);
    lp.frequency.linearRampToValueAtTime(220, t + 0.5);
    lp.frequency.linearRampToValueAtTime(70, t + 1.9);
    n.connect(lp);
    const g = this._env(lp, t, 0.55 * vol, 0.08, 1.9);
    g.connect(this.bus);
    n.start(t); n.stop(t + 2.2);
    this._tone('sine', 46, 26, t, 1.4, 0.3 * vol);
  }

  /** Weather: the rain bed. On is a ramp up, off a ramp down. */
  rain(on, vol = 1) {
    if (!this.ready || this.muted) return;
    if (!this._rainSrc) {
      const n = this._noiseSrc();
      n.playbackRate.value = 0.9;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1050; bp.Q.value = 0.28;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 320;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      n.connect(bp).connect(hp).connect(g).connect(this.ambientBus);
      n.start();
      this._rainSrc = n; this._rainGain = g;
    }
    const t = this.t;
    this._rainGain.gain.cancelScheduledValues(t);
    this._rainGain.gain.setValueAtTime(Math.max(0.0001, this._rainGain.gain.value), t);
    this._rainGain.gain.linearRampToValueAtTime(on ? 0.075 * vol : 0.0001, t + (on ? 1.6 : 2.2));
  }

  /**
   * The bird: a looping rotor chop. `level` 0..1 turns the whole thing --
   * volume, chop depth and rotor rate -- so one call site can fade the
   * helicopter in from over the west trees and out again on the way up.
   */
  heli(level = 1) {
    if (!this.ready || this.muted) return;
    if (!this._heliSrc) {
      const n = this._noiseSrc();
      n.playbackRate.value = 0.7;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 230; lp.Q.value = 0.6;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      // the chop: a slow LFO riding straight on the gain
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 7.5;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.0;
      lfo.connect(depth); depth.connect(g.gain);
      n.connect(lp).connect(g).connect(this.ambientBus);
      n.start(); lfo.start();
      this._heliSrc = n; this._heliGain = g; this._heliDepth = depth; this._heliLfo = lfo;
    }
    const t = this.t;
    const v = Math.max(0, Math.min(1, level));
    this._heliGain.gain.cancelScheduledValues(t);
    this._heliGain.gain.setValueAtTime(Math.max(0.0001, this._heliGain.gain.value), t);
    this._heliGain.gain.linearRampToValueAtTime(0.0001 + 0.11 * v, t + 0.4);
    this._heliDepth.gain.setTargetAtTime(0.06 * v, t, 0.15);
    this._heliLfo.frequency.setTargetAtTime(5.5 + 3.5 * v, t, 0.3);
  }

  /** Rotor off: the bird is gone, or it never came. */
  heliOff() {
    if (!this.ready || !this._heliGain) return;
    const t = this.t;
    this._heliGain.gain.cancelScheduledValues(t);
    this._heliGain.gain.setValueAtTime(Math.max(0.0001, this._heliGain.gain.value), t);
    this._heliGain.gain.linearRampToValueAtTime(0.0001, t + 1.4);
    this._heliDepth.gain.setTargetAtTime(0, t, 0.4);
  }

  /**
   * Eighteen-second major-key celebration, isolated from the sad adaptive score.
   * Uses the music fader, and stops a debug audition before the fanfare.
   */
  victory() {
    if (!this.ready) return;
    this.soundtrack?.stop();
    if (this._victoryGroup) this._victoryGroup.disconnect();
    this._victoryUntil = this.t + 18;
    this.setMusic({ calm: 0, combat: 0, last: 0, elegy: 0 });
    const ctx = this.ctx, t = this.t;
    const group = this._victoryGroup = ctx.createGain();
    group.gain.value = 0.7; group.connect(this.musicBus);
    // C major fanfare, answering bells and a final warm C6/9 chord. No minor drone.
    const phrase = [60, 64, 67, 72, 71, 67, 69, 72, 76, 74, 72, 79];
    phrase.forEach((note, i) => {
      const f = 440 * 2 ** ((note - 69) / 12), at = t + 0.12 + i * 0.38;
      this._tone('triangle', f, f, at, i === 11 ? 2.2 : 0.65, 0.085, group);
      this._tone('sine', f * 2, f * 2, at + 0.02, 1.2, 0.025, group);
    });
    for (const [offset, chord] of [[0, [48, 52, 55]], [2.3, [53, 57, 60]], [4.6, [55, 59, 62]], [6.9, [48, 52, 55, 57, 62, 72]]]) {
      for (const note of chord) {
        const f = 440 * 2 ** ((note - 69) / 12);
        this._tone('sine', f, f, t + offset, offset > 6 ? 10 : 3.6, 0.035, group);
      }
    }
  }

  /** Wheels up: the run does not end with a bang but with a climb. */
  evacSting() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    [392, 523, 659, 784].forEach((f, i) => this._tone('triangle', f, f, t + i * 0.18, 1.5, 0.11));
    this._tone('sine', 131, 196, t, 2.4, 0.13);
  }

  /** Shocker: the light climbing the rod. */
  zapCharge(vol = 0.8) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.7);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 3;
    const trem = this.ctx.createOscillator(); trem.type = 'square'; trem.frequency.value = 26;
    const tg = this.ctx.createGain(); tg.gain.value = 0.035;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085 * vol, t + 0.62);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
    trem.connect(tg).connect(g.gain);
    o.connect(bp).connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.8);
    trem.start(t); trem.stop(t + 0.8);
  }

  /** Shocker: the bolt itself. */
  zap(vol = 1) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    // three crackles on top of each other, then the body of the discharge
    for (let i = 0; i < 3; i++) {
      const n = this._noiseSrc();
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
      n.connect(hp);
      const g = this._env(hp, t + i * 0.035, 0.3 * vol, 0.001, 0.045);
      g.connect(this.bus);
      n.start(t + i * 0.035); n.stop(t + i * 0.035 + 0.08);
    }
    this._tone('square', 1250, 130, t, 0.16, 0.16 * vol);
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 1.4;
    n.connect(bp);
    const g = this._env(bp, t, 0.2 * vol, 0.002, 0.3);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.4);
  }

  /** Totem: raised, humming, broken. */
  totemRaise() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    this._tone('sine', 92, 44, t, 0.9, 0.4);
    this._tone('sine', 110, 110, t + 0.15, 1.3, 0.16);
    this._tone('sine', 165, 164, t + 0.15, 1.3, 0.11);
    this._tone('triangle', 880, 415, t + 0.3, 0.7, 0.1);
  }

  totemPulse() {
    if (!this.ready || this.muted) return;
    if (this.t - (this._lastTotemPulse ?? 0) < 1.5) return;
    this._lastTotemPulse = this.t;
    const t = this.t;
    this._tone('sine', 58, 52, t, 0.55, 0.2);
    const n = this._noiseSrc();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    n.connect(lp);
    const g = this._env(lp, t, 0.05, 0.12, 0.5);
    g.connect(this.ambientBus);
    n.start(t); n.stop(t + 0.7);
  }

  totemBreak() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    n.connect(hp);
    const g = this._env(hp, t, 0.3, 0.002, 0.22);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.3);
    this._tone('triangle', 330, 82, t, 0.5, 0.24);
    this._tone('sine', 196, 98, t + 0.05, 0.8, 0.18);
  }

  /** Grave: dug, and despoiled. */
  graveDug() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    for (let i = 0; i < 2; i++) {
      const n = this._noiseSrc();
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      n.connect(lp);
      const g = this._env(lp, t + i * 0.28, 0.3, 0.004, 0.16);
      g.connect(this.bus);
      n.start(t + i * 0.28); n.stop(t + i * 0.28 + 0.2);
    }
    this._tone('sine', 70, 48, t + 0.28, 0.4, 0.22);
  }

  graveBreak() {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 760; bp.Q.value = 0.9;
    n.connect(bp);
    const g = this._env(bp, t, 0.32, 0.002, 0.18);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.25);
    this._tone('sine', 120, 52, t, 0.35, 0.26);
  }

  /** Snowman: the snowball landing -- on you, or beside you. */
  snowHit(onYou = 1) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const n = this._noiseSrc();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = onYou > 0.7 ? 560 : 420;
    n.connect(lp);
    const g = this._env(lp, t, onYou > 0.7 ? 0.3 : 0.14, 0.003, 0.12);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.16);
    if (onYou > 0.7) this._tone('sine', 130, 72, t, 0.14, 0.12);
  }

  /**
   * The last round leaving the gun, and the click of an empty one. Both have
   * to survive a room full of gunfire: they sit above the mix, short and hard,
   * and they never rate-limit against each other.
   */
  lastClick() {
    if (!this.ready || this.muted) return;
    if (this.t - (this._lastClickT ?? 0) < 0.07) return;
    this._lastClickT = this.t;
    const t = this.t + 0.015;
    for (const [f, v, dt2] of [[4700, 0.42, 0], [2500, 0.34, 0.038]]) {
      const n = this._noiseSrc();
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 9;
      n.connect(bp);
      const g = this._env(bp, t + dt2, v, 0.001, 0.028);
      g.connect(this.bus);
      n.start(t + dt2); n.stop(t + dt2 + 0.06);
    }
    this._tone('square', 195, 120, t, 0.05, 0.14);
  }

  gunDry() {
    if (!this.ready || this.muted) return;
    if (this.t - (this._gunDryT ?? 0) < 0.09) return;
    this._gunDryT = this.t;
    const t = this.t;
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3700; bp.Q.value = 5;
    n.connect(bp);
    const g = this._env(bp, t, 0.42, 0.001, 0.045);
    g.connect(this.bus);
    n.start(t); n.stop(t + 0.08);
    this._tone('square', 210, 130, t, 0.05, 0.16);
  }

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
