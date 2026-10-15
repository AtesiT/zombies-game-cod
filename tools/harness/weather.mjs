// Software Canvas probe only: not browser FPS, audible validation, or a memory certification.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M=await load(),data=JSON.parse(await readFile(new URL('../../assets/maps/registry.json',import.meta.url)));
const seconds=Number(process.argv[2]??3);
for(const map of data.maps){
 const g=new M.Game(new M.Input(nc(800,500)));
 await g.mapManager.load('',async()=>({ok:true,json:async()=>structuredClone(data)}));g.playMap(map.id);g.dayNight.force(Number(process.argv[3]??12));g.dayNight.toggle();g.debug.god=true;g.roundActive=false;g.intermission=1e9;
 let spawn=0;const add=()=>{const s=g.map.spawnPoints[spawn++%g.map.spawnPoints.length];const z=g.makeZombie({...s,floor:0},spawn%5===0&&g.dayNight.period==='night'?'night-stalker':'walker');z.pos={x:s.x,y:s.y};z.state=1;g.zombies.push(z);};
 const ctx=nc(800,500).getContext('2d');
 for(const mode of ['clear','rain','fog','storm','snow']){
  g.weatherManager.force(mode,{immediate:true});const times=[];
  for(let i=0;i<seconds*60;i++){g.zombies=g.zombies.filter(z=>!z.dead&&!z.remove);while(g.zombies.length<100)add();const t=performance.now();g.update(1/60);g.draw(ctx);g.input.endFrame();times.push(performance.now()-t);assert.ok(g.weatherManager.rain.items.length<=160);assert.ok(g.weatherManager.snow.prints.length<=256);for(const z of g.zombies)assert.ok(Number.isFinite(z.pos.x)&&Number.isFinite(z.pos.y));}
  times.sort((a,b)=>a-b);console.log(JSON.stringify({map:map.id,weather:mode,hour:g.dayNight.hour,zombies:g.zombies.length,seconds,medianMs:+times[Math.floor(times.length*.5)].toFixed(2),p95Ms:+times[Math.floor(times.length*.95)].toFixed(2),particles:g.weatherManager.rain.items.length+g.weatherManager.snow.items.length,tracks:g.weatherManager.snow.prints.length}));
 }
 g.weatherManager.dispose();g.environment?.dispose();g.bus?.dispose();
}
