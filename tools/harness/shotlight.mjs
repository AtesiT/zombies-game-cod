// Deterministic screenshot of the lit scene, so a renderer change can be
// diffed against the previous one instead of eyeballed.
let s = 20251003;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const { nc, load } = await import('./stub.mjs');
const M = await load();
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.begin();
g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.input.mouse.x = 560; g.input.mouse.y = 300;          // fixed aim -> fixed torch cone
g.player.hurt = () => false;
for (let f = 0; f < 120 * 6; f++) { g.player.hp = 100; g.update(H); }
g.draw(cx);
const out = process.argv[2] ?? 'light.png';
(await import('node:fs')).writeFileSync(out, cv.toBuffer('image/png'));
console.log(`${out}  round ${g.round}, ${g.zombies.length} zombies, power on`);
