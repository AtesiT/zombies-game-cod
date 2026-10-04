import { nc, load } from './stub.mjs';
const M = await load();
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
const f = Number(process.argv[2] ?? 1);
const [x0, x1, y0, y1] = [13, 45, 7, 31];
const links = g.map.linksOn(f).map((l) => (l.a.floor === f ? l.a : l.b));
console.log(`storey ${f}: x ${x0}..${x1}, y ${y0}..${y1}   (S = staircase)`);
let head = '     ';
for (let x = x0; x <= x1; x++) head += x % 10 === 0 ? String((x / 10) | 0) : ' ';
console.log(head);
for (let y = y0; y <= y1; y++) {
  let row = String(y).padStart(3) + '  ';
  for (let x = x0; x <= x1; x++) {
    if (links.some((e) => e.tx === x && e.ty === y)) { row += 'S'; continue; }
    const t = g.map.tileOn(f, x, y);
    row += t === null || t === undefined ? '?' : (t === ' ' ? '.' : t);
  }
  console.log(row);
}
console.log('\nrows 10-18 = north wing, 19-28 = south-west leg (the L)');
