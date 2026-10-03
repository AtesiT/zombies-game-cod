import { loadImage, createCanvas } from './node_modules/@napi-rs/canvas/index.js';
const img = async (p) => { const i = await loadImage(p); const c = createCanvas(i.width, i.height); const x = c.getContext('2d'); x.drawImage(i, 0, 0); return { d: x.getImageData(0, 0, i.width, i.height).data, w: i.width }; };
const A = await img(process.argv[2]), B = await img(process.argv[3]);
let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const rows = new Map();
for (let i = 0; i < A.d.length / 4; i++) {
  const o = i * 4;
  const d = Math.max(Math.abs(A.d[o]-B.d[o]), Math.abs(A.d[o+1]-B.d[o+1]), Math.abs(A.d[o+2]-B.d[o+2]));
  if (d > 40) { const x = i % A.w, y = (i / A.w) | 0; n++; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
    rows.set((y/40|0)*40, (rows.get((y/40|0)*40)||0)+1); }
}
console.log(`pixels >40: ${n}   bbox x ${x0}..${x1}  y ${y0}..${y1}`);
console.log('rows (y band -> count):', [...rows.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([y,c])=>`y${y}:${c}`).join('  '));
