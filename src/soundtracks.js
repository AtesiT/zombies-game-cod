// Original procedural scores: 128 bars each, arranged into eight sections.
// Only a small look-ahead window is scheduled; no multi-minute audio buffers.
const track = (id, title, mood, bpm, root, voice, rhythm, seed, major = false) => Object.freeze({
  id, title, mood, bpm, root, voice, rhythm, seed, major, bars: 128,
  duration: 128 * 4 * 60 / bpm,
});
export const SOUNDTRACKS = Object.freeze([
  track('ash', 'Ash over Nacht', 'dark piano / strings', 64, 45, 'piano', 0, 11),
  track('wire', 'The Last Frequency', 'radio pulse / bells', 76, 50, 'bell', 1, 29),
  track('snow', 'Snow on the Barracks', 'cold glass / drone', 58, 47, 'glass', 0, 43),
  track('siege', 'Siege at Midnight', 'march / low brass', 88, 38, 'brass', 2, 61),
  track('lantern', 'A Lantern Upstairs', 'quiet piano / hope', 66, 48, 'piano', 0, 79, true),
  track('blackout', 'Blackout Protocol', 'analogue synth / pulse', 92, 40, 'synth', 3, 97),
  track('rain', 'Rain behind the Glass', 'soft mallets / rain', 60, 42, 'glass', 1, 113),
  track('grave', 'The Graves Remember', 'organ / slow tolls', 62, 43, 'organ', 0, 137),
  track('embers', 'Embers in the Yard', 'warm plucks / bass', 74, 45, 'pluck', 1, 151),
  track('machine', 'The Sleeping Machine', 'industrial / mechanical', 96, 36, 'synth', 2, 173),
  track('roof', 'Stars above the Roof', 'celesta / airy strings', 68, 50, 'bell', 0, 191),
  track('convoy', 'The Convoy Never Came', 'military elegy / brass', 72, 41, 'brass', 1, 211),
  track('hollow', 'Hollow Corridors', 'organ / unsettling steps', 70, 46, 'organ', 3, 233),
  track('signal', 'A Signal through Fog', 'arpeggios / synthwave', 84, 45, 'synth', 1, 251),
  track('winter', 'Winter Watch', 'music box / low strings', 63, 52, 'bell', 0, 277),
  track('hunt', 'Footsteps at the Fence', 'tense plucks / drums', 90, 40, 'pluck', 3, 293),
  track('letters', 'Letters Never Sent', 'melancholic piano duet', 59, 48, 'piano', 0, 317),
  track('bunker', 'Beneath the Generator', 'deep organ / ticking', 80, 38, 'organ', 2, 337),
  track('dawn', 'Until the Morning', 'hopeful strings / bells', 78, 48, 'glass', 1, 359, true),
  track('home', 'Somebody Put the Kettle On', 'peaceful piano / home', 70, 55, 'piano', 0, 379, true),
]);
export const musicTime = (seconds) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
function random(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}

/** Pure arrangement data, also used by the headless tests. Beat offsets in a bar. */
export function scoreBar(t, bar) {
  const rnd = random(t.seed * 8191 + bar * 131);
  const section = Math.floor(bar / 16), phrase = bar % 16;
  const minor = [0, 2, 3, 5, 7, 8, 10], major = [0, 2, 4, 5, 7, 9, 11];
  const scale = t.major ? major : minor;
  const progressions = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 2, 5, 3], [5, 3, 0, 4]];
  const degree = progressions[(t.seed + Math.floor(section / 2)) % 4][Math.floor(phrase / 2) % 4];
  const root = t.root + scale[degree];
  const third = scale[(degree + 2) % 7] + (degree + 2 >= 7 ? 12 : 0) - scale[degree];
  const fifth = scale[(degree + 4) % 7] + (degree + 4 >= 7 ? 12 : 0) - scale[degree];
  const energy = [0.32, 0.5, 0.66, 0.45, 0.8, 0.95, 0.6, 0.3][section];
  const events = [];
  const add = (beat, note, length, gain, voice) => events.push({ beat, note, length, gain, voice });
  // Long overlapping pads, bass and an identifiable four-note motif.
  for (const interval of [0, third, fifth]) add(0, root + interval + 12, 5.5, 0.018 * energy, 'pad');
  add(0, root - 12, t.rhythm ? 1.5 : 3.8, 0.055 * energy, 'bass');
  if (t.rhythm && section > 0) add(2, root - 12, 1.2, 0.035 * energy, 'bass');
  const motif = [0, 2 + t.seed % 3, 4, 1 + t.seed % 2];
  const steps = t.rhythm === 3 ? 8 : t.rhythm === 1 ? 4 : 2;
  for (let i = 0; i < steps; i++) {
    if (section === 0 && i > 0 && rnd() < 0.5) continue;
    if (section === 7 && phrase > 11 && i % 2) continue;
    const d = (motif[(i + phrase % 4) % 4] + degree + (section === 4 ? 2 : 0)) % 7;
    const octave = 12 + (section === 5 || rnd() > 0.84 ? 12 : 0);
    add(i * 4 / steps, t.root + scale[d] + octave, t.voice === 'organ' ? 1.6 : 1.1 + rnd(), (0.05 + rnd() * 0.025) * energy, t.voice);
  }
  if (t.rhythm && section > 0 && section < 7) {
    for (const beat of t.rhythm === 2 ? [0, 1, 2, 3] : [0, 2]) add(beat, 30, 0.22, 0.07 * energy, 'kick');
    if (t.rhythm >= 2) for (const beat of [1, 3]) add(beat, 79, 0.1, 0.018 * energy, 'tick');
  }
  // Counter-melody enters only in the developed middle sections.
  if (section >= 2 && section <= 6 && phrase % 2 === 1) add(3, root + fifth + 24, 2.6, 0.025, 'bell');
  return events;
}

export class SoundtrackPlayer {
  constructor(ctx, destination) {
    this.ctx = ctx; this.destination = destination;
    this.current = null; this.mode = 'repeat'; this.sources = new Set(); this.timer = null;
  }
  get elapsed() { return this.current ? Math.max(0, Math.min(this.current.duration, this.ctx.currentTime - this.started)) : 0; }
  play(id, offset = 0) {
    const t = SOUNDTRACKS.find((t) => t.id === id);
    if (!t) return false;
    const position = Math.max(0, Math.min(t.duration - 1, Number.isFinite(offset) ? offset : 0));
    this.stop(); this.current = t; this.started = this.ctx.currentTime + 0.05 - position;
    this.nextBeat = Math.floor(position / (60 / t.bpm));
    this.output = this.ctx.createGain(); this.output.gain.value = 0.8; this.output.connect(this.destination);
    if (position > 0) {
      // Reconstruct the current harmony on seeking instead of waiting in silence
      // for the next bar. Do not replay old percussion/melody events.
      const length = 60 / t.bpm, bar = Math.floor(position / (length * 4));
      for (const e of scoreBar(t, bar)) if (e.voice === 'pad' || e.voice === 'bass') this._note(e, this.ctx.currentTime + 0.02, length);
    }
    this._tick();
    return true;
  }
  seek(seconds) { return this.current ? this.play(this.current.id, seconds) : false; }
  stop() {
    clearTimeout(this.timer); this.timer = null;
    if (this.output) {
      const old = this.output, now = this.ctx.currentTime;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(Math.max(0.0001, old.gain.value), now);
      old.gain.linearRampToValueAtTime(0.0001, now + 0.03);
      const cleanup = setTimeout(() => old.disconnect(), 40); cleanup?.unref?.();
      this.output = null;
    }
    for (const src of this.sources) { try { src.stop(this.ctx.currentTime + 0.035); } catch { src.disconnect(); } }
    this.sources.clear(); this.current = null;
  }
  _tick() {
    if (!this.current) return;
    const t = this.current, now = this.ctx.currentTime;
    if (now >= this.started + t.duration) {
      const i = SOUNDTRACKS.indexOf(t);
      if (this.mode === 'once') { this.stop(); this.onFinish?.(); return; }
      this.play(this.mode === 'playlist' ? SOUNDTRACKS[(i + 1) % SOUNDTRACKS.length].id : t.id);
      return;
    }
    const beatLength = 60 / t.bpm;
    // Catch up after a background-tab suspension; never schedule a backlog.
    this.nextBeat = Math.max(this.nextBeat, Math.ceil(Math.max(0, now - this.started) / beatLength - 0.001));
    while (this.nextBeat < t.bars * 4 && this.started + this.nextBeat * beatLength < now + 0.35) {
      const beat = this.nextBeat++, bar = Math.floor(beat / 4), offset = beat % 4;
      for (const event of scoreBar(t, bar)) {
        if (event.beat >= offset && event.beat < offset + 1) {
          const at = Math.max(now + 0.005, this.started + (bar * 4 + event.beat) * beatLength);
          this._note(event, at, beatLength);
        }
      }
    }
    this.timer = setTimeout(() => this._tick(), 100);
    this.timer?.unref?.(); // node harnesses must not be held open by an audition
  }
  _note(e, at, beatLength) {
    const ctx = this.ctx, gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    const duration = Math.min(8, e.length * beatLength), pad = e.voice === 'pad';
    filter.type = 'lowpass'; filter.frequency.value = pad ? 760 : e.voice === 'brass' ? 1100 : 3400;
    filter.Q.value = 0.5;
    filter.connect(gain).connect(this.output);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(e.gain, at + (pad ? 0.65 : 0.014));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + (pad ? 1 : 0.3));
    const voices = e.voice === 'bell' ? [[1, 1], [2.01, 0.22], [3.98, 0.06]]
      : e.voice === 'piano' || e.voice === 'glass' ? [[1, 1], [2, 0.25], [3.01, 0.1]]
      : pad ? [[1, 0.5], [1.003, 0.5]] : [[1, 1]];
    let remaining = voices.length;
    for (const [multiple, volume] of voices) {
      const osc = ctx.createOscillator(), partial = ctx.createGain(); partial.gain.value = volume;
      osc.type = ['pad', 'brass', 'synth'].includes(e.voice) ? 'sawtooth' : e.voice === 'pluck' ? 'triangle' : 'sine';
      const f = hz(e.note) * multiple;
      osc.frequency.setValueAtTime(e.voice === 'kick' ? 130 : f, at);
      if (e.voice === 'kick') osc.frequency.exponentialRampToValueAtTime(38, at + 0.18);
      osc.connect(partial).connect(filter);
      this.sources.add(osc);
      osc.onended = () => {
        this.sources.delete(osc); osc.disconnect(); partial.disconnect();
        if (--remaining === 0) { filter.disconnect(); gain.disconnect(); }
      };
      osc.start(at); osc.stop(at + duration + (pad ? 1.1 : 0.4));
    }
  }
}
