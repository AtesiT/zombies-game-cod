// Ten simulated minutes per map, 100 actors, rendering at 1Hz. NOT a browser/60FPS memory gate.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M=await load(),data=JSON.parse(await readFile(new URL('../../assets/maps/registry.json',import.meta.url)));
const seconds=Number(process.argv[2]??600);
for(const map of data.maps){
 const g=new M.Game(new M.Input(nc(800,500)));await g.mapManager.load('',async()=>({ok:true,json:async()=>structuredClone(data)}));g.playMap(map.id);g.debug.god=true;g.roundActive=false;g.intermission=1e9;g.dayNight.force(16,{pause:false});g.dayNight.toggle();
 const ctx=nc(800,500).getContext('2d');let spawn=0,maxTracks=0,maxRain=0,maxSnow=0;
 for(let frame=0;frame<seconds*60;frame++){
  if(frame%(60*60)===0)g.weatherManager.force(['clear','rain','fog','storm','snow'][Math.floor(frame/3600)%5],{immediate:false});
  g.zombies=g.zombies.filter(z=>!z.dead&&!z.remove);
  while(g.zombies.length<100){const s=g.map.spawnPoints[spawn++%g.map.spawnPoints.length];const z=g.makeZombie({...s,floor:0},spawn%5===0&&g.dayNight.period==='night'?'night-stalker':'walker');z.pos={x:s.x,y:s.y};z.state=1;g.zombies.push(z);}
  g.update(1/60);g.input.endFrame();
  if(frame%60===0){g.draw(ctx);for(const z of g.zombies)assert.ok(Number.isFinite(z.pos.x)&&Number.isFinite(z.pos.y));const weather=JSON.parse(JSON.stringify(g.weatherManager.serialize()));g.weatherManager.restore(weather);const clock=JSON.parse(JSON.stringify(g.dayNight.serialize()));g.dayNight.restore(clock);}
  maxTracks=Math.max(maxTracks,g.weatherManager.snow.prints.length);maxRain=Math.max(maxRain,g.weatherManager.rain.items.length);maxSnow=Math.max(maxSnow,g.weatherManager.snow.items.length);
 }
 assert.ok(maxTracks<=256&&maxRain<=160&&maxSnow<=120);
 console.log(JSON.stringify({map:map.id,simulatedSeconds:seconds,renderHz:1,zombies:g.zombies.length,hour:+g.dayNight.hour.toFixed(2),maxTracks,maxRain,maxSnow,heapMB:+(process.memoryUsage().heapUsed/1048576).toFixed(1)}));
 g.weatherManager.dispose();g.dayNight.dispose();g.environment?.dispose();g.bus?.dispose();
}
console.log('FINAL SOFTWARE SOAK PASS');
