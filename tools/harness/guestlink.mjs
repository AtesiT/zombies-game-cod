// Headless harness: a guest's stair cooldown must cool. The reported bug:
// playing as the second player, the hatch works exactly once and then the
// stairs are just stairs forever. checkLinksFor(p, rec, dt) must decay the
// cooldown every host step so the second, third and tenth crossings work.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { Player } = await import(SRC + '/entities.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 8080;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();

const link = g.map.linksOn(0)[0];
ok(!!link, 'the ground floor has no stair link');
const at0 = g.map.linkPos(link, 0);
const at1 = g.map.linkPos(link, 1);

const p = new Player(g.map, at0.x, at0.y);
p.floor = 0;
const rec = { linkOn: false, linkCd: 0 };

// 1. first crossing
g.checkLinksFor(p, rec, H);
ok(p.floor === 1, 'the first crossing did not happen');

// 2. standing on the landing must not bounce anybody straight back
for (let i = 0; i < 10; i++) g.checkLinksFor(p, rec, H);
ok(p.floor === 1, 'standing on the landing bounced the guest back down');

// 3. step off, let the cooldown cool, step on: the way back must open
p.pos.x += 60; p.pos.y += 20;
for (let i = 0; i < 45; i++) g.checkLinksFor(p, rec, H);
p.pos.x = at1.x; p.pos.y = at1.y;
g.checkLinksFor(p, rec, H);
ok(p.floor === 0, 'the second crossing never opened -- the reported hatch bug');

// 4. and a third, because a round trip is not a luxury
p.pos.x += 60; p.pos.y += 20;
for (let i = 0; i < 45; i++) g.checkLinksFor(p, rec, H);
p.pos.x = at0.x; p.pos.y = at0.y;
g.checkLinksFor(p, rec, H);
ok(p.floor === 1, 'the third crossing failed');

if (fails.length) { console.error('GUESTLINK FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('GUESTLINK PASS  guests can ride the hatch more than once per game');
