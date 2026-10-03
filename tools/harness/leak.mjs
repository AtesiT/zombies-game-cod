// Do the "cached" glow sprites actually get reused, or does every frame bake
// a fresh 128x128 gradient canvas and leak it into the GLOWS map?
import { nc, load } from './stub.mjs';
const M = await load();
let canvases = 0, grads = 0, fills = 0, bytes = 0;
const doc = globalThis.document;
const rawCreate = doc.createElement;
doc.createElement = (t) => {
  if (t !== 'canvas') return rawCreate(t);
  canvases++;
  const c = nc();
  let w = 0, h = 0;
  Object.defineProperty(c, 'width', { get: () => w, set: (v) => { w = v; bytes += v * (h || 150) * 4; } });
  Object.defineProperty(c, 'height', { get: () => h, set: (v) => { h = v; bytes += (w || 300) * v * 4; } });
  const raw = c.getContext.bind(c);
  c.getContext = (k) => {
    const x = raw(k);
    const g = x.createRadialGradient.bind(x);
    x.createRadialGradient = (...a) => { grads++; return g(...a); };
    const f = x.fillRect.bind(x);
    x.fillRect = (...a) => { fills++; return f(...a); };
    return x;
  };
  return c;
};
const light = await import(process.env.SRC + '/lighting.js').catch(() => null);
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin();
console.log(`power ON at frame 0 (this is what the player does around round 3-5)`);
g.power = true; g.powerOn = true;
g.player.hurt = () => false;
let frames = 0;
const report = (tag) => {
  console.log(`${tag.padEnd(22)} canvases/frame ${(canvases / frames).toFixed(2).padStart(6)}  gradients/frame ${(grads / frames).toFixed(2).padStart(6)}  leaked ${(bytes / 1048576).toFixed(1).padStart(8)} MB  heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0).padStart(4)} MB`);
  canvases = 0; grads = 0; frames = 0;
};
for (let f = 0; f < 120 * 40; f++) {
  g.player.hp = 100;
  g.update(H);
  if (f % 2 === 0) { g.draw(cx); frames++; }
  if (f === 120 * 5) report('after 5s w/ power');
  if (f === 120 * 20) report('after 20s w/ power');
}
report('after 40s w/ power');
