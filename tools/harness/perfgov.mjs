// Headless harness: the performance governor must obey the AUTO PERFORMANCE
// toggle. With it on, sustained slow frames step the lighting down. With it
// off, whatever was stepped down is restored at once and nothing may ever be
// stepped down again -- the user complaint was "I turned it off and it still
// degrades", and that must be impossible.
import { nc, load } from './stub.mjs';

const M = await load();
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();

// auto on (default): slow frames walk the stage down
M.settings.set('autoQuality', true);
for (let i = 0; i < 120; i++) g.tickPerf(30);
ok(g._perfStage > 0, 'auto quality never stepped the lighting down while enabled');
const degraded = g._perfStage;

// switching it off restores full quality immediately
M.settings.set('autoQuality', false);
g.tickPerf(30);
ok(g._perfStage === 0, `auto off did not restore the lighting (stage ${g._perfStage}, was ${degraded})`);

// and a marathon of terrible frames cannot degrade it again
for (let i = 0; i < 600; i++) g.tickPerf(90);
ok(g._perfStage === 0, 'lighting degraded while auto quality was off');

// switching back on re-arms the governor
M.settings.set('autoQuality', true);
for (let i = 0; i < 120; i++) g.tickPerf(30);
ok(g._perfStage > 0, 'governor did not re-arm after being switched back on');
M.settings.set('autoQuality', true);

if (fails.length) { console.error('PERFGOV FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('PERFGOV PASS  auto off restores and freezes quality; auto on governs again');
