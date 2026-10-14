// Headless harness: contextual touch buttons. A phone screen is small, so a
// button only earns its place when there is a job for it: F appears when
// something nearby can actually be used, R when the magazine is dry, G/H when
// you carry the thing, Q once you carry two guns -- and the knife is ALWAYS
// there, because the knife never stops being useful.
import { nc, load, SRC } from './stub.mjs';

function fakeEl(tag) {
  const el = {
    tagName: tag, style: {}, children: [], parentNode: null, textContent: '',
    _l: {},
    _rect: { left: 0, top: 0, width: 132, height: 132 },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    addEventListener(t, fn) { (el._l[t] ||= []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return el._rect; },
    fire(t, ev) { for (const fn of el._l[t] ?? []) fn(ev); },
  };
  return el;
}
// richer DOM for the touch panel; canvas requests still go to the real stub
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (t) => (t === 'canvas' ? realCreate(t) : fakeEl(t));

const { TouchControls } = await import(SRC + '/touch.js');
const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 4321;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
const mount = fakeEl('div');
const tc = new TouchControls(inp, { mount });
tc.show(true);

const shown = (id) => tc.buttons[id].style.display !== 'none';
const step = (n = 12) => { for (let i = 0; i < n; i++) { tc.update(g); g.update(H); inp.endFrame(); } };

step();
const p = g.player;

// at the spawn with an empty pocket: knife/fire/sprint live, the rest earn it
ok(shown('knife'), 'the knife button is not always on');
ok(shown('fire'), 'fire hidden');
ok(shown('sprint'), 'sprint hidden');
ok(!shown('interact'), 'F is shown with nothing to use');
ok(!shown('grenade'), 'G is shown with no grenades');
ok(!shown('medkit'), 'H is shown with no medkits');
ok(!shown('swap'), 'Q is shown with one gun');
ok(!shown('reload'), 'R is shown with a full magazine');

// walk up to the grenade crate: now there is a job for F
const gc = g.map.grenadeCrates[0];
p.pos.x = gc.x + 10; p.pos.y = gc.y + 10;
step();
ok(shown('interact'), 'F did not appear next to a usable crate');

// dry the magazine: R earns its place
p.pos.x = 400; p.pos.y = 200;
step();
ok(!shown('reload'), 'R still shown away from anything');
p.slot.mag = 3;
step();
ok(shown('reload'), 'R did not appear for a near-empty magazine');

// a second gun brings Q; grenades bring G; a wound and a medkit bring H
p.giveWeapon('mp40');
p.grenades = 2;
p.medkits = 1;
p.hp = 40;
step();
ok(shown('swap'), 'Q did not appear with two guns');
ok(shown('grenade'), 'G did not appear with grenades');
ok(shown('medkit'), 'H did not appear wounded with a medkit');

// spend them and the buttons retire again
p.grenades = 0;
p.medkits = 0;
p.hp = p.maxHp;
p.slot.mag = p.def.mag;
step();
ok(!shown('grenade'), 'G stayed after the last grenade');
ok(!shown('medkit'), 'H stayed at full health');

if (fails.length) { console.error('TOUCHCTX FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('TOUCHCTX PASS  buttons appear for a job and retire after it; the knife never leaves');
