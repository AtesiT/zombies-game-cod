// Headless harness: flipping the power switch must not light every lamp in
// the same frame. The generator spins up and the fixtures catch one by one,
// each flickering for a beat -- the whole point is that it *looks* like power
// arriving, not like a flag being set.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 555;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();

const mains = g.lampsHere().filter((l) => l.mains);
ok(mains.length >= 10, 'the ground floor lost its mains lamps');

// before the switch: nothing warm
ok(mains.every((l) => g._lampWarm(l) === 0), 'lamps are warm before the power is on');

// flip it the way a player would
g.powerOn = true;
g.powerOnAt = g.time;

// 0.3 s in: some lamps caught, most have not
for (let i = 0; i < 18; i++) g.update(H);
const early = mains.filter((l) => g._lampWarm(l) > 0).length;
ok(early > 0, 'no lamp has caught 0.3 s after the switch');
ok(early < mains.length, 'every lamp lit in the same instant -- no animation');

// mid-way through the surge, at least one lamp is mid-flicker (neither off
// nor settled) when sampled across a few frames
let sawFlicker = false;
for (let i = 0; i < 30; i++) {
  g.update(H);
  for (const l of mains) {
    const w = g._lampWarm(l);
    if (w > 0.01 && w < 0.9) { sawFlicker = true; break; }
  }
  if (sawFlicker) break;
}
ok(sawFlicker, 'no lamp ever flickered while catching');

// 3 s in: every fixture settled at full burn
for (let i = 0; i < 180; i++) g.update(H);
ok(mains.every((l) => g._lampWarm(l) === 1), 'some lamp never settled at full burn');

// and the drawn frame actually shows lit fixtures without throwing
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.draw(cx);

// determinism for co-op: same position, same delay, on any machine
const a = mains.map((l) => g._lampWarm(l)).join('');
g.powerOnAt = g.time - 0.4;
const b = mains.map((l) => g._lampWarm(l)).join('');
g.powerOnAt = g.time - 0.4;
const c2 = mains.map((l) => g._lampWarm(l)).join('');
ok(b === c2, 'the warm-up sequence is not deterministic');
ok(a !== b, 'warm state ignored the clock');

if (fails.length) { console.error('POWERANIM FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log(`POWERANIM PASS  ${early}/${mains.length} lamps caught at 0.3s, all settled by 3s, flicker seen`);
