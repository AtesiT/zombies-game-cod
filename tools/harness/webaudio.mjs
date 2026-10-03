// A deliberately strict WebAudio stand-in: it throws on exactly the things a
// real browser throws on (connect() with a non-node, exponentialRamp to zero,
// non-finite values), so a broken audio graph cannot pass silently.
export const stats = { nodes: 0, connects: 0, byKind: {} };
class Param {
  constructor(v = 0) { this.value = v; }
  _chk(v, t, kind) {
    if (!Number.isFinite(v)) throw new Error(`AudioParam.${kind}: non-finite value ${v}`);
    if (t !== undefined && !Number.isFinite(t)) throw new Error(`AudioParam.${kind}: non-finite time ${t}`);
  }
  setValueAtTime(v, t) { this._chk(v, t, 'setValueAtTime'); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this._chk(v, t, 'linearRamp'); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    this._chk(v, t, 'exponentialRamp');
    if (v === 0) throw new Error('exponentialRampToValueAtTime(0): browsers throw RangeError');
    if (this.value === 0) throw new Error('exponentialRampToValueAtTime from a value of 0');
    this.value = v; return this;
  }
  setTargetAtTime(v, t) { this._chk(v, t, 'setTargetAtTime'); this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this._out = []; stats.nodes++; stats.byKind[kind] = (stats.byKind[kind] || 0) + 1; }
  connect(dest) {
    if (!(dest instanceof Node) && !(dest instanceof Param)) throw new TypeError("Failed to execute 'connect' on 'AudioNode': parameter 1 is not of type 'AudioNode'");
    stats.connects++; this._out.push(dest);
    return dest instanceof Node ? dest : undefined;
  }
  disconnect() { this._out.length = 0; }
}
class Src extends Node {
  constructor(ctx, kind) { super(ctx, kind); this._started = false; }
  start(t = 0) { if (this._started) throw new Error('source started twice'); if (!Number.isFinite(t)) throw new Error('start(non-finite)'); this._started = true; }
  stop(t = 0) { if (!Number.isFinite(t)) throw new Error('stop(non-finite)'); }
}
class Osc extends Src { constructor(ctx) { super(ctx, 'osc'); this.frequency = new Param(440); this.detune = new Param(0); this.type = 'sine'; } }
class Buf extends Src { constructor(ctx) { super(ctx, 'bufsrc'); this.buffer = null; this.loop = false; this.playbackRate = new Param(1); } start(t = 0) { if (this.buffer == null) throw new Error('BufferSource with no buffer'); super.start(t); } }
class Gain extends Node { constructor(ctx) { super(ctx, 'gain'); this.gain = new Param(1); } }
class Filter extends Node { constructor(ctx) { super(ctx, 'filter'); this.frequency = new Param(350); this.Q = new Param(1); this.gain = new Param(0); this.type = 'lowpass'; } }
class Buffer {
  constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this._d = []; for (let i = 0; i < ch; i++) this._d.push(new Float32Array(len)); }
  getChannelData(i) { if (i >= this.numberOfChannels) throw new Error('getChannelData out of range'); return this._d[i]; }
}
export class AudioContext {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this._t = 0; this.destination = new Node(this, 'destination'); }
  get currentTime() { return this._t; }
  advance(dt) { this._t += dt; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return new Gain(this); }
  createOscillator() { return new Osc(this); }
  createBiquadFilter() { return new Filter(this); }
  createBufferSource() { return new Buf(this); }
  createBuffer(ch, len, sr) { if (!(len > 0)) throw new Error('createBuffer with length ' + len); return new Buffer(ch, len, sr); }
}
