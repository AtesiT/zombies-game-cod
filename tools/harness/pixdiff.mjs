import { loadImage, createCanvas } from './node_modules/@napi-rs/canvas/index.js';
const [a, b] = process.argv.slice(2);
const img = async (p) => { const i = await loadImage(p); const c = createCanvas(i.width, i.height); const x = c.getContext('2d'); x.drawImage(i, 0, 0); return { d: x.getImageData(0, 0, i.width, i.height).data, w: i.width, h: i.height }; };
const A = await img(a), B = await img(b);
if (A.w !== B.w || A.h !== B.h) { console.log('size mismatch'); process.exit(1); }
let n = A.d.length / 4, changed = 0, big = 0, sum = 0, worst = 0;
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
for (let i = 0; i < n; i++) {
  const o = i * 4;
  const dl = Math.abs(lum(A.d, o) - lum(B.d, o));
  sum += dl; if (dl > worst) worst = dl;
  if (dl > 2) changed++;
  if (dl > 8) big++;
}
const meanLum = (d) => { let s = 0; for (let i = 0; i < n; i++) s += lum(d, i * 4); return s / n; };
console.log(`${a} vs ${b}`);
console.log(`  pixels ${n}   mean |dLuma| ${(sum / n).toFixed(2)}   worst ${worst.toFixed(0)}`);
console.log(`  changed >2 luma: ${changed} (${(changed / n * 100).toFixed(2)}%)   >8 luma: ${big} (${(big / n * 100).toFixed(2)}%)`);
console.log(`  mean luma: before ${meanLum(A.d).toFixed(1)}  after ${meanLum(B.d).toFixed(1)}`);
